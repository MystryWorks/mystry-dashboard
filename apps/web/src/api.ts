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
    throw new ApiError(res.status, data.error || `请求失败 (${res.status})`);
  }
  return data as T;
}

/** 带 JWT 下载二进制文件并触发浏览器保存。 */
export async function downloadAuthenticated(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { headers });
  if (!res.ok) {
    let message = `下载失败 (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = String(data.error);
    } catch {
      // 非 JSON 错误体时使用默认文案
    }
    throw new ApiError(res.status, message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

export async function pollTask(
  taskId: string,
  onUpdate?: (task: {
    status: string;
    progress: number;
    message: string;
    error?: string;
    result?: { instanceId?: string };
  }) => void,
): Promise<{ instanceId?: string }> {
  const pollIntervalMs = 2_000;
  const rateLimitBackoffMs = 5_000;

  for (;;) {
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
      if (error instanceof ApiError && error.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, rateLimitBackoffMs));
        continue;
      }
      throw error;
    }

    onUpdate?.(task);
    if (task.status === 'completed') return task.result ?? {};
    if (task.status === 'failed') throw new Error(task.error || '任务失败');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
