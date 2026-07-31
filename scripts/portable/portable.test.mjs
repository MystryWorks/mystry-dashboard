import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

test('便携脚本均可由 Node 直接解析', async () => {
  const scripts = (await fsp.readdir(scriptDir))
    .filter((name) => name.endsWith('.mjs'));
  for (const script of scripts) {
    const result = spawnSync(process.execPath, ['--check', path.join(scriptDir, script)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${script}\n${result.stderr}`);
  }
});

test('便携入口只调用包内 Node 运行时', async () => {
  const windows = await fsp.readFile(path.join(scriptDir, 'mmdctl.cmd'), 'utf8');
  const unix = await fsp.readFile(path.join(scriptDir, 'mmdctl.sh'), 'utf8');
  assert.match(windows, /runtime\\node\.exe/i);
  assert.doesNotMatch(windows, /\bnpm(?:\.cmd)?\b/i);
  assert.match(unix, /runtime\/bin\/node/);
  assert.doesNotMatch(unix, /\bnpm\b/i);
});

test('校验和脚本稳定排序并排除自身', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mmd-checksums-test-'));
  try {
    await fsp.writeFile(path.join(root, 'b.txt'), 'b', 'utf8');
    await fsp.writeFile(path.join(root, 'a.txt'), 'a', 'utf8');
    const script = path.join(scriptDir, 'create-checksums.mjs');
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const lines = (await fsp.readFile(path.join(root, 'SHA256SUMS'), 'utf8')).trim().split('\n');
    assert.match(lines[0], /  a\.txt$/);
    assert.match(lines[1], /  b\.txt$/);
    assert.equal(lines.some((line) => line.includes('SHA256SUMS')), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('运行时版本固定为 Node 22', async () => {
  const runtime = JSON.parse(await fsp.readFile(path.join(scriptDir, 'runtime.json'), 'utf8'));
  assert.match(runtime.nodeVersion, /^22\.\d+\.\d+$/);
  assert.equal(fs.existsSync(path.join(scriptDir, 'fetch-node-runtime.mjs')), true);
});

test('SBOM 只包含生产依赖并使用 CycloneDX 1.6', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mmd-sbom-test-'));
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'demo', version: '1.0.0' },
        'node_modules/prod': { version: '2.0.0', license: 'MIT' },
        'node_modules/dev': { version: '3.0.0', dev: true },
      },
    };
    await fsp.writeFile(
      path.join(root, 'package-lock.json'),
      JSON.stringify(lock),
      'utf8',
    );
    await fsp.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }),
      'utf8',
    );
    const output = path.join(root, 'sbom.cdx.json');
    const script = path.join(scriptDir, 'create-sbom.mjs');
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--lock', path.join(root, 'package-lock.json'),
        '--package', path.join(root, 'package.json'),
        '--output', output,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const sbom = JSON.parse(await fsp.readFile(output, 'utf8'));
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.6');
    assert.deepEqual(sbom.components.map((component) => component.name), ['prod']);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
