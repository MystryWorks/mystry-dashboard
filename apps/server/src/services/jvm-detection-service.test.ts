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
  externalAttributes?: number;
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
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(localOffset, 42);

    localEntries.push(local, name, contents);
    centralEntries.push(central, name);
    localOffset += local.length + name.length + contents.length;
  }

  const centralSize = centralEntries.reduce((total, entry) => total + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localEntries, ...centralEntries, end]);
}

test('目录检测只读取根目录普通 user_jvm_args.txt', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-jvm-detect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { detectJvmConfigFile } = await import('./jvm-detection-service.js');

  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'user_jvm_args.txt'), '-Xms1G\n-Xmx3G\n');
  assert.equal(detectJvmConfigFile(root), undefined);

  fs.writeFileSync(path.join(root, 'user_jvm_args.txt'), '# 注释\n-Xms1G\n-Xmx4G\n');
  const detected = detectJvmConfigFile(root);
  assert.equal(detected?.canonicalArgs, '-Xms1G -Xmx4G');
  assert.equal(detected?.issues.length, 0);

  fs.writeFileSync(path.join(root, 'user_jvm_args.txt'), 'x'.repeat(64 * 1024 + 1));
  const oversized = detectJvmConfigFile(root);
  assert.equal(oversized?.canonicalArgs, null);
  assert.match(oversized?.issues[0]?.message ?? '', /64 KiB/);
});

test('ZIP 检测支持单一顶层目录并拒绝危险中央目录', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mystry-jvm-zip-detect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inspectZipJvmConfig } = await import('./import-service.js');
  const writeZip = (name: string, entries: readonly StoredZipEntry[]) => {
    const target = path.join(root, name);
    fs.writeFileSync(target, createStoredZip(entries));
    return target;
  };

  const wrapped = writeZip('wrapped.zip', [
    { name: 'server/user_jvm_args.txt', contents: '# 注释\n-Xms1G\n-Xmx4G\n' },
    { name: 'server/server.jar', contents: 'jar' },
  ]);
  assert.equal((await inspectZipJvmConfig(wrapped))?.canonicalArgs, '-Xms1G -Xmx4G');

  const nestedOnly = writeZip('nested.zip', [
    { name: 'server/server.jar', contents: 'jar' },
    { name: 'other/user_jvm_args.txt', contents: '-Xms1G\n-Xmx4G\n' },
  ]);
  assert.equal(await inspectZipJvmConfig(nestedOnly), undefined);

  const oversized = writeZip('oversized.zip', [
    { name: 'user_jvm_args.txt', contents: 'x'.repeat(64 * 1024 + 1) },
  ]);
  const oversizedResult = await inspectZipJvmConfig(oversized);
  assert.equal(oversizedResult?.canonicalArgs, null);
  assert.match(oversizedResult?.issues[0]?.message ?? '', /64 KiB/);

  const duplicate = writeZip('duplicate.zip', [
    { name: 'user_jvm_args.txt', contents: '-Xms1G' },
    { name: 'user_jvm_args.txt', contents: '-Xmx2G' },
  ]);
  await assert.rejects(() => inspectZipJvmConfig(duplicate), /重复 entry/);

  const symlinkMode = ((0xa000 | 0o777) << 16) >>> 0;
  const linked = writeZip('link.zip', [
    { name: 'user_jvm_args.txt', contents: 'target', externalAttributes: symlinkMode },
  ]);
  await assert.rejects(() => inspectZipJvmConfig(linked), /链接或特殊文件/);

  const zip64 = createStoredZip([{ name: 'server.jar', contents: 'jar' }]);
  zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
  const zip64Path = path.join(root, 'zip64.zip');
  fs.writeFileSync(zip64Path, zip64);
  await assert.rejects(() => inspectZipJvmConfig(zip64Path), /ZIP64/);

  const tooManyEntries = createStoredZip([{ name: 'server.jar', contents: 'jar' }]);
  tooManyEntries.writeUInt16LE(10_001, tooManyEntries.length - 22 + 8);
  tooManyEntries.writeUInt16LE(10_001, tooManyEntries.length - 22 + 10);
  const tooManyEntriesPath = path.join(root, 'too-many-entries.zip');
  fs.writeFileSync(tooManyEntriesPath, tooManyEntries);
  await assert.rejects(() => inspectZipJvmConfig(tooManyEntriesPath), /条目数量超过限制/);

  const splitZip = createStoredZip([{ name: 'server.jar', contents: 'jar' }]);
  splitZip.writeUInt16LE(1, splitZip.length - 22 + 4);
  const splitZipPath = path.join(root, 'split.zip');
  fs.writeFileSync(splitZipPath, splitZip);
  await assert.rejects(() => inspectZipJvmConfig(splitZipPath), /分卷 ZIP/);
});
