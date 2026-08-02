import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  ExistingServerSourceInfo,
  ImportExistingServerInput,
} from '@mmd/shared';
import { config } from '../config.js';
import {
  OWNERSHIP_MARKER_FILE,
  assertSafeInstanceRoot,
  getInstanceDir,
  resolveSafePath,
} from '../utils/path.js';
import { ensureEula } from './config-service.js';
import { createInstance, deleteInstance, updateInstanceMeta } from './instance-service.js';
import { detectServerLaunchTarget } from './server-launch-detect.js';
import { recordTaskInstance, runBackgroundTask } from './task-service.js';

type SourceScan = {
  entries: number;
  bytes: number;
};

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('任务已取消');
}

function assertSourceId(sourceId: string): void {
  if (
    sourceId.length === 0
    || sourceId.length > 255
    || sourceId === '.'
    || sourceId === '..'
    || sourceId.includes('/')
    || sourceId.includes('\\')
    || /[\u0000-\u001f]/.test(sourceId)
  ) {
    throw new Error('交接目录标识无效');
  }
}

/** 只允许解析 DATA_DIR/imports 下的直接子目录，不接受系统路径。 */
export function resolveExistingServerSource(sourceId: string): string {
  assertSourceId(sourceId);
  const importRoot = assertSafeInstanceRoot(config.existingServerImportDir);
  const sourceDir = path.resolve(importRoot, sourceId);
  const relative = path.relative(importRoot, sourceDir);
  if (relative !== sourceId || path.isAbsolute(relative)) {
    throw new Error('交接目录必须位于 DATA_DIR/imports 下');
  }
  return assertSafeInstanceRoot(sourceDir);
}

function inspectSource(sourceId: string): ExistingServerSourceInfo {
  try {
    const sourceDir = resolveExistingServerSource(sourceId);
    if (fs.existsSync(resolveSafePath(sourceDir, OWNERSHIP_MARKER_FILE))) {
      throw new Error('目录包含面板实例标记，不能作为交接源');
    }
    const launchTarget = detectServerLaunchTarget(sourceDir);
    const stat = fs.statSync(sourceDir);
    if (!launchTarget) {
      return {
        id: sourceId,
        launchTarget: null,
        coreType: 'custom',
        modifiedAt: stat.mtime.toISOString(),
        ready: false,
        error: '未找到服务端 jar 或 ModLoader args 文件',
      };
    }
    return {
      id: sourceId,
      launchTarget: launchTarget.value,
      coreType: launchTarget.coreType,
      modifiedAt: stat.mtime.toISOString(),
      ready: true,
    };
  } catch (error) {
    return {
      id: sourceId,
      launchTarget: null,
      coreType: 'custom',
      modifiedAt: new Date(0).toISOString(),
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listExistingServerSources(): ExistingServerSourceInfo[] {
  const importRoot = assertSafeInstanceRoot(config.existingServerImportDir);
  return fs
    .readdirSync(importRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => inspectSource(entry.name))
    .sort((left, right) => left.id.localeCompare(right.id, 'zh-CN'));
}

function checkScanLimits(scan: SourceScan): void {
  if (scan.entries > config.maxExistingImportEntries) {
    throw new Error(`已有服务端文件条目超过上限 ${config.maxExistingImportEntries}`);
  }
  if (scan.bytes > config.maxExistingImportBytes) {
    throw new Error(`已有服务端总大小超过上限 ${config.maxExistingImportBytes} 字节`);
  }
}

async function scanSourceDirectory(
  sourceRoot: string,
  signal: AbortSignal,
): Promise<SourceScan> {
  const scan: SourceScan = { entries: 0, bytes: 0 };

  async function walk(relativeDirectory: string): Promise<void> {
    throwIfAborted(signal);
    const current = relativeDirectory
      ? resolveSafePath(sourceRoot, relativeDirectory)
      : assertSafeInstanceRoot(sourceRoot);
    assertSafeInstanceRoot(current);
    const entries = await fs.promises.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      throwIfAborted(signal);
      if (!relativeDirectory && entry.name === OWNERSHIP_MARKER_FILE) {
        throw new Error('交接目录包含面板实例标记，拒绝复制');
      }

      const relative = path.join(relativeDirectory, entry.name);
      const source = resolveSafePath(sourceRoot, relative);
      const stat = await fs.promises.lstat(source);
      if (stat.isSymbolicLink()) {
        throw new Error(`交接目录不能包含 symlink/junction：${relative}`);
      }

      scan.entries += 1;
      if (stat.isDirectory()) {
        assertSafeInstanceRoot(source);
        checkScanLimits(scan);
        await walk(relative);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`交接目录包含不支持的特殊文件：${relative}`);
      }
      scan.bytes += stat.size;
      checkScanLimits(scan);
    }
  }

  await walk('');
  return scan;
}

function assertEnoughDiskSpace(instanceRoot: string, requiredBytes: number): void {
  const stat = fs.statfsSync(instanceRoot);
  const availableBytes = BigInt(stat.bavail) * BigInt(stat.bsize);
  if (BigInt(requiredBytes) > availableBytes) {
    throw new Error('面板数据目录剩余空间不足，无法复制已有服务端');
  }
}

async function copySourceDirectory(
  sourceRoot: string,
  instanceRoot: string,
  scan: SourceScan,
  signal: AbortSignal,
  report: (progress: number, message: string) => void,
): Promise<void> {
  let copiedEntries = 0;
  let copiedBytes = 0;
  let lastProgress = -1;

  function reportCopyProgress(): void {
    const ratio = scan.bytes > 0
      ? copiedBytes / scan.bytes
      : copiedEntries / Math.max(scan.entries, 1);
    const progress = Math.min(90, 20 + Math.floor(ratio * 70));
    if (progress === lastProgress) return;
    lastProgress = progress;
    report(progress, `正在复制已有服务端… ${copiedEntries}/${scan.entries} 项`);
  }

  async function walk(relativeDirectory: string): Promise<void> {
    throwIfAborted(signal);
    const sourceDirectory = relativeDirectory
      ? resolveSafePath(sourceRoot, relativeDirectory)
      : assertSafeInstanceRoot(sourceRoot);
    const entries = await fs.promises.readdir(sourceDirectory, { withFileTypes: true });

    for (const entry of entries) {
      throwIfAborted(signal);
      if (!relativeDirectory && entry.name === OWNERSHIP_MARKER_FILE) {
        throw new Error('交接目录包含面板实例标记，拒绝复制');
      }

      const relative = path.join(relativeDirectory, entry.name);
      const source = resolveSafePath(sourceRoot, relative);
      const target = resolveSafePath(instanceRoot, relative);
      const stat = await fs.promises.lstat(source);
      if (stat.isSymbolicLink()) {
        throw new Error(`交接目录不能包含 symlink/junction：${relative}`);
      }

      copiedEntries += 1;
      if (copiedEntries > config.maxExistingImportEntries) {
        throw new Error(`已有服务端文件条目超过上限 ${config.maxExistingImportEntries}`);
      }

      if (stat.isDirectory()) {
        assertSafeInstanceRoot(source);
        await fs.promises.mkdir(target, { mode: stat.mode & 0o777 });
        await walk(relative);
        reportCopyProgress();
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`交接目录包含不支持的特殊文件：${relative}`);
      }

      let fileBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          fileBytes += chunk.length;
          if (copiedBytes + fileBytes > config.maxExistingImportBytes) {
            callback(new Error(`已有服务端总大小超过上限 ${config.maxExistingImportBytes} 字节`));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        fs.createReadStream(source),
        meter,
        fs.createWriteStream(target, { flags: 'wx', mode: stat.mode & 0o777 }),
        { signal },
      );
      copiedBytes += fileBytes;
      reportCopyProgress();
    }
  }

  await walk('');
}

