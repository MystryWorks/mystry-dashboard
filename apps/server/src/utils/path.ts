import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { getDb } from '../db.js';

export const OWNERSHIP_MARKER_FILE = '.mystry-instance.json';

function comparable(value: string): string {
  let normalized = path.resolve(value);
  if (process.platform === 'win32') {
    normalized = normalized.replace(/^\\\\\?\\/, '');
    return normalized.toLowerCase();
  }
  return normalized;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(comparable(root), comparable(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 校验实例根目录本身及其父路径没有 symlink/junction。realpath 比单纯 lstat 更能识别 Windows junction。
 */
export function assertSafeInstanceRoot(instanceRoot: string): string {
  const root = path.resolve(instanceRoot);
  if (!fs.existsSync(root)) throw new Error('实例目录不存在');
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('实例目录不能是 symlink/junction');
  }
  const realRoot = fs.realpathSync(root);
  if (!isWithin(root, realRoot)) {
    throw new Error('实例目录检测到 symlink/junction 逃逸');
  }
  return root;
}

/** 在创建目录前检查最近的已存在父目录，避免 mkdir 通过 dangling symlink/junction 逃逸。 */
export function assertSafeDirectoryPath(targetPath: string): void {
  let probe = path.resolve(targetPath);
  while (true) {
    try {
      fs.lstatSync(probe);
      assertSafeInstanceRoot(probe);
      return;
    } catch (err) {
      if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) throw err;
      const parent = path.dirname(probe);
      if (parent === probe) throw new Error('找不到安全的目录父路径');
      probe = parent;
    }
  }
}

function assertNoSymlinkTraversal(root: string, target: string): void {
  const safeRoot = assertSafeInstanceRoot(root);
  const relative = path.relative(safeRoot, target);
  if (!relative) return;

  let current = safeRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') break;
      throw err;
    }
    if (stat.isSymbolicLink()) {
      throw new Error('非法路径：不允许通过 symlink/junction 访问实例目录之外的文件');
    }
    const realCurrent = fs.realpathSync(current);
    if (!isWithin(current, realCurrent)) {
      throw new Error('非法路径：检测到 symlink/junction 逃逸');
    }
  }
}

/**
 * 将相对路径安全解析到实例根目录内，防止路径逃逸。
 */
export function resolveSafePath(instanceRoot: string, relativePath = ''): string {
  const root = path.resolve(instanceRoot);
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(root, cleaned);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('非法路径：不允许访问实例目录之外的文件');
  }
  assertNoSymlinkTraversal(root, target);
  return target;
}

/** 默认安装目录：data/instances/<id> */
export function defaultInstanceDir(instanceId: string): string {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(instanceId)) {
    throw new Error('实例 ID 非法');
  }
  return path.join(config.instancesDir, instanceId);
}

/**
 * 根据实例 ID 解析面板托管目录。
 */
export function getInstanceDir(instanceId: string): string {
  const row = getDb()
    .prepare('SELECT install_path FROM instances WHERE id = ?')
    .get(instanceId) as { install_path: string | null } | undefined;
  if (!row) {
    throw new Error('实例不存在');
  }
  if (row.install_path !== null) {
    throw new Error('旧实例需要迁移到面板托管目录');
  }
  return assertSafeInstanceRoot(defaultInstanceDir(instanceId));
}

/** 在已知 row 时解析目录，避免重复查库 */
export function resolveDirFromRow(row: {
  id: string;
  install_path: string | null;
}): string {
  if (row.install_path !== null) {
    throw new Error('旧实例需要迁移到面板托管目录');
  }
  return defaultInstanceDir(row.id);
}

export function writeOwnershipMarker(
  instanceId: string,
  instanceRoot: string,
  marker: string,
): void {
  const root = assertSafeInstanceRoot(instanceRoot);
  const markerPath = resolveSafePath(root, OWNERSHIP_MARKER_FILE);
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify({ version: 1, instanceId, marker })}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}

export type OwnershipMarkerInspection = {
  exists: boolean;
  marker: string | null;
};

/** 检查固定托管目录中的 marker，并区分不存在与内容无效。 */
export function inspectOwnershipMarker(
  instanceId: string,
  instanceRoot: string,
): OwnershipMarkerInspection {
  const root = assertSafeInstanceRoot(instanceRoot);
  const markerPath = resolveSafePath(root, OWNERSHIP_MARKER_FILE);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(markerPath);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { exists: false, marker: null };
    }
    throw err;
  }

  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { exists: true, marker: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as {
      version?: number;
      instanceId?: string;
      marker?: unknown;
    };
    if (
      parsed.version !== 1 ||
      parsed.instanceId !== instanceId ||
      typeof parsed.marker !== 'string' ||
      parsed.marker.length === 0
    ) {
      return { exists: true, marker: null };
    }
    return { exists: true, marker: parsed.marker };
  } catch {
    return { exists: true, marker: null };
  }
}

/** 读取并校验固定托管目录中的 ownership marker。 */
export function readOwnershipMarker(instanceId: string, instanceRoot: string): string | null {
  try {
    return inspectOwnershipMarker(instanceId, instanceRoot).marker;
  } catch {
    return null;
  }
}

export function hasValidOwnershipMarker(
  row: { id: string; install_path: string | null; ownership_marker: string | null },
): boolean {
  if (row.install_path !== null || !row.ownership_marker) return false;
  const root = defaultInstanceDir(row.id);
  return readOwnershipMarker(row.id, root) === row.ownership_marker;
}

/** 仅删除仍与本次写入值完全匹配的 marker，避免误删其它 marker。 */
export function removeOwnershipMarker(
  instanceId: string,
  instanceRoot: string,
  marker: string,
): boolean {
  try {
    const root = assertSafeInstanceRoot(instanceRoot);
    const markerPath = resolveSafePath(root, OWNERSHIP_MARKER_FILE);
    const stat = fs.lstatSync(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const expected = `${JSON.stringify({ version: 1, instanceId, marker })}\n`;
    if (fs.readFileSync(markerPath, 'utf8') !== expected) return false;
    fs.unlinkSync(markerPath);
    return true;
  } catch {
    return false;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
