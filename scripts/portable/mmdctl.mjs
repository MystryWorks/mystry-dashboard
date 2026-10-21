#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVICE_NAME = 'minecraft-mystry-dashboard';
const SECRET_PATTERN = /^[0-9a-f]{64}$/i;
const INTERNAL_FINALIZE_SETUP = '__finalize-setup';
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);

function discoverHome() {
  if (process.env.MMD_HOME?.trim()) return path.resolve(process.env.MMD_HOME.trim());
  const portableCandidate = path.resolve(scriptDir, '..');
  if (fs.existsSync(path.join(portableCandidate, 'app', 'server', 'dist', 'index.js'))) {
    return portableCandidate;
  }
  return path.resolve(scriptDir, '..', '..');
}

function resolveFromHome(value, homeDir) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(homeDir, value);
}

const homeDir = discoverHome();
const configPath = resolveFromHome(
  process.env.MMD_CONFIG_PATH?.trim() || path.join('config', 'panel.env'),
  homeDir,
);
const dataDir = resolveFromHome(process.env.MMD_DATA_DIR?.trim() || 'data', homeDir);
const logDir = path.join(homeDir, 'logs');
const launcherDir = path.join(dataDir, 'launcher');
const statePath = path.join(launcherDir, 'state.json');
const lockPath = path.join(launcherDir, 'mmdctl.lock');
const stdoutLog = path.join(logDir, 'panel.stdout.log');
const stderrLog = path.join(logDir, 'panel.stderr.log');
const portableServerEntry = path.join(homeDir, 'app', 'server', 'dist', 'index.js');
const repositoryServerEntry = path.join(homeDir, 'apps', 'server', 'dist', 'index.js');
const portableMode = fs.existsSync(portableServerEntry);
const serverEntry = portableMode
  ? portableServerEntry
  : repositoryServerEntry;
const managerLabel = portableMode ? '便携版' : '源码版';
const managerCommand = portableMode ? 'mmdctl' : 'PanelManager.sh';
const bundledNode = process.platform === 'win32'
  ? path.join(homeDir, 'runtime', 'node.exe')
  : path.join(homeDir, 'runtime', 'bin', 'node');
const nodeExecutable = fs.existsSync(bundledNode) ? bundledNode : process.execPath;

function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function parseEnv(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    result.set(key, line.slice(separator + 1).trim());
  }
  return result;
}

function setEnvLine(lines, name, value) {
  const pattern = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (value === null) {
    if (index < 0) return false;
    lines.splice(index, 1);
    return true;
  }
  const next = `${name}=${value}`;
  if (index >= 0) {
    if (lines[index] === next) return false;
    lines[index] = next;
    return true;
  }
  if (lines.length > 0 && lines.at(-1) !== '') lines.push('');
  lines.push(next);
  return true;
}

async function writeAtomic(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  await fsp.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fsp.rename(temporary, filePath);
  if (process.platform !== 'win32') await fsp.chmod(filePath, 0o600);
}

