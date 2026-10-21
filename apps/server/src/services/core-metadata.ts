import { Readable } from 'node:stream';
import type { CoreType } from '@mystry/shared';
import { config } from '../config.js';
import { abortError, USER_AGENT } from './core-utils.js';

type DeployableCore = Exclude<CoreType, 'custom'>;

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
          /* 忽略无法映射到 Minecraft 版本的条目 */
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
    /* 回退到 Maven 元数据 */
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

export async function resolveVanillaServerUrl(mcVersion: string, signal: AbortSignal): Promise<string> {
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

export async function resolvePaperDownload(
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

export async function resolveFabricJarUrl(
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

export function forgeInstallerUrl(mcVersion: string, forgeVersion: string): string {
  const full = `${mcVersion}-${forgeVersion}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
}

export function neoForgeInstallerUrl(neoVersion: string): string {
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
}
