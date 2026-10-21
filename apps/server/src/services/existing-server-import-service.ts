import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  ExistingServerSourceInfo,
  ImportExistingServerInput,
} from '@mystry/shared';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import {
  OWNERSHIP_MARKER_FILE,
  assertSafeInstanceRoot,
  resolveSafePath,
} from '../utils/path.js';
import { registerPromotedInstance, updateInstanceMeta } from './instance-service.js';
import { normalizeAndAssertJvmArgs } from './jvm-validation-service.js';
import { detectJvmConfigFile, jvmConfigFileFingerprint } from './jvm-detection-service.js';
import { detectJarFile, detectServerLaunchTarget, isModLoaderScanLimitError, type ModLoaderScanBudget } from './server-launch-detect.js';
import { recordTaskStaging, runBackgroundTask } from './task-service.js';
import {
  prepareTaskStaging,
  promoteTaskStagingToInstance,
  removeTaskStagingTree,
} from './task-staging-service.js';

type SourceScan = {
  entries: number;
  bytes: number;
};

type PrecheckCacheEntry = {
  mtimeMs: number;
  jvmFingerprint: string;
  info: ExistingServerSourceInfo;
};

const sourcePrecheckCache = new Map<string, PrecheckCacheEntry>();

function modLoaderPrecheckBudget(): ModLoaderScanBudget {
  return {
    maxDepth: config.modLoaderPrecheckMaxDepth,
    maxEntries: config.modLoaderPrecheckMaxEntries,
    deadlineMs: config.modLoaderPrecheckTimeoutMs,
  };
}

function modLoaderFullScanBudget(signal: AbortSignal): ModLoaderScanBudget {
  return {
    maxDepth: config.modLoaderScanMaxDepth,
    maxEntries: config.modLoaderScanMaxEntries,
    deadlineMs: config.modLoaderScanTimeoutMs,
    signal,
  };
}

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

async function inspectSource(sourceId: string): Promise<ExistingServerSourceInfo> {
  try {
    const sourceDir = resolveExistingServerSource(sourceId);
    const stat = fs.statSync(sourceDir);
    const jvmFingerprint = jvmConfigFileFingerprint(sourceDir);
    const cached = sourcePrecheckCache.get(sourceId);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.jvmFingerprint === jvmFingerprint) {
      return cached.info;
    }

    const completeInfo = (info: ExistingServerSourceInfo): ExistingServerSourceInfo => {
      const detectedJvmConfig = detectJvmConfigFile(sourceDir, info.coreType);
      const complete = detectedJvmConfig ? { ...info, detectedJvmConfig } : info;
      sourcePrecheckCache.set(sourceId, { mtimeMs: stat.mtimeMs, jvmFingerprint, info: complete });
      return complete;
    };

    if (fs.existsSync(resolveSafePath(sourceDir, OWNERSHIP_MARKER_FILE))) {
      throw new Error('目录包含面板实例标记，不能作为交接源');
    }

    const jarFile = detectJarFile(sourceDir);
    if (jarFile) {
      const info: ExistingServerSourceInfo = {
        id: sourceId,
        launchTarget: jarFile,
        coreType: jarFile.toLowerCase().includes('paper')
          ? 'paper'
          : jarFile.toLowerCase().includes('fabric')
            ? 'fabric'
            : jarFile === 'server.jar'
              ? 'vanilla'
              : 'custom',
        modifiedAt: stat.mtime.toISOString(),
        ready: true,
      };
      return completeInfo(info);
    }

    try {
      const launchTarget = await detectServerLaunchTarget(sourceDir, modLoaderPrecheckBudget());
      if (launchTarget) {
        const info: ExistingServerSourceInfo = {
          id: sourceId,
          launchTarget: launchTarget.value,
          coreType: launchTarget.coreType,
          modifiedAt: stat.mtime.toISOString(),
          ready: true,
        };
        return completeInfo(info);
      }
    } catch (error) {
      if (isModLoaderScanLimitError(error)) {
        const info: ExistingServerSourceInfo = {
          id: sourceId,
          launchTarget: null,
          coreType: 'custom',
          modifiedAt: stat.mtime.toISOString(),
          ready: true,
          error: '快速预检未找到启动文件；提交后将在导入任务中做完整校验',
        };
        return completeInfo(info);
      }
      throw error;
    }

    const info: ExistingServerSourceInfo = {
      id: sourceId,
      launchTarget: null,
      coreType: 'custom',
      modifiedAt: stat.mtime.toISOString(),
      ready: false,
      error: '未找到服务端 jar 或 ModLoader args 文件',
    };
    return completeInfo(info);
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

export async function listExistingServerSources(): Promise<ExistingServerSourceInfo[]> {
  const importRoot = assertSafeInstanceRoot(config.existingServerImportDir);
  const entries = fs
    .readdirSync(importRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));

  const sources: ExistingServerSourceInfo[] = [];
  for (const sourceId of entries) {
    sources.push(await inspectSource(sourceId));
  }
  return sources;
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
        // 使用固定权限而不是沿用源目录 mode，避免把源端特殊权限带入面板托管目录。
        await fs.promises.mkdir(target, { mode: 0o700 });
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
      // 先打开源文件 fd 再 fstat 校验，消除 lstat 与读流之间文件被替换的 TOCTOU 窗口。
      const sourceFd = await fs.promises.open(source, 'r');
      try {
        const fdStat = await sourceFd.stat();
        if (!fdStat.isFile()) {
          throw new Error(`交接目录包含不支持的特殊文件：${relative}`);
        }
        await pipeline(
          sourceFd.createReadStream(),
          meter,
          fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
      } finally {
        await sourceFd.close();
      }
      copiedBytes += fileBytes;
      reportCopyProgress();
    }
  }

  await walk('');
}

