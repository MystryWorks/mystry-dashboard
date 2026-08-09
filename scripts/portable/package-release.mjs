import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const FLAG_OPTIONS = ['skip-install', 'skip-verify', 'skip-smoke', 'no-force', 'allow-dirty'];

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`);
    const name = token.slice(2);
    if (FLAG_OPTIONS.includes(name)) {
      result[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 --${name} 缺少值`);
    result[name] = value;
    index += 1;
  }
  return result;
}

function assertNodeVersion() {
  const match = /^v(\d+)\./.exec(process.version);
  const major = match ? Number(match[1]) : 0;
  if (major < 22) {
    throw new Error(`Node.js 必须为 22 或更高版本，当前：${process.version}`);
  }
}

function npmCommand() {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c'],
    };
  }
  return { command: 'npm', args: [] };
}

function runNpm(label, scriptArguments) {
  const { command, args } = npmCommand();
  if (process.platform === 'win32') {
    args.push(`npm.cmd ${scriptArguments.join(' ')}`);
  } else {
    args.push(...scriptArguments);
  }
  run(label, command, args);
}

function run(label, command, args) {
  console.log(`\n[${label}] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`步骤「${label}」执行失败：${command} ${args.join(' ')}`);
  }
}

function releasePlatform(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return platform;
}

function archiveExtension(platform) {
  return platform === 'win32' ? 'zip' : 'tar.gz';
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const outputDir = path.resolve(args['output-dir'] || 'release');
  const allowDirty = Boolean(args['allow-dirty']);
  const force = !args['no-force'];
  const skipInstall = Boolean(args['skip-install']);
  const skipVerify = Boolean(args['skip-verify']);
  const skipSmoke = Boolean(args['skip-smoke']);

  assertNodeVersion();

  const rootPackage = JSON.parse(
    await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
  );
  const version = rootPackage.version;
  const platformName = releasePlatform(process.platform);
  const arch = process.arch === 'amd64' ? 'x64' : process.arch;
  const archiveName = `mmd-v${version}-${platformName}-${arch}.${archiveExtension(process.platform)}`;
  const archivePath = path.join(outputDir, archiveName);

  console.log(`一键打包开始：v${version}（${platformName}/${arch}）`);
  console.log(`输出目录：${outputDir}`);
  console.log(
    `开关：跳过安装=${skipInstall} 跳过验证=${skipVerify} 跳过冒烟=${skipSmoke} `
      + `覆盖=${force} 允许脏工作树=${allowDirty}`,
  );

  if (!skipInstall) {
    runNpm('安装依赖', ['ci']);
  }

  if (skipVerify) {
    runNpm('构建应用', ['run', 'build']);
  } else {
    runNpm('完整验证', ['run', 'verify']);
    runNpm('生产依赖审计', ['run', 'audit:production']);
  }

  const packageArguments = [
    path.join(scriptDir, 'package-portable.mjs'),
    '--platform', process.platform,
    '--arch', process.arch,
    '--output-dir', outputDir,
  ];
  if (force) packageArguments.push('--force');
  if (allowDirty) packageArguments.push('--allow-dirty');
  if (args['runtime-dir']) {
    packageArguments.push('--runtime-dir', path.resolve(args['runtime-dir']));
  }
  run('组装便携包', process.execPath, packageArguments);

  if (!fs.existsSync(archivePath)) {
    throw new Error(`打包未生成预期压缩包：${archivePath}`);
  }
  console.log(`已生成压缩包：${archivePath}`);

  if (!skipSmoke) {
    run(
      '冒烟验证',
      process.execPath,
      [path.join(scriptDir, 'smoke-portable.mjs'), archivePath],
    );
  }

  run(
    '生成校验和',
    process.execPath,
    [path.join(scriptDir, 'create-checksums.mjs'), outputDir],
  );
  run(
    '生成 SBOM',
    process.execPath,
    [
      path.join(scriptDir, 'create-sbom.mjs'),
      '--output',
      path.join(outputDir, 'sbom.cdx.json'),
    ],
  );

  const artifacts = (await fsp.readdir(outputDir)).sort((left, right) =>
    left.localeCompare(right),
  );
  console.log(`\n一键打包完成，发布目录 ${outputDir} 内文件：`);
  for (const name of artifacts) {
    console.log(`  - ${name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`\n一键打包失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
