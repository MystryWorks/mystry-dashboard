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
