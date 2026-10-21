import fs from 'node:fs';
import path from 'node:path';
import type { DeployCoreInput } from '@mystry/shared';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { registerPromotedInstance, updateInstanceMeta } from './instance-service.js';
import { detectJarFile, findModLoaderArgsFile } from './server-launch-detect.js';
import { resolveSafePath } from '../utils/path.js';
import { recordTaskStaging, runBackgroundTask } from './task-service.js';
import { prepareTaskStaging, promoteTaskStagingToInstance, removeTaskStagingTree } from './task-staging-service.js';
import { normalizeAndAssertJvmArgs } from './jvm-validation-service.js';
import { resolveJavaRuntimeCommand } from './java-runtime-service.js';
import { throwIfAborted } from './core-utils.js';
import { ensureCoreCache, isUsableCoreCache } from './core-download.js';
import { runInstaller, writeUserJvmArgs } from './core-installer.js';
import {
  buildResolvedCoreCacheBasename,
  forgeInstallerUrl,
  listForgeLoaders,
  listNeoForgeLoaders,
  neoForgeInstallerUrl,
  resolveFabricJarUrl,
  resolvePaperDownload,
  resolveVanillaServerUrl,
} from './core-metadata.js';

// 保留原有模块入口，路由与既有调用方无需随内部拆分迁移。
export {
  buildResolvedCoreCacheBasename, fetchJson, fetchText, listCoreVersions,
  listFabricInstallers, listFabricLoaders, listForgeLoaders, listNeoForgeLoaders,
  listPaperBuilds, neoForgeVersionToMc,
} from './core-metadata.js';
export { downloadToFile, isUsableCoreCache } from './core-download.js';
export { isRetryableInstallerFailure, summarizeInstallerDownloadFailure, writeUserJvmArgs } from './core-installer.js';

/**
 * 创建实例并后台下载核心。
 */
