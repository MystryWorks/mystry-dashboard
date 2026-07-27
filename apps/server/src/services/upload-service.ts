import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { resolveSafePath } from '../utils/path.js';

export class UploadCapacityError extends Error {
  readonly code = 'UPLOAD_CAPACITY';

  constructor() {
    super('上传并发容量已满，请稍后重试');
    this.name = 'UploadCapacityError';
  }
}

export class UploadTooLargeError extends Error {
  readonly code = 'UPLOAD_TOO_LARGE';

  constructor() {
    super('上传文件超过大小限制');
    this.name = 'UploadTooLargeError';
  }
}

export function isUploadCapacityError(error: unknown): error is UploadCapacityError {
  return error instanceof UploadCapacityError
    || (error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'UPLOAD_CAPACITY');
}

export function isUploadTooLargeError(error: unknown): error is UploadTooLargeError {
  return error instanceof UploadTooLargeError
    || (error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'UPLOAD_TOO_LARGE');
}

let activeUploads = 0;

function tempPath(prefix: string): string {
  return path.join(
    config.uploadDir,
    `.tmp-${prefix}-${Date.now()}-${randomBytes(12).toString('hex')}`,
  );
}

/** 将 multipart 流直接写入受控临时目录，不把上传内容聚合到内存。 */
export async function streamToUploadTemp(input: Readable, prefix: string): Promise<string> {
  if (activeUploads >= config.maxConcurrentUploads) throw new UploadCapacityError();
  activeUploads += 1;
  let target: string | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let timedOut = false;

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const armIdleTimer = () => {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      timedOut = true;
      const error = new Error('上传流空闲超时');
      input.destroy(error);
    }, config.uploadIdleTimeoutMs);
  };

  try {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    target = tempPath(prefix);
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        armIdleTimer();
        bytes += chunk.length;
        if (bytes > config.maxUploadBytes) {
          callback(new UploadTooLargeError());
          return;
        }
        callback(null, chunk);
      },
    });

    armIdleTimer();
    await pipeline(input, counter, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
    if ((input as Readable & { truncated?: boolean }).truncated) {
      throw new UploadTooLargeError();
    }
    return target;
  } catch (err) {
    try {
      if (target) fs.rmSync(target, { force: true });
    } catch {
      /* 清理失败不覆盖原始错误 */
    }
    if ((input as Readable & { truncated?: boolean }).truncated) {
      throw new UploadTooLargeError();
    }
    if (timedOut) throw new Error('上传流空闲超时');
    throw err;
  } finally {
    clearIdleTimer();
    activeUploads -= 1;
  }
}

export function removeUploadTemp(filePath: string): void {
  const resolved = path.resolve(filePath);
  const uploadRoot = path.resolve(config.uploadDir);
  const relative = path.relative(uploadRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('非法临时文件路径');
  }
  fs.rmSync(resolved, { force: true });
}

/** 确保后台任务只接收 uploads 目录中的临时文件。 */
export function assertUploadPath(filePath: string): string {
  const safe = resolveSafePath(config.uploadDir, path.basename(filePath));
  if (!path.basename(safe).startsWith('.tmp-import-')) {
    throw new Error('非法上传临时文件');
  }
  return safe;
}
