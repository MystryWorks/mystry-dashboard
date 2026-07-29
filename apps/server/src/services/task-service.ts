import { nanoid } from 'nanoid';
import type { TaskInfo } from '@mmd/shared';
import { config } from '../config.js';
import { getDb, type TaskRow } from '../db.js';
import { nowIso } from '../utils/path.js';

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