async function databaseNeedsSetup() {
  const databasePath = path.join(dataDir, 'panel.db');
  if (!fs.existsSync(databasePath)) return true;
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < 15_000) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
      try {
        const table = database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
          .get();
        if (!table) return true;
        const count = database.prepare('SELECT COUNT(*) AS count FROM users').get();
        return !count || Number(count.count) === 0;
      } finally {
        database.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 面板重启收尾期间数据库可能短暂被写锁占用，等待后重试。
      if (!/database is locked|SQLITE_BUSY/.test(message)) {
        throw new Error(`无法检查管理员初始化状态：${message}`);
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `无法检查管理员初始化状态：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function backupConfiguration() {
  if (!fs.existsSync(configPath)) return null;
  const backupDir = path.join(path.dirname(configPath), 'backups');
  await fsp.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `panel-${stamp}.env.bak`);
  await fsp.copyFile(configPath, backupPath, fs.constants.COPYFILE_EXCL);
  if (process.platform !== 'win32') await fsp.chmod(backupPath, 0o600);
  return backupPath;
}

async function ensureConfiguration() {
  await Promise.all([
    fsp.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 }),
    fsp.mkdir(dataDir, { recursive: true, mode: 0o700 }),
    fsp.mkdir(logDir, { recursive: true, mode: 0o700 }),
    fsp.mkdir(launcherDir, { recursive: true, mode: 0o700 }),
  ]);

  const existed = fs.existsSync(configPath);
  const original = existed
    ? await fsp.readFile(configPath, 'utf8')
    : [
        '# Minecraft Mystry Dashboard 配置',
        '# 本文件包含密钥，不要上传、分享或放入版本控制。',
        'HOST=127.0.0.1',
        'PORT=3000',
        'JWT_EXPIRES_IN=2h',
        'CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000',
        '',
      ].join('\n');
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  let values = parseEnv(original);
  let changed = !existed;
  let repaired = false;

  for (const name of ['JWT_SECRET', 'LAUNCHER_TOKEN']) {
    const current = values.get(name);
    if (!current || !SECRET_PATTERN.test(current)) {
      changed = setEnvLine(lines, name, randomSecret()) || changed;
      repaired = repaired || Boolean(current);
    }
  }

  values = parseEnv(lines.join('\n'));
  if (values.get('JWT_SECRET') === values.get('LAUNCHER_TOKEN')) {
    changed = setEnvLine(lines, 'LAUNCHER_TOKEN', randomSecret()) || changed;
    repaired = true;
  }

  const needsSetup = await databaseNeedsSetup();
  values = parseEnv(lines.join('\n'));
  if (needsSetup) {
    const current = values.get('SETUP_TOKEN');
    if (!current || !SECRET_PATTERN.test(current)) {
      changed = setEnvLine(lines, 'SETUP_TOKEN', randomSecret()) || changed;
      repaired = repaired || Boolean(current);
    }
  } else {
    changed = setEnvLine(lines, 'SETUP_TOKEN', null) || changed;
  }

  values = parseEnv(lines.join('\n'));
  if (
    needsSetup
    && (values.get('SETUP_TOKEN') === values.get('JWT_SECRET')
      || values.get('SETUP_TOKEN') === values.get('LAUNCHER_TOKEN'))
  ) {
    changed = setEnvLine(lines, 'SETUP_TOKEN', randomSecret()) || changed;
    repaired = true;
  }

  if (changed) {
    const backup = existed ? await backupConfiguration() : null;
    let content = lines.join('\n').replace(/\n+$/, '');
    content += '\n';
    await writeAtomic(configPath, content);
    if (backup) console.log(`配置已备份：${backup}`);
    if (!existed) console.log(`已创建${managerLabel}配置：${configPath}`);
    if (repaired) console.warn('检测到缺失或无效密钥，已备份配置并生成新的随机密钥。');
  }

  values = parseEnv(await fsp.readFile(configPath, 'utf8'));
  return {
    values,
    needsSetup,
    setupToken: needsSetup ? values.get('SETUP_TOKEN') ?? null : null,
  };
}

async function loadConfiguration() {
  if (!fs.existsSync(configPath)) return null;
  return parseEnv(await fsp.readFile(configPath, 'utf8'));
}

function parsePort(values) {
  const raw = process.env.PORT?.trim() || values?.get('PORT') || '3000';
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 必须是 1 到 65535 的整数：${raw}`);
  }
  return port;
}