export async function deployCore(input: DeployCoreInput) {
  input = {
    ...input,
    jvmArgs: normalizeAndAssertJvmArgs(input.jvmArgs ?? '-Xms1G -Xmx2G', {
      coreType: input.coreType,
      javaRuntimeId: input.javaRuntimeId,
    }),
  };
  return runBackgroundTask(
    'deploy',
    `正在部署 ${input.coreType} ${input.mcVersion}`,
    async (taskId, signal, report) => {
      let instanceId: string | null = null;
      let stagingToken: string | null = null;
      let completed = false;
      try {
        throwIfAborted(signal);
        instanceId = nanoid(12);
        stagingToken = nanoid(32);
        recordTaskStaging(taskId, instanceId, stagingToken);
        const dir = prepareTaskStaging(taskId, instanceId, stagingToken);
        const writeEulaIfNeeded = () => {
          if (input.acceptEula) {
            fs.writeFileSync(resolveSafePath(dir, 'eula.txt'), 'eula=true\n', 'utf8');
          }
        };

        let jarFile: string;
        const usesInstaller = input.coreType === 'forge' || input.coreType === 'neoforge';
        if (input.coreType === 'forge' || input.coreType === 'neoforge') {
          throwIfAborted(signal);
          report(5, '解析 Forge/NeoForge 版本…');
          let loaderVersion = input.loaderVersion;
          if (!loaderVersion) {
            const loaders =
              input.coreType === 'forge'
                ? await listForgeLoaders(input.mcVersion, signal)
                : await listNeoForgeLoaders(input.mcVersion, signal);
            loaderVersion = loaders[0];
          }
          if (!loaderVersion) {
            throw new Error(`${input.coreType} ${input.mcVersion} 没有可用版本`);
          }

          const installerUrl =
            input.coreType === 'forge'
              ? forgeInstallerUrl(input.mcVersion, loaderVersion)
              : neoForgeInstallerUrl(loaderVersion);
          const installerName =
            input.coreType === 'forge'
              ? `forge-${input.mcVersion}-${loaderVersion}-installer.jar`
              : `neoforge-${loaderVersion}-installer.jar`;
          const cachePath = path.join(
            config.cacheDir,
            installerName.replace(/[^\w.-]+/g, '_'),
          );
          const installerDest = resolveSafePath(dir, installerName);

          if (isUsableCoreCache(cachePath)) {
            throwIfAborted(signal);
            report(20, '使用本地 installer 缓存…');
            fs.copyFileSync(cachePath, installerDest);
          } else {
            throwIfAborted(signal);
            report(15, '下载 installer…');
            await ensureCoreCache(installerUrl, cachePath, (ratio) => {
              report(15 + ratio * 40, `下载 installer ${(ratio * 100).toFixed(0)}%`);
            }, signal);
            throwIfAborted(signal);
            fs.copyFileSync(cachePath, installerDest);
          }

          throwIfAborted(signal);
          report(60, '运行 --installServer…');
          writeUserJvmArgs(dir, input.jvmArgs || '-Xms1G -Xmx2G');
          const javaCommand = await resolveJavaRuntimeCommand(input.javaRuntimeId);
          await runInstaller(installerDest, dir, javaCommand, signal, (progress, message) => {
            report(progress, message);
          });

          // 安装结束后移除临时 installer。
          try {
            fs.unlinkSync(installerDest);
          } catch {
            /* 清理失败不影响后续启动目标探测 */
          }

          throwIfAborted(signal);
          report(85, '探测启动文件…');
          const argsFile = await findModLoaderArgsFile(dir, input.coreType, {
            maxDepth: config.modLoaderScanMaxDepth,
            maxEntries: config.modLoaderScanMaxEntries,
            deadlineMs: config.modLoaderScanTimeoutMs,
            signal,
          });
          jarFile = '@modloader';
          if (argsFile) {
            jarFile = `@args:${argsFile}`;
          } else {
            const jar = detectJarFile(dir);
            if (!jar) {
              throw new Error('安装完成但未找到可启动的 jar / args 文件');
            }
            jarFile = jar;
          }

          writeEulaIfNeeded();
          throwIfAborted(signal);
          report(95, '写入实例目录…');
        } else {
          // Vanilla / Paper / Fabric：直接下载 jar
          throwIfAborted(signal);
          const destJar = resolveSafePath(dir, 'server.jar');

          report(5, '解析下载地址…');

          let downloadUrl: string;
          let cacheBasename: string;
          if (input.coreType === 'vanilla') {
            downloadUrl = await resolveVanillaServerUrl(input.mcVersion, signal);
            cacheBasename = buildResolvedCoreCacheBasename('vanilla', input.mcVersion, {});
          } else if (input.coreType === 'paper') {
            const paper = await resolvePaperDownload(input.mcVersion, input.build, signal);
            downloadUrl = paper.url;
            cacheBasename = buildResolvedCoreCacheBasename('paper', input.mcVersion, { build: paper.build });
          } else {
            const fabric = await resolveFabricJarUrl(
              input.mcVersion,
              input.loaderVersion,
              input.installerVersion,
              signal,
            );
            downloadUrl = fabric.url;
            cacheBasename = buildResolvedCoreCacheBasename('fabric', input.mcVersion, {
              loader: fabric.loader,
              installer: fabric.installer,
            });
          }
          const cachePath = path.join(config.cacheDir, cacheBasename.replace(/[^\w.-]+/g, '_'));

          if (isUsableCoreCache(cachePath)) {
            throwIfAborted(signal);
            report(60, '使用本地缓存…');
            fs.copyFileSync(cachePath, destJar);
          } else {
            throwIfAborted(signal);
            report(15, '开始下载核心…');
            await ensureCoreCache(downloadUrl, cachePath, (ratio) => {
              report(15 + ratio * 70, `下载中 ${(ratio * 100).toFixed(0)}%`);
            }, signal);
            throwIfAborted(signal);
            fs.copyFileSync(cachePath, destJar);
          }

          throwIfAborted(signal);
          report(95, '写入启动配置…');
          writeEulaIfNeeded();
          report(97, '写入实例目录…');
          jarFile = 'server.jar';
        }

        // 目录一旦落地就必须继续注册；此处不能加入 await 或取消检查。
        promoteTaskStagingToInstance(taskId, instanceId);
        registerPromotedInstance(instanceId, {
          name: input.name,
          coreType: input.coreType,
          mcVersion: input.mcVersion,
          jarFile,
          jvmArgs: input.jvmArgs,
          acceptEula: input.acceptEula,
          javaRuntimeId: input.javaRuntimeId ?? null,
        });
        completed = true;
        updateInstanceMeta(instanceId, {
          core_type: input.coreType,
          mc_version: input.mcVersion,
          jar_file: jarFile,
          accept_eula: input.acceptEula ? 1 : 0,
        });
        if (usesInstaller) report(100, '部署完成');
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
    },
  );
}
