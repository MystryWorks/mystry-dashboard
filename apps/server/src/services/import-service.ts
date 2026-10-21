import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { CoreType } from '@mystry/shared';
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
import { assertUploadPath, removeUploadTemp } from './upload-service.js';
import { normalizeAndAssertJvmArgs } from './jvm-validation-service.js';
import { safeExtract } from './zip-service.js';

// 保留原服务的导出入口，现有调用方可继续使用。
export { safeExtract, inspectZipJvmConfig } from './zip-service.js';

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && ['任务执行超时', '任务已取消'].includes(signal.reason.message)) {
    return signal.reason;
  }
  return new Error('任务已取消');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
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
