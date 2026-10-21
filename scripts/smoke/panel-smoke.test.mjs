import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const START_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 15_000;
const blockedEnvNames = [
  'JWT_SECRET',
  'SETUP_TOKEN',
  'LAUNCHER_TOKEN',
  'DATA_DIR',
  'MYSTRY_DATA_DIR',
  'MYSTRY_HOME',
  'MYSTRY_CONFIG_PATH',
  'MYSTRY_PROCESS_FINGERPRINT',
  'HOST',
  'PORT',
  'DOTENV_CONFIG_PATH',
  'NODE_OPTIONS',
];

const protectedPaths = [
  '/api/auth/me',
  '/api/instances',
  '/api/nodes',
  '/api/tasks',
  '/api/system/metrics',
  '/api/import/sources',
  '/api/instances/not-created/files',
];

function redact(text) {
  return text.replace(/[0-9a-fA-F]{64}/g, '[redacted]');
}

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== ''
    && !relative.startsWith('..')
    && !path.isAbsolute(relative);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function distinctSecrets() {
  const values = new Set();
  while (values.size < 3) values.add(crypto.randomBytes(32).toString('hex'));
  return [...values];
}

function wrongSecret(secret) {
  const flipped = secret[0] === '0' ? '1' : '0';
  return `${flipped}${secret.slice(1)}`;
}

function panelEnv(overrides) {
  const blocked = new Set(blockedEnvNames);
  const env = {};
  // Windows 环境块不区分大小写，展开后的对象却区分；Data_Dir 这类写法必须一并丢掉。
  // NODE_OPTIONS 整段不继承：只裁掉 --inspect 会把 --inspect-port 截成非法的 -port。
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const comparable = process.platform === 'win32' ? key.toUpperCase() : key;
    if (blocked.has(comparable)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (childHasExited(child)) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.once('exit', (code) => finish(code ?? 1));
    if (childHasExited(child)) finish(child.exitCode);
  });
}

async function removeTemp(tempRoot) {
  const resolvedTemp = path.resolve(tempRoot);
  // 只删除系统临时目录内的演练目录，避免路径异常时误删用户数据。
  if (!isInside(os.tmpdir(), resolvedTemp)) {
    throw new Error(`拒绝删除临时目录之外的路径：${resolvedTemp}`);
  }
  await fs.rm(resolvedTemp, {
    recursive: true,
    force: true,
    maxRetries: 15,
    retryDelay: 500,
  });
}

async function shallowSnapshot(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  const rows = [];
  for (const entry of entries) {
    const stat = await fs.lstat(path.join(dir, entry.name));
    rows.push(`${entry.name}\t${stat.mtimeMs}\t${stat.size}`);
  }
  rows.sort();
  return rows.join('\n');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 200);
    }
  }
  return { status: response.status, body };
}

function formatBody(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return redact(text ?? '').slice(0, 200);
}

function assertUnauthorized(result, label) {
  assert.equal(result.status, 401, `${label} 应返回 401，实际 ${result.status} ${formatBody(result.body)}`);
  assert.equal(
    typeof result.body?.error === 'string' && result.body.error.length > 0,
    true,
    `${label} 的拒绝响应应包含非空 error`,
  );
}

