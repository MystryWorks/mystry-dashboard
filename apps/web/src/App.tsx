import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { InstancePage } from './pages/InstancePage';
import { DeployPage } from './pages/DeployPage';
import { ImportPage } from './pages/ImportPage';
import { NodesPage } from './pages/NodesPage';

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          Mystery Dashboard
          <span>Minecraft 服务端管理</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
            实例总览
          </NavLink>
          <NavLink to="/deploy" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            一键部署
          </NavLink>
          <NavLink to="/import" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            导入安装包
          </NavLink>
          <NavLink to="/nodes" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            节点管理
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-user">{user?.username}</span>
          <button className="btn btn-ghost sidebar-logout" type="button" onClick={logout}>
            退出
          </button>
        </div>
      </aside>
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
