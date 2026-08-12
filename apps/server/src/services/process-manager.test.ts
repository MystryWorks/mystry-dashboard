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
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-process-mgr-test-'));
  t.after(async () => {
    try {
      const { closeDb } = await import('../db.js');
      closeDb();
    } catch {
      /* 模块可能尚未加载 */
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  process.env.MMD_DATA_DIR = dataRoot;
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

test('R0-03: 普通 stop 超时不得隐式 SIGKILL', async (t) => {
  prepareTempDataRoot(t);
  process.env.MMD_TEST_STOP_GRACE_MS = '40';
  t.after(() => {
    delete process.env.MMD_TEST_STOP_GRACE_MS;
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
  const { parseJvmArgFile } = await import('@mmd/shared');

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
