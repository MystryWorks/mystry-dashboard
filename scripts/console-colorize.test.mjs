import assert from 'node:assert/strict';
import test from 'node:test';
import {
  colorizeConsoleLine,
  colorizeConsoleStream,
  createConsoleColorizeState,
  flushConsoleColorize,
} from '../apps/web/src/console-colorize.ts';

test('INFO/WARN/ERROR 使用 ECMA-48 亮绿/亮黄/亮红', () => {
  const info = colorizeConsoleLine('[01:00:00] [Server thread/INFO]: started');
  const warn = colorizeConsoleLine('[01:00:00] [Server thread/WARN]: missing');
  const error = colorizeConsoleLine('[01:00:00] [Server thread/ERROR]: boom');

  assert.match(info, /^\x1b\[92m.*\x1b\[0m$/);
  assert.match(warn, /^\x1b\[93m.*\x1b\[0m$/);
  assert.match(error, /^\x1b\[91m.*\x1b\[0m$/);
});

test('已含 ANSI 的行不再二次着色', () => {
  const raw = '\x1b[31mred\x1b[0m';
  assert.equal(colorizeConsoleLine(raw), raw);
});

test('流式残片在换行后才着色', () => {
  const state = createConsoleColorizeState();
  assert.equal(colorizeConsoleStream('[main/INF', state), '');
  const colored = colorizeConsoleStream('O]: ok\n', state);
  assert.match(colored, /^\x1b\[92m\[main\/INFO\]: ok\x1b\[0m\n$/);
  assert.equal(flushConsoleColorize(state), '');
});
