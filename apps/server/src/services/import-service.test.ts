import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.SETUP_TOKEN = 'b'.repeat(64);
process.env.LAUNCHER_TOKEN = 'c'.repeat(64);

type ZipTestEntry = {
  name: string;
  contents: string;
  compression?: 0 | 8;
  localExtra?: Buffer;
};

function createZip(entries: readonly ZipTestEntry[]): Buffer {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const contents = Buffer.from(entry.contents, 'utf8');
    const compression = entry.compression ?? 0;
    const compressed = compression === 8 ? deflateRawSync(contents) : contents;
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(compression, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(compression, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);

    localEntries.push(local, name, localExtra, compressed);
    centralEntries.push(central, name);
    localOffset += local.length + name.length + localExtra.length + compressed.length;
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
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-import-service-test-'));
  process.env.MYSTRY_DATA_DIR = dataRoot;
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
  fs.writeFileSync(zipPath, createZip([
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

test('ZIP 预览与解压保留条目读取、大小校验及取消边界', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-zip-boundaries-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inspectZipJvmConfig, safeExtract } = await import('./import-service.js');
  const jvmArgs = '-Xms1G\n-Xmx2G\n';
  let sequence = 0;
  const fixture = (zip: Buffer) => {
    const zipPath = path.join(root, `${sequence++}.zip`);
    fs.writeFileSync(zipPath, zip);
    return { zipPath, destDir: `${zipPath}-extracted` };
  };
  const centralOffset = (zip: Buffer) => zip.readUInt32LE(zip.length - 22 + 16);

  for (const compression of [0, 8] as const) {
    await t.test(`压缩方式 ${compression} 正确跳过本地扩展字段并读取空文件`, async () => {
      const { zipPath, destDir } = fixture(createZip([
        { name: 'user_jvm_args.txt', contents: jvmArgs, compression, localExtra: Buffer.from([0xfe, 0xca, 0, 0]) },
        { name: 'empty.txt', contents: '', compression },
      ]));
      assert.equal((await inspectZipJvmConfig(zipPath))?.canonicalArgs, '-Xms1G -Xmx2G');
      await safeExtract(zipPath, destDir);
      assert.equal(fs.readFileSync(path.join(destDir, 'user_jvm_args.txt'), 'utf8'), jvmArgs);
      assert.equal(fs.statSync(path.join(destDir, 'empty.txt')).size, 0);
    });
  }

  const corruptions: Array<{ name: string; mutate: (zip: Buffer) => void; error: RegExp }> = [
    { name: '本地文件头损坏', mutate: (zip) => { zip.writeUInt32LE(0, 0); }, error: /ZIP entry 头非法/ },
    { name: '条目数据越界', mutate: (zip) => { zip.writeUInt16LE(0xffff, 28); }, error: /ZIP entry 数据越界/ },
    { name: '压缩方式不支持', mutate: (zip) => { zip.writeUInt16LE(99, centralOffset(zip) + 10); }, error: /ZIP compression method/ },
    { name: '解压大小不匹配', mutate: (zip) => { zip.writeUInt32LE(Buffer.byteLength(jvmArgs) + 1, centralOffset(zip) + 24); }, error: /解压大小不匹配/ },
  ];
  for (const { name, mutate, error } of corruptions) {
    await t.test(`${name} 时预览返回诊断、解压清理半成品`, async () => {
      const zip = createZip([{ name: 'user_jvm_args.txt', contents: jvmArgs }]);
      mutate(zip);
      const { zipPath, destDir } = fixture(zip);
      const preview = await inspectZipJvmConfig(zipPath);
      assert.equal(preview?.canonicalArgs, null);
      assert.equal(preview?.issues[0]?.code, 'ZIP_ARGFILE_ERROR');
      assert.match(preview?.issues[0]?.message ?? '', error);
      await assert.rejects(() => safeExtract(zipPath, destDir), error);
      assert.equal(fs.existsSync(destDir), false);
      assert.equal(fs.existsSync(zipPath), true);
    });
  }

  await t.test('JVM 预览对伪造的解压大小仍执行 64 KiB 流式限制', async () => {
    const zip = createZip([{ name: 'user_jvm_args.txt', contents: 'x'.repeat(65_537), compression: 8 }]);
    zip.writeUInt32LE(1, centralOffset(zip) + 24);
    const { zipPath } = fixture(zip);
    const preview = await inspectZipJvmConfig(zipPath);
    assert.equal(preview?.canonicalArgs, null);
    assert.match(preview?.issues[0]?.message ?? '', /超过 64 KiB/);
  });

  await t.test('开始前取消时保留超时原因并清理解压目录', async () => {
    const { zipPath, destDir } = fixture(createZip([{ name: 'server.jar', contents: 'jar' }]));
    const controller = new AbortController();
    controller.abort(new Error('任务执行超时'));
    await assert.rejects(() => safeExtract(zipPath, destDir, controller.signal), /任务执行超时/);
    assert.equal(fs.existsSync(destDir), false);
    assert.equal(fs.existsSync(zipPath), true);
  });

  await t.test('读取途中取消时关闭流并删除已写入的半成品', async (t) => {
    const { zipPath, destDir } = fixture(createZip([{ name: 'server.jar', contents: 'x'.repeat(256 * 1024) }]));
    const controller = new AbortController();
    const createReadStream = fs.createReadStream;
    let source: fs.ReadStream | undefined;
    t.mock.method(fs, 'createReadStream', (...args: Parameters<typeof createReadStream>) => {
      source = createReadStream(...args);
      source.once('data', () => controller.abort(new Error('任务已取消')));
      return source;
    });
    await assert.rejects(() => safeExtract(zipPath, destDir, controller.signal), /任务已取消/);
    assert.equal(source?.destroyed, true);
    assert.equal(fs.existsSync(destDir), false);
    assert.equal(fs.existsSync(zipPath), true);
  });
});

test('ZIP 外层目录内的伪造 staging marker 应被拒绝', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-import-service-test-'));
  process.env.MYSTRY_DATA_DIR = dataRoot;
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
  fs.writeFileSync(zipPath, createZip([
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
  assert.match(completedTask?.error ?? '', /ZIP 根目录存在重复路径：\.mystry-staging-marker\.json/);
  const instanceId = completedTask?.result?.instanceId;
  if (typeof instanceId === 'string') {
    assert.equal(fs.existsSync(defaultInstanceDir(instanceId)), false);
  }
  assert.equal(fs.existsSync(zipPath), false);
});