export async function importExistingServerDirectory(input: ImportExistingServerInput) {
  // 在占用任务队列前先拒绝路径型或不存在的 sourceId；任务执行时仍会再次校验。
  resolveExistingServerSource(input.sourceId);
  input = {
    ...input,
    jvmArgs: normalizeAndAssertJvmArgs(input.jvmArgs ?? '-Xms1G -Xmx2G', {
      coreType: input.coreType,
      javaRuntimeId: input.javaRuntimeId,
    }),
  };

  return runBackgroundTask('import', '等待复制已有服务端…', async (taskId, signal, report) => {
    let instanceId: string | null = null;
    let stagingToken: string | null = null;
    let completed = false;
    try {
      throwIfAborted(signal);
      const sourceRoot = resolveExistingServerSource(input.sourceId);
      report(5, '正在校验已有服务端目录…');
      const scan = await scanSourceDirectory(sourceRoot, signal);
      const sourceLaunchTarget = await detectServerLaunchTarget(
        sourceRoot,
        modLoaderFullScanBudget(signal),
      );
      if (!sourceLaunchTarget) {
        throw new Error('交接目录中未找到可用的服务端 jar 或 ModLoader args 文件');
      }

      throwIfAborted(signal);
      instanceId = nanoid(12);
      stagingToken = nanoid(32);
      recordTaskStaging(taskId, instanceId, stagingToken);
      const stagingRoot = prepareTaskStaging(taskId, instanceId, stagingToken);
      assertEnoughDiskSpace(stagingRoot, scan.bytes);

      report(20, '开始复制已有服务端…');
      await copySourceDirectory(sourceRoot, stagingRoot, scan, signal, report);

      throwIfAborted(signal);
      report(92, '正在确认启动文件…');
      const copiedLaunchTarget = await detectServerLaunchTarget(
        stagingRoot,
        modLoaderFullScanBudget(signal),
      );
      if (!copiedLaunchTarget) {
        throw new Error('复制完成后未找到可用的服务端启动文件');
      }

      report(95, '写入实例目录…');
      throwIfAborted(signal);
      promoteTaskStagingToInstance(taskId, instanceId);
      registerPromotedInstance(instanceId, {
        name: input.name.trim(),
        coreType: input.coreType ?? copiedLaunchTarget.coreType,
        mcVersion: input.mcVersion?.trim() || undefined,
        jarFile: copiedLaunchTarget.value,
        jvmArgs: input.jvmArgs,
        acceptEula: input.acceptEula,
        javaRuntimeId: input.javaRuntimeId ?? null,
      });
      completed = true;
      updateInstanceMeta(instanceId, {
        core_type: input.coreType ?? copiedLaunchTarget.coreType,
        mc_version: input.mcVersion?.trim() || null,
        jar_file: copiedLaunchTarget.value,
        accept_eula: input.acceptEula ? 1 : 0,
      });
      if (input.acceptEula) {
        const instanceRoot = path.join(config.instancesDir, instanceId);
        fs.writeFileSync(resolveSafePath(instanceRoot, 'eula.txt'), 'eula=true\n', 'utf8');
      }

      report(100, '已有服务端已复制到面板托管目录');
      return { instanceId };
    } finally {
      if (!completed && instanceId) {
        try {
          removeTaskStagingTree(taskId, instanceId);
        } catch {
          /* 清理失败不覆盖原始错误 */
        }
      }
    }
  });
}