test('隔离数据目录启动面板并拒绝未登录访问', { timeout: 90_000 }, async (t) => {
  const sharedEntry = path.join(repoRoot, 'packages', 'shared', 'dist', 'index.js');
  try {
    await fs.access(sharedEntry);
  } catch {
    throw new Error('缺少 @mystry/shared 构建产物。请先运行 npm run build -w @mystry/shared');
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mystry-panel-smoke-'));
  let child = null;
  t.after(async () => {
    // Windows 上 kill 不会投递 SIGINT，失败路径只能强行结束子进程。
    if (child && !childHasExited(child)) {
      child.kill();
      await waitForExit(child, 5_000);
    }
    await removeTemp(tempRoot);
  });

  const dataDir = path.join(tempRoot, 'data');
  const repoData = path.resolve(repoRoot, 'data');
  assert.equal(isInside(tempRoot, dataDir), true);
  assert.equal(isInside(repoData, dataDir), false);
  assert.notEqual(path.resolve(dataDir), repoData);

  let logs = '';
  const appendLog = (chunk) => {
    logs += chunk;
    if (logs.length > 16_000) logs = logs.slice(-16_000);
  };

  const port = await reservePort();
  assert.equal(port > 0, true);
  const fingerprint = `smoke-${crypto.randomBytes(8).toString('hex')}`;
  const [jwtSecret, setupToken, launcherToken] = distinctSecrets();
  let loader;
  try {
    loader = import.meta.resolve('tsx');
  } catch {
    throw new Error('找不到 tsx。请先在仓库根目录执行 npm install');
  }
  const serverEntry = path.join(repoRoot, 'apps', 'server', 'src', 'index.ts');
  const repoDataBefore = await shallowSnapshot(repoData);
  let startupError = null;
  child = spawn(process.execPath, [
    '--experimental-sqlite',
    '--import',
    loader,
    serverEntry,
  ], {
    cwd: tempRoot,
    env: panelEnv({
      MYSTRY_HOME: tempRoot,
      MYSTRY_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: jwtSecret,
      SETUP_TOKEN: setupToken,
      LAUNCHER_TOKEN: launcherToken,
      MYSTRY_PROCESS_FINGERPRINT: fingerprint,
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.once('error', (error) => {
    startupError = error;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  let health = null;
  let lastFailure = '尚未收到响应';
  while (Date.now() < deadline) {
    if (startupError) {
      throw new Error(`面板进程启动失败：${startupError.message}\n${redact(logs)}`);
    }
    if (childHasExited(child)) {
      throw new Error(`面板进程提前退出，code=${child.exitCode} signal=${child.signalCode}\n${redact(logs)}`);
    }
    try {
      const result = await requestJson(`${baseUrl}/api/health`);
      if (
        result.status === 200
        && result.body?.ok === true
        && result.body?.service === 'mystry-dashboard'
        && result.body?.processFingerprint === fingerprint
      ) {
        health = result.body;
        break;
      }
      if (result.status === 200 && result.body?.processFingerprint && result.body.processFingerprint !== fingerprint) {
        throw new Error('健康检查命中了其他面板进程');
      }
      lastFailure = `HTTP ${result.status} ${formatBody(result.body)}`;
    } catch (error) {
      if (error instanceof Error && error.message === '健康检查命中了其他面板进程') throw error;
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(health, `健康检查超时：${lastFailure}\n${redact(logs)}`);

  const authStatus = await requestJson(`${baseUrl}/api/auth/status`);
  assert.equal(authStatus.status, 200, `认证状态接口异常：${formatBody(authStatus.body)}`);
  assert.equal(authStatus.body?.needsSetup, true);

  for (const routePath of protectedPaths) {
    assertUnauthorized(await requestJson(`${baseUrl}${routePath}`), routePath);
  }

  assertUnauthorized(
    await requestJson(`${baseUrl}/api/launcher/shutdown`, { method: 'POST' }),
    '缺少启动器令牌',
  );
  const rejectedToken = wrongSecret(launcherToken);
  assertUnauthorized(
    await requestJson(`${baseUrl}/api/launcher/shutdown`, {
      method: 'POST',
      headers: { 'x-launcher-token': rejectedToken },
    }),
    '错误的启动器令牌',
  );
  assert.equal(child.exitCode, null, `只读检查期间面板退出了\n${redact(logs)}`);
  assert.equal(child.signalCode, null, `只读检查期间面板收到了信号\n${redact(logs)}`);

  const dbPath = path.join(dataDir, 'panel.db');
  await fs.access(dbPath);
  const realDb = await fs.realpath(dbPath);
  const realTemp = await fs.realpath(os.tmpdir());
  const realRepo = await fs.realpath(repoRoot);
  assert.equal(isInside(realTemp, realDb), true, `数据库不在系统临时目录内：${realDb}`);
  assert.equal(isInside(realRepo, realDb), false, `数据库解析后落在仓库内：${realDb}`);
  assert.equal(
    await shallowSnapshot(repoData),
    repoDataBefore,
    '冒烟过程中仓库 data/ 的直接子项发生变化',
  );

  const acceptedShutdown = await requestJson(`${baseUrl}/api/launcher/shutdown`, {
    method: 'POST',
    headers: { 'x-launcher-token': launcherToken },
  });
  assert.equal(
    acceptedShutdown.status,
    202,
    `启动器关闭未被接受：${acceptedShutdown.status} ${formatBody(acceptedShutdown.body)}`,
  );
  assert.equal(acceptedShutdown.body?.accepted, true);

  const exitCode = await waitForExit(child, STOP_TIMEOUT_MS);
  if (exitCode === null && !childHasExited(child)) {
    child.kill();
    await waitForExit(child, 5_000);
    assert.fail(`启动器关闭后进程未退出\n${redact(logs)}`);
  }
  assert.equal(exitCode, 0, `面板关闭退出码异常\n${redact(logs)}`);
  assert.equal(
    await shallowSnapshot(repoData),
    repoDataBefore,
    '面板关闭后仓库 data/ 的直接子项发生变化',
  );
});
