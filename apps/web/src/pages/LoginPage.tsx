import { useRef, useState } from 'react';
import { useAuth } from '../auth';

export function LoginPage() {
  const { needsSetup, statusError, login, setup, refresh } = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (needsSetup) await setup(username, password, setupToken);
      else await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (statusError) {
    return (
      <div className="login-page">
        <div className="panel login-card">
          <h1 className="page-title">面板服务不可用</h1>
          <p className="error">{statusError}</p>
          <button className="btn" type="button" onClick={() => void refresh()}>
            重新检查
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="panel login-card" onSubmit={onSubmit}>
        <h1 className="page-title">{needsSetup ? '初始化管理员' : '登录面板'}</h1>
        <p className="page-desc">
          {needsSetup
            ? '首次启动，请创建管理员账号。'
            : '使用管理员账号登录 Minecraft Mystery Dashboard。'}
        </p>
        <div className="field">
          <label htmlFor="username">用户名</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        {needsSetup && (
          <div className="field">
            <label htmlFor="setup-token">初始化令牌</label>
            <input
              id="setup-token"
              type="password"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              autoComplete="off"
              minLength={64}
              maxLength={64}
              required
            />
            <p className="muted field-help">请输入服务器配置 SETUP_TOKEN 的完整 64 位令牌。</p>
          </div>
        )}
        <div className="field">
          <label htmlFor="password">密码</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            required
            minLength={needsSetup ? 12 : 1}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? '处理中…' : needsSetup ? '创建并进入' : '登录'}
        </button>
      </form>
    </div>
  );
}
