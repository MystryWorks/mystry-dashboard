import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yazl from 'yazl';
import { fetchNodeRuntime } from './fetch-node-runtime.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const packageRootName = 'mystry-dashboard';

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`);
    const name = token.slice(2);
    if (name === 'force') {
      result.force = true;
      continue;
    }
    if (name === 'allow-dirty') {
      result.allowDirty = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 --${name} 缺少值`);
    result[name] = value;
    index += 1;
  }
  return result;
}

function normalizePlatform(value) {
  if (value === 'windows') return 'win32';
  if (value === 'macos') return 'darwin';
  return value;
}

function releasePlatform(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return platform;
}

async function copyFileOrDirectory(source, destination, options = {}) {
  const stat = await fsp.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`拒绝复制符号链接：${source}`);
  if (stat.isDirectory()) {
    await fsp.cp(source, destination, {
      recursive: true,
      dereference: true,
      errorOnExist: false,
      force: true,
      ...options,
    });
    return;
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} 执行失败：\n${result.stderr || result.stdout || ''}`,
    );
  }
  return result.stdout.trim();
}

async function assertBuildOutputs() {
  const required = [
    'apps/server/dist/index.js',
    'apps/web/dist/index.html',
    'packages/shared/dist/index.js',
  ];
  const missing = required.filter((relative) => !fs.existsSync(path.join(repoRoot, relative)));
  if (missing.length > 0) {
    throw new Error(`缺少构建产物，请先运行 npm run build：${missing.join(', ')}`);
  }
}

async function installProductionDependencies(tempRoot) {
  const installRoot = path.join(tempRoot, 'production-install');
  const manifests = [
    'package.json',
    'package-lock.json',
    'apps/server/package.json',
    'apps/web/package.json',
    'packages/shared/package.json',
  ];
  for (const relative of manifests) {
    await copyFileOrDirectory(
      path.join(repoRoot, relative),
      path.join(installRoot, relative),
    );
  }
  const npmCommand = process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'npm';
  const npmArguments = process.platform === 'win32'
    ? [
        '/d',
        '/s',
        '/c',
        'npm.cmd ci --omit=dev --ignore-scripts --no-audit --fund=false',
      ]
    : ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--fund=false'];
  run(
    npmCommand,
    npmArguments,
    {
      cwd: installRoot,
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE
          || path.join(os.tmpdir(), 'mystry-portable-npm-cache'),
      },
    },
  );
  return path.join(installRoot, 'node_modules');
}

function workspaceEntry(relative) {
  const normalized = relative.split(path.sep).join('/');
  return [
    'node_modules/@mystry/server',
    'node_modules/@mystry/web',
    'node_modules/@mystry/shared',
  ].some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

async function copyProductionDependencies(source, destination) {
  await fsp.cp(source, destination, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (current) => {
      const relative = path.relative(path.dirname(source), current);
      return !workspaceEntry(relative);
    },
  });
  const sharedDestination = path.join(destination, '@mystry', 'shared');
  await fsp.mkdir(sharedDestination, { recursive: true });
  await copyFileOrDirectory(
    path.join(repoRoot, 'packages', 'shared', 'package.json'),
    path.join(sharedDestination, 'package.json'),
  );
  await copyFileOrDirectory(
    path.join(repoRoot, 'packages', 'shared', 'dist'),
    path.join(sharedDestination, 'dist'),
  );
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function collectFiles(rootDir) {
  const result = [];
  async function visit(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(rootDir, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`便携包中不允许出现符号链接：${relative}`);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && relative !== 'manifest.json') {
        const stat = await fsp.stat(absolute);
        result.push({
          path: relative,
          size: stat.size,
          sha256: await hashFile(absolute),
        });
      }
    }
  }
  await visit(rootDir);
  return result;
}

function assertCleanWorktreeForRelease(allowDirty) {
  if (allowDirty || process.env.MYSTRY_PORTABLE_ALLOW_DIRTY === '1') return;
  try {
    const status = run('git', ['status', '--porcelain']);
    if (status) {
      throw new Error(
        '工作树不干净，拒绝生成可发布便携包；本地调试可设置 MYSTRY_PORTABLE_ALLOW_DIRTY=1 或传入 --allow-dirty',
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('工作树不干净')) throw error;
    // 非 Git 仓库时跳过（仅本地非发布场景）
  }
}

function getGitSha() {
  try {
    return run('git', ['rev-parse', 'HEAD']);
  } catch {
    if (process.env.GITHUB_SHA?.trim()) return process.env.GITHUB_SHA.trim();
    return 'unknown';
  }
}

async function createPortableReadme(destination, version) {
  const content = `Mystry Dashboard ${version} 便携预览版
