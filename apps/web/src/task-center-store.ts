import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { TaskInfo } from '@mystry/shared';
import { ApiError, listTasks } from './api';

/**
 * 任务中心共享状态：桌面侧边栏和移动顶栏各有一个入口，但只允许一个轮询循环。
 * 订阅数为 0 时停止轮询（如退出登录后），避免无意义的 401 请求。
 */

const POLL_INTERVAL_MS = 4_000;
const RATE_LIMIT_BACKOFF_MS = 10_000;

let tasks: TaskInfo[] = [];
let loadError = '';
let lastSuccessAt: string | null = null;
let hasLoaded = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let pollingGeneration = 0;
let inFlight: { generation: number; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function isActive(generation: number): boolean {
  return polling && listeners.size > 0 && generation === pollingGeneration;
}

async function runTick(generation: number): Promise<void> {
  try {
    const nextTasks = await listTasks();
    if (!isActive(generation)) return;
    tasks = nextTasks;
    loadError = '';
    lastSuccessAt = new Date().toISOString();
    hasLoaded = true;
    schedule(POLL_INTERVAL_MS, generation);
  } catch (error) {
    if (!isActive(generation)) return;
    // 429 说明服务端限流，退避后继续；401 等错误交给全局处理，这里仅记录。
    loadError = error instanceof Error ? error.message : String(error);
    hasLoaded = true;
    schedule(
      error instanceof ApiError && error.status === 429 ? RATE_LIMIT_BACKOFF_MS : POLL_INTERVAL_MS,
      generation,
    );
  }
  if (isActive(generation)) emit();
}

function tick(): Promise<void> {
  const generation = pollingGeneration;
  if (!isActive(generation)) return Promise.resolve();
  if (inFlight?.generation === generation) return inFlight.promise;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const promise = runTick(generation).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { generation, promise };
  return promise;
}

function schedule(delay: number, generation: number): void {
  if (!isActive(generation)) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (!isActive(generation)) return;
    // 页面隐藏时暂停轮询，恢复可见时立即补一次。
    if (document.hidden) {
      schedule(POLL_INTERVAL_MS, generation);
      return;
    }
    void tick();
  }, delay);
}

function onVisibilityChange(): void {
  if (!document.hidden && listeners.size > 0) void tick();
}

function start(): void {
  if (polling) return;
  polling = true;
  pollingGeneration += 1;
  document.addEventListener('visibilitychange', onVisibilityChange);
  void tick();
}

function stop(): void {
  polling = false;
  pollingGeneration += 1;
  inFlight = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  // 订阅清零（登出/退出登录页）时清空模块级缓存，避免换用户后短暂显示上一会话的任务。
  tasks = [];
  loadError = '';
  lastSuccessAt = null;
  hasLoaded = false;
}

export function retryTaskCenterPoll(): void {
  if (listeners.size === 0) return;
  void tick();
}

export function useTaskCenter(): {
  tasks: TaskInfo[];
  error: string;
  loading: boolean;
  activeCount: number;
  lastSuccessAt: string | null;
  retry: () => void;
} {
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  const retryRef = useRef(retryTaskCenterPoll);
  retryRef.current = retryTaskCenterPoll;

  useEffect(() => {
    listeners.add(forceRender);
    start();
    return () => {
      listeners.delete(forceRender);
      if (listeners.size === 0) stop();
    };
  }, []);

  return {
    tasks,
    error: loadError,
    loading: !hasLoaded,
    activeCount: tasks.filter((task) => task.status === 'pending' || task.status === 'running').length,
    lastSuccessAt,
    retry: useCallback(() => retryRef.current(), []),
  };
}