export async function importExistingServerDirectory(input: ImportExistingServerInput) {
  // 在占用任务队列前先拒绝路径型或不存在的 sourceId；任务执行时仍会再次校验。
  resolveExistingServerSource(input.sourceId);

  return runBackgroundTask('import', '等待复制已有服务端…', async (taskId, signal, report) => {
    let instanceId: string | null = null;
    let completed = false;
    try {
      throwIfAborted(signal);
      const sourceRoot = resolveExistingServerSource(input.sourceId);
      report(5, '正在校验已有服务端目录…');
      const scan = await scanSourceDirectory(sourceRoot, signal);
      const sourceLaunchTarget = detectServerLaunchTarget(sourceRoot);
      if (!sourceLaunchTarget) {
        throw new Error('交接目录中未找到可用的服务端 jar 或 ModLoader args 文件');
      }

      throwIfAborted(signal);
      const instance = createInstance({
        name: input.name.trim(),
        coreType: input.coreType ?? sourceLaunchTarget.coreType,
        mcVersion: input.mcVersion?.trim() || undefined,
        jarFile: sourceLaunchTarget.value,
        jvmArgs: input.jvmArgs,
        acceptEula: input.acceptEula,
        javaRuntimeId: input.javaRuntimeId ?? null,
      });
      instanceId = instance.id;
      recordTaskInstance(taskId, instance.id);
      const instanceRoot = getInstanceDir(instance.id);
      assertEnoughDiskSpace(instanceRoot, scan.bytes);

      report(20, '开始复制已有服务端…');
      await copySourceDirectory(sourceRoot, instanceRoot, scan, signal, report);

      throwIfAborted(signal);
      report(92, '正在确认启动文件…');
      const copiedLaunchTarget = detectServerLaunchTarget(instanceRoot);
      if (!copiedLaunchTarget) {
        throw new Error('复制完成后未找到可用的服务端启动文件');
      }
      updateInstanceMeta(instance.id, {
        core_type: input.coreType ?? copiedLaunchTarget.coreType,
        mc_version: input.mcVersion?.trim() || null,
        jar_file: copiedLaunchTarget.value,
        accept_eula: input.acceptEula ? 1 : 0,
      });
      if (input.acceptEula) ensureEula(instance.id, true);

      report(100, '已有服务端已复制到面板托管目录');
      throwIfAborted(signal);
      completed = true;
      return { instanceId: instance.id };
    } finally {
      if (!completed && instanceId) {
        try {
          deleteInstance(instanceId);
        } catch {
          /* 清理失败不覆盖原始错误 */
        }
      }
    }
  });
}
