import fs from 'node:fs';
import path from 'node:path';
import { createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform, Writable } from 'node:stream';
import { nanoid } from 'nanoid';
import type { CoreType } from '@mmd/shared';
import { config } from '../config.js';
import {
  registerPromotedInstance,
  updateInstanceMeta,
} from './instance-service.js';
import { detectServerLaunchTarget } from './server-launch-detect.js';
import {
  assertSafeInstanceRoot,
  resolveSafePath,
} from '../utils/path.js';
import { recordTaskStaging, runBackgroundTask } from './task-service.js';
import {
  prepareTaskStaging,
  promoteTaskStagingToInstance,
  removeTaskStagingTree,
  stagingMarkerMatches,
  STAGING_MARKER_FILE,
  type TaskStagingMarker,
} from './task-staging-service.js';
import { assertUploadPath } from './upload-service.js';
import { removeUploadTemp } from './upload-service.js';
import { normalizeAndAssertJvmArgs } from './jvm-validation-service.js';
import { MAX_DETECTED_JVM_ARGS_BYTES } from './jvm-detection-service.js';
import { inspectJvmArgFile, type DetectedJvmConfig } from '@mmd/shared';

type ZipEntry = {
  name: string;
  normalizedName: string;
  compressedSize: number;
  uncompressedSize: number;
  compression: number;
  flags: number;
  localHeaderOffset: number;
  directory: boolean;
};

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && ['任务执行超时', '任务已取消'].includes(signal.reason.message)) {
    return signal.reason;
  }
  return new Error('任务已取消');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  const bytes = fs.readSync(fd, buffer, 0, length, position);
  if (bytes !== length) throw new Error('ZIP 文件已损坏');
  return buffer;
}

function zipPathFromEntry(name: string): string {
  if (!name || name.includes('\0')) throw new Error('ZIP entry 名称非法');
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`检测到不安全的 zip 路径：${name}`);
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) {
    throw new Error(`检测到不安全的 zip 路径：${name}`);
  }
  if (!parts.length) throw new Error('ZIP entry 名称为空');
  return parts.join('/');
}

