import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPropertiesPatch,
  parseProperties,
  parsePropertiesDocument,
  propertiesMapFromDocument,
  stringifyPropertiesDocument,
} from './config-service.js';

test('保留注释、空行、重复键与分隔符，引导补丁只改最后定义', () => {
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

test('parseProperties 对重复键取最后有效值', () => {
  const map = parseProperties('a=1\na=2\n# comment\nb=3\n');
  assert.deepEqual(map, { a: '2', b: '3' });
});
