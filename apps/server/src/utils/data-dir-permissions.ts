import fs from 'node:fs';
import path from 'node:path';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export class DataDirPermissionError extends Error {
  readonly code = 'DATA_DIR_PERMISSION';

  constructor(message: string) {
    super(message);
    this.name = 'DataDirPermissionError';
  }
}

let windowsAclWarningShown = false;

function isUnix(): boolean {
  return process.platform !== 'win32';
}

export function isDataPermissionRepairEnabled(): boolean {
  return process.env.MMD_REPAIR_DATA_PERMISSIONS === '1';
}

function warnWindowsAclBoundary(targetPath: string): void {
  if (windowsAclWarningShown || isUnix()) return;
  windowsAclWarningShown = true;
  console.warn(
    `[安全警告] 无法在 Windows 上自动验证「${targetPath}」的 ACL。`
      + '请确保 DATA_DIR 仅当前运行面板的用户可读写；'
      + '若目录权限过宽，其他本机账户可能读取数据库与实例文件。'
      + '详见 docs/configuration.md。',
  );
}

function assertUnixOwner(stat: fs.Stats, targetPath: string): void {
  if (!isUnix() || typeof process.getuid !== 'function') return;
  const uid = process.getuid();
  if (stat.uid !== uid) {
    throw new DataDirPermissionError(
      `路径「${targetPath}」所有者不是当前用户（uid ${uid}，实际 ${stat.uid}），拒绝启动。`,
    );
  }
}

function normalizeMode(stat: fs.Stats): number {
  return stat.mode & 0o777;
}

function isDirModeUnsafe(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

function isFileModeUnsafe(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

function tightenOrReject(
  targetPath: string,
  kind: 'directory' | 'file',
  currentMode: number,
): void {
  const expected = kind === 'directory' ? DIR_MODE : FILE_MODE;
  const unsafe = kind === 'directory'
    ? isDirModeUnsafe(currentMode)
    : isFileModeUnsafe(currentMode);
  if (!unsafe) {
    if (isUnix() && currentMode !== expected) {
      fs.chmodSync(targetPath, expected);
    }
    return;
  }
  if (isDataPermissionRepairEnabled()) {
    fs.chmodSync(targetPath, expected);
    return;
  }
  const bits = currentMode.toString(8).padStart(3, '0');
  throw new DataDirPermissionError(
    `数据目录权限过宽：「${targetPath}」当前 mode ${bits}，`
      + `要求目录 ${DIR_MODE.toString(8)}、敏感文件 ${FILE_MODE.toString(8)}。`
      + '设置 MMD_REPAIR_DATA_PERMISSIONS=1 可在启动时收紧权限，或手动 chmod 后重试。',
  );
}

/** 确保目录存在且 Unix 上为 0700；校验已有路径不过宽。 */
export function ensureSecureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: DIR_MODE });
    if (isUnix()) fs.chmodSync(dirPath, DIR_MODE);
    return;
  }
  warnWindowsAclBoundary(dirPath);
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new DataDirPermissionError(`期望目录但路径不是目录：${dirPath}`);
  }
  assertUnixOwner(stat, dirPath);
  if (isUnix()) {
    tightenOrReject(dirPath, 'directory', normalizeMode(stat));
  }
}

/** 敏感文件（数据库、WAL、SHM 等）在 Unix 上应为 0600。 */
export function ensureSecureSensitiveFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  warnWindowsAclBoundary(path.dirname(filePath));
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return;
  assertUnixOwner(stat, filePath);
  if (isUnix()) {
    tightenOrReject(filePath, 'file', normalizeMode(stat));
  }
}

/** 初始化数据根及子目录权限；在 initDb 创建数据库后调用 finalizeSensitiveDataFiles。 */
export function prepareSecureDataLayout(dataDir: string, subdirectories: string[]): void {
  ensureSecureDirectory(dataDir);
  for (const relative of subdirectories) {
    ensureSecureDirectory(path.join(dataDir, relative));
  }
}

/** SQLite 主库与 WAL/SHM  companion 文件的权限校验。 */
export function finalizeSensitiveDataFiles(dbPath: string): void {
  ensureSecureSensitiveFile(dbPath);
  ensureSecureSensitiveFile(`${dbPath}-wal`);
  ensureSecureSensitiveFile(`${dbPath}-shm`);
}
