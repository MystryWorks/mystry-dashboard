import { nanoid } from 'nanoid';
import type { TaskInfo } from '@mmd/shared';
import { config } from '../config.js';
import { getDb, type TaskRow } from '../db.js';
import { nowIso } from '../utils/path.js';
import { deleteInstance, getInstanceRow } from './instance-service.js';

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

export function createTask(type: TaskInfo['type'], message = '排队中'): TaskInfo {
  const id = nanoid(12);
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO tasks (id, type, status, progress, message, result_json, error, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
    )
    .run(id, type, message, now, now);
  return getTask(id)!;
}

export function getTask(id: string): TaskInfo | null {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function updateTask(
  id: string,
  patch: Partial<Pick<TaskInfo, 'status' | 'progress' | 'message' | 'result' | 'error'>>,
): TaskInfo {
  const existing = getTask(id);
  if (!existing) throw new Error('任务不存在');
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE tasks SET
        status = ?,
        progress = ?,
        message = ?,
        result_json = ?,
        error = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      patch.status ?? existing.status,
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

/** 记录任务创建的实例，使面板重启后可以清理未完成的部署或导入。 */
export function recordTaskInstance(taskId: string, instanceId: string): TaskInfo {
  return updateTask(taskId, { result: { instanceId } });
}

export type InterruptedTaskRecovery = {
  interrupted: number;
  cleanedInstances: number;
  cleanupFailures: number;
};

/**
 * 内存 worker 无法跨面板进程恢复；启动时把遗留任务收敛为失败终态，
 * 并尽可能清理任务已经创建的半成品实例。
 */
export function recoverInterruptedTasks(): InterruptedTaskRecovery {
  const rows = getDb()
    .prepare("SELECT * FROM tasks WHERE status IN ('pending', 'running') ORDER BY created_at")
    .all() as TaskRow[];
  let cleanedInstances = 0;
  let cleanupFailures = 0;
  const update = getDb().prepare(
    `UPDATE tasks
     SET status = 'failed', message = '已中断', error = ?, result_json = ?, updated_at = ?
     WHERE id = ?`,
  );

  for (const row of rows) {
    let instanceId: string | null = null;
    if (row.result_json) {
      try {
        const result = JSON.parse(row.result_json) as { instanceId?: unknown };
        if (typeof result.instanceId === 'string' && result.instanceId) {
          instanceId = result.instanceId;
        }
      } catch {
        // 无效的旧结果不阻止任务状态恢复，原始内容会保留以便排查。
      }
    }

    let cleanupError: string | null = null;
    if (instanceId && getInstanceRow(instanceId)) {
      try {
        deleteInstance(instanceId);
        cleanedInstances += 1;
      } catch (error) {
        cleanupFailures += 1;
        cleanupError = error instanceof Error ? error.message : String(error);
      }
    }

    const error = cleanupError
      ? `面板重启，内存任务无法恢复；半成品实例清理失败：${cleanupError}`
      : '面板重启，内存任务无法恢复，请重新提交';
    update.run(error, cleanupError ? row.result_json : null, nowIso(), row.id);
  }

  return { interrupted: rows.length, cleanedInstances, cleanupFailures };
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
    updateTask(item.task.id, { status: 'running', message: item.task.message });
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
    updateTask(item.task.id, { status: 'failed', message: '失败', error });
    return;
  }

  updateTask(item.task.id, {
    status: 'completed',
    progress: 100,
    message: '完成',
    result: result ?? undefined,
  });
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
    });
  }

  for (const controller of runningControllers.values()) {
    if (!controller.signal.aborted) {
      controller.abort(new Error('任务已取消'));
    }
  }

  await Promise.allSettled([...runningExecutions.values()]);
}