============================================================

Windows：
  双击 mystryctl.cmd，或运行 mystryctl.cmd start

Linux / macOS：
  chmod +x mystryctl
  ./mystryctl start

支持命令：
  start, foreground, stop, restart, status, logs, open

重要说明：
1. 本包自带 Node.js，不需要安装 Node 或运行 npm install。
2. 本包不含 Minecraft Java；默认使用系统 PATH 中的 java，也可在面板中扫描并选择其他已安装运行时。
3. 本预览版不会注册系统服务，也不会开机自动启动。
4. config、data、logs 由首次启动创建。升级时请停止面板，并保留这些目录。
5. 默认只监听 127.0.0.1。不要把面板端口直接暴露到不可信公网。

项目主页：https://github.com/MystryWorks/mystry-dashboard
`;
  await fsp.writeFile(destination, content, 'utf8');
}

async function archivePackage(stageRoot, packageDir, archivePath, platform) {
  if (platform !== 'win32') {
    run('tar', ['-czf', archivePath, path.basename(packageDir)], { cwd: stageRoot });
    return;
  }

  const zipFile = new yazl.ZipFile();
  const rootName = path.basename(packageDir);
  zipFile.addEmptyDirectory(rootName);

  async function addDirectory(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(stageRoot, absolute).split(path.sep).join('/');
      const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`拒绝将符号链接写入 ZIP：${relative}`);
      if (entry.isDirectory()) {
        zipFile.addEmptyDirectory(relative, { mtime: stat.mtime, mode: stat.mode });
        await addDirectory(absolute);
      } else if (entry.isFile()) {
        zipFile.addFile(absolute, relative, { mtime: stat.mtime, mode: stat.mode });
      }
    }
  }

  await addDirectory(packageDir);
  const output = fs.createWriteStream(archivePath, { flags: 'wx' });
  const completed = pipeline(zipFile.outputStream, output);
  zipFile.end();
  await completed;
}

export async function packagePortable({
  platform = process.platform,
  arch = process.arch,
  outputDir = path.join(repoRoot, 'release'),
  runtimeDir,
  force = false,
  allowDirty = false,
}) {
  const targetPlatform = normalizePlatform(platform);
  const targetArch = arch === 'amd64' ? 'x64' : arch;
  if (targetPlatform !== process.platform || targetArch !== process.arch) {
    throw new Error(
      `便携包必须在目标系统原生构建：target=${targetPlatform}/${targetArch} `
        + `runner=${process.platform}/${process.arch}`,
    );
  }
  if (!['win32', 'linux', 'darwin'].includes(targetPlatform)) {
    throw new Error(`不支持的平台：${targetPlatform}`);
  }
  if (targetPlatform === 'win32' && targetArch !== 'x64') {
    throw new Error('首发 Windows 仅支持 x64');
  }
  if (!['x64', 'arm64'].includes(targetArch)) throw new Error(`不支持的架构：${targetArch}`);

  await assertBuildOutputs();
  assertCleanWorktreeForRelease(allowDirty);
  const rootPackage = JSON.parse(await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = rootPackage.version;
  const extension = targetPlatform === 'win32' ? 'zip' : 'tar.gz';
  const archiveName = `mystry-v${version}-${releasePlatform(targetPlatform)}-${targetArch}.${extension}`;
  const resolvedOutput = path.resolve(outputDir);
  const archivePath = path.join(resolvedOutput, archiveName);
  await fsp.mkdir(resolvedOutput, { recursive: true });
  if (fs.existsSync(archivePath)) {
    if (!force) throw new Error(`输出文件已存在；传入 --force 才允许覆盖：${archivePath}`);
    await fsp.unlink(archivePath);
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mystry-portable-package-'));
  const stageRoot = path.join(tempRoot, 'stage');
  const portableRoot = path.join(stageRoot, packageRootName);
  try {
    await Promise.all([
      fsp.mkdir(path.join(portableRoot, 'app'), { recursive: true }),
      fsp.mkdir(path.join(portableRoot, 'config'), { recursive: true, mode: 0o700 }),
      fsp.mkdir(path.join(portableRoot, 'data'), { recursive: true, mode: 0o700 }),
      fsp.mkdir(path.join(portableRoot, 'logs'), { recursive: true, mode: 0o700 }),
    ]);

    if (runtimeDir) {
      await copyFileOrDirectory(path.resolve(runtimeDir), path.join(portableRoot, 'runtime'));
    } else {
      await fetchNodeRuntime({
        platform: targetPlatform,
        arch: targetArch,
        outputDir: path.join(portableRoot, 'runtime'),
      });
    }

    await copyFileOrDirectory(
      path.join(repoRoot, 'apps', 'server', 'dist'),
      path.join(portableRoot, 'app', 'server', 'dist'),
    );
    await copyFileOrDirectory(
      path.join(repoRoot, 'apps', 'server', 'package.json'),
      path.join(portableRoot, 'app', 'server', 'package.json'),
    );
    await copyFileOrDirectory(
      path.join(repoRoot, 'apps', 'web', 'dist'),
      path.join(portableRoot, 'app', 'web', 'dist'),
    );
    await copyFileOrDirectory(
      path.join(repoRoot, 'packages', 'shared', 'dist'),
      path.join(portableRoot, 'app', 'shared', 'dist'),
    );
    await copyFileOrDirectory(
      path.join(repoRoot, 'packages', 'shared', 'package.json'),
      path.join(portableRoot, 'app', 'shared', 'package.json'),
    );
    await copyFileOrDirectory(
      path.join(scriptDir, 'mystryctl.mjs'),
      path.join(portableRoot, 'app', 'mystryctl.mjs'),
    );
    await copyFileOrDirectory(
      path.join(repoRoot, 'LICENSE'),
      path.join(portableRoot, 'LICENSE'),
    );

    if (targetPlatform === 'win32') {
      await copyFileOrDirectory(
        path.join(scriptDir, 'mystryctl.cmd'),
        path.join(portableRoot, 'mystryctl.cmd'),
      );
    } else {
      const wrapperPath = path.join(portableRoot, 'mystryctl');
      await copyFileOrDirectory(path.join(scriptDir, 'mystryctl.sh'), wrapperPath);
      await fsp.chmod(wrapperPath, 0o755);
    }

    const productionNodeModules = await installProductionDependencies(tempRoot);
    await copyProductionDependencies(
      productionNodeModules,
      path.join(portableRoot, 'app', 'node_modules'),
    );

    await fsp.writeFile(path.join(portableRoot, 'VERSION'), `${version}\n`, 'utf8');
    await createPortableReadme(path.join(portableRoot, 'README.txt'), version);
    const runtime = JSON.parse(
      await fsp.readFile(path.join(portableRoot, 'runtime', 'runtime.json'), 'utf8'),
    );
    const files = await collectFiles(portableRoot);
    const manifest = {
      schemaVersion: 1,
      product: 'mystry-dashboard',
      version,
      gitSha: getGitSha(),
      nodeVersion: runtime.nodeVersion,
      platform: targetPlatform,
      arch: targetArch,
      builtAt: new Date().toISOString(),
      entrypoint: 'app/server/dist/index.js',
      files,
    };
    await fsp.writeFile(
      path.join(portableRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await archivePackage(stageRoot, portableRoot, archivePath, targetPlatform);
    return { archivePath, archiveName, manifest };
  } finally {
    const resolvedTemp = path.resolve(tempRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (resolvedTemp.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
      await fsp.rm(resolvedTemp, { recursive: true, force: true });
    }
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const result = await packagePortable({
    platform: args.platform || process.platform,
    arch: args.arch || process.arch,
    outputDir: args['output-dir'] ? path.resolve(args['output-dir']) : undefined,
    runtimeDir: args['runtime-dir'] ? path.resolve(args['runtime-dir']) : undefined,
    force: Boolean(args.force),
    allowDirty: Boolean(args.allowDirty),
  });
  console.log(`便携包已生成：${result.archivePath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
