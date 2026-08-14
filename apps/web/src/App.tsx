import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
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
  const topbarRef = useRef<HTMLDivElement>(null);

  const closeSidebar = useCallback(() => {
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
    mainRef.current?.toggleAttribute('inert', sidebarOpen);
    const topbarExtras = topbarRef.current?.querySelector('.topbar-task-center');
    topbarExtras?.toggleAttribute('inert', sidebarOpen);
  }, [sidebarOpen]);

  return (
    <div className={`app-shell${sidebarOpen ? ' sidebar-open' : ''}`}>
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}
      >
        <div className="brand">
          Mystery Dashboard
          <span>Minecraft 服务端管理</span>
        </div>
        <nav className="nav" onClick={closeSidebar}>
          <NavLink
            ref={firstNavRef}
            to="/"
            end
            className={({ isActive }) => (isActive ? 'active' : undefined)}
          >
            实例总览
          </NavLink>
          <NavLink to="/deploy" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            一键部署
          </NavLink>
          <NavLink to="/import" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            导入已有服务端
          </NavLink>
          <NavLink to="/nodes" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            节点管理
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <TaskCenter placement="sidebar" />
          <ThemeToggle placement="sidebar" />
          <span className="sidebar-user">{user?.username}</span>
          <button className="btn btn-ghost sidebar-logout" type="button" onClick={logout}>
            退出
          </button>
        </div>
      </aside>
      <div className="app-topbar" ref={topbarRef}>
        <button
          ref={toggleRef}
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarOpen ? '关闭导航菜单' : '打开导航菜单'}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          <span>{sidebarOpen ? '关闭' : '菜单'}</span>
        </button>
        <div className="topbar-task-center">
          <ThemeToggle placement="topbar" />
          <TaskCenter placement="topbar" />
        </div>
      </div>
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeSidebar} aria-hidden="true" tabIndex={-1} />
      )}
      <main className="main" ref={mainRef}>
        {children}
      </main>
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
