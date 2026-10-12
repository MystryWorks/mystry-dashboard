import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { FolderDown, LayoutGrid, LogOut, Menu, Rocket, Server, Terminal, X } from 'lucide-react';
import { useAuth } from './auth';
import { TaskCenter } from './components/TaskCenter';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './pages/LoginPage';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then(({ DashboardPage }) => ({ default: DashboardPage })),
);
const InstancePage = lazy(() =>
  import('./pages/InstancePage').then(({ InstancePage }) => ({ default: InstancePage })),
);
const DeployPage = lazy(() =>
  import('./pages/DeployPage').then(({ DeployPage }) => ({ default: DeployPage })),
);
const ImportPage = lazy(() =>
  import('./pages/ImportPage').then(({ ImportPage }) => ({ default: ImportPage })),
);
const NodesPage = lazy(() =>
  import('./pages/NodesPage').then(({ NodesPage }) => ({ default: NodesPage })),
);

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function PageLoading() {
  return (
    <div className="login-page" role="status" aria-live="polite">
      页面加载中…
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const firstNavRef = useRef<HTMLAnchorElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const topbarToolsRef = useRef<HTMLDivElement>(null);

  const closeSidebar = useCallback(() => {
    mainRef.current?.removeAttribute('inert');
    topbarToolsRef.current?.removeAttribute('inert');
    setSidebarOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    closeSidebar();
  }, [location.pathname, closeSidebar]);

  useEffect(() => {
    if (!sidebarOpen) return;
    firstNavRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeSidebar();
        return;
      }
      if (event.key !== 'Tab' || !sidebarRef.current) return;
      const focusables = [...sidebarRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, closeSidebar]);

  useEffect(() => {
    // 只 inert 主内容和顶栏右侧，避免汉堡/关闭按钮被整栏挡住。
    mainRef.current?.toggleAttribute('inert', sidebarOpen);
    topbarToolsRef.current?.toggleAttribute('inert', sidebarOpen);
  }, [sidebarOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1025px)');
    const onResize = () => { if (desktop.matches) closeSidebar(); };
    desktop.addEventListener('change', onResize);
    return () => desktop.removeEventListener('change', onResize);
  }, [closeSidebar]);

  const pageTitle = useMemo(() => {
    if (location.pathname === '/') return '实例总览';
    if (location.pathname.startsWith('/instances')) return '实例工作台';
    if (location.pathname.startsWith('/deploy')) return '一键部署';
    if (location.pathname.startsWith('/import')) return '导入已有服务端';
    if (location.pathname.startsWith('/nodes')) return '节点监控';
    return '管理控制台';
  }, [location.pathname]);

  return (
    <div className={`app-shell${sidebarOpen ? ' sidebar-open' : ''}`}>
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}
      >
        <div className="sidebar-brand">
          <div className="brand-cube">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div className="brand-info">
            <div className="brand-title">Mystry Dashboard</div>
            <div className="brand-subtitle">v0.2.0-preview · Minecraft</div>
          </div>
        </div>

        <nav className="nav-section" onClick={closeSidebar}>
          <div className="nav-header">主控集群</div>
          <NavLink
            ref={firstNavRef}
            to="/"
            end
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <LayoutGrid size={18} />
            <span>实例总览</span>
          </NavLink>
          {location.pathname.startsWith('/instances') && (
            <NavLink
              to={location.pathname}
              className="nav-item active"
            >
              <Terminal size={18} />
              <span>当前工作台</span>
            </NavLink>
          )}

          <div className="nav-header">部署与维护</div>
          <NavLink
            to="/deploy"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Rocket size={18} />
            <span>一键部署</span>
          </NavLink>
          <NavLink
            to="/import"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <FolderDown size={18} />
            <span>导入服务端</span>
          </NavLink>
          <NavLink
            to="/nodes"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Server size={18} />
            <span>节点监控</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">{user?.username ? user.username.slice(0, 1).toUpperCase() : 'A'}</div>
            <div className="user-meta">
              <span className="user-name">{user?.username ?? 'admin'}</span>
              <span className="user-role">● 本机主控权限</span>
            </div>
          </div>
          <button className="btn btn-icon" type="button" title="登出系统" onClick={logout}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="viewport">
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={toggleRef}
              type="button"
              className="sidebar-toggle"
              aria-label={sidebarOpen ? '关闭导航菜单' : '打开导航菜单'}
              aria-expanded={sidebarOpen}
              aria-controls="app-sidebar"
              onClick={() => {
                if (sidebarOpen) closeSidebar();
                else setSidebarOpen(true);
              }}
            >
              {sidebarOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
            <h2 className="page-title" style={{ margin: 0, fontSize: '1.15rem' }}>{pageTitle}</h2>
            <span className="tag-badge">Minecraft Java 服务端</span>
          </div>
          <div className="topbar-right" ref={topbarToolsRef}>
            <TaskCenter placement="topbar" />
            <ThemeToggle placement="topbar" />
          </div>
        </header>

        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={closeSidebar} aria-hidden="true" tabIndex={-1} />
        )}

        <main className="content-container" ref={mainRef}>
          {children}
        </main>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  if (loading) return <div className="login-page">加载中…</div>;
  if (needsSetup || !user) return <Navigate to="/login" replace />;
  return (
    <Shell>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </Shell>
  );
}

export function App() {
  const { user, loading, needsSetup } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          loading ? (
            <div className="login-page">加载中…</div>
          ) : user && !needsSetup ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/instances/:id/*"
        element={
          <RequireAuth>
            <InstancePage />
          </RequireAuth>
        }
      />
      <Route
        path="/deploy"
        element={
          <RequireAuth>
            <DeployPage />
          </RequireAuth>
        }
      />
      <Route
        path="/import"
        element={
          <RequireAuth>
            <ImportPage />
          </RequireAuth>
        }
      />
      <Route
        path="/nodes"
        element={
          <RequireAuth>
            <NodesPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
