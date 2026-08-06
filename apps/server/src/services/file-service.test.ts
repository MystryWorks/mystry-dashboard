/**
 * R0-05 文件重命名与路径安全回归骨架（批次 C 实现无覆盖 rename）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function prepareTempDataRoot(t: test.TestContext): string {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-file-service-test-'));
  t.after(async () => {
    try {
      const { closeDb } = await import('../db.js');
      closeDb();
    } catch {
      /* 模块可能尚未加载 */
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  process.env.DATA_DIR = dataRoot;
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.SETUP_TOKEN = 'b'.repeat(64);
  return dataRoot;
}

test('R0-05: 目标已存在时同目录重命名应拒绝且不覆盖内容', async (t) => {
  prepareTempDataRoot(t);
  const { initDb } = await import('../db.js');
  const { createInstance } = await import('./instance-service.js');
  const { renamePath } = await import('./file-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const inst = createInstance({ name: 'rename-conflict' });
  const root = defaultInstanceDir(inst.id);
  fs.writeFileSync(path.join(root, 'a.txt'), 'source-a');
  fs.writeFileSync(path.join(root, 'b.txt'), 'keep-b');

  assert.throws(
    () => renamePath(inst.id, 'a.txt', 'b.txt'),
    (err: unknown) => err instanceof Error && /已存在|冲突|目标/.test(err.message),
    'R0-05 待批次 C：renamePath 不得静默覆盖已有 b.txt',
  );
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'keep-b');
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'source-a');
});

test('R0-05: 重命名冲突应对外映射为 HTTP 409', async (t) => {
  prepareTempDataRoot(t);
  const { initDb } = await import('../db.js');
  const { createInstance } = await import('./instance-service.js');
  const { renamePath, fileServiceErrorHttpStatus, FileRenameConflictError } = await import('./file-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');

  initDb();
  const inst = createInstance({ name: 'rename-http' });
  const root = defaultInstanceDir(inst.id);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b');

  try {
    renamePath(inst.id, 'a.txt', 'b.txt');
    assert.fail('应抛出重命名冲突');
  } catch (err) {
    assert.ok(err instanceof FileRenameConflictError);
    assert.equal(fileServiceErrorHttpStatus(err), 409);
  }
});
