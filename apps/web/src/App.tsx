import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from './auth';
import { TaskCenter } from './components/TaskCenter';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { InstancePage } from './pages/InstancePage';
import { DeployPage } from './pages/DeployPage';
import { ImportPage } from './pages/ImportPage';
import { NodesPage } from './pages/NodesPage';

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    closeSidebar();
  }, [location.pathname, closeSidebar]);

  useEffect(() => {
    if (!sidebarOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setSidebarOpen(false);
      toggleRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className={`app-shell${sidebarOpen ? ' sidebar-open' : ''}`}>
      <aside id="app-sidebar" className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="brand">
          Mystery Dashboard
          <span>Minecraft 服务端管理</span>
        </div>
        <nav className="nav" onClick={closeSidebar}>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
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
          <ThemeToggle />
          <span className="sidebar-user">{user?.username}</span>
          <button className="btn btn-ghost sidebar-logout" type="button" onClick={logout}>
            退出
          </button>
        </div>
      </aside>
      <div className="app-topbar">
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
          <ThemeToggle />
          <TaskCenter placement="topbar" />
        </div>
      </div>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={closeSidebar} aria-hidden="true" />}
      <main className="main">{children}</main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  if (loading) return <div className="login-page">加载中…</div>;
  if (needsSetup || !user) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
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