function getConnection(values) {
  const host = process.env.HOST?.trim() || values?.get('HOST') || '127.0.0.1';
  const port = parsePort(values);
  const browserHost = ['0.0.0.0', '::', '[::]'].includes(host) ? '127.0.0.1' : host;
  return {
    port,
    url: `http://${browserHost}:${port}`,
    healthUrl: `http://${browserHost}:${port}/api/health`,
    authStatusUrl: `http://${browserHost}:${port}/api/auth/status`,
    shutdownUrl: `http://127.0.0.1:${port}/api/launcher/shutdown`,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 2_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getHealth(values, expectedFingerprint = null) {
  try {
    const connection = getConnection(values);
    const response = await fetchWithTimeout(connection.healthUrl);
    if (!response.ok) return null;
    const body = await response.json();
    if (body?.ok !== true || body?.service !== SERVICE_NAME) return null;
    if (
      expectedFingerprint
      && body?.processFingerprint !== expectedFingerprint
    ) {
      return null;
    }
    return body;
  } catch {
    return null;
  }
}

async function isPortOpen(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function childEnvironment(fingerprint) {
  return {
    ...process.env,
    MMD_HOME: homeDir,
    MMD_CONFIG_PATH: configPath,
    MMD_DATA_DIR: dataDir,
    MMD_PROCESS_FINGERPRINT: fingerprint,
  };
}

async function writeState(pid, startedAt, fingerprint, url) {
  await writeAtomic(
    statePath,
    `${JSON.stringify({ version: 1, pid, startedAt, fingerprint, url }, null, 2)}\n`,
  );
}

async function readState() {
  try {
    return JSON.parse(await fsp.readFile(statePath, 'utf8'));
  } catch {
    return null;
  }
}

async function clearState() {
  try {
    await fsp.unlink(statePath);
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}

function isProcessAlive(pid) {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireManagerLock() {
  await fsp.mkdir(launcherDir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fsp.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      await handle.close();
      return async () => {
        try {
          await fsp.unlink(lockPath);
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
            throw error;
          }
        }
      };
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
      const ownerText = await fsp.readFile(lockPath, 'utf8').catch(() => '');
      const owner = Number(ownerText.trim());
      if (isProcessAlive(owner)) throw new Error(`另一个 ${managerCommand} 正在运行，请稍后再试。`);
      await fsp.unlink(lockPath).catch(() => {});
    }
  }
  throw new Error('无法获取 mmdctl 运行锁。');
}

async function releaseCurrentManagerLock() {
  const ownerText = await fsp.readFile(lockPath, 'utf8').catch(() => '');
  if (Number(ownerText.trim()) !== process.pid) return;
  await fsp.unlink(lockPath).catch((error) => {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  });
}

function checkJava() {
  const result = spawnSync('java', ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    console.warn('警告：PATH 中未找到可用 Java。面板可以启动；默认实例无法启动，但可在面板中探测并选择其他已安装运行时。');
    return;
  }
  const line = `${result.stderr || result.stdout}`.split(/\r?\n/).find(Boolean)?.trim();
  console.log(`Java：${line || '已检测到'}`);
  const versionMatch = `${result.stderr || result.stdout}`.match(/\bversion\s+"(?:1\.)?(\d+)/i);
  const major = versionMatch ? Number(versionMatch[1]) : null;
  if (major === null) {
    console.warn('警告：无法识别默认 PATH Java 主版本，请在启动 Minecraft 实例前确认兼容性。');
  } else if (![8, 17, 21].includes(major)) {
    console.warn(
      `警告：检测到 Java ${major}；当前常见 Minecraft 服务端通常需要 Java 8、17 或 21，`
        + '请按服务端版本确认兼容性；已绑定实例以所选运行时为准。',
    );
  }
}

async function waitForHealth(
  values,
  expectedFingerprint = null,
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await getHealth(values, expectedFingerprint)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function openBrowser(values) {
  const url = getConnection(values).url;
  console.log(`面板地址：${url}`);
  if (process.env.MMD_NO_BROWSER === '1') return;
  const command = process.platform === 'win32'
    ? ['explorer.exe', [url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    console.warn('无法自动打开浏览器，请手动访问上面的地址。');
  }
}

function copySetupToken(token) {
  const commands = process.platform === 'win32'
    ? [['clip.exe', []]]
    : process.platform === 'darwin'
      ? [['pbcopy', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      input: token,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    if (!result.error && result.status === 0) return true;
  }
  return false;
}

function showSetupToken(token) {
  if (!token) return;
  if (copySetupToken(token)) {
    console.log('首次初始化令牌已复制到剪贴板，请粘贴到初始化页面。');
  } else {
    console.log(`首次初始化令牌：${token}`);
    console.log(`令牌也保存在：${configPath}`);
  }
}

async function spawnSetupFinalizer(values) {
  const child = spawn(
    nodeExecutable,
    ['--experimental-sqlite', scriptPath, INTERNAL_FINALIZE_SETUP],
    {
      cwd: homeDir,
      env: { ...childEnvironment('setup-finalizer'), MMD_NO_BROWSER: '1' },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();
  void values;
}

async function finalizeSetup() {
  const values = await loadConfiguration();
  if (!values?.get('SETUP_TOKEN')) return;
  const connection = getConnection(values);
  const deadline = Date.now() + 30 * 60_000;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(connection.authStatusUrl);
      const status = response.ok ? await response.json() : null;
      consecutiveFailures = 0;
      if (status?.needsSetup === false) {
        const original = await fsp.readFile(configPath, 'utf8');
        const lines = original.replace(/\r\n/g, '\n').split('\n');
        if (setEnvLine(lines, 'SETUP_TOKEN', null)) {
          await writeAtomic(configPath, `${lines.join('\n').replace(/\n+$/, '')}\n`);
        }
        return;
      }
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function rotateLogs() {
  await fsp.mkdir(logDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const current of [stdoutLog, stderrLog]) {
    if (!fs.existsSync(current)) continue;
    await fsp.rename(current, `${current}.${stamp}`);
  }
}

async function startBackground() {
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`找不到服务端构建产物：${serverEntry}`);
  }
  const configuration = await ensureConfiguration();
  const existingHealth = await getHealth(configuration.values);
  if (existingHealth) {
    const existingState = await readState();
    if (
      isProcessAlive(existingState?.pid)
      && existingState?.fingerprint
      && await getHealth(configuration.values, existingState.fingerprint)
    ) {
      console.log('面板已经在运行。');
      await openBrowser(configuration.values);
      return;
    }
    throw new Error('端口上已有无法由当前 mmdctl 指纹确认的面板，拒绝接管。');
  }
  const connection = getConnection(configuration.values);
  if (await isPortOpen(connection.port)) {
    throw new Error(`端口 ${connection.port} 已被其他程序占用。`);
  }

  checkJava();
  await rotateLogs();
  const nonce = crypto.randomBytes(16).toString('hex');
  const startedAt = new Date().toISOString();
  const stdout = fs.openSync(stdoutLog, 'a', 0o600);
  const stderr = fs.openSync(stderrLog, 'a', 0o600);
  const child = spawn(
    nodeExecutable,
    ['--experimental-sqlite', serverEntry, `--mmd-fingerprint=${nonce}`],
    {
      cwd: homeDir,
      env: childEnvironment(nonce),
      detached: true,
      stdio: ['ignore', stdout, stderr],
      windowsHide: true,
    },
  );
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  child.unref();
  await writeState(child.pid, startedAt, nonce, connection.url);

  if (!(await waitForHealth(configuration.values, nonce))) {
    if (isProcessAlive(child.pid)) child.kill();
    await clearState();
    const recent = await readRecentLogs(40);
    if (recent) console.error(recent);
    throw new Error('面板未能在 60 秒内启动，请检查日志。');
  }

  console.log(`面板已启动：${connection.url}`);
  await openBrowser(configuration.values);
  if (configuration.needsSetup) {
    showSetupToken(configuration.setupToken);
    await spawnSetupFinalizer(configuration.values);
  }
}

async function startForeground() {
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`找不到服务端构建产物：${serverEntry}`);
  }
  const configuration = await ensureConfiguration();
  const existingHealth = await getHealth(configuration.values);
  if (existingHealth) {
    const existingState = await readState();
    if (
      isProcessAlive(existingState?.pid)
      && existingState?.fingerprint
      && await getHealth(configuration.values, existingState.fingerprint)
    ) {
      console.log('面板已经在运行。');
      await openBrowser(configuration.values);
      return;
    }
    throw new Error('端口上已有无法由当前 mmdctl 指纹确认的面板，拒绝接管。');
  }
  const connection = getConnection(configuration.values);
  if (await isPortOpen(connection.port)) {
    throw new Error(`端口 ${connection.port} 已被其他程序占用。`);
  }

  checkJava();
  const nonce = crypto.randomBytes(16).toString('hex');
  const startedAt = new Date().toISOString();
  const child = spawn(
    nodeExecutable,
    ['--experimental-sqlite', serverEntry, `--mmd-fingerprint=${nonce}`],
    {
      cwd: homeDir,
      env: childEnvironment(nonce),
      stdio: 'inherit',
      windowsHide: false,
    },
  );
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  await writeState(child.pid, startedAt, nonce, connection.url);

  const forwardInterrupt = () => {
    if (isProcessAlive(child.pid)) child.kill('SIGINT');
  };
  const forwardTerminate = () => {
    if (isProcessAlive(child.pid)) child.kill('SIGTERM');
  };
  process.once('SIGINT', forwardInterrupt);
  process.once('SIGTERM', forwardTerminate);
  try {
    if (!(await waitForHealth(configuration.values, nonce))) {
      if (isProcessAlive(child.pid)) child.kill('SIGTERM');
      await exitPromise.catch(() => 1);
      throw new Error('面板未能在 60 秒内启动，请检查前台输出。');
    }
    await releaseCurrentManagerLock();
    console.log(`面板已启动：${connection.url}`);
    await openBrowser(configuration.values);
    if (configuration.needsSetup) {
      showSetupToken(configuration.setupToken);
      await spawnSetupFinalizer(configuration.values);
    }
    const exitCode = await exitPromise;
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    process.off('SIGINT', forwardInterrupt);
    process.off('SIGTERM', forwardTerminate);
    await clearState();
  }
}

async function stopPanel() {
  const values = await loadConfiguration();
  const state = await readState();
  const managedHealth = values
    && isProcessAlive(state?.pid)
    && state?.fingerprint
    ? await getHealth(values, state.fingerprint)
    : null;
  if (!values || !managedHealth) {
    if (values && await getHealth(values)) {
      throw new Error('检测到面板服务，但 PID 或进程指纹不匹配；拒绝停止未知进程。');
    }
    if (!isProcessAlive(state?.pid)) await clearState();
    console.log('面板未运行。');
    return;
  }
  const launcherToken = values.get('LAUNCHER_TOKEN');
  if (!launcherToken || !SECRET_PATTERN.test(launcherToken)) {
    throw new Error('LAUNCHER_TOKEN 缺失或格式无效，无法安全停止面板。');
  }
  const connection = getConnection(values);
  const response = await fetchWithTimeout(
    connection.shutdownUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Launcher-Token': launcherToken,
      },
      body: '{}',
    },
    10_000,
  );
  const summary = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(summary?.error || `安全停止请求失败：HTTP ${response.status}`);
  }
  console.log(
    `正在停止：${summary.runningInstances ?? 0} 个实例，`
      + `${summary.runningTasks ?? 0} 个运行任务，${summary.queuedTasks ?? 0} 个排队任务。`,
  );

  const timeoutMs = Math.min(
    30 * 60_000,
    60_000
      + 20_000 * Number(summary.runningInstances ?? 0)
      + 60_000 * Number(summary.runningTasks ?? 0),
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await getHealth(values, state.fingerprint))) {
      await clearState();
      console.log('面板已停止。');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`面板安全停止超时；为保护游戏数据，${managerCommand} 不会按 PID 强制结束进程。`);
}

async function showStatus() {
  const values = await loadConfiguration();
  const state = await readState();
  if (
    values
    && isProcessAlive(state?.pid)
    && state?.fingerprint
    && await getHealth(values, state.fingerprint)
  ) {
    const connection = getConnection(values);
    console.log(`状态：运行中  ${connection.url}`);
    if (state?.pid) console.log(`PID：${state.pid}`);
    return;
  }
  console.log('状态：未运行');
  if (values && await getHealth(values)) {
    console.warn('配置端口存在面板服务，但 PID 或进程指纹不匹配；不会自动接管或停止。');
    return;
  }
  if (isProcessAlive(state?.pid)) {
    console.warn(`检测到 PID ${state.pid} 仍存在，但健康检查不匹配；不会自动结束该进程。`);
  }
}

async function readRecentLogs(limit = 100) {
  const sections = [];
  for (const [label, filePath] of [['stderr', stderrLog], ['stdout', stdoutLog]]) {
    if (!fs.existsSync(filePath)) continue;
    const content = await fsp.readFile(filePath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    sections.push(`===== ${label} =====\n${lines.slice(-limit).join('\n')}`);
  }
  return sections.join('\n');
}

async function showLogs() {
  const content = await readRecentLogs();
  if (!content) {
    console.log('暂无日志。');
    return;
  }
  console.log(content);
}

function printHelp() {
  console.log([
    `Minecraft Mystry Dashboard ${managerLabel}管理器`,
    '',
    `用法：${managerCommand} <command>`,
    '',
    '命令：',
    '  start       后台启动面板',
    '  foreground  前台启动面板',
    '  stop        安全停止面板及实例',
    '  restart     安全重启面板',
    '  status      查看状态',
    '  logs        查看最近日志',
    '  open        打开管理页面',
    '  help        显示帮助',
    '',
    '启动器不会注册系统服务，也不会配置开机启动。',
  ].join('\n'));
}

async function interactiveMenu() {
  const values = await loadConfiguration();
  const state = await readState();
  const running = Boolean(
    values
    && isProcessAlive(state?.pid)
    && state?.fingerprint
    && await getHealth(values, state.fingerprint),
  );
  console.log('============================================================');
  console.log(`Minecraft Mystry Dashboard ${managerLabel}`);
  console.log('============================================================');
  console.log(running ? '状态：运行中' : '状态：未运行');
  console.log('');
  if (running) {
    console.log('[1] 打开面板（直接回车）');
    console.log('[2] 查看日志');
    console.log('[3] 重启面板');
    console.log('[4] 停止面板');
  } else {
    console.log('[1] 后台启动面板（直接回车）');
    console.log('[2] 前台启动并查看日志');
    console.log('[3] 查看最近日志');
  }
  console.log('[0] 退出');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await terminal.question('\n请选择：')).trim();
    if (answer === '0') return null;
    if (running) {
      return answer === '' || answer === '1'
        ? 'open'
        : answer === '2'
          ? 'logs'
          : answer === '3'
            ? 'restart'
            : answer === '4'
              ? 'stop'
              : 'help';
    }
    return answer === '' || answer === '1'
      ? 'start'
      : answer === '2'
        ? 'foreground'
        : answer === '3'
          ? 'logs'
          : 'help';
  } finally {
    terminal.close();
  }
}

async function runCommand(command) {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'status') {
    await showStatus();
    return;
  }
  if (command === 'logs') {
    await showLogs();
    return;
  }
  if (command === 'open') {
    await openBrowser(await loadConfiguration());
    return;
  }

  const releaseLock = await acquireManagerLock();
  try {
    if (command === 'start') {
      await startBackground();
      return;
    }
    if (command === 'foreground') {
      await startForeground();
      return;
    }
    if (command === 'stop') {
      await stopPanel();
      return;
    }
    if (command === 'restart') {
      await stopPanel();
      await startBackground();
      return;
    }
    throw new Error(`未知命令：${command}`);
  } finally {
    await releaseLock();
  }
}

async function main() {
  if (process.argv[2] === INTERNAL_FINALIZE_SETUP) {
    await finalizeSetup();
    return;
  }
  let command = process.argv[2];
  if (!command) {
    if (!process.stdin.isTTY) {
      printHelp();
      return;
    }
    command = await interactiveMenu();
    if (!command) return;
  }
  await runCommand(command);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