function readZipEntries(zipPath: string, signal: AbortSignal): ZipEntry[] {
  const fileSize = fs.statSync(zipPath).size;
  if (fileSize > config.maxUploadBytes) throw new Error('ZIP 文件过大');
  const tailLength = Math.min(fileSize, 65_557);
  const fd = fs.openSync(zipPath, 'r');
  try {
    const tail = readAt(fd, fileSize - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (
        tail.readUInt32LE(i) === 0x06054b50
        && i + 22 + tail.readUInt16LE(i + 20) === tail.length
      ) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件');

    const diskNumber = tail.readUInt16LE(eocd + 4);
    const centralDisk = tail.readUInt16LE(eocd + 6);
    const entriesOnDisk = tail.readUInt16LE(eocd + 8);
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 文件');
    }
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
      throw new Error('暂不支持分卷 ZIP 文件');
    }
    if (totalEntries > config.maxZipEntries) throw new Error('ZIP 条目数量超过限制');
    if (centralSize > config.maxZipCentralDirectoryBytes) {
      throw new Error('ZIP 目录数据超过限制');
    }
    if (centralOffset + centralSize > fileSize) throw new Error('ZIP 目录位置非法');

    const central = readAt(fd, centralOffset, centralSize);
    const entries: ZipEntry[] = [];
    const seen = new Set<string>();
    let offset = 0;
    let totalUncompressed = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      throwIfAborted(signal);
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('ZIP 中央目录已损坏');
      }
      const flags = central.readUInt16LE(offset + 8);
      const compression = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const externalAttributes = central.readUInt32LE(offset + 38);
      const localHeaderOffset = central.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > central.length) throw new Error('ZIP entry 元数据已损坏');

      const name = central.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      const normalizedName = zipPathFromEntry(name);
      const unixMode = (externalAttributes >>> 16) & 0xffff;
      const fileType = unixMode & 0xf000;
      if (fileType === 0xa000 || (unixMode !== 0 && fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000)) {
        throw new Error(`ZIP 中不允许链接或特殊文件：${name}`);
      }
      if ((flags & 1) !== 0) throw new Error(`ZIP 加密 entry 不受支持：${name}`);
      if (compressedSize > config.maxUploadBytes || uncompressedSize > config.maxZipEntryBytes) {
        throw new Error(`ZIP entry 超过单文件大小限制：${name}`);
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > config.maxZipUncompressedBytes) {
        throw new Error('ZIP 解压总量超过限制');
      }

      const key = process.platform === 'win32' ? normalizedName.toLowerCase() : normalizedName;
      if (seen.has(key)) throw new Error(`ZIP 存在重复 entry：${name}`);
      seen.add(key);
      entries.push({
        name,
        normalizedName,
        compressedSize,
        uncompressedSize,
        compression,
        flags,
        localHeaderOffset,
        directory: name.endsWith('/') || fileType === 0x4000,
      });
      offset = end;
    }
    if (offset !== central.length) {
      // 中央目录后允许 ZIP 注释，但不允许 entry 数量与目录内容不一致。
      const remaining = central.length - offset;
      if (remaining > 0) throw new Error('ZIP 中央目录条目数量不一致');
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

async function extractZipEntry(
  zipPath: string,
  destDir: string,
  entry: ZipEntry,
  totalWritten: { value: number },
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const fd = fs.openSync(zipPath, 'r');
  let dataStart: number;
  try {
    const local = readAt(fd, entry.localHeaderOffset, 30);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP entry 头非法：${entry.name}`);
    const localNameLength = local.readUInt16LE(26);
    const localExtraLength = local.readUInt16LE(28);
    dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
    const fileSize = fs.statSync(zipPath).size;
    if (dataStart + entry.compressedSize > fileSize) throw new Error(`ZIP entry 数据越界：${entry.name}`);
    throwIfAborted(signal);
  } finally {
    fs.closeSync(fd);
  }

  const target = resolveSafePath(destDir, entry.normalizedName);
  if (entry.directory) {
    throwIfAborted(signal);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (fs.existsSync(target)) throw new Error(`ZIP entry 覆盖了已有路径：${entry.name}`);

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (signal.aborted) {
        callback(abortError(signal));
        return;
      }
      written += chunk.length;
      totalWritten.value += chunk.length;
      if (written > config.maxZipEntryBytes || totalWritten.value > config.maxZipUncompressedBytes) {
        callback(new Error('ZIP 解压数据超过限制'));
        return;
      }
      callback(null, chunk);
    },
  });
  const source = entry.compressedSize === 0
    ? Readable.from([])
    : fs.createReadStream(zipPath, {
        start: dataStart,
        end: dataStart + entry.compressedSize - 1,
      });
  const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
  let success = false;
  try {
    if (entry.compression === 0) {
      await pipeline(source, counter, output, { signal });
    } else if (entry.compression === 8) {
      await pipeline(source, createInflateRaw(), counter, output, { signal });
    } else {
      throw new Error(`ZIP compression method 不受支持：${entry.name}`);
    }
    if (written !== entry.uncompressedSize) throw new Error(`ZIP entry 解压大小不匹配：${entry.name}`);
    success = true;
  } finally {
    if (fs.existsSync(target) && !success) {
      fs.rmSync(target, { force: true });
    }
  }
}

async function readZipEntryText(
  zipPath: string,
  entry: ZipEntry,
  signal: AbortSignal,
): Promise<string> {
  if (entry.uncompressedSize > MAX_DETECTED_JVM_ARGS_BYTES) {
    throw new Error('user_jvm_args.txt 超过 64 KiB，不能自动沿用');
  }
  const fd = fs.openSync(zipPath, 'r');
  let dataStart: number;
  try {
    const local = readAt(fd, entry.localHeaderOffset, 30);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP entry 头非法：${entry.name}`);
    dataStart = entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    if (dataStart + entry.compressedSize > fs.statSync(zipPath).size) {
      throw new Error(`ZIP entry 数据越界：${entry.name}`);
    }
  } finally {
    fs.closeSync(fd);
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_DETECTED_JVM_ARGS_BYTES) {
        callback(new Error('user_jvm_args.txt 超过 64 KiB，不能自动沿用'));
        return;
      }
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const source = entry.compressedSize === 0
    ? Readable.from([])
    : fs.createReadStream(zipPath, {
        start: dataStart,
        end: dataStart + entry.compressedSize - 1,
      });
  if (entry.compression === 0) {
    await pipeline(source, sink, { signal });
  } else if (entry.compression === 8) {
    await pipeline(source, createInflateRaw(), sink, { signal });
  } else {
    throw new Error(`user_jvm_args.txt 使用了不受支持的 ZIP compression method：${entry.compression}`);
  }
  if (bytes !== entry.uncompressedSize) throw new Error('user_jvm_args.txt 解压大小不匹配');
  return Buffer.concat(chunks).toString('utf8');
}

