import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { once, EventEmitter, getEventListeners } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import type { DeployCoreInput } from '@mystry/shared';

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.SETUP_TOKEN = randomBytes(32).toString('hex');
process.env.LAUNCHER_TOKEN = randomBytes(32).toString('hex');

test('Paper 缓存键使用解析后的 build，旧 latest 键不会命中', async () => {
  const { buildResolvedCoreCacheBasename } = await import('./core-depot.js');
  const resolved = buildResolvedCoreCacheBasename('paper', '1.21.1', { build: 42 });
  const legacy = 'paper-1.21.1-latest-.jar'.replace(/[^\w.-]+/g, '_');
  const current = resolved.replace(/[^\w.-]+/g, '_');
  assert.notEqual(current, legacy);
  assert.match(current, /paper-1\.21\.1-build-42\.jar/);
});

test('Fabric 缓存键包含解析后的 loader 与 installer', async () => {
  const { buildResolvedCoreCacheBasename } = await import('./core-depot.js');
  const resolved = buildResolvedCoreCacheBasename('fabric', '1.21.1', {
    loader: '0.16.9',
    installer: '1.0.1',
  });
  assert.match(resolved, /loader-0\.16\.9-installer-1\.0\.1/);
});

test('Forge 和 NeoForge JVM 参数文件可由 Java argfile 规则往返解析', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-user-jvm-args-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { writeUserJvmArgs } = await import('./core-depot.js');
  const { parseJvmArgFile } = await import('@mystry/shared');
  writeUserJvmArgs(dir, String.raw`-Xms1G -Xmx2G "-Dfolder=C:\Minecraft Server"`);
  assert.deepEqual(
    parseJvmArgFile(fs.readFileSync(path.join(dir, 'user_jvm_args.txt'), 'utf8')),
    ['-Xms1G', '-Xmx2G', String.raw`-Dfolder=C:\Minecraft Server`],
  );
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待测试条件超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function tempDir(t: import('node:test').TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-core-depot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function downloadFixture(t: import('node:test').TestContext) {
  const responses: ServerResponse[] = [];
  const server = createServer((_req, res) => {
    responses.push(res);
    res.writeHead(200, { 'Content-Length': 6 });
    res.write('abc');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/core.jar`, responses };
}

test('下载开始前取消：保留超时原因，不发请求、不创建临时文件', async (t) => {
  const dir = tempDir(t);
  const { downloadToFile } = await import('./core-download.js');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('不应请求'); });
  const controller = new AbortController();
  const reason = new Error('任务执行超时');
  controller.abort(reason);
  await assert.rejects(downloadToFile('http://unused.invalid', path.join(dir, 'core.jar'), undefined, controller.signal), (error) => error === reason);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('流式下载中取消：关闭响应、删除 part，保留已有完整缓存', async (t) => {
  const dir = tempDir(t);
  const { url, responses } = await downloadFixture(t);
  const { downloadToFile } = await import('./core-download.js');
  const dest = path.join(dir, 'core.jar');
  fs.writeFileSync(dest, '原有完整缓存');
  const controller = new AbortController();
  const reason = new Error('任务已取消');
  const result = assert.rejects(downloadToFile(url, dest, () => controller.abort(reason), controller.signal), (error) => error === reason);
  await result;
  await waitUntil(() => responses[0]?.destroyed === true);
  assert.equal(fs.readFileSync(dest, 'utf8'), '原有完整缓存');
  assert.deepEqual(fs.readdirSync(dir), ['core.jar']);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('缓存并发：仅下载一次，单个等待者取消不会中断其他任务', async (t) => {
  const dir = tempDir(t);
  const { url, responses } = await downloadFixture(t);
  const { ensureCoreCache } = await import('./core-download.js');
  const dest = path.join(dir, 'core.jar');
  const first = new AbortController();
  const second = new AbortController();
  const progress1: number[] = [];
  const progress2: number[] = [];
  const p1 = assert.rejects(ensureCoreCache(url, dest, (p) => progress1.push(p), first.signal), /任务已取消/);
  const p2 = ensureCoreCache(url, dest, (p) => progress2.push(p), second.signal);
  await waitUntil(() => progress1.length > 0 && progress2.length > 0);
  assert.equal(responses.length, 1);
  assert.equal(fs.existsSync(dest), false, '下载完成之前最终缓存不可见');
  first.abort(new Error('任务已取消'));
  await p1;
  const canceledProgressCount = progress1.length;
  assert.equal(responses[0]!.destroyed, false);
  responses[0]!.end('def');
  await p2;
  assert.equal(progress1.length, canceledProgressCount);
  assert.equal(progress2.at(-1), 1);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'abcdef');
  assert.deepEqual(fs.readdirSync(dir), ['core.jar']);
  await ensureCoreCache(url, dest);
  assert.equal(responses.length, 1, '完整缓存复用不应重复请求');
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  assert.equal(getEventListeners(second.signal, 'abort').length, 0);
});

test('缓存所有等待者取消：终止下载、清理 part，后续可重新下载', async (t) => {
  const dir = tempDir(t);
  const { url, responses } = await downloadFixture(t);
  const { ensureCoreCache } = await import('./core-download.js');
  const dest = path.join(dir, 'core.jar');
  const controllers = [new AbortController(), new AbortController()];
  let progressSeen = false;
  const results = controllers.map((controller) => assert.rejects(
    ensureCoreCache(url, dest, () => { progressSeen = true; }, controller.signal), /任务已取消/,
  ));
  await waitUntil(() => progressSeen);
  controllers.forEach((controller) => controller.abort(new Error('任务已取消')));
  await Promise.all(results);
  await waitUntil(() => responses[0]?.destroyed === true && fs.readdirSync(dir).length === 0);
  const retry = ensureCoreCache(url, dest);
  await waitUntil(() => responses.length === 2);
  responses[1]!.end('def');
  await retry;
  assert.equal(fs.readFileSync(dest, 'utf8'), 'abcdef');
  assert.deepEqual(fs.readdirSync(dir), ['core.jar']);
});

type FakeInstaller = EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid?: number; kill: (signal?: string) => boolean };

function installerFixture(t: import('node:test').TestContext, onSpawn?: (child: FakeInstaller, cwd: string) => void) {
  const children: FakeInstaller[] = [];
  const kills: unknown[][] = [];
  const spawnMock = t.mock.method(childProcess, 'spawn', (...args: unknown[]) => {
    if (args[0] === 'taskkill') {
      kills.push(args);
      return new EventEmitter();
    }
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), pid: 87654321,
      kill: (signal?: string) => { kills.push([signal]); return true; },
    });
    children.push(child);
    onSpawn?.(child, (args[2] as { cwd: string }).cwd);
    return child;
  });
  // 内建模块的具名导入需同步替身；任何测试都不向真实 PID 发送信号。
  const killMock = t.mock.method(process, 'kill', (...args: unknown[]) => { kills.push(args); return true; });
  syncBuiltinESMExports();
  t.after(() => {
    spawnMock.mock.restore();
    killMock.mock.restore();
    syncBuiltinESMExports();
    children.forEach((child) => { child.stdout.destroy(); child.stderr.destroy(); });
  });
  return { children, kills, spawnMock };
}

test('安装器退出：零退出成功，非零和启动错误失败，清理监听器且不重复完成', async (t) => {
  const { children } = installerFixture(t);
  const { runInstaller } = await import('./core-installer.js');
  for (const outcome of ['success', 'failure', 'signal', 'error'] as const) {
    const controller = new AbortController();
    const run = runInstaller('installer.jar', tempDir(t), 'java', controller.signal);
    const result = outcome === 'success' ? run : assert.rejects(run,
      outcome === 'failure' ? /退出码 7.*\n.*安装失败/s : outcome === 'signal' ? /退出码 未知/ : /无法启动/);
    const child = children.at(-1)!;
    child.stderr.emit('data', Buffer.from('安装失败'));
    child.stdout.emit('error', new Error('EPIPE'));
    child.stderr.emit('error', new Error('EPIPE'));
    if (outcome === 'error') child.emit('error', new Error('无法启动'));
    child.emit('close', outcome === 'signal' ? null : outcome === 'success' ? 0 : 7);
    await result;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
  assert.equal(children.length, 4, '非网络失败不得重试');
});

test('安装器网络失败最多重试一次，保留最终中文诊断', async (t) => {
  const { children } = installerFixture(t);
  const { runInstaller } = await import('./core-installer.js');
  const controller = new AbortController();
  const messages: string[] = [];
  const result = assert.rejects(runInstaller('installer.jar', tempDir(t), 'java', controller.signal, (_p, message) => messages.push(message)), /已自动重试 1 次.*域名解析失败/);
  children[0]!.stderr.emit('data', Buffer.from('UnknownHostException'));
  children[0]!.emit('close', 1);
  await waitUntil(() => children.length === 2);
  children[1]!.stderr.emit('data', Buffer.from('UnknownHostException'));
  children[1]!.emit('close', 1);
  await result;
  assert.equal(children.length, 2);
  assert.ok(messages.some((message) => message.includes('自动重试')));
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('安装器取消：等待退出才释放；缺少 close 时强杀兜底；零退出也不能覆盖取消', async (t) => {
  const { config } = await import('../config.js');
  const grace = config.installerKillGraceMs;
  config.installerKillGraceMs = 20;
  t.after(() => { config.installerKillGraceMs = grace; });
  const { children, kills } = installerFixture(t);
  const { runInstaller } = await import('./core-installer.js');
  for (const sendsClose of [true, false]) {
    const controller = new AbortController();
    const reason = new Error('任务执行超时');
    let settled = false;
    const result = assert.rejects(runInstaller('installer.jar', tempDir(t), 'java', controller.signal).finally(() => { settled = true; }), (error) => error === reason);
    controller.abort(reason);
    await Promise.resolve();
    assert.equal(settled, false, '发出终止请求不等于子进程已经退出');
    if (sendsClose) children.at(-1)!.emit('close', 0);
    await result;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
  assert.equal(children.length, 2, '取消不得启动重试');
  assert.equal(kills.length, 3, '两次取消加一次强杀兜底');
});

test('部署落地后关闭：五种核心均继续注册并完成任务', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-core-depot-'));
  const originalDataDir = process.env.MYSTRY_DATA_DIR;
  process.env.MYSTRY_DATA_DIR = dir;
  const { initDb, closeDb } = await import('../db.js');
  const { deployCore } = await import('./core-depot.js');
  const { getInstanceRow } = await import('./instance-service.js');
  const { getTask, shutdownTasks, resetTaskRuntimeForTests } = await import('./task-service.js');
  initDb();
  t.after(async () => {
    await shutdownTasks();
    resetTaskRuntimeForTests();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.MYSTRY_DATA_DIR;
    else process.env.MYSTRY_DATA_DIR = originalDataDir;
  });
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const value = String(url);
    if (value.includes('version_manifest')) return Response.json({ versions: [{ id: '1.21.1', url: 'https://fixture.invalid/detail' }] });
    if (value.endsWith('/detail')) return Response.json({ downloads: { server: { url: 'https://fixture.invalid/core.jar' } } });
    if (value.includes('fill.papermc.io')) return Response.json([{ id: 42, channel: 'STABLE', downloads: { 'server:default': { url: 'https://fixture.invalid/core.jar' } } }]);
    return new Response('测试核心文件');
  });
  installerFixture(t, (child, cwd) => {
    fs.writeFileSync(path.join(cwd, 'server.jar'), '安装器生成的服务端');
    queueMicrotask(() => child.emit('close', 0));
  });
  const rename = fs.renameSync;
  let promotedId = '';
  let closing: Promise<void> | undefined;
  t.mock.method(fs, 'renameSync', (source: fs.PathLike, dest: fs.PathLike) => {
    rename(source, dest);
    if (path.dirname(String(dest)) === path.join(dir, 'instances')) {
      promotedId = path.basename(String(dest));
      assert.equal(getInstanceRow(promotedId), null, '重命名时尚未注册');
      closing = shutdownTasks();
    }
  });
  for (const coreType of ['vanilla', 'paper', 'fabric', 'forge', 'neoforge'] as const) {
    resetTaskRuntimeForTests();
    promotedId = '';
    closing = undefined;
    const input: DeployCoreInput = { name: `顺序测试-${coreType}`, coreType, mcVersion: '1.21.1', loaderVersion: '1.0.0', installerVersion: '1.0.0', acceptEula: true };
    const task = await deployCore(input);
    await waitUntil(() => ['completed', 'failed'].includes(getTask(task.id)!.status));
    await closing;
    const current = getTask(task.id)!;
    assert.equal(current.status, 'completed', current.error);
    assert.equal(current.result?.instanceId, promotedId);
    const row = getInstanceRow(promotedId)!;
    assert.equal(row.name, input.name);
    assert.equal(row.core_type, coreType);
    assert.equal(row.jar_file, 'server.jar');
    assert.ok(row.ownership_marker);
    assert.equal(fs.readFileSync(path.join(dir, 'instances', promotedId, 'eula.txt'), 'utf8'), 'eula=true\n');
    assert.equal(fs.existsSync(path.join(dir, '.mystry-staging', task.id)), false);
  }
});

test('部署落地前失败或取消：清理 staging、不注册实例、不遗留最终目录', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-core-depot-'));
  const originalDataDir = process.env.MYSTRY_DATA_DIR;
  process.env.MYSTRY_DATA_DIR = dir;
  const { initDb, closeDb, getDb } = await import('../db.js');
  const { deployCore } = await import('./core-depot.js');
  const { getTask, shutdownTasks, resetTaskRuntimeForTests } = await import('./task-service.js');
  initDb();
  t.after(async () => {
    await shutdownTasks();
    resetTaskRuntimeForTests();
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.MYSTRY_DATA_DIR;
    else process.env.MYSTRY_DATA_DIR = originalDataDir;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('测试核心文件'));
  let closing: Promise<void> | undefined;
  installerFixture(t, (child) => {
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from('安装失败'));
      child.emit('close', 7);
    });
  });
  const copy = fs.copyFileSync;
  t.mock.method(fs, 'copyFileSync', (source: fs.PathLike, dest: fs.PathLike, mode?: number) => {
    copy(source, dest, mode);
    if (path.basename(String(dest)) === 'server.jar') closing = shutdownTasks();
  });
  for (const coreType of ['fabric', 'forge'] as const) {
    resetTaskRuntimeForTests();
    const task = await deployCore({ name: '失败清理', coreType, mcVersion: '1.21.1', loaderVersion: '1.0.0', installerVersion: '1.0.0' });
    await waitUntil(() => getTask(task.id)!.status === 'failed');
    await closing;
    assert.match(getTask(task.id)!.error!, coreType === 'fabric' ? /任务已取消/ : /退出码 7/);
    assert.equal(getDb().prepare('SELECT count(*) AS count FROM instances').get()!.count, 0);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'instances')), []);
    assert.equal(fs.existsSync(path.join(dir, '.mystry-staging', task.id)), false);
  }
});
