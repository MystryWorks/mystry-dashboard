import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.SETUP_TOKEN = 'b'.repeat(64);
process.env.LAUNCHER_TOKEN = 'c'.repeat(64);

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-user-jvm-args-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { writeUserJvmArgs } = await import('./core-depot.js');
  const { parseJvmArgFile } = await import('@mmd/shared');
  writeUserJvmArgs(dir, String.raw`-Xms1G -Xmx2G "-Dfolder=C:\Minecraft Server"`);
  assert.deepEqual(
    parseJvmArgFile(fs.readFileSync(path.join(dir, 'user_jvm_args.txt'), 'utf8')),
    ['-Xms1G', '-Xmx2G', String.raw`-Dfolder=C:\Minecraft Server`],
  );
});
