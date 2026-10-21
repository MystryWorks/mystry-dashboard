import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeConfig = JSON.parse(
  await fsp.readFile(path.join(scriptDir, 'runtime.json'), 'utf8'),
);

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`);
    const name = token.slice(2);
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

function archiveFor(version, platform, arch) {
  const prefix = `node-v${version}`;
  if (platform === 'win32' && arch === 'x64') return `${prefix}-win-x64.zip`;
  if (platform === 'linux' && ['x64', 'arm64'].includes(arch)) {
    return `${prefix}-linux-${arch}.tar.xz`;
  }
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) {
    return `${prefix}-darwin-${arch}.tar.gz`;
  }
  throw new Error(`不支持的 Node 运行时目标：${platform}/${arch}`);
}

async function download(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'nodejs.org') {
    throw new Error(`拒绝从非官方地址下载 Node：${url}`);
  }
  const response = await fetch(parsed, { redirect: 'error' });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：${url}（HTTP ${response.status}）`);
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 200 * 1024 * 1024) {
    throw new Error(`Node 运行时压缩包超过 200MB 上限：${declaredLength}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination, { flags: 'wx' }));
  const stat = await fsp.stat(destination);
  if (stat.size === 0 || stat.size > 200 * 1024 * 1024) {
    throw new Error(`Node 运行时压缩包大小异常：${stat.size}`);
  }
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

function assertEmptyOutput(outputDir) {
  if (!fs.existsSync(outputDir)) return;
  const entries = fs.readdirSync(outputDir);
  if (entries.length > 0) throw new Error(`运行时输出目录不是空目录：${outputDir}`);
}

export async function fetchNodeRuntime({
  version = runtimeConfig.nodeVersion,
  platform = process.platform,
  arch = process.arch,
  outputDir,
}) {
  if (!outputDir) throw new Error('必须指定 Node 运行时输出目录');
  const targetPlatform = normalizePlatform(platform);
  const targetArch = arch === 'amd64' ? 'x64' : arch;
  const archiveName = archiveFor(version, targetPlatform, targetArch);
  const baseUrl = `https://nodejs.org/dist/v${version}`;
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mystry-node-runtime-'));
  const archivePath = path.join(tempRoot, archiveName);
  const checksumsPath = path.join(tempRoot, 'SHASUMS256.txt');
  const extractDir = path.join(tempRoot, 'extract');

  try {
    assertEmptyOutput(outputDir);
    await fsp.mkdir(outputDir, { recursive: true });
    await Promise.all([
      download(`${baseUrl}/${archiveName}`, archivePath),
      download(`${baseUrl}/SHASUMS256.txt`, checksumsPath),
    ]);

    const checksums = await fsp.readFile(checksumsPath, 'utf8');
    const checksumLine = checksums
      .split(/\r?\n/)
      .find((line) => line.trim().endsWith(`  ${archiveName}`));
    if (!checksumLine) throw new Error(`SHASUMS256.txt 中找不到 ${archiveName}`);
    const expected = checksumLine.trim().split(/\s+/)[0].toLowerCase();
    const actual = await sha256(archivePath);
    if (actual !== expected) {
      throw new Error(`Node 运行时 SHA-256 不匹配：expected=${expected} actual=${actual}`);
    }

    await fsp.mkdir(extractDir);
    const extracted = spawnSync('tar', ['-xf', archivePath, '-C', extractDir], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (extracted.status !== 0) {
      throw new Error(`解压 Node 运行时失败：${extracted.stderr || extracted.stdout}`);
    }
    const roots = await fsp.readdir(extractDir, { withFileTypes: true });
    const root = roots.find((entry) => entry.isDirectory());
    if (!root) throw new Error('Node 运行时压缩包缺少根目录');
    const sourceRoot = path.join(extractDir, root.name);

    if (targetPlatform === 'win32') {
      await fsp.copyFile(path.join(sourceRoot, 'node.exe'), path.join(outputDir, 'node.exe'));
    } else {
      const binDir = path.join(outputDir, 'bin');
      await fsp.mkdir(binDir, { recursive: true });
      const nodePath = path.join(binDir, 'node');
      await fsp.copyFile(path.join(sourceRoot, 'bin', 'node'), nodePath);
      await fsp.chmod(nodePath, 0o755);
    }
    await fsp.copyFile(
      path.join(sourceRoot, 'LICENSE'),
      path.join(outputDir, 'LICENSE-node.txt'),
    );
    await fsp.writeFile(
      path.join(outputDir, 'runtime.json'),
      `${JSON.stringify({ nodeVersion: version, platform: targetPlatform, arch: targetArch }, null, 2)}\n`,
      'utf8',
    );
    return { version, platform: targetPlatform, arch: targetArch, archiveName, sha256: actual };
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
  if (!args.output) throw new Error('必须通过 --output 指定空的运行时输出目录');
  const result = await fetchNodeRuntime({
    version: args.version || runtimeConfig.nodeVersion,
    platform: args.platform || process.platform,
    arch: args.arch || process.arch,
    outputDir: path.resolve(args.output),
  });
  console.log(
    `已准备 Node ${result.version} ${result.platform}/${result.arch}：${args.output}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
