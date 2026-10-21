/**
 * R0-04 任务 staging 与保守恢复回归骨架（批次 B 实现 staging + 迁移）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function prepareTempDataRoot(t: test.TestContext): string {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-task-service-test-'));
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

test('R0-04: recoverInterruptedTasks 不得因 result.instanceId 删除最终实例', async (t) => {
  prepareTempDataRoot(t);
  const { initDb, getDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const { createTask, recordTaskInstance, recoverInterruptedTasks } = await import('./task-service.js');

  initDb();
  const inst = createInstance({ name: 'recovery-stub' });
  const task = createTask('deploy', '模拟中断');
  recordTaskInstance(task.id, inst.id);
  getDb().prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id);

  const instanceDir = path.join(process.env.MYSTRY_DATA_DIR!, 'instances', inst.id);
  assert.ok(fs.existsSync(instanceDir), '前置：实例目录应已创建');

  recoverInterruptedTasks();

  assert.ok(
    fs.existsSync(instanceDir) && getInstanceRow(inst.id),
    '恢复逻辑不得 deleteInstance 已落地的最终目录',
  );
});

test('R0-04: 仅清理 .mystry-staging 内 marker 匹配且任务未完成的半成品', async (t) => {
  const dataRoot = prepareTempDataRoot(t);
  const { initDb } = await import('../db.js');
  const { createTask, recordTaskStaging, recoverInterruptedTasks } = await import('./task-service.js');
  const { prepareTaskStaging, taskStagingDir } = await import('./task-staging-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const task = createTask('deploy', 'staging 中断');
  const { getDb } = await import('../db.js');
  getDb().prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id);
  const instanceId = 'staginginst01';
  const token = 'token-staging-test-32chars-long!!';
  recordTaskStaging(task.id, instanceId, token);
  const stagingPath = prepareTaskStaging(task.id, instanceId, token, dataRoot);
  fs.writeFileSync(path.join(stagingPath, 'server.jar'), 'partial', 'utf8');

  const finalInstanceId = 'finalinst001';
  const finalDir = defaultInstanceDir(finalInstanceId);
  fs.mkdirSync(finalDir, { recursive: true });
  fs.writeFileSync(path.join(finalDir, 'world.dat'), 'keep-me', 'utf8');

  const recovery = recoverInterruptedTasks();
  assert.equal(recovery.cleanedStaging, 1);
  assert.equal(fs.existsSync(taskStagingDir(task.id, instanceId, dataRoot)), false);
  assert.ok(fs.existsSync(finalDir), '与任务无关的最终目录必须保留');
});

test('worker 正常返回后即使任务已中止也保持成功', async (t) => {
  prepareTempDataRoot(t);
  const { initDb } = await import('../db.js');
  const { createInstance, getInstanceRow } = await import('./instance-service.js');
  const {
    runBackgroundTask,
    getTask,
    shutdownTasks,
    resetTaskRuntimeForTests,
  } = await import('./task-service.js');

  t.after(() => {
    resetTaskRuntimeForTests();
  });

  initDb();
  const inst = createInstance({ name: 'task-keep-success' });
  let workerEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    workerEntered = resolve;
  });

  const task = await runBackgroundTask('import', 'verify success after abort', async () => {
    workerEntered();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { instanceId: inst.id };
  });

  await entered;
  await shutdownTasks();

  const current = getTask(task.id);
  assert.equal(current?.status, 'completed');
  assert.equal(current?.result?.instanceId, inst.id);
  assert.ok(getInstanceRow(inst.id));
});
