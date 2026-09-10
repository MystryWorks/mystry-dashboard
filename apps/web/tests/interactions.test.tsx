// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DashboardPage } from '../src/pages/DashboardPage';
import { ImportPage } from '../src/pages/ImportPage';
import { NodesPage } from '../src/pages/NodesPage';
import { TaskCenter } from '../src/components/TaskCenter';
import { ConsolePanel } from '../src/components/ConsolePanel';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth';

const terminal = vi.hoisted(() => ({ text: '', clearSelection: vi.fn() }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  loadAddon() {} open() {} write() {} writeln() {} dispose() {} clear() {} selectAll() {}
  getSelection() { return terminal.text; }
  clearSelection = terminal.clearSelection;
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));

function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
function mount(element: React.ReactNode) {
  return render(<MemoryRouter>{element}<Location /></MemoryRouter>);
}
const instance = { id: 'test', name: '很长的测试实例'.repeat(12), coreType: 'custom', status: 'stopped', jarFile: 'server.jar', jvmArgs: '-Xmx2G', nodeId: 'local' };
const metricSample = { sampledAt: '2026-09-08T10:00:00Z', cpuPercent: 24, memory: { usedBytes: 8 * 1024 ** 3, totalBytes: 32 * 1024 ** 3 }, disk: { availableBytes: 186 * 1024 ** 3, totalBytes: 512 * 1024 ** 3 }, instances: { test: { cpuPercent: 8.2, memoryBytes: 2.4 * 1024 ** 3, state: 'ready' } }, warnings: [] };
let requests: string[];
let nodes: unknown[];
let failNodes: boolean;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  requests = []; nodes = []; failNodes = false; terminal.text = '';
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  // jsdom 不实现原生模态层；此替身仅验证开关状态与应用的焦点恢复逻辑。
  HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector<HTMLElement>('button')?.focus(); };
  HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new Event('close')); };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(String(url));
    if (url === '/api/nodes' && failNodes) return new Response(JSON.stringify({ error: '测试网络失败' }), { status: 503 });
    const data = url === '/api/auth/status' ? { needsSetup: false }
      : url === '/api/auth/me' ? { user: { id: 'tester', username: '测试员' } }
      : url === '/api/instances' ? [instance]
      : url === '/api/system/metrics' ? metricSample
      : url === '/api/tasks' ? { tasks: [{ id: 'task', type: 'import', status: 'running', progress: 30, createdAt: new Date().toISOString() }] }
      : url === '/api/nodes' ? nodes
      : String(url).includes('/import/sources') ? { sources: [] }
      : String(url).includes('java-runtimes') ? { runtimes: [], defaultRuntime: null }
      : {};
    return new Response(JSON.stringify(data));
  }));
  vi.stubGlobal('WebSocket', class { close() {} });
});

test('总览监测保留过期数据，重试恢复，异常筛选可清除', async () => {
  const baseFetch = globalThis.fetch;
  let fail = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/system/metrics' && fail) return new Response('{}', { status: 503 });
    if (url === '/api/instances') return new Response(JSON.stringify([{ ...instance, status: 'running' }]));
    return baseFetch(url, options);
  }));
  const user = userEvent.setup();
  mount(<DashboardPage />);
  expect(await screen.findByText('24.0%')).toBeTruthy();
  expect(await screen.findByText('2.4 GiB')).toBeTruthy();
  fail = true;
  await user.click(screen.getByRole('button', { name: '刷新', exact: true }));
  expect(await screen.findByText(/数据可能过期/)).toBeTruthy();
  expect(screen.getByText('2.4 GiB（过期）')).toBeTruthy();
  fail = false;
  await user.click(screen.getByRole('button', { name: '重试监测' }));
  await waitFor(() => expect(screen.queryByText(/数据可能过期/)).toBeNull());
  await user.click(screen.getByRole('button', { name: '异常 0' }));
  expect(screen.getByText('暂无异常实例。')).toBeTruthy();
  expect(screen.queryByRole('link', { name: instance.name })).toBeNull();
  await user.click(screen.getByRole('button', { name: /显示全部/ }));
  expect(screen.getByRole('link', { name: instance.name })).toBeTruthy();
});

