/**
 * R0-02 / R0-03 进程互斥与停止语义回归骨架（批次 C 实现）。
 */
import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { InstanceRow } from '../db.js';

function prepareTempDataRoot(t: test.TestContext): string {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-process-mgr-test-'));
  t.after(async () => {
    try {
      const { closeDb } = await import('../db.js');
      closeDb();
    } catch {
      /* 模块可能尚未加载 */
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  process.env.MYSTRY_DATA_DIR = dataRoot;
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.SETUP_TOKEN = 'b'.repeat(64);
  return dataRoot;
}

function fakeChild(options?: { onKill?: (signal?: NodeJS.Signals) => void }): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    pid: Math.floor(Math.random() * 100_000) + 10_000,
    stdin,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    kill: (signal?: NodeJS.Signals) => {
      options?.onKill?.(signal);
      return true;
    },
  });
  setImmediate(() => child.emit('spawn'));
  return child;
}

test('R0-02: 并发 start 只应 spawn 一个受管 Minecraft 进程', async (t) => {
  prepareTempDataRoot(t);
  const { ProcessManager } = await import('./process-manager.js');
  const { initDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const info = createInstance({ name: 'concurrent-start' });
  const instanceDir = defaultInstanceDir(info.id);
  fs.writeFileSync(path.join(instanceDir, 'server.jar'), 'stub-jar');
  const row = getInstanceRow(info.id)!;

  let spawnCount = 0;
  const manager = new ProcessManager(
    () => {
      spawnCount += 1;
      return fakeChild();
    },
    async () => 'java',
  );

  await Promise.allSettled([
    manager.start(row as InstanceRow),
    manager.start(row as InstanceRow),
  ]);

  assert.equal(spawnCount, 1);
});

test('首次启动写入普通难度，已有 server.properties 不覆盖', async (t) => {
  prepareTempDataRoot(t);
  const { ProcessManager } = await import('./process-manager.js');
  const { initDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const missing = createInstance({ name: 'start-default-difficulty' });
  const existing = createInstance({ name: 'start-preserve-difficulty' });
  const missingDir = defaultInstanceDir(missing.id);
  const existingDir = defaultInstanceDir(existing.id);
  fs.writeFileSync(path.join(missingDir, 'server.jar'), 'stub-jar');
  fs.writeFileSync(path.join(existingDir, 'server.jar'), 'stub-jar');
  const existingProperties = 'difficulty=hard\nmotd=keep\n';
  fs.writeFileSync(path.join(existingDir, 'server.properties'), existingProperties, 'utf8');

  const manager = new ProcessManager(
    () => fakeChild(),
    async () => 'java',
  );
  await manager.start(getInstanceRow(missing.id)! as InstanceRow);
  await manager.start(getInstanceRow(existing.id)! as InstanceRow);

  assert.match(
    fs.readFileSync(path.join(missingDir, 'server.properties'), 'utf8'),
    /^difficulty=normal$/m,
  );
  assert.equal(
    fs.readFileSync(path.join(existingDir, 'server.properties'), 'utf8'),
    existingProperties,
  );
});

test('R0-03: 普通 stop 超时不得隐式 SIGKILL', async (t) => {
  prepareTempDataRoot(t);
  process.env.MYSTRY_TEST_STOP_GRACE_MS = '40';
  t.after(() => {
    delete process.env.MYSTRY_TEST_STOP_GRACE_MS;
  });

  const { ProcessManager, isInstanceStopPendingError } = await import('./process-manager.js');
  const { initDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const info = createInstance({ name: 'stop-timeout' });
  fs.writeFileSync(path.join(defaultInstanceDir(info.id), 'server.jar'), 'stub-jar');
  const row = getInstanceRow(info.id)!;

  const killSignals: Array<string | undefined> = [];
  const manager = new ProcessManager(
    () => fakeChild({ onKill: (signal) => killSignals.push(signal) }),
    async () => 'java',
  );

  await manager.start(row as InstanceRow);
  await assert.rejects(
    () => manager.stop(row.id),
    (err: unknown) => isInstanceStopPendingError(err),
  );
  assert.deepEqual(killSignals, []);
  assert.equal(manager.getStatus(row.id), 'stopping');
});

test('Forge 启动按规范参数重写 user_jvm_args.txt', async (t) => {
  prepareTempDataRoot(t);
  const { ProcessManager } = await import('./process-manager.js');
  const { initDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');
  const { parseJvmArgFile } = await import('@mystry/shared');

  initDb();
  const info = createInstance({
    name: 'forge-args',
    coreType: 'forge',
    jarFile: '@args:libraries/net/minecraftforge/forge/win_args.txt',
    jvmArgs: String.raw`-Xms1G -Xmx2G "-Dfolder=C:\Minecraft Server"`,
  });
  const instanceDir = defaultInstanceDir(info.id);
  const argsFile = path.join(instanceDir, 'libraries', 'net', 'minecraftforge', 'forge', 'win_args.txt');
  fs.mkdirSync(path.dirname(argsFile), { recursive: true });
  fs.writeFileSync(argsFile, '--launchTarget forge_server', 'utf8');
  const row = getInstanceRow(info.id)!;

  let spawnedArgs: readonly string[] = [];
  const manager = new ProcessManager(
    (_command, args) => {
      spawnedArgs = [...args];
      return fakeChild();
    },
    async () => 'java',
  );
  await manager.start(row as InstanceRow);

  assert.deepEqual(spawnedArgs, [
    '@user_jvm_args.txt',
    '@libraries/net/minecraftforge/forge/win_args.txt',
    'nogui',
  ]);
  assert.deepEqual(
    parseJvmArgFile(fs.readFileSync(path.join(instanceDir, 'user_jvm_args.txt'), 'utf8')),
    ['-Xms1G', '-Xmx2G', String.raw`-Dfolder=C:\Minecraft Server`],
  );
});

test('删除须等待未完成的 start，启动中不得拆掉目录', async (t) => {
  prepareTempDataRoot(t);
  const { processManager } = await import('./process-manager.js');
  const { initDb } = await import('../db.js');
  const { createInstance, deleteInstance, getInstanceRow } = await import('./instance-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const info = createInstance({ name: 'delete-lock' });
  const instanceDir = defaultInstanceDir(info.id);
  fs.writeFileSync(path.join(instanceDir, 'server.jar'), 'stub-jar');
  const row = getInstanceRow(info.id)!;

  let releaseJava!: () => void;
  const javaGate = new Promise<void>((resolve) => {
    releaseJava = resolve;
  });
  const singleton = processManager as unknown as {
    spawnMinecraft: (...args: unknown[]) => ChildProcessWithoutNullStreams;
    resolveJavaCommand: (id: string | null) => Promise<string>;
  };
  const originalSpawn = singleton.spawnMinecraft;
  const originalResolve = singleton.resolveJavaCommand;
  singleton.spawnMinecraft = () => {
    const child = fakeChild({
      onKill() {
        Object.assign(child, { exitCode: 1 });
        child.emit('exit', 1, 'SIGKILL');
      },
    });
    return child;
  };
  singleton.resolveJavaCommand = async () => {
    await javaGate;
    return 'java';
  };
  t.after(async () => {
    singleton.spawnMinecraft = originalSpawn;
    singleton.resolveJavaCommand = originalResolve;
    try {
      await processManager.stop(info.id, true);
    } catch {
      /* 实例可能已经停掉 */
    }
  });

  const startPromise = processManager.start(row as InstanceRow);
  const deletePromise = deleteInstance(info.id);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(fs.existsSync(instanceDir), 'start 持锁期间删除不得先拆目录');
  assert.ok(getInstanceRow(info.id), 'start 持锁期间删除不得先删库行');

  releaseJava();
  await startPromise;
  await assert.rejects(deletePromise, /请先停止实例再删除/);
  assert.equal(processManager.isRunning(info.id), true);
});

async function waitForStatus(
  manager: { getStatus(id: string): string },
  instanceId: string,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (manager.getStatus(instanceId) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(manager.getStatus(instanceId), expected);
}

test('关闭时取消尚未 spawn 的启动，不留下无主进程', async (t) => {
  prepareTempDataRoot(t);
  const { ProcessManager } = await import('./process-manager.js');
  const { initDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const info = createInstance({ name: 'shutdown-cancel-start' });
  fs.writeFileSync(path.join(defaultInstanceDir(info.id), 'server.jar'), 'stub-jar');
  const row = getInstanceRow(info.id)!;

  let spawnCount = 0;
  let releaseJava!: () => void;
  const javaGate = new Promise<void>((resolve) => {
    releaseJava = resolve;
  });
  const manager = new ProcessManager(
    () => {
      spawnCount += 1;
      return fakeChild();
    },
    async () => {
      await javaGate;
      return 'java';
    },
  );

  const startPromise = manager.start(row as InstanceRow);
  await waitForStatus(manager, info.id, 'starting');
  const stopAllPromise = manager.stopAll();
  releaseJava();

  await assert.rejects(startPromise, /面板正在关闭，已取消启动/);
  const result = await stopAllPromise;
  assert.equal(spawnCount, 0);
  assert.equal(manager.getRunningCount(), 0);
  assert.equal(manager.getStatus(info.id), 'stopped');
  assert.equal(result.attempted, 0);
});

test('关闭后拒绝新的 start', async (t) => {
  prepareTempDataRoot(t);
  const { ProcessManager } = await import('./process-manager.js');
  const { initDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const info = createInstance({ name: 'shutdown-reject-start' });
  fs.writeFileSync(path.join(defaultInstanceDir(info.id), 'server.jar'), 'stub-jar');
  const row = getInstanceRow(info.id)!;

  let spawnCount = 0;
  const manager = new ProcessManager(
    () => {
      spawnCount += 1;
      return fakeChild();
    },
    async () => 'java',
  );
  manager.beginShutdown();

  await assert.rejects(() => manager.start(row as InstanceRow), /面板正在关闭，无法启动实例/);
  assert.equal(spawnCount, 0);
  assert.equal(manager.getRunningCount(), 0);
});
