import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { defaultInstanceDir } from '../utils/path.js';

export const STAGING_ROOT_DIR = '.mystry-staging';
export const STAGING_MARKER_FILE = '.mystry-staging-marker.json';

export type TaskStagingMarker = {
  version: 1;
  taskId: string;
  instanceId: string;
  token: string;
};

export function taskStagingDir(taskId: string, instanceId: string, dataDir = config.dataDir): string {
  return path.join(dataDir, STAGING_ROOT_DIR, taskId, instanceId);
}

export function writeTaskStagingMarker(dir: string, marker: TaskStagingMarker): void {
  const markerPath = path.join(dir, STAGING_MARKER_FILE);
  const tempPath = `${markerPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(marker)}\n`, 'utf8');
  fs.renameSync(tempPath, markerPath);
}

export function readTaskStagingMarker(dir: string): TaskStagingMarker | null {
  const markerPath = path.join(dir, STAGING_MARKER_FILE);
  if (!fs.existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as TaskStagingMarker;
    if (
      parsed.version !== 1
      || typeof parsed.taskId !== 'string'
      || typeof parsed.instanceId !== 'string'
      || typeof parsed.token !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function prepareTaskStaging(
  taskId: string,
  instanceId: string,
  token: string,
  dataDir = config.dataDir,
): string {
  const dir = taskStagingDir(taskId, instanceId, dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeTaskStagingMarker(dir, { version: 1, taskId, instanceId, token });
  return dir;
}

export function stagingMarkerMatches(dir: string, marker: TaskStagingMarker): boolean {
  const onDisk = readTaskStagingMarker(dir);
  return (
    onDisk !== null
    && onDisk.taskId === marker.taskId
    && onDisk.instanceId === marker.instanceId
    && onDisk.token === marker.token
  );
}

function removeEmptyParents(dir: string, dataDir: string): void {
  const stagingRoot = path.join(dataDir, STAGING_ROOT_DIR);
  let current = path.dirname(dir);
  while (current.startsWith(stagingRoot) && current !== stagingRoot) {
    try {
      if (fs.readdirSync(current).length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
        continue;
      }
    } catch {
      /* 忽略 */
    }
    break;
  }
}

export function removeTaskStagingTree(
  taskId: string,
  instanceId: string,
  dataDir = config.dataDir,
): boolean {
  const dir = taskStagingDir(taskId, instanceId, dataDir);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  removeEmptyParents(dir, dataDir);
  return true;
}

/** 将 staging 目录原子移动到最终 instances/<id>，并移除 staging marker。 */
export function promoteTaskStagingToInstance(
  taskId: string,
  instanceId: string,
  dataDir = config.dataDir,
): string {
  const staging = taskStagingDir(taskId, instanceId, dataDir);
  const instanceDir = defaultInstanceDir(instanceId);
  if (!fs.existsSync(staging)) {
    throw new Error('任务 staging 目录不存在，无法完成实例落地');
  }
  if (fs.existsSync(instanceDir)) {
    throw new Error('实例目录已存在，拒绝覆盖已有数据');
  }
  fs.renameSync(staging, instanceDir);
  removeEmptyParents(staging, dataDir);
  const markerPath = path.join(instanceDir, STAGING_MARKER_FILE);
  if (fs.existsSync(markerPath)) {
    fs.unlinkSync(markerPath);
  }
  return instanceDir;
}
