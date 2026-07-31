import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { FileEntry } from '@mmd/shared';
import { config } from '../config.js';
import { getInstanceDir, OWNERSHIP_MARKER_FILE, resolveSafePath } from '../utils/path.js';
import { streamToUploadTemp, removeUploadTemp } from './upload-service.js';

type ResourceLimits = { maxTextFileBytes: number };
const maxTextFileBytes = (config as typeof config & Partial<ResourceLimits>).maxTextFileBytes ?? 1_048_576;

export class FileDownloadCapacityError extends Error {
  readonly code = 'FILE_DOWNLOAD_CAPACITY';

  constructor() {
    super('文件下载并发容量已满，请稍后重试');
    this.name = 'FileDownloadCapacityError';
  }
}

export function isFileDownloadCapacityError(error: unknown): error is FileDownloadCapacityError {
  return error instanceof FileDownloadCapacityError
    || (error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'FILE_DOWNLOAD_CAPACITY');
}

let activeFileDownloads = 0;

export function acquireFileDownloadSlot(): () => void {
  if (activeFileDownloads >= config.maxConcurrentFileDownloads) {
    throw new FileDownloadCapacityError();
  }
  activeFileDownloads += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeFileDownloads -= 1;
  };
}

function samePath(left: string, right: string): boolean {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  return process.platform === 'win32'
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

/** 所有会改变实例目录的入口都不得触碰根目录或 ownership marker。 */
function assertMutableTarget(root: string, target: string): void {
  if (samePath(root, target)) {
    throw new Error('不能修改实例根目录');
  }
  const marker = resolveSafePath(root, OWNERSHIP_MARKER_FILE);
  if (samePath(marker, target)) {
    throw new Error('不能修改实例所有权标记');
  }
}

export function listFiles(instanceId: string, relativePath = ''): FileEntry[] {
  const root = getInstanceDir(instanceId);
  const target = resolveSafePath(root, relativePath);
  if (!fs.existsSync(target)) {
    throw new Error('目录不存在');
  }
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    throw new Error('目标不是目录');
  }

  // 按运行环境区域设置排序（Windows 资源管理器风格：目录优先 + 自然序）
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return fs
    .readdirSync(target, { withFileTypes: true })
    .map((entry) => {
      const full = resolveSafePath(root, path.relative(root, path.join(target, entry.name)));
      const s = fs.lstatSync(full);
      if (s.isSymbolicLink()) throw new Error('目录中存在 symlink/junction，已拒绝访问');
      const rel = path.relative(root, full).replace(/\\/g, '/');
      return {
        name: entry.name,
        path: rel,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : s.size,
        modifiedAt: s.mtime.toISOString(),
      };
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return collator.compare(a.name, b.name);
    });
}

export function readTextFile(instanceId: string, relativePath: string): string {
  const root = getInstanceDir(instanceId);
  const target = resolveSafePath(root, relativePath);
  if (!fs.existsSync(target)) {
    throw new Error('文件不存在');
  }

  const linkStat = fs.lstatSync(target);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    throw new Error('目标不是普通文件');
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error('目标不是普通文件');
  }
  if (stat.size > maxTextFileBytes) {
    throw new Error(`文本文件超过大小限制（${maxTextFileBytes} 字节）`);
  }
  return fs.readFileSync(target, 'utf8');
}

export function writeTextFile(instanceId: string, relativePath: string, content: string): void {
  if (typeof content !== 'string') {
    throw new Error('文本内容格式不正确');
  }
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes > maxTextFileBytes) {
    throw new Error(`文本文件超过大小限制（${maxTextFileBytes} 字节）`);
  }

  const root = getInstanceDir(instanceId);
  const target = resolveSafePath(root, relativePath);
  assertMutableTarget(root, target);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('目标不是普通文件');
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(content, 'utf8'));
}

/** 在直接读取 server.properties 前检查其是否仍是受限的普通文本文件。 */
export function assertTextFileWithinLimit(instanceId: string, relativePath: string): void {
  const root = getInstanceDir(instanceId);
  const target = resolveSafePath(root, relativePath);
  if (!fs.existsSync(target)) return;

  const linkStat = fs.lstatSync(target);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    throw new Error('目标不是普通文件');
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error('目标不是普通文件');
  }
  if (stat.size > maxTextFileBytes) {
    throw new Error(`文本文件超过大小限制（${maxTextFileBytes} 字节）`);
  }
}

export function deletePath(instanceId: string, relativePath: string): void {
  const root = getInstanceDir(instanceId);
  const target = resolveSafePath(root, relativePath);
  assertMutableTarget(root, target);
  if (!fs.existsSync(target)) {
    throw new Error('路径不存在');
  }
  fs.rmSync(target, { recursive: true, force: true });
}

export function renamePath(instanceId: string, from: string, to: string): void {
  const root = getInstanceDir(instanceId);
  const src = resolveSafePath(root, from);
  const dest = resolveSafePath(root, to);
  assertMutableTarget(root, src);
  assertMutableTarget(root, dest);
  if (!fs.existsSync(src)) throw new Error('源路径不存在');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
}

export function mkdirPath(instanceId: string, relativePath: string): void {
  const root = getInstanceDir(instanceId);
  const target = resolveSafePath(root, relativePath);
  assertMutableTarget(root, target);
  fs.mkdirSync(target, { recursive: true });
}

export function getAbsoluteFilePath(instanceId: string, relativePath: string): string {
  const root = getInstanceDir(instanceId);
  const target = resolveSafePath(root, relativePath);
  if (!fs.existsSync(target)) {
    throw new Error('文件不存在');
  }
  const linkStat = fs.lstatSync(target);
  if (linkStat.isSymbolicLink()) {
    throw new Error('文件不存在');
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    throw new Error('文件不存在');
  }
  return target;
}

export async function saveUploadedFile(
  instanceId: string,
  relativeDir: string,
  filename: string,
  input: Readable,
): Promise<string> {
  const root = getInstanceDir(instanceId);
  const safeName = path.posix.basename(filename.replace(/\\/g, '/'));
  const target = resolveSafePath(root, path.posix.join(relativeDir || '', safeName));
  assertMutableTarget(root, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = await streamToUploadTemp(input, 'file');
  try {
    if (fs.existsSync(target)) {
      const existing = fs.lstatSync(target);
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error('目标不是普通文件');
      }
      fs.unlinkSync(target);
    }
    fs.renameSync(temp, target);
    return path.relative(root, target).replace(/\\/g, '/');
  } finally {
    if (fs.existsSync(temp)) removeUploadTemp(temp);
  }
}
