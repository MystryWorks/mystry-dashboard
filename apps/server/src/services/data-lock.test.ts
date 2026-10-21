/**
 * R0-01 数据目录生命周期锁回归骨架（批次 B 实现 data-lock-service）。
 * 必须使用随机临时 DATA_DIR，禁止触碰仓库 data/。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function prepareTempDataRoot(t: test.TestContext): string {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-data-lock-test-'));
  t.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  process.env.MYSTRY_DATA_DIR = dataRoot;
  process.env.JWT_SECRET = 'a'.repeat(64);
  return dataRoot;
}

test('R0-01: 第二个面板进程不得在进入 initDb 前写入数据库', async (t) => {
  const dataRoot = prepareTempDataRoot(t);
  const { acquirePanelDataLock } = await import('./data-lock-service.js');
  const first = acquirePanelDataLock(dataRoot);
  assert.throws(
    () => acquirePanelDataLock(dataRoot),
    /数据目录|已有面板|锁/,
    '存活锁持有者应拒绝第二个进程',
  );
  first.release();
  const second = acquirePanelDataLock(dataRoot);
  second.release();
});

test('R0-01: 锁目录应为 0700、owner.json 应为 0600', { skip: process.platform === 'win32' }, async (t) => {
  const dataRoot = prepareTempDataRoot(t);
  const { acquirePanelDataLock } = await import('./data-lock-service.js');
  const lock = acquirePanelDataLock(dataRoot);
  t.after(() => lock.release());
  const lockDir = path.join(dataRoot, '.mystry-panel-lock');
  assert.equal(fs.statSync(lockDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(lockDir, 'owner.json')).mode & 0o777, 0o600);
});

test('R0-01: 陈旧锁仅在原 PID 不存在时可 quarantine 并接管', async (t) => {
  const dataRoot = prepareTempDataRoot(t);
  const lockDir = path.join(dataRoot, '.mystry-panel-lock');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(
    path.join(lockDir, 'owner.json'),
    `${JSON.stringify({
      pid: 9_999_999,
      fingerprint: 'stale-test',
      version: '0.0.0',
      createdAt: new Date(0).toISOString(),
    })}\n`,
    'utf8',
  );

  const { acquirePanelDataLock } = await import('./data-lock-service.js');
  const lock = acquirePanelDataLock(dataRoot);
  assert.ok(fs.existsSync(path.join(lockDir, 'owner.json')));
  assert.equal(lock.owner.pid, process.pid);
  const quarantined = fs.readdirSync(dataRoot).some((name) => name.startsWith('.mystry-panel-lock.quarantine.'));
  assert.ok(quarantined, '陈旧锁应移入 quarantine 目录');
  lock.release();
});
