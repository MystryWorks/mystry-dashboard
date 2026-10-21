import fs, { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { config } from '../config.js';
import { abortError, USER_AGENT } from './core-utils.js';

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
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
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
export async function ensureCoreCache(
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
