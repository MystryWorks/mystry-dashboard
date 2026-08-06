import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { CoreType, DeployCoreInput } from '@mmd/shared';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import {
  registerPromotedInstance,
  updateInstanceMeta,
} from './instance-service.js';
import { detectJarFile, findModLoaderArgsFile } from './server-launch-detect.js';
import { resolveSafePath } from '../utils/path.js';
import { recordTaskStaging, runBackgroundTask } from './task-service.js';
import {
  prepareTaskStaging,
  promoteTaskStagingToInstance,
  removeTaskStagingTree,
} from './task-staging-service.js';
import { parseJvmArgs, serializeJvmArgFile } from '../utils/jvm-args.js';
import { getMinecraftChildEnv } from '../utils/child-env.js';
import { resolveJavaRuntimeCommand } from './java-runtime-service.js';

/** PaperMC 要求 User-Agent 标明软件名与联系方式 */
const USER_AGENT = 'MinecraftMysteryDashboard/0.1 (https://localhost; contact@localhost)';

type DeployableCore = Exclude<CoreType, 'custom'>;

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && [
    '任务执行超时',
    '核心下载超时',
    '核心元数据请求超时',
    '任务已取消',
  ].includes(signal.reason.message)) {
    return signal.reason;
  }
  return new Error('任务已取消');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > config.maxCoreMetadataBytes) {
    throw new Error('核心元数据超过大小限制');
  }
  if (!response.body) throw new Error('核心元数据响应没有正文');

  const nodeStream = Readable.fromWeb(
    response.body as import('stream/web').ReadableStream,
  );
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of nodeStream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      bytes += buffer.length;
      if (bytes > config.maxCoreMetadataBytes) {
        nodeStream.destroy();
        throw new Error('核心元数据超过大小限制');
      }
      chunks.push(buffer);
    }
  } finally {
    nodeStream.destroy();
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

async function fetchMetadataText(url: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw abortError(signal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('核心元数据请求超时'));
  }, config.coreMetadataTimeoutMs);
  if (signal) {
    signal.addEventListener('abort', abortFromParent, { once: true });
    if (signal.aborted) abortFromParent();
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        /* 忽略错误响应正文清理失败 */
      }
      throw new Error(`请求失败 ${response.status}: ${url}`);
    }
    return await readBoundedResponseText(response);
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (timedOut) throw new Error('核心元数据请求超时');
    if (controller.signal.aborted) throw abortError(controller.signal);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

export async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  return fetchMetadataText(url, signal);
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const text = await fetchMetadataText(url, signal);
  return JSON.parse(text) as T;
}

