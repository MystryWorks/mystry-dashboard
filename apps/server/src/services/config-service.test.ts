import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.SETUP_TOKEN = 'b'.repeat(64);
process.env.LAUNCHER_TOKEN = 'c'.repeat(64);

function prepareTempDataRoot(t: test.TestContext): string {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-config-service-test-'));
  t.after(async () => {
    try {
      const { closeDb } = await import('../db.js');
      closeDb();
    } catch {
      /* 模块可能尚未加载 */
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  process.env.MMD_DATA_DIR = dataRoot;
  return dataRoot;
}

test('保留注释、空行、重复键与分隔符，引导补丁只改最后定义', async () => {
  const {
    applyPropertiesPatch,
    parseProperties,
    parsePropertiesDocument,
    propertiesMapFromDocument,
    stringifyPropertiesDocument,
  } = await import('./config-service.js');
  const fixture = [
    '# 顶部注释',
    '',
    'server-port=25565',
    'motd=Old MOTD',
    'motd=Current MOTD',
    'gamemode:survival',
    'online-mode=true',
    '',
  ].join('\n');

  const document = parsePropertiesDocument(fixture);
  assert.equal(propertiesMapFromDocument(document).motd, 'Current MOTD');
  assert.equal(propertiesMapFromDocument(document).gamemode, 'survival');

  const patched = applyPropertiesPatch(document, { motd: 'New MOTD', 'server-port': '25566' });
  const output = stringifyPropertiesDocument(patched);

  assert.match(output, /# 顶部注释/);
  assert.match(output, /motd=Old MOTD/);
  assert.match(output, /motd=New MOTD/);
  assert.doesNotMatch(output, /motd=Current MOTD/);
  assert.match(output, /server-port=25566/);
  assert.match(output, /gamemode:survival/);
});

test('parseProperties 对重复键取最后有效值', async () => {
  const { parseProperties } = await import('./config-service.js');
  const map = parseProperties('a=1\na=2\n# comment\nb=3\n');
  assert.deepEqual(map, { a: '2', b: '3' });
});

test('缺少 server.properties 时默认难度为普通', async (t) => {
  prepareTempDataRoot(t);
  const { initDb } = await import('../db.js');
  const { createInstance } = await import('./instance-service.js');
  const { readServerProperties } = await import('./config-service.js');

  initDb();
  const inst = createInstance({ name: 'props-default-difficulty' });

  assert.equal(readServerProperties(inst.id).difficulty, 'normal');
});

test('首次写入不存在的 server.properties：值含换行不产生额外属性', async (t) => {
  prepareTempDataRoot(t);
  const { initDb } = await import('../db.js');
  const { createInstance } = await import('./instance-service.js');
  const { writeServerProperties, readServerProperties } = await import('./config-service.js');

  initDb();
  const inst = createInstance({ name: 'props-newline' });
  const instanceDir = path.join(process.env.MMD_DATA_DIR!, 'instances', inst.id);
  assert.ok(!fs.existsSync(path.join(instanceDir, 'server.properties')), '前置：文件尚不存在');

  writeServerProperties(inst.id, { motd: 'line1\nmalicious=value' });
  const content = fs.readFileSync(path.join(instanceDir, 'server.properties'), 'utf8');
  const { parseProperties } = await import('./config-service.js');
  const parsed = parseProperties(content);

  assert.ok(content.includes('motd=line1\\nmalicious=value'), '换行应被转义为字面 \\n');
  assert.ok(!('malicious' in parsed), '不得产生多余的 malicious 属性');
  assert.equal(parsed.motd, 'line1\nmalicious=value');
});

test('首次写入不存在的 server.properties：值以反斜杠结尾不吞并下一行', async (t) => {
  prepareTempDataRoot(t);
  const { initDb } = await import('../db.js');
  const { createInstance } = await import('./instance-service.js');
  const { writeServerProperties, readServerProperties } = await import('./config-service.js');

  initDb();
  const inst = createInstance({ name: 'props-trailing-slash' });
  const instanceDir = path.join(process.env.MMD_DATA_DIR!, 'instances', inst.id);

  writeServerProperties(inst.id, { motd: 'foo\\' });
  const content = fs.readFileSync(path.join(instanceDir, 'server.properties'), 'utf8');

  assert.ok(content.includes('motd=foo\\\\\n'), '尾随反斜杠应转义且独占一行');
  assert.ok(content.includes('online-mode=true'), '默认属性不得被吞并');
  assert.equal(readServerProperties(inst.id).motd, 'foo\\');
});

test('JWT 纯数字按毫秒交给 Fastify，而不是秒', async () => {
  const { parseJwtExpiresIn } = await import('../config.js');
  assert.equal(parseJwtExpiresIn('3600000'), '3600000ms');
  assert.equal(parseJwtExpiresIn('2h'), '2h');
  assert.throws(() => parseJwtExpiresIn('abc'), /JWT_EXPIRES_IN/);
  assert.throws(() => parseJwtExpiresIn('0'), /JWT_EXPIRES_IN/);
});
