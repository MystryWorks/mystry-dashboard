import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecksums } from './create-checksums.mjs';
import { createReleaseMetadata } from './package-release.mjs';

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
  const windows = await fsp.readFile(path.join(scriptDir, 'mystryctl.cmd'), 'utf8');
  const unix = await fsp.readFile(path.join(scriptDir, 'mystryctl.sh'), 'utf8');
  assert.match(windows, /runtime\\node\.exe/i);
  assert.doesNotMatch(windows, /\bnpm(?:\.cmd)?\b/i);
  assert.match(unix, /runtime\/bin\/node/);
  assert.doesNotMatch(unix, /\bnpm\b/i);
});

test('校验和脚本稳定排序并排除自身', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mystry-checksums-test-'));
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

test('发布元数据在每次覆盖 SBOM 后重新生成校验和', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mystry-release-metadata-test-'));
  try {
    await fsp.writeFile(path.join(root, 'mystry-v0.0.0-test.zip'), 'archive', 'utf8');
    const calls = [];
    let sbomVersion = 0;
    const execute = async (label, command, args) => {
      const script = path.basename(args[0]);
      calls.push({ label, command, script });
      if (script === 'create-sbom.mjs') {
        const outputIndex = args.indexOf('--output');
        assert.notEqual(outputIndex, -1);
        await fsp.writeFile(args[outputIndex + 1], `SBOM ${++sbomVersion}`, 'utf8');
        return;
      }
      assert.equal(script, 'create-checksums.mjs');
      assert.deepEqual(args.slice(1), [root]);
      await createChecksums(args[1]);
    };
    const checksumForCurrentSbom = async () => {
      const sbom = await fsp.readFile(path.join(root, 'sbom.cdx.json'));
      return crypto.createHash('sha256').update(sbom).digest('hex');
    };
    const recordedSbomChecksum = async () => {
      const sums = await fsp.readFile(path.join(root, 'SHA256SUMS'), 'utf8');
      return sums.match(/^([a-f0-9]{64})  sbom\.cdx\.json$/m)?.[1];
    };

    await createReleaseMetadata(root, execute);
    const firstChecksum = await recordedSbomChecksum();
    assert.equal(firstChecksum, await checksumForCurrentSbom());

    await createReleaseMetadata(root, execute);
    const secondChecksum = await recordedSbomChecksum();
    assert.equal(secondChecksum, await checksumForCurrentSbom());
    assert.notEqual(secondChecksum, firstChecksum);
    assert.deepEqual(calls.map((call) => call.script), [
      'create-sbom.mjs',
      'create-checksums.mjs',
      'create-sbom.mjs',
      'create-checksums.mjs',
    ]);
    assert.equal(calls.every((call) => call.command === process.execPath), true);
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
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mystry-sbom-test-'));
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
