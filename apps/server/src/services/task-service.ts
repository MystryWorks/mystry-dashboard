import fs from 'node:fs';
import { nanoid } from 'nanoid';
import type { TaskInfo } from '@mmd/shared';
import { config } from '../config.js';
import { getDb, type TaskRow } from '../db.js';
import { nowIso } from '../utils/path.js';
import { getInstanceRow } from './instance-service.js';
import {
  readTaskStagingMarker,
  removeTaskStagingTree,
  stagingMarkerMatches,
  taskStagingDir,
} from './task-staging-service.js';

export class TaskCapacityError extends Error {
  readonly code = 'TASK_CAPACITY';

  constructor() {
    super('任务队列容量已满，请稍后重试');
    this.name = 'TaskCapacityError';
  }
}

export class TaskShuttingDownError extends Error {
  readonly code = 'TASK_SHUTTING_DOWN';

  constructor() {
    super('面板正在关闭，不再接受新任务');
    this.name = 'TaskShuttingDownError';
  }
}

export function isTaskCapacityError(error: unknown): error is TaskCapacityError {
  return error instanceof TaskCapacityError
    || (error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'TASK_CAPACITY');
}

export function isTaskShuttingDownError(error: unknown): error is TaskShuttingDownError {
  return error instanceof TaskShuttingDownError
    || (error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'TASK_SHUTTING_DOWN');
}

type TaskWorker = (
  taskId: string,
  signal: AbortSignal,
  report: (progress: number, msg: string) => void,
) => Promise<{ instanceId?: string } | void>;

type QueuedTask = {
  task: TaskInfo;
  worker: TaskWorker;
};

const taskQueue: QueuedTask[] = [];
let runningTasks = 0;
let shuttingDown = false;
const runningControllers = new Map<string, AbortController>();
const runningExecutions = new Map<string, Promise<void>>();

type TaskResultPayload = {
  instanceId?: string;
  stagingToken?: string;
};

