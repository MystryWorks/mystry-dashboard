import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const managerPath = path.join(scriptDirectory, 'panel-manager.ps1');

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function cleanEnvironment() {
  const environment = { ...process.env };
  for (const name of ['JWT_SECRET', 'SETUP_TOKEN', 'LAUNCHER_TOKEN', 'DATA_DIR']) {
    delete environment[name];
  }
  return environment;
}

function runPowerShell(command) {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { cwd: path.resolve(scriptDirectory, '../..'), env: cleanEnvironment(), encoding: 'utf8' },
  );
}

test('Invoke-Npm 不会把 npm 输出混入函数返回值', { skip: process.platform !== 'win32' }, () => {
  const result = runPowerShell(`
    $env:MMD_PANEL_MANAGER_LIBRARY_ONLY = '1'
    . ${quotePowerShell(managerPath)}
    $captured = @(Invoke-Npm -Arguments @('--version') -FailureMessageKey 'InstallFailed')
    if ($captured.Count -ne 0) { throw "Invoke-Npm 返回了 $($captured.Count) 个对象" }
  `);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('PanelManager 自动把三个重复密钥修复为不同值', { skip: process.platform !== 'win32' }, () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-panel-manager-test-'));
  try {
    const envPath = path.join(testRoot, 'panel.env');
    const envExamplePath = path.join(testRoot, 'panel.env.example');
    const launcherDirectory = path.join(testRoot, 'launcher');
    const duplicate = 'a'.repeat(64);
    const content = [
      `DATA_DIR=${path.join(testRoot, 'data')}`,
      `JWT_SECRET=${duplicate}`,
      `SETUP_TOKEN=${duplicate}`,
      `LAUNCHER_TOKEN=${duplicate}`,
      '',
    ].join('\r\n');
    fs.writeFileSync(envPath, content, 'utf8');
    fs.writeFileSync(envExamplePath, content, 'utf8');

    const result = runPowerShell(`
      $env:MMD_PANEL_MANAGER_LIBRARY_ONLY = '1'
      . ${quotePowerShell(managerPath)}
      $script:EnvPath = ${quotePowerShell(envPath)}
      $script:EnvExamplePath = ${quotePowerShell(envExamplePath)}
      $script:LauncherDir = ${quotePowerShell(launcherDirectory)}
      $script:EnvBackupPath = $null
      $configuration = Ensure-EnvironmentConfiguration
      $values = @(
        [string]$configuration.Environment.JWT_SECRET,
        [string]$configuration.Environment.SETUP_TOKEN,
        [string]$configuration.Environment.LAUNCHER_TOKEN
      )
      if (($values | Sort-Object -Unique).Count -ne 3) { throw '密钥仍然重复' }
      foreach ($value in $values) {
        if (-not (Test-ValidSecret $value)) { throw '密钥格式无效' }
      }
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(launcherDirectory, 'config-backups')), true);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

test('R1-03: 伪造健康响应时 Invoke-SafeShutdown 不得发送 LAUNCHER_TOKEN', { skip: process.platform !== 'win32' }, () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-panel-shutdown-test-'));
  try {
    const statePath = path.join(testRoot, 'state.json');
    const envPath = path.join(testRoot, 'panel.env');
    const launcherToken = 'b'.repeat(64);
    fs.writeFileSync(
      envPath,
      `JWT_SECRET=${'a'.repeat(64)}\r\nLAUNCHER_TOKEN=${launcherToken}\r\nPORT=3000\r\n`,
      'utf8',
    );
    fs.writeFileSync(
      statePath,
      `${JSON.stringify({ pid: process.pid, fingerprint: 'expected-fingerprint' })}\n`,
      'utf8',
    );

    const result = runPowerShell(`
      $env:MMD_PANEL_MANAGER_LIBRARY_ONLY = '1'
      . ${quotePowerShell(managerPath)}
      $script:StatePath = ${quotePowerShell(statePath)}
      $script:EnvPath = ${quotePowerShell(envPath)}
      $script:LauncherDir = ${quotePowerShell(testRoot)}
      $global:TokenSent = $false
      function Invoke-RestMethod {
        param(
          [string]$Uri,
          [hashtable]$Headers
        )
        if ($Headers -and $Headers['X-Launcher-Token']) {
          $global:TokenSent = $true
        }
        return @{ runningInstances = 0; runningTasks = 0; queuedTasks = 0 }
      }
      function Test-ManagedPanelProcessAlive { param([int]$ProcessId) return $true }
      function Get-PanelConnection {
        return @{
          ShutdownUrl = 'http://127.0.0.1:65535/shutdown'
          Environment = @{ LAUNCHER_TOKEN = '${launcherToken}' }
          Port = 3000
          Url = 'http://127.0.0.1:3000'
          HealthUrl = 'http://127.0.0.1:3000/api/health'
        }
      }
      function Get-PanelHealth {
        param([string]$ExpectedFingerprint)
        $body = @{
          ok = $true
          service = 'minecraft-mystery-dashboard'
          processFingerprint = 'wrong-fingerprint'
        }
        if ($ExpectedFingerprint -and ([string]$body.processFingerprint -ne [string]$ExpectedFingerprint)) {
          return $null
        }
        return $body
      }
      try {
        Invoke-SafeShutdown
        throw 'expected Invoke-SafeShutdown to fail'
      } catch {
        if ($global:TokenSent) { throw 'LAUNCHER_TOKEN was sent to shutdown endpoint' }
      }
      exit 0
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});
