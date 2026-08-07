/**
 * R1-02 数据目录 Unix 权限回归。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('R1-02: 新建目录在 Unix 上应为 0700', { skip: process.platform === 'win32' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-data-perm-new-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const { ensureSecureDirectory } = await import('./data-dir-permissions.js');
  const nested = path.join(root, 'instances');
  ensureSecureDirectory(nested);
  const mode = fs.statSync(nested).mode & 0o777;
  assert.equal(mode, 0o700);
});

test('R1-02: forceSecureSensitiveFile 应立即把新文件收紧为 0600', { skip: process.platform === 'win32' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-data-perm-force-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'panel.db');
  fs.writeFileSync(file, 'db');
  const { forceSecureSensitiveFile } = await import('./data-dir-permissions.js');
  forceSecureSensitiveFile(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('R1-02: 过宽权限应拒绝启动', { skip: process.platform === 'win32' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-data-perm-bad-'));
  t.after(() => {
    delete process.env.MMD_REPAIR_DATA_PERMISSIONS;
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(root, { mode: 0o755 });
  const { ensureSecureDirectory, DataDirPermissionError } = await import('./data-dir-permissions.js');
  assert.throws(() => ensureSecureDirectory(root), DataDirPermissionError);
  process.env.MMD_REPAIR_DATA_PERMISSIONS = '1';
  ensureSecureDirectory(root);
  const mode = fs.statSync(root).mode & 0o777;
  assert.equal(mode, 0o700);
});
