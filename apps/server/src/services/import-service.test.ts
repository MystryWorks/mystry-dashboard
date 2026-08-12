import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.SETUP_TOKEN = 'b'.repeat(64);
process.env.LAUNCHER_TOKEN = 'c'.repeat(64);

type StoredZipEntry = {
  name: string;
  contents: string;
};

function createStoredZip(entries: readonly StoredZipEntry[]): Buffer {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const contents = Buffer.from(entry.contents, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);

    localEntries.push(local, name, contents);
    centralEntries.push(central, name);
    localOffset += local.length + name.length + contents.length;
  }

  const centralSize = centralEntries.reduce((total, entry) => total + entry.length, 0);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralSize, 12);
  endOfCentralDirectory.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localEntries, ...centralEntries, endOfCentralDirectory]);
}

test('ZIP 单一外层目录在 staging marker 存在时仍应被扁平化并导入', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-import-service-test-'));
  process.env.MMD_DATA_DIR = dataRoot;
  t.after(async () => {
    try {
      const { closeDb } = await import('../db.js');
      closeDb();
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  const { initDb } = await import('../db.js');
  const { importZipPackage } = await import('./import-service.js');
  const { getTask } = await import('./task-service.js');
  const { STAGING_MARKER_FILE } = await import('./task-staging-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');
  initDb();

  const zipPath = path.join(dataRoot, 'uploads', '.tmp-import-wrapper.zip');
  fs.writeFileSync(zipPath, createStoredZip([
    { name: 'wrapper/server.jar', contents: 'server-jar-content' },
  ]));

  const queuedTask = await importZipPackage({
    name: '带外层目录的导入包',
    zipPath,
  });
  let completedTask = getTask(queuedTask.id);
  for (
    let attempt = 0;
    attempt < 200 && completedTask?.status !== 'completed' && completedTask?.status !== 'failed';
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    completedTask = getTask(queuedTask.id);
  }

  assert.equal(completedTask?.status, 'completed', completedTask?.error);
  const instanceId = completedTask?.result?.instanceId;
  if (typeof instanceId !== 'string') {
    assert.fail('导入任务未返回实例 ID');
  }
  const instanceDir = defaultInstanceDir(instanceId);
  assert.equal(fs.readFileSync(path.join(instanceDir, 'server.jar'), 'utf8'), 'server-jar-content');
  assert.equal(fs.existsSync(path.join(instanceDir, 'wrapper')), false);
  assert.equal(fs.existsSync(path.join(instanceDir, STAGING_MARKER_FILE)), false);
  assert.equal(fs.existsSync(zipPath), false);
});

test('ZIP 外层目录内的伪造 staging marker 应被拒绝', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-import-service-test-'));
  process.env.MMD_DATA_DIR = dataRoot;
  t.after(async () => {
    try {
      const { closeDb } = await import('../db.js');
      closeDb();
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  const { initDb } = await import('../db.js');
  const { importZipPackage } = await import('./import-service.js');
  const { getTask } = await import('./task-service.js');
  const { STAGING_MARKER_FILE } = await import('./task-staging-service.js');
  const { defaultInstanceDir } = await import('../utils/path.js');
  initDb();

  const zipPath = path.join(dataRoot, 'uploads', '.tmp-import-forged-marker.zip');
  fs.writeFileSync(zipPath, createStoredZip([
    { name: 'wrapper/server.jar', contents: 'server-jar-content' },
    { name: `wrapper/${STAGING_MARKER_FILE}`, contents: '{"version":1,"token":"forged"}' },
  ]));

  const queuedTask = await importZipPackage({
    name: '伪造标记的导入包',
    zipPath,
  });
  let completedTask = getTask(queuedTask.id);
  for (
    let attempt = 0;
    attempt < 200 && completedTask?.status !== 'completed' && completedTask?.status !== 'failed';
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    completedTask = getTask(queuedTask.id);
  }

  assert.equal(completedTask?.status, 'failed');
  assert.match(completedTask?.error ?? '', /ZIP 根目录存在重复路径：\.mmd-staging-marker\.json/);
  const instanceId = completedTask?.result?.instanceId;
  if (typeof instanceId === 'string') {
    assert.equal(fs.existsSync(defaultInstanceDir(instanceId)), false);
  }
  assert.equal(fs.existsSync(zipPath), false);
});
