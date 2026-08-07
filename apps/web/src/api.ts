import type {
  ExistingServerSourceListResult,
  FileDownloadTicketResult,
  FileDownloadTicketStatusResult,
  JavaRuntimeListResult,
  TaskListResult,
} from '@mmd/shared';

const TOKEN_KEY = 'mmd_token';


export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 登录态失效事件：auth.tsx 监听后清空用户并自动跳回登录页。 */
export const UNAUTHORIZED_EVENT = 'mmd:unauthorized';

/** 这些路径的 401 是业务结果（如密码错误），不能当作会话失效处理。 */
const AUTH_EXEMPT_PATHS = ['/api/auth/login', '/api/auth/setup', '/api/auth/status'];

function handleUnauthorized(path: string): void {
  if (AUTH_EXEMPT_PATHS.some((exempt) => path.startsWith(exempt))) return;
  if (!getToken()) return;
  setToken(null);
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let body = options.body;
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.json);
  }

  const res = await fetch(path, { ...options, headers, body });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    const message =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: string }).error)
        : `请求失败 (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { method: 'POST', headers, body: form });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    throw new ApiError(res.status, data.error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export function createConsoleTicket(
  instanceId: string,
  signal?: AbortSignal,
): Promise<{ ticket: string; expiresIn: number }> {
  return api<{ ticket: string; expiresIn: number }>(
    `/api/instances/${encodeURIComponent(instanceId)}/console-ticket`,
    { method: 'POST', signal },
  );
}

/**
 * 认证下载：同步打开空白下载窗，再申请 ticket 并导航至流式 GET；轮询状态把失败回传 SPA。
 * 禁止使用 res.blob() / ArrayBuffer 整体缓冲文件体（见 KF-001 / KF-002）。
 */
export async function downloadAuthenticated(
  instanceId: string,
  relativePath: string,
): Promise<void> {
  const popup = window.open('about:blank', '_blank', 'noopener,noreferrer');
  if (!popup) {
    throw new Error('浏览器拦截了下载窗口，请允许弹窗后重试');
  }

  let ticket: string;
  let expiresInSeconds = 60;
  try {
    const issued = await api<FileDownloadTicketResult>(
      `/api/instances/${encodeURIComponent(instanceId)}/files/download-ticket`,
      { method: 'POST', json: { path: relativePath } },
    );
    ticket = issued.ticket;
    expiresInSeconds = issued.expiresIn;
  } catch (error) {
    popup.close();
    throw error;
  }

  const url =
    `/api/instances/${encodeURIComponent(instanceId)}/files/download`
    + `?path=${encodeURIComponent(relativePath)}`
    + `&ticket=${encodeURIComponent(ticket)}`;
  popup.location.href = url;

  const deadline = Date.now() + expiresInSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    let status: FileDownloadTicketStatusResult;
    try {
      status = await api<FileDownloadTicketStatusResult>(
        `/api/instances/${encodeURIComponent(instanceId)}/files/download-ticket/${encodeURIComponent(ticket)}/status`,
      );
    } catch (error) {
      // 票据被服务端清理（过期等）时返回 404：关闭空白下载窗并明确报错。
      if (error instanceof ApiError && error.status === 404) {
        popup.close();
        throw new Error('下载票据已过期，请重试');
      }
      popup.close();
      throw error;
    }
    if (status.status === 'streaming' || status.status === 'consumed') return;
    if (status.status === 'failed') {
      popup.close();
      throw new Error(status.error || '文件下载失败');
    }
    if (status.status === 'expired') {
      popup.close();
      throw new Error(status.error || '下载票据已过期');
    }
  }
  popup.close();
  throw new Error('下载票据已过期，请重试');
}

/** 任务中心：拉取最近的任务列表（含排队/进行中和已结束任务）。 */
export async function listTasks() {
  const res = await api<TaskListResult>('/api/tasks');
  return res.tasks;
}

/** Java 运行时清单；refresh=true 强制重新扫描本机安装目录。 */
export async function listJavaRuntimes(refresh = false) {
  const res = await api<JavaRuntimeListResult>(
    `/api/system/java-runtimes${refresh ? '?refresh=1' : ''}`,
  );
  return res.runtimes;
}

/** 固定 DATA_DIR/imports 交接区中的已有服务端候选。 */
export async function listExistingServerSources() {
  const res = await api<ExistingServerSourceListResult>('/api/import/sources');
  return res.sources;
}

export async function pollTask(
  taskId: string,
  onUpdate?: (task: {
    status: string;
    progress: number;
    message: string;
    error?: string;
    result?: { instanceId?: string };
  }) => void,
  signal?: AbortSignal,
): Promise<{ instanceId?: string }> {
  const pollIntervalMs = 2_000;
  const rateLimitBackoffMs = 5_000;
  if (signal?.aborted) {
    throw new DOMException('任务轮询已中止', 'AbortError');
  }

  // 等待与中止信号竞争，组件卸载/登出后可立即终止轮询。
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('任务轮询已中止', 'AbortError');
  };

  for (;;) {
    throwIfAborted();
    let task: {
      status: string;
      progress: number;
      message: string;
      error?: string;
      result?: { instanceId?: string };
    };

    try {
      task = await api<{
        status: string;
        progress: number;
        message: string;
        error?: string;
        result?: { instanceId?: string };
      }>(`/api/tasks/${taskId}`);
    } catch (error) {
      // 任务可能仍在排队，服务端限流不代表任务失败。继续使用单一
      // 的等待链轮询，避免每次重试都创建一个新的并发定时器。
      if (error instanceof ApiError && error.status === 429) {
        await wait(rateLimitBackoffMs);
        continue;
      }
      throw error;
    }

    throwIfAborted();
    onUpdate?.(task);
    if (task.status === 'completed') return task.result ?? {};
    if (task.status === 'failed') throw new Error(task.error || '任务失败');
    await wait(pollIntervalMs);
  }
}
