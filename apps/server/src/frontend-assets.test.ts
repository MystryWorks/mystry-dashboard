import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerFrontendAssets } from './frontend-assets.js';

test('构建产物更新后仍以 JavaScript MIME 提供新增模块资源', async (t) => {
  const webDist = await mkdtemp(path.join(os.tmpdir(), 'mmd-static-assets-'));
  t.after(async () => {
    await rm(webDist, { recursive: true, force: true });
  });

  await mkdir(path.join(webDist, 'assets'));
  await writeFile(path.join(webDist, 'index.html'), '<!doctype html><title>面板</title>');

  const app = Fastify();
  await registerFrontendAssets(app, webDist);
  await app.ready();
  t.after(async () => {
    await app.close();
  });

  await writeFile(path.join(webDist, 'assets', 'updated-entry.js'), 'export const ready = true;');

  const response = await app.inject({ method: 'GET', url: '/assets/updated-entry.js' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /^application\/javascript\b/);
  assert.equal(response.body, 'export const ready = true;');
});
