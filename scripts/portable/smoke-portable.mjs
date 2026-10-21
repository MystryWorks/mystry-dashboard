import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} 执行失败：\n${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function runControl(root, command, env) {
  const nodeExecutable = process.platform === 'win32'
    ? path.join(root, 'runtime', 'node.exe')
    : path.join(root, 'runtime', 'bin', 'node');
  return run(
    nodeExecutable,
    ['--experimental-sqlite', path.join(root, 'app', 'mystryctl.mjs'), command],
    { cwd: root, env },
  );
}

function verifyWrapper(root, env) {
  const output = process.platform === 'win32'
    ? run(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', 'mystryctl.cmd help'],
        { cwd: root, env },
      )
    : run(path.join(root, 'mystryctl'), ['help'], { cwd: root, env });
  if (!output.includes('Mystry Dashboard 便携版管理器')) {
    throw new Error('平台入口脚本未能调用包内便携控制器');
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function verifyManifest(portableRoot, manifest) {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('manifest.json 缺少文件校验清单');
  }
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const actualPaths = [];

  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(portableRoot, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`最终压缩包包含符号链接：${relative}`);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && relative !== 'manifest.json') {
        actualPaths.push(relative);
        const expectedFile = expected.get(relative);
        if (!expectedFile) throw new Error(`manifest.json 未登记文件：${relative}`);
        const stat = await fsp.stat(absolute);
        if (stat.size !== expectedFile.size) throw new Error(`文件大小不匹配：${relative}`);
        if (await hashFile(absolute) !== expectedFile.sha256) {
          throw new Error(`文件 SHA-256 不匹配：${relative}`);
        }
      }
    }
  }

  await visit(portableRoot);
  actualPaths.sort((left, right) => left.localeCompare(right));
  const expectedPaths = [...expected.keys()].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('manifest.json 文件清单与解压结果不一致');
  }
}

async function main() {
  const archive = process.argv[2];
  if (!archive) throw new Error('用法：node smoke-portable.mjs <archive>');
  const archivePath = path.resolve(archive);
  if (!fs.existsSync(archivePath)) throw new Error(`便携包不存在：${archivePath}`);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mystry-portable-smoke-'));
  const extractDir = path.join(tempRoot, 'extract');
  let portableRoot = '';
  let started = false;
  let controlEnv = null;
  try {
    await fsp.mkdir(extractDir);
    run('tar', ['-xf', archivePath, '-C', extractDir]);
    portableRoot = path.join(extractDir, 'mystry-dashboard');
    const manifest = JSON.parse(
      await fsp.readFile(path.join(portableRoot, 'manifest.json'), 'utf8'),
    );
    if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
      throw new Error(
        `便携包目标与当前机器不一致：package=${manifest.platform}/${manifest.arch} `
          + `host=${process.platform}/${process.arch}`,
      );
    }
    await verifyManifest(portableRoot, manifest);
    for (const name of ['config', 'data', 'logs']) {
      const entries = await fsp.readdir(path.join(portableRoot, name));
      if (entries.length !== 0) throw new Error(`发布包的 ${name}/ 必须为空`);
    }
    const sharedStat = await fsp.lstat(
      path.join(portableRoot, 'app', 'node_modules', '@mystry', 'shared'),
    );
    if (!sharedStat.isDirectory() || sharedStat.isSymbolicLink()) {
      throw new Error('@mystry/shared 必须是发布包内的物理目录');
    }
    if (fs.existsSync(path.join(portableRoot, 'app', 'node_modules', 'typescript'))) {
      throw new Error('发布包不得包含 TypeScript 开发依赖');
    }

    const port = await reservePort();
    const env = {
      ...process.env,
      MYSTRY_HOME: portableRoot,
      MYSTRY_CONFIG_PATH: path.join(portableRoot, 'config', 'panel.env'),
      MYSTRY_DATA_DIR: path.join(portableRoot, 'data'),
      MYSTRY_NO_BROWSER: '1',
      PORT: String(port),
    };
    controlEnv = env;
    verifyWrapper(portableRoot, env);
    const startOutput = runControl(portableRoot, 'start', env);
    if (!startOutput.includes('面板已启动')) {
      throw new Error(`启动输出缺少成功标记：\n${startOutput}`);
    }
    started = true;
    if (!fs.existsSync(path.join(portableRoot, 'config', 'panel.env'))) {
      throw new Error('首次启动未在 config/panel.env 生成配置');
    }
    if (!fs.existsSync(path.join(portableRoot, 'data', 'panel.db'))) {
      throw new Error('首次启动未在 data/panel.db 创建数据库');
    }
    if (fs.existsSync(path.join(portableRoot, '.env'))) {
      throw new Error('便携根目录不得生成源码模式 .env');
    }
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await health.json();
    if (!health.ok || body?.service !== 'mystry-dashboard') {
      throw new Error(`健康检查失败：HTTP ${health.status}`);
    }
    const statusOutput = runControl(portableRoot, 'status', env);
    if (!statusOutput.includes('状态：运行中')) {
      throw new Error(`状态检查失败：\n${statusOutput}`);
    }
    const logsOutput = runControl(portableRoot, 'logs', env);
    if (!logsOutput.includes('stdout')) {
      throw new Error(`日志命令未返回面板输出：\n${logsOutput}`);
    }
    const openOutput = runControl(portableRoot, 'open', env);
    if (!openOutput.includes(`http://127.0.0.1:${port}`)) {
      throw new Error(`open 命令未返回面板地址：\n${openOutput}`);
    }
    const restartOutput = runControl(portableRoot, 'restart', env);
    if (!restartOutput.includes('面板已启动')) {
      throw new Error(`重启输出缺少成功标记：\n${restartOutput}`);
    }
    const restartedHealth = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!restartedHealth.ok) {
      throw new Error(`重启后的健康检查失败：HTTP ${restartedHealth.status}`);
    }
    runControl(portableRoot, 'stop', env);
    started = false;
    console.log(`便携包冒烟验证通过：${path.basename(archivePath)}`);
  } finally {
    if (started && portableRoot && controlEnv) {
      try {
        runControl(portableRoot, 'stop', controlEnv);
      } catch {
        // 后续清理仍会尝试，主错误由上层保留。
      }
    }
    const resolvedTemp = path.resolve(tempRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (resolvedTemp.startsWith(`${resolvedSystemTemp}${path.sep}`)) {
      await fsp.rm(resolvedTemp, {
        recursive: true,
        force: true,
        maxRetries: 15,
        retryDelay: 1_000,
      });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