function invalidDetectedJvmConfig(message: string): DetectedJvmConfig {
  return {
    source: 'user_jvm_args.txt',
    raw: '',
    canonicalArgs: null,
    issues: [{ code: 'ZIP_ARGFILE_ERROR', severity: 'error', message }],
  };
}

/** ZIP 预览只读取中央目录和受限的 user_jvm_args.txt，不解压完整安装包。 */
export async function inspectZipJvmConfig(
  zipPath: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<DetectedJvmConfig | undefined> {
  const entries = readZipEntries(zipPath, signal);
  const files = entries.filter((entry) => !entry.directory);
  const topLevels = new Set(files.map((entry) => entry.normalizedName.split('/')[0]!.toLowerCase()));
  const singleRoot = topLevels.size === 1
    && files.every((entry) => entry.normalizedName.includes('/'))
    ? [...topLevels][0]
    : null;
  const candidates = files.filter((entry) => {
    const normalized = entry.normalizedName.toLowerCase();
    return normalized === 'user_jvm_args.txt'
      || (singleRoot !== null && normalized === `${singleRoot}/user_jvm_args.txt`);
  });
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) {
    return invalidDetectedJvmConfig('ZIP 中存在多个 user_jvm_args.txt，不能自动沿用');
  }
  try {
    const raw = await readZipEntryText(zipPath, candidates[0]!, signal);
    return inspectJvmArgFile(raw);
  } catch (error) {
    return invalidDetectedJvmConfig(error instanceof Error ? error.message : String(error));
  }
}

/** 流式解压 ZIP；只在内存中保留中央目录，不会把整个上传包读入内存。 */
export async function safeExtract(
  zipPath: string,
  destDir: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  assertSafeInstanceRoot(destDir);
  try {
    throwIfAborted(signal);
    const entries = readZipEntries(zipPath, signal);
    const totalWritten = { value: 0 };
    for (const entry of entries) {
      throwIfAborted(signal);
      await extractZipEntry(zipPath, destDir, entry, totalWritten, signal);
    }
  } catch (err) {
    fs.rmSync(destDir, { recursive: true, force: true });
    if (signal.aborted) throw abortError(signal);
    throw err;
  }
}

/** 若解压后只有一层目录，则上移内容到实例根目录。 */
function flattenSingleRoot(
  dir: string,
  signal: AbortSignal,
  stagingMarker: TaskStagingMarker,
): void {
  throwIfAborted(signal);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hasExpectedStagingMarker = stagingMarkerMatches(dir, stagingMarker);
  const contentEntries = entries.filter(
    (entry) => entry.name !== STAGING_MARKER_FILE || !hasExpectedStagingMarker,
  );
  if (contentEntries.length !== 1 || !contentEntries[0]!.isDirectory()) return;
  const nested = path.join(dir, contentEntries[0]!.name);
  const nestedEntries = fs.readdirSync(nested);
  for (const name of nestedEntries) {
    throwIfAborted(signal);
    const source = path.join(nested, name);
    const target = path.join(dir, name);
    if (fs.existsSync(target)) throw new Error(`ZIP 根目录存在重复路径：${name}`);
    fs.renameSync(source, target);
  }
  fs.rmSync(nested, { recursive: true, force: true });
}

function moveExtractedContents(sourceDir: string, instanceDir: string, signal: AbortSignal): void {
  assertSafeInstanceRoot(sourceDir);
  assertSafeInstanceRoot(instanceDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    throwIfAborted(signal);
    const source = path.join(sourceDir, entry.name);
    const target = resolveSafePath(instanceDir, entry.name);
    if (entry.name === '.mmd-instance.json' || fs.existsSync(target)) {
      throw new Error(`ZIP 不能覆盖实例保留路径：${entry.name}`);
    }
    try {
      fs.renameSync(source, target);
    } catch (err) {
      if (!(err && typeof err === 'object' && 'code' in err && err.code === 'EXDEV')) throw err;
      fs.cpSync(source, target, { recursive: true, force: false });
      fs.rmSync(source, { recursive: true, force: true });
    }
  }
}

