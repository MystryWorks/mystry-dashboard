import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const panelVersion: string = (require('../../package.json') as { version: string }).version;

const LOCK_DIR_NAME = '.mmd-panel-lock';
const OWNER_FILE = 'owner.json';

export type PanelLockOwner = {
  pid: number;
  fingerprint: string;
  version: string;
  createdAt: string;
};

export type PanelDataLock = {
  dataDir: string;
  lockDir: string;
  owner: PanelLockOwner;
  release: () => void;
};

function lockDirPath(dataDir: string): string {
  return path.join(dataDir, LOCK_DIR_NAME);
}

function readOwner(lockDir: string): PanelLockOwner | null {
  const ownerPath = path.join(lockDir, OWNER_FILE);
  if (!fs.existsSync(ownerPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as PanelLockOwner;
    if (
      typeof parsed.pid !== 'number'
      || typeof parsed.fingerprint !== 'string'
      || typeof parsed.version !== 'string'
      || typeof parsed.createdAt !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** 判断 PID 是否仍存活；无法确认时视为存活，避免双写数据库。 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ESRCH') return false;
      // Windows 等平台上对存活进程可能返回 EPERM
      if (error.code === 'EPERM') return true;
    }
    return true;
  }
}

function writeOwner(lockDir: string, owner: PanelLockOwner): void {
  fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const ownerPath = path.join(lockDir, OWNER_FILE);
  const tempPath = `${ownerPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(owner)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, ownerPath);
}

function quarantineStaleLock(dataDir: string, lockDir: string): boolean {
  const quarantineName = `${LOCK_DIR_NAME}.quarantine.${Date.now()}.${process.pid}.${nanoid(8)}`;
  const quarantinePath = path.join(dataDir, quarantineName);
  try {
    fs.renameSync(lockDir, quarantinePath);
    return true;
  } catch {
    return false;
  }
}

function lockConflictError(dataDir: string, owner: PanelLockOwner | null): Error {
  const pidText = owner ? String(owner.pid) : '未知';
  return new Error(
    `数据目录已被其他面板进程占用（${dataDir}）。`
      + `记录 PID：${pidText}。`
      + '请先关闭已运行的面板，或在确认该进程已退出后手动检查 '
      + `\`${path.join(dataDir, LOCK_DIR_NAME)}\` 与 \`owner.json\`，勿删除实例或世界目录。`,
  );
}

function tryAcquireOnce(dataDir: string): PanelDataLock | 'exists' {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lockDir = lockDirPath(dataDir);
  try {
    fs.mkdirSync(lockDir, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return 'exists';
    }
    throw error;
  }

  const owner: PanelLockOwner = {
    pid: process.pid,
    fingerprint: config.processFingerprint ?? nanoid(16),
    version: panelVersion,
    createdAt: new Date().toISOString(),
  };
  try {
    writeOwner(lockDir, owner);
  } catch (error) {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      /* 忽略清理失败 */
    }
    throw error;
  }

  let released = false;
  return {
    dataDir,
    lockDir,
    owner,
    release: () => {
      if (released) return;
      released = true;
      try {
        const current = readOwner(lockDir);
        if (current?.pid === owner.pid && current.fingerprint === owner.fingerprint) {
          fs.rmSync(lockDir, { recursive: true, force: true });
        }
      } catch {
        /* 释放失败不抛出，避免掩盖原始关闭错误 */
      }
    },
  };
}

/**
 * 取得数据目录生命周期锁；存活 PID 持有锁时拒绝启动。
 */
export function acquirePanelDataLock(dataDir: string = config.dataDir): PanelDataLock {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = tryAcquireOnce(dataDir);
    if (result !== 'exists') return result;

    const lockDir = lockDirPath(dataDir);
    const owner = readOwner(lockDir);
    if (owner && isProcessAlive(owner.pid)) {
      throw lockConflictError(dataDir, owner);
    }
    if (!owner) {
      // 无法解析 owner 时不冒险删除，视为仍被占用
      throw lockConflictError(dataDir, owner);
    }

    if (!quarantineStaleLock(dataDir, lockDir)) {
      continue;
    }
  }

  throw new Error(`无法取得数据目录锁（${dataDir}），请稍后重试或检查是否有其他面板正在启动。`);
}
