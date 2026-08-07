import { test } from 'node:test';
import assert from 'node:assert/strict';

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