export async function importZipPackage(options: {
  name: string;
  zipPath: string;
  coreType?: CoreType;
  mcVersion?: string;
  jvmArgs?: string;
  acceptEula?: boolean;
  javaRuntimeId?: string | null;
  preserveUploadOnEnqueueFailure?: boolean;
}) {
  const zipPath = assertUploadPath(options.zipPath);
  options = {
    ...options,
    jvmArgs: normalizeAndAssertJvmArgs(options.jvmArgs ?? '-Xms1G -Xmx2G', {
      coreType: options.coreType,
      javaRuntimeId: options.javaRuntimeId,
    }),
  };
  try {
    return await runBackgroundTask('import', '正在导入安装包…', async (taskId, signal, report) => {
    let instanceId: string | null = null;
    let stagingToken: string | null = null;
    let completed = false;
    try {
      throwIfAborted(signal);
      instanceId = nanoid(12);
      stagingToken = nanoid(32);
      const stagingMarker: TaskStagingMarker = {
        version: 1,
        taskId,
        instanceId,
        token: stagingToken,
      };
      recordTaskStaging(taskId, instanceId, stagingToken);
      const staging = prepareTaskStaging(taskId, instanceId, stagingToken);
      throwIfAborted(signal);
      report(20, '流式解压安装包…');
      await safeExtract(zipPath, staging, signal);
      flattenSingleRoot(staging, signal, stagingMarker);

      throwIfAborted(signal);
      report(70, '校验实例文件…');
      const launchTarget = await detectServerLaunchTarget(staging, {
        maxDepth: config.modLoaderScanMaxDepth,
        maxEntries: config.modLoaderScanMaxEntries,
        deadlineMs: config.modLoaderScanTimeoutMs,
        signal,
      });
      if (!launchTarget) {
        throw new Error('安装包中未找到可用的服务端 jar 或 ModLoader args 文件');
      }

      throwIfAborted(signal);
      report(85, '写入实例目录…');
      promoteTaskStagingToInstance(taskId, instanceId);
      // promote 之后目录已在 instances/<id>，不得再因超时/关闭中止，必须继续注册。
      const dir = path.join(config.instancesDir, instanceId);
      assertSafeInstanceRoot(dir);

      report(90, '注册实例…');
      registerPromotedInstance(instanceId, {
        name: options.name,
        coreType: options.coreType ?? launchTarget.coreType,
        mcVersion: options.mcVersion?.trim() || undefined,
        jarFile: launchTarget.value,
        jvmArgs: options.jvmArgs,
        acceptEula: options.acceptEula,
        javaRuntimeId: options.javaRuntimeId ?? null,
      });
      completed = true;

      if (options.acceptEula) {
        fs.writeFileSync(resolveSafePath(dir, 'eula.txt'), 'eula=true\n', 'utf8');
      }

      updateInstanceMeta(instanceId, {
        core_type: options.coreType ?? launchTarget.coreType,
        mc_version: options.mcVersion?.trim() || null,
        jar_file: launchTarget.value,
        accept_eula: options.acceptEula ? 1 : 0,
      });

      report(100, '导入完成');
      return { instanceId };
    } finally {
      if (!completed && instanceId && stagingToken) {
        try {
          removeTaskStagingTree(taskId, instanceId);
        } catch {
          /* 清理失败不覆盖原始错误 */
        }
      }
      if (fs.existsSync(zipPath)) {
        try {
          removeUploadTemp(zipPath);
        } catch {
          /* 清理失败不覆盖原始错误 */
        }
      }
    }
    });
  } catch (err) {
    // 任务未进入队列（队列满/面板关闭中）时任务回调不会执行，兜底清理上传临时文件。
    if (!options.preserveUploadOnEnqueueFailure && fs.existsSync(zipPath)) {
      try {
        removeUploadTemp(zipPath);
      } catch {
        /* 清理失败不覆盖原始错误 */
      }
    }
    throw err;
  }
}