export function isUsableCoreCache(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function downloadToFile(
  url: string,
  dest: string,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) throw abortError(signal);
    signal.addEventListener('abort', abortFromParent, { once: true });
    if (signal.aborted) abortFromParent();
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('核心下载超时'));
  }, config.coreDownloadTimeoutMs);
  const part = path.join(
    path.dirname(dest),
    `.part-${path.basename(dest)}-${Date.now()}-${randomBytes(12).toString('hex')}`,
  );
  let renamed = false;

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`下载失败 ${res.status}: ${url}`);
    }

    const total = Number(res.headers.get('content-length') || 0);
    if (total > config.maxCoreDownloadBytes) throw new Error('核心下载文件超过大小限制');
    let downloaded = 0;
    const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloaded += chunk.length;
        if (downloaded > config.maxCoreDownloadBytes) {
          callback(new Error('核心下载文件超过大小限制'));
          return;
        }
        if (total > 0 && onProgress) onProgress(downloaded / total);
        callback(null, chunk);
      },
    });
    await pipeline(
      nodeStream,
      counter,
      createWriteStream(part, { flags: 'wx', mode: 0o600 }),
      { signal: controller.signal },
    );
    if (controller.signal.aborted) throw abortError(controller.signal);

    // 只把完整 part 文件提升为最终缓存文件；最终路径不会被用作下载中的暂存区。
    if (isUsableCoreCache(dest)) {
      fs.rmSync(part, { force: true });
      renamed = true;
    } else {
      fs.rmSync(dest, { force: true });
      fs.renameSync(part, dest);
      renamed = true;
    }
  } catch (error) {
    try {
      if (!renamed) fs.rmSync(part, { force: true });
    } catch {
      /* 清理失败不覆盖原始错误 */
    }
    if (signal?.aborted) throw abortError(signal);
    if (timedOut) throw new Error('核心下载超时');
    if (controller.signal.aborted) throw abortError(controller.signal);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

type CacheDownloadFlight = {
  controller: AbortController;
  promise: Promise<void>;
  waiters: number;
  callbacks: Set<(ratio: number) => void>;
  finished: boolean;
};

const cacheDownloadFlights = new Map<string, CacheDownloadFlight>();

function waitForCacheDownload(flight: CacheDownloadFlight, signal?: AbortSignal): Promise<void> {
  if (!signal) return flight.promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    flight.promise.then(
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

/** 按最终缓存路径合并并发下载，避免多个任务同时覆盖同一个核心文件。 */
async function ensureCoreCache(
  url: string,
  cachePath: string,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  if (isUsableCoreCache(cachePath)) return;

  let flight = cacheDownloadFlights.get(cachePath);
  if (!flight) {
    const controller = new AbortController();
    const callbacks = new Set<(ratio: number) => void>();
    flight = {
      controller,
      promise: Promise.resolve(),
      waiters: 0,
      callbacks,
      finished: false,
    };
    flight.promise = downloadToFile(
      url,
      cachePath,
      (ratio) => {
        for (const callback of callbacks) callback(ratio);
      },
      controller.signal,
    ).finally(() => {
      flight!.finished = true;
      if (cacheDownloadFlights.get(cachePath) === flight) cacheDownloadFlights.delete(cachePath);
    });
    cacheDownloadFlights.set(cachePath, flight);
  }

  flight.waiters += 1;
  if (onProgress) flight.callbacks.add(onProgress);
  try {
    await waitForCacheDownload(flight, signal);
  } finally {
    if (onProgress) flight.callbacks.delete(onProgress);
    flight.waiters -= 1;
    if (flight.waiters === 0 && !flight.finished && !flight.controller.signal.aborted) {
      flight.controller.abort(signal?.reason);
    }
  }
}

function parseMavenVersions(xml: string): string[] {
  const matches = [...xml.matchAll(/<version>([^<]+)<\/version>/g)];
  return matches.map((m) => m[1]!).filter(Boolean);
}

/** NeoForge 版本号 → Minecraft 版本，如 21.1.244 → 1.21.1，21.0.x → 1.21 */
export function neoForgeVersionToMc(neoVersion: string): string {
  const cleaned = neoVersion.replace(/-beta.*$/i, '');
  const [a, b] = cleaned.split('.');
  if (!a || b === undefined) throw new Error(`无法解析 NeoForge 版本：${neoVersion}`);
  if (b === '0') return `1.${a}`;
  return `1.${a}.${b}`;
}

type PaperBuild = {
  id: number;
  channel: string;
  downloads?: {
    'server:default'?: { name: string; url: string };
  };
};

/** 列出各核心可用游戏版本 */
export async function listCoreVersions(coreType: DeployableCore, signal?: AbortSignal): Promise<string[]> {
  if (coreType === 'paper') {
    const data = await fetchJson<{ versions: Record<string, string[]> }>(
      'https://fill.papermc.io/v3/projects/paper',
      signal,
    );
    const versions = Object.values(data.versions).flat();
    return versions.filter((v) => !v.includes('-'));
  }

  if (coreType === 'fabric') {
    const data = await fetchJson<Array<{ version: string; stable: boolean }>>(
      'https://meta.fabricmc.net/v2/versions/game',
      signal,
    );
    return data.filter((g) => g.stable).map((g) => g.version);
  }

  if (coreType === 'forge') {
    // BMCL 提供按 MC 版本聚合的 Forge 列表
    const versions = await fetchJson<string[]>('https://bmclapi2.bangbang93.com/forge/minecraft', signal);
    return [...versions].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  if (coreType === 'neoforge') {
    const xml = await fetchText(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
      signal,
    );
    const neoVersions = parseMavenVersions(xml);
    const mcSet = new Set<string>();
    for (const v of neoVersions) {
      try {
        mcSet.add(neoForgeVersionToMc(v));
      } catch {
        /* ignore */
      }
    }
    return [...mcSet].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  // Vanilla
  const manifest = await fetchJson<{
    versions: Array<{ id: string; type: string }>;
  }>('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', signal);
  return manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
}

export async function listPaperBuilds(version: string, signal?: AbortSignal): Promise<number[]> {
  const builds = await fetchJson<PaperBuild[]>(
    `https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`,
    signal,
  );
  const stable = builds.filter((b) => b.channel === 'STABLE');
  const list = (stable.length ? stable : builds).map((b) => b.id);
  return list.sort((a, b) => a - b);
}

export async function listFabricLoaders(gameVersion: string, signal?: AbortSignal): Promise<string[]> {
  const data = await fetchJson<Array<{ loader: { version: string; stable: boolean } }>>(
    `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`,
    signal,
  );
  return data.filter((x) => x.loader.stable).map((x) => x.loader.version);
}

export async function listFabricInstallers(signal?: AbortSignal): Promise<string[]> {
  const data = await fetchJson<Array<{ version: string; stable: boolean }>>(
    'https://meta.fabricmc.net/v2/versions/installer',
    signal,
  );
  return data.filter((x) => x.stable).map((x) => x.version);
}

/** Forge loader 版本列表（不含 MC 前缀） */
export async function listForgeLoaders(mcVersion: string, signal?: AbortSignal): Promise<string[]> {
  const data = await fetchJson<Array<{ version: string }>>(
    `https://bmclapi2.bangbang93.com/forge/minecraft/${encodeURIComponent(mcVersion)}`,
    signal,
  );
  const versions = data.map((x) => x.version).filter(Boolean);
  // BMCL 通常旧→新，反转为新在前
  return [...versions].reverse();
}

/** NeoForge 版本列表（完整 NeoForge 版本号） */
export async function listNeoForgeLoaders(mcVersion: string, signal?: AbortSignal): Promise<string[]> {
  // 优先 BMCL
  try {
    const data = await fetchJson<Array<{ version: string; mcversion?: string }>>(
      `https://bmclapi2.bangbang93.com/neoforge/list/${encodeURIComponent(mcVersion)}`,
      signal,
    );
    if (Array.isArray(data) && data.length) {
      return [...data.map((x) => x.version)].reverse();
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    /* fallback maven */
  }

  const xml = await fetchText(
    'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
    signal,
  );
  const all = parseMavenVersions(xml);
  const matched = all.filter((v) => {
    try {
      return neoForgeVersionToMc(v) === mcVersion;
    } catch {
      return false;
    }
  });
  return [...matched].reverse();
}

async function resolveVanillaServerUrl(mcVersion: string, signal: AbortSignal): Promise<string> {
  const manifest = await fetchJson<{
    versions: Array<{ id: string; url: string }>;
  }>('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', signal);
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new Error(`找不到 Vanilla 版本：${mcVersion}`);
  const detail = await fetchJson<{
    downloads?: { server?: { url: string } };
  }>(entry.url, signal);
  const url = detail.downloads?.server?.url;
  if (!url) throw new Error(`该版本没有官方服务端 jar：${mcVersion}`);
  return url;
}

async function resolvePaperDownload(
  version: string,
  build?: number,
  signal?: AbortSignal,
): Promise<{ url: string; build: number; filename: string }> {
  const builds = await fetchJson<PaperBuild[]>(
    `https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`,
    signal,
  );
  if (!builds.length) throw new Error(`Paper ${version} 没有可用构建`);

  const stable = builds.filter((b) => b.channel === 'STABLE');
  const pool = stable.length ? stable : builds;
  const selected =
    (build !== undefined ? pool.find((b) => b.id === build) || builds.find((b) => b.id === build) : null) ??
    pool.sort((a, b) => b.id - a.id)[0]!;

  const file = selected.downloads?.['server:default'];
  if (!file?.url) throw new Error(`Paper ${version}#${selected.id} 缺少下载地址`);
  return { url: file.url, build: selected.id, filename: file.name || 'server.jar' };
}

/** 基于解析后的不可变版本生成核心缓存文件名（不含目录）。 */
export function buildResolvedCoreCacheBasename(
  coreType: 'vanilla' | 'paper' | 'fabric',
  mcVersion: string,
  resolved: { build?: number; loader?: string; installer?: string },
): string {
  if (coreType === 'vanilla') return `vanilla-${mcVersion}.jar`;
  if (coreType === 'paper') return `paper-${mcVersion}-build-${resolved.build!}.jar`;
  return `fabric-${mcVersion}-loader-${resolved.loader!}-installer-${resolved.installer!}.jar`;
}

async function resolveFabricJarUrl(
  gameVersion: string,
  loaderVersion?: string,
  installerVersion?: string,
  signal?: AbortSignal,
): Promise<{ url: string; loader: string; installer: string }> {
  const loaders = loaderVersion ? [loaderVersion] : await listFabricLoaders(gameVersion, signal);
  const installers = installerVersion ? [installerVersion] : await listFabricInstallers(signal);
  if (!loaders.length || !installers.length) {
    throw new Error(`Fabric ${gameVersion} 没有可用 loader/installer`);
  }
  const loader = loaders[0]!;
  const installer = installers[0]!;
  const url = `https://meta.fabricmc.net/v2/versions/loader/${gameVersion}/${loader}/${installer}/server/jar`;
  return { url, loader, installer };
}

function forgeInstallerUrl(mcVersion: string, forgeVersion: string): string {
  const full = `${mcVersion}-${forgeVersion}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
}

function neoForgeInstallerUrl(neoVersion: string): string {
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
}

const INSTALLER_MAX_ATTEMPTS = 2;

class InstallerProcessError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly output: string,
  ) {
    super(`Installer 退出码 ${exitCode ?? '未知'}\n${output}`);
    this.name = 'InstallerProcessError';
  }
}

export function isRetryableInstallerFailure(output: string): boolean {
  return /These libraries failed to download\. Try again\./i.test(output)
    || /(?:SocketTimeoutException|ConnectException|UnknownHostException|SSL(?:Handshake)?Exception)/i.test(output);
}

export function summarizeInstallerDownloadFailure(output: string, attempts: number): string {
  const failedBlock = output.match(
    /These libraries failed to download\. Try again\.\s*([\s\S]*?)\s*There was an error during installation/i,
  )?.[1];
  const failedLibraries = failedBlock
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const failedUrl = output.match(/Failed to establish connection to (https?:\/\/\S+)/i)?.[1];
  let failedHost = '';
  if (failedUrl) {
    try {
      failedHost = new URL(failedUrl).host;
    } catch {
      // URL 只用于优化错误提示，解析失败不影响任务收尾。
    }
  }

  let reason = '连接失败';
  if (/SocketTimeoutException:\s*Read timed out/i.test(output)) reason = '读取超时';
  else if (/UnknownHostException/i.test(output)) reason = '域名解析失败';
  else if (/SSL(?:Handshake)?Exception/i.test(output)) reason = 'TLS 连接失败';

  const libraryText = failedLibraries?.length
    ? `失败依赖：${failedLibraries.join('、')}；`
    : '';
  const hostText = failedHost ? `${failedHost} ${reason}` : reason;
  const retryText = attempts > 1 ? `已自动重试 ${attempts - 1} 次，` : '';
  return `Installer 下载依赖失败（${retryText}${hostText}）。${libraryText}请检查网络、代理或防火墙后重新部署。`;
}

type InstallerProgressState = {
  progress: number;
  completedDownloads: number;
};

function installerArtifactName(urlText: string): string {
  try {
    const pathname = new URL(urlText).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || '依赖文件';
  } catch {
    return '依赖文件';
  }
}

function reportInstallerLine(
  line: string,
  state: InstallerProgressState,
  report?: (progress: number, message: string) => void,
): void {
  if (!report) return;
  const downloadUrl = line.match(/Downloading (?:library )?from (https?:\/\/\S+)/i)?.[1];
  if (downloadUrl) {
    state.progress = Math.min(83, state.progress + 1);
    report(state.progress, `Installer 正在下载 ${installerArtifactName(downloadUrl)}…`);
    return;
  }
  if (/Download completed:/i.test(line)) {
    state.completedDownloads += 1;
    state.progress = Math.min(84, Math.max(state.progress, 60 + state.completedDownloads));
    report(state.progress, `Installer 已完成 ${state.completedDownloads} 个下载…`);
    return;
  }
  if (/Failed to establish connection to /i.test(line)) {
    report(state.progress, 'Installer 下载遇到网络问题，正在继续处理…');
  }
}

function runInstallerAttempt(
  installerJar: string,
  cwd: string,
  javaCommand: string,
  signal: AbortSignal,
  progressState: InstallerProgressState,
  report?: (progress: number, message: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const child = spawn(javaCommand, ['-jar', installerJar, '--installServer'], {
      cwd,
      env: getMinecraftChildEnv(),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = Buffer.alloc(0);
    let aborted = false;
    let settled = false;
    let forceTimer: NodeJS.Timeout | null = null;
    let pendingLine = '';
    const appendOutput = (chunk: Buffer) => {
      output = Buffer.concat([output, chunk]);
      if (output.length > config.maxInstallerOutputBytes) {
        output = output.subarray(output.length - config.maxInstallerOutputBytes);
      }
      pendingLine += chunk.toString('utf8');
      const lines = pendingLine.split(/\r?\n/);
      pendingLine = lines.pop() ?? '';
      for (const line of lines) reportInstallerLine(line, progressState, report);
    };
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      if (forceTimer) {
        clearTimeout(forceTimer);
        forceTimer = null;
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const killProcessTree = (force: boolean) => {
      const pid = child.pid;
      if (!pid) return;
      if (process.platform === 'win32') {
        // 只针对 installer 的 PID 杀进程树，不能使用面板自身的 PID。
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('error', () => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 子进程可能已经退出 */
          }
        });
        return;
      }

      try {
        process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        try {
          child.kill(force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          /* 子进程可能已经退出 */
        }
      }
    };
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      killProcessTree(false);
      forceTimer = setTimeout(() => {
        killProcessTree(true);
        // 某些平台在强制杀进程后不会再发送 close 事件，不能永久占用任务槽。
        finish(abortError(signal));
      }, config.installerKillGraceMs);
    };
    child.stdout.on('data', (c: Buffer) => {
      appendOutput(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      appendOutput(c);
    });
    child.once('error', (error) => finish(aborted || signal.aborted ? abortError(signal) : error));
    child.once('close', (code) => {
      if (aborted || signal.aborted) {
        finish(abortError(signal));
      } else if (code === 0) {
        finish();
      } else {
        if (pendingLine) reportInstallerLine(pendingLine, progressState, report);
        finish(new InstallerProcessError(code, output.toString('utf8')));
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function runInstaller(
  installerJar: string,
  cwd: string,
  javaCommand: string,
  signal: AbortSignal,
  report?: (progress: number, message: string) => void,
): Promise<void> {
  const progressState: InstallerProgressState = { progress: 60, completedDownloads: 0 };
  for (let attempt = 1; attempt <= INSTALLER_MAX_ATTEMPTS; attempt += 1) {
    try {
      await runInstallerAttempt(installerJar, cwd, javaCommand, signal, progressState, report);
      return;
    } catch (error) {
      if (!(error instanceof InstallerProcessError) || signal.aborted) throw error;
      const retryable = isRetryableInstallerFailure(error.output);
      if (retryable && attempt < INSTALLER_MAX_ATTEMPTS) {
        report?.(
          progressState.progress,
          `Installer 下载不完整，正在自动重试（${attempt + 1}/${INSTALLER_MAX_ATTEMPTS}）…`,
        );
        continue;
      }
      if (retryable) {
        throw new Error(summarizeInstallerDownloadFailure(error.output, attempt));
      }
      throw error;
    }
  }
}

/**
 * 写入 user_jvm_args.txt（Forge/NeoForge 启动用）。
 */
export function writeUserJvmArgs(dir: string, jvmArgs: string): void {
  const file = resolveSafePath(dir, 'user_jvm_args.txt');
  const lines = serializeJvmArgFile(parseJvmArgs(jvmArgs));
  fs.writeFileSync(file, `${lines}\n`, 'utf8');
}

/**
 * 创建实例并后台下载核心。
 */
export async function deployCore(input: DeployCoreInput) {
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

        // 清理 installer（可选保留）
        try {
          fs.unlinkSync(installerDest);
        } catch {
          /* ignore */
        }

        throwIfAborted(signal);
        report(85, '探测启动文件…');
        const argsFile = await findModLoaderArgsFile(dir, input.coreType, {
          maxDepth: config.modLoaderScanMaxDepth,
          maxEntries: config.modLoaderScanMaxEntries,
          deadlineMs: config.modLoaderScanTimeoutMs,
          signal,
        });
        let jarFile = '@modloader';
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
        report(95, '写入实例目录…');
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
        updateInstanceMeta(instanceId, {
          core_type: input.coreType,
          mc_version: input.mcVersion,
          jar_file: jarFile,
          accept_eula: input.acceptEula ? 1 : 0,
        });
        report(100, '部署完成');
        throwIfAborted(signal);
        completed = true;
        return { instanceId };
        }

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
        promoteTaskStagingToInstance(taskId, instanceId);
        registerPromotedInstance(instanceId, {
          name: input.name,
          coreType: input.coreType,
          mcVersion: input.mcVersion,
          jarFile: 'server.jar',
          jvmArgs: input.jvmArgs,
          acceptEula: input.acceptEula,
          javaRuntimeId: input.javaRuntimeId ?? null,
        });
        updateInstanceMeta(instanceId, {
          core_type: input.coreType,
          mc_version: input.mcVersion,
          jar_file: 'server.jar',
          accept_eula: input.acceptEula ? 1 : 0,
        });

        throwIfAborted(signal);
        completed = true;
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