test('监测在隐藏页暂停，回到前台刷新，卸载后停止请求', async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const view = mount(<DashboardPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const count = () => requests.filter(url => url === '/api/system/metrics').length;
  expect(count()).toBe(1);
  hidden = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(count()).toBe(1);
  hidden = false;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
  expect(count()).toBe(2);
  view.unmount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(count()).toBe(2);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('导航菜单禁用主内容和顶栏右侧，Escape 后解除并恢复入口焦点', async () => {
  const user = userEvent.setup();
  localStorage.setItem('mmd_token', 'test-only');
  mount(<AuthProvider><App /></AuthProvider>);
  const trigger = await screen.findByRole('button', { name: '打开导航菜单' });
  await user.click(trigger);
  expect(document.querySelector('.topbar')?.hasAttribute('inert')).toBe(false);
  expect(document.querySelector('.topbar-right')?.hasAttribute('inert')).toBe(true);
  expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
  expect(screen.getByRole('button', { name: '关闭导航菜单' })).toBe(trigger);
  expect(document.querySelector('.sidebar')?.contains(document.activeElement)).toBe(true);
  await user.keyboard('{Escape}');
  expect(document.querySelector('.topbar')?.hasAttribute('inert')).toBe(false);
  expect(document.querySelector('.topbar-right')?.hasAttribute('inert')).toBe(false);
  expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('导航菜单关闭按钮可点，点击后关菜单并恢复入口焦点', async () => {
  const user = userEvent.setup();
  localStorage.setItem('mmd_token', 'test-only');
  mount(<AuthProvider><App /></AuthProvider>);
  const trigger = await screen.findByRole('button', { name: '打开导航菜单' });
  await user.click(trigger);
  const closer = screen.getByRole('button', { name: '关闭导航菜单' });
  expect(closer.closest('[inert]')).toBeNull();
  await user.click(closer);
  expect(document.querySelector('.sidebar-open')).toBeNull();
  expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('打开导航菜单后点击导航会跳转并关闭菜单', async () => {
  const user = userEvent.setup();
  localStorage.setItem('mmd_token', 'test-only');
  mount(<AuthProvider><App /></AuthProvider>);
  const trigger = await screen.findByRole('button', { name: '打开导航菜单' });
  await user.click(trigger);
  const sidebarDeploy = document.querySelector<HTMLAnchorElement>('.sidebar a.nav-item[href="/deploy"]');
  expect(sidebarDeploy).toBeTruthy();
  await user.click(sidebarDeploy!);
  expect(screen.getByTestId('location').textContent).toBe('/deploy');
  expect(document.querySelector('.sidebar-open')).toBeNull();
  expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
});

test('实例操作按钮按 Enter 只执行操作，名称链接仍可导航', async () => {
  const user = userEvent.setup();
  mount(<DashboardPage />);
  const start = await screen.findByRole('button', { name: '启动', exact: true });
  start.focus(); await user.keyboard('{Enter}');
  await waitFor(() => expect(requests).toContain('/api/instances/test/start'));
  expect(screen.getByTestId('location').textContent).toBe('/');
  await user.click(screen.getByRole('link', { name: instance.name }));
  expect(screen.getByTestId('location').textContent).toBe('/instances/test');
});

test('任务抽屉关闭时不可访问，按钮、Escape 和遮罩关闭均恢复入口焦点', async () => {
  const user = userEvent.setup();
  mount(<TaskCenter />);
  const trigger = screen.getByRole('button', { name: /打开任务中心/ });
  expect(screen.queryByRole('dialog')).toBeNull();
  for (const reason of ['button', 'cancel', 'backdrop']) {
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(document.body);
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuenow')).toBe('30');
    if (reason === 'button') await user.click(screen.getByTitle('关闭'));
    if (reason === 'cancel') fireEvent(dialog, new Event('cancel', { cancelable: true }));
    if (reason === 'backdrop') fireEvent.click(dialog, { clientX: -1 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('button', { name: '刷新任务' })).toBeNull();
  }
});

test('ZIP 按钮可用键盘触发，选择与拖放拒绝非 ZIP 并允许重新选择', async () => {
  const user = userEvent.setup();
  mount(<ImportPage />);
  await user.click(screen.getByRole('button', { name: /ZIP/ }));
  const input = document.querySelector<HTMLInputElement>('#existing-server-zip')!;
  const click = vi.spyOn(input, 'click');
  screen.getByRole('button', { name: '选择 ZIP', exact: true }).focus();
  await user.keyboard('{Enter}'); expect(click).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { files: [new File(['bad'], 'bad.txt')] } });
  expect(await screen.findByText('请选择 ZIP 格式的服务端压缩包。')).toBeTruthy();
  fireEvent.change(input, { target: { files: [new File(['zip'], 'server.ZIP')] } });
  expect(screen.getByText('server.ZIP')).toBeTruthy();
  const dropZone = screen.getByRole('button', { name: '选择 ZIP', exact: true }).parentElement!;
  fireEvent.drop(dropZone, { dataTransfer: { files: [new File(['bad'], 'drop.txt')] } });
  expect(screen.getByText('请选择 ZIP 格式的服务端压缩包。')).toBeTruthy();
  expect(screen.getByText('server.ZIP')).toBeTruthy();
});

test('恢复预览和上传期间锁定 ZIP 选择与拖放', async () => {
  const user = userEvent.setup();
  sessionStorage.setItem('mmd_import_preview_id', 'restoring');
  const fetchDefault = globalThis.fetch;
  let resolvePreview: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn((url, options) => String(url).includes('/import/previews/')
    ? new Promise<Response>((resolve) => { resolvePreview = resolve; }) : fetchDefault(url, options)));
  mount(<ImportPage />);
  await user.click(screen.getByRole('button', { name: /ZIP/ }));
  const button = screen.getByRole('button', { name: '选择 ZIP', exact: true }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.drop(button.parentElement!, { dataTransfer: { files: [new File(['x'], 'locked.zip')] } });
  expect(screen.queryByText('locked.zip')).toBeNull();
  await act(async () => resolvePreview(new Response(JSON.stringify({ error: '预览过期' }), { status: 410 })));
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.change(document.querySelector('#existing-server-zip')!, { target: { files: [new File(['zip'], 'upload.zip')] } });
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  await user.click(screen.getByRole('button', { name: '上传并预检' }));
  expect(button.disabled).toBe(true);
  fireEvent.drop(button.parentElement!, { dataTransfer: { files: [new File(['x'], 'locked.zip')] } });
  expect(screen.queryByText('locked.zip')).toBeNull();
});

test('节点页展示空态，失败后可主动重试恢复真实离线状态', async () => {
  const user = userEvent.setup();
  mount(<NodesPage />);
  expect(await screen.findByText('暂无节点。')).toBeTruthy();
  failNodes = true;
  await user.click(screen.getByRole('button', { name: '刷新节点' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  failNodes = false;
  nodes = [{ id: 'local', isLocal: true, name: '本机', status: 'offline', instanceCount: 0 }];
  await user.click(screen.getByRole('button', { name: '重试加载' }));
  expect(await screen.findByText('离线')).toBeTruthy();
  expect(screen.queryByText(/健康运转中/)).toBeNull();
});

test('复制日志提供空日志、权限拒绝、API 缺失与成功反馈', async () => {
  const user = userEvent.setup();
  mount(<ConsolePanel instanceId="test" />);
  await user.click(screen.getByRole('button', { name: '复制日志' }));
  expect(screen.getByRole('status').textContent).toContain('暂无可复制');
  terminal.text = '测试日志';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  await user.click(screen.getByRole('button', { name: '复制日志' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('请手动选择日志并复制'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  await user.click(screen.getByRole('button', { name: '复制日志' }));
  expect(screen.getByRole('status').textContent).toContain('复制失败');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await user.click(screen.getByRole('button', { name: '复制日志' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('日志已复制。'));
  expect(writeText).toHaveBeenCalledWith('测试日志');
});

test('节点轮询失败保留旧数据并标记可能过期', async () => {
  nodes = [{ id: 'local', isLocal: true, name: '本机', status: 'online', instanceCount: 3 }];
  vi.useFakeTimers();
  mount(<NodesPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText('在线')).toBeTruthy();
  failNodes = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('3 个服务实例')).toBeTruthy();
  expect(screen.getByText('状态可能已过期')).toBeTruthy();
  expect(screen.queryByText('在线')).toBeNull();
  expect(screen.getByRole('button', { name: '重试加载' })).toBeTruthy();
});

test('复制提示计时器在控制台卸载时清理', async () => {
  vi.useFakeTimers();
  const view = mount(<ConsolePanel instanceId="test" />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '复制日志' })));
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
