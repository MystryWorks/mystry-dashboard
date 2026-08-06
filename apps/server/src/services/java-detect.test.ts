/**
 * R1-01 Java 探测子进程环境脱敏回归。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function prepareTempDataRoot(t: test.TestContext): string {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-java-detect-test-'));
  t.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  process.env.DATA_DIR = dataRoot;
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.SETUP_TOKEN = 'b'.repeat(64);
  process.env.LAUNCHER_TOKEN = 'c'.repeat(64);
  process.env.MMD_HOME = dataRoot;
  return dataRoot;
}

test('R1-01: getMinecraftChildEnv 不得暴露面板密钥', async (t) => {
  prepareTempDataRoot(t);
  const { getMinecraftChildEnv } = await import('../utils/child-env.js');
  const env = getMinecraftChildEnv();
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.SETUP_TOKEN, undefined);
  assert.equal(env.LAUNCHER_TOKEN, undefined);
  assert.equal(env.DATA_DIR, undefined);
  assert.equal(env.MMD_HOME, undefined);
});

test('R1-01: detectJava 应对 java -version 使用脱敏环境', async (t) => {
  prepareTempDataRoot(t);
  const { detectJava } = await import('./java-detect.js');
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  await detectJava(async (_file, _args, options) => {
    capturedEnv = options.env;
    return { stdout: '', stderr: 'openjdk version "21.0.2"' };
  });
  assert.ok(capturedEnv);
  assert.equal(capturedEnv!.JWT_SECRET, undefined);
  assert.equal(capturedEnv!.LAUNCHER_TOKEN, undefined);
  assert.equal(capturedEnv!.DATA_DIR, undefined);
});