function rowToTask(row: TaskRow): TaskInfo {
  return {
    id: row.id,
    type: row.type as TaskInfo['type'],
    status: row.status as TaskInfo['status'],
    progress: row.progress,
    message: row.message,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseTaskResult(row: TaskRow): TaskResultPayload | null {
  if (!row.result_json) return null;
  try {
    return JSON.parse(row.result_json) as TaskResultPayload;
  } catch {
    return null;
  }
}

export function createTask(type: TaskInfo['type'], message = '排队中'): TaskInfo {
  const id = nanoid(12);
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO tasks (id, type, status, phase, progress, message, result_json, error, created_at, updated_at)
       VALUES (?, ?, 'pending', NULL, 0, ?, NULL, NULL, ?, ?)`,
    )
    .run(id, type, message, now, now);
  return getTask(id)!;
}

export function getTask(id: string): TaskInfo | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

/** 任务中心列表：按创建时间倒序返回最近的任务，limit 由服务端固定边界。 */
export function listTasks(limit = 50): TaskInfo[] {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 200);
  const rows = getDb()
    .prepare('SELECT * FROM tasks ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(safeLimit) as TaskRow[];
  return rows.map(rowToTask);
}

export function updateTask(
  id: string,
  patch: Partial<Pick<TaskInfo, 'status' | 'progress' | 'message' | 'result' | 'error'>>,
  options?: { phase?: string | null },
): TaskInfo {
  const existing = getTask(id);
  if (!existing) throw new Error('任务不存在');
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  const now = nowIso();
  const phase = options?.phase !== undefined ? options.phase : row.phase;
  getDb()
    .prepare(
      `UPDATE tasks SET
        status = ?,
        phase = ?,
        progress = ?,
        message = ?,
        result_json = ?,
        error = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      patch.status ?? existing.status,
      phase,
      patch.progress ?? existing.progress,
      patch.message ?? existing.message,
      patch.result !== undefined
        ? JSON.stringify(patch.result)
        : existing.result
          ? JSON.stringify(existing.result)
          : null,
      patch.error !== undefined ? patch.error : (existing.error ?? null),
      now,
      id,
    );
  return getTask(id)!;
}

/** 记录任务 staging 资源，供崩溃后仅清理半成品目录。 */
export function recordTaskStaging(taskId: string, instanceId: string, stagingToken: string): TaskInfo {
  return updateTask(
    taskId,
    { result: { instanceId, stagingToken } },
    { phase: 'staging' },
  );
}

/**
 * @deprecated 保留兼容旧调用；新任务应使用 recordTaskStaging，且不得在文件落地前写入最终实例。
 */
export function recordTaskInstance(taskId: string, instanceId: string): TaskInfo {
  return updateTask(taskId, { result: { instanceId } }, { phase: 'staging' });
}

export type InterruptedTaskRecovery = {
  interrupted: number;
  cleanedStaging: number;
  stagingCleanupFailures: number;
};

function tryCleanInterruptedStaging(row: TaskRow): { cleaned: boolean; cleanupError: string | null } {
  const result = parseTaskResult(row);
  if (!result?.instanceId || !result.stagingToken) {
    return { cleaned: false, cleanupError: null };
  }
  const stagingPath = taskStagingDir(row.id, result.instanceId, config.dataDir);
  if (!fs.existsSync(stagingPath)) {
    return { cleaned: false, cleanupError: null };
  }
  const marker = {
    version: 1 as const,
    taskId: row.id,
    instanceId: result.instanceId,
    token: result.stagingToken,
  };
  if (!stagingMarkerMatches(stagingPath, marker)) {
    return { cleaned: false, cleanupError: 'staging marker 与任务记录不匹配，已跳过自动清理' };
  }
  try {
    removeTaskStagingTree(row.id, result.instanceId, config.dataDir);
    return { cleaned: true, cleanupError: null };
  } catch (error) {
    return {
      cleaned: false,
      cleanupError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 内存 worker 无法跨面板进程恢复；启动时把遗留任务收敛为失败终态。
 * 仅清理可证明位于 .mmd-staging 的半成品，绝不删除已注册实例或最终 instances 目录。
 */
export function recoverInterruptedTasks(): InterruptedTaskRecovery {
  const rows = getDb()
    .prepare("SELECT * FROM tasks WHERE status IN ('pending', 'running') ORDER BY created_at")
    .all() as TaskRow[];
  let cleanedStaging = 0;
  let stagingCleanupFailures = 0;
  const update = getDb().prepare(
    `UPDATE tasks
     SET status = 'failed', phase = 'failed', message = '已中断', error = ?, result_json = ?, updated_at = ?
     WHERE id = ?`,
  );

  for (const row of rows) {
    const result = parseTaskResult(row);
    const instanceId = result?.instanceId;
    const stagingCleanup = tryCleanInterruptedStaging(row);
    if (stagingCleanup.cleaned) {
      cleanedStaging += 1;
    } else if (stagingCleanup.cleanupError) {
      stagingCleanupFailures += 1;
    }

    // 最终实例目录或数据库记录一律保留，即使任务未完成。
    if (instanceId && getInstanceRow(instanceId)) {
      const error = stagingCleanup.cleanupError
        ? `面板重启，内存任务无法恢复；staging 清理异常：${stagingCleanup.cleanupError}`
        : '面板重启，内存任务无法恢复；已保留实例目录，请重新提交或手动检查任务状态';
      update.run(error, row.result_json, nowIso(), row.id);
      continue;
    }

    const error = stagingCleanup.cleanupError
      ? `面板重启，内存任务无法恢复；staging 清理异常：${stagingCleanup.cleanupError}`
      : '面板重启，内存任务无法恢复，请重新提交';
    update.run(error, stagingCleanup.cleaned ? null : row.result_json, nowIso(), row.id);
  }

  return { interrupted: rows.length, cleanedStaging, stagingCleanupFailures };
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && signal.reason.message) return signal.reason;
  return new Error('任务已取消');
}

function drainTaskQueue(): void {
  while (!shuttingDown && runningTasks < config.maxConcurrentTasks && taskQueue.length > 0) {
    const item = taskQueue.shift()!;
    runningTasks += 1;
    const controller = new AbortController();
    runningControllers.set(item.task.id, controller);
    const execution = executeTask(item, controller).finally(() => {
      runningTasks -= 1;
      runningControllers.delete(item.task.id);
      runningExecutions.delete(item.task.id);
      drainTaskQueue();
    });
    runningExecutions.set(item.task.id, execution);
    void execution;
  }
}

async function executeTask(item: QueuedTask, controller: AbortController): Promise<void> {
  let timedOut = false;
  let ended = false;
  let result: { instanceId?: string } | void = undefined;
  let failure: unknown;
  let failed = false;

  try {
    updateTask(item.task.id, { status: 'running', message: item.task.message }, { phase: 'staging' });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('任务执行超时'));
    }, config.taskTimeoutMs);

    try {
      result = await item.worker(item.task.id, controller.signal, (progress, msg) => {
        if (!ended && !controller.signal.aborted) {
          updateTask(item.task.id, { progress, message: msg, status: 'running' });
        }
      });
      if (controller.signal.aborted) throw abortError(controller.signal);
    } catch (error) {
      failure = error;
      failed = true;
    } finally {
      clearTimeout(timeout);
      ended = true;
    }
  } catch (error) {
    failure = error;
    failed = true;
    ended = true;
  }

  if (failed) {
    const error = timedOut
      ? '任务执行超时'
      : failure instanceof Error
        ? failure.message
        : String(failure);
    updateTask(item.task.id, { status: 'failed', message: '失败', error }, { phase: 'failed' });
    return;
  }

  updateTask(item.task.id, {
    status: 'completed',
    progress: 100,
    message: '完成',
    result: result ?? undefined,
  }, { phase: 'completed' });
}

export async function runBackgroundTask(
  type: TaskInfo['type'],
  message: string,
  worker: TaskWorker,
): Promise<TaskInfo> {
  if (shuttingDown) {
    throw new TaskShuttingDownError();
  }
  if (runningTasks + taskQueue.length >= config.maxConcurrentTasks + config.maxQueuedTasks) {
    throw new TaskCapacityError();
  }

  const task = createTask(type, message);
  taskQueue.push({ task, worker });
  drainTaskQueue();

  return getTask(task.id)!;
}

export function getTaskActivity(): { running: number; queued: number } {
  return { running: runningTasks, queued: taskQueue.length };
}

/** 停止接收任务，取消排队项并等待运行中的任务完成清理。 */
export async function shutdownTasks(): Promise<void> {
  shuttingDown = true;

  while (taskQueue.length > 0) {
    const item = taskQueue.shift()!;
    updateTask(item.task.id, {
      status: 'failed',
      message: '已取消',
      error: '面板正在关闭，任务已取消',
    }, { phase: 'failed' });
  }

  for (const controller of runningControllers.values()) {
    if (!controller.signal.aborted) {
      controller.abort(new Error('任务已取消'));
    }
  }

  await Promise.allSettled([...runningExecutions.values()]);
}

export { readTaskStagingMarker };
