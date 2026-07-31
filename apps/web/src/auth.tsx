import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from '@mmd/shared';
import { api, ApiError, getToken, setToken } from './api';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
  statusError: string | null;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string, setupToken: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatusError(null);
    try {
      const status = await api<{ needsSetup: boolean }>('/api/auth/status');
      setNeedsSetup(status.needsSetup);
      if (status.needsSetup) {
        setUser(null);
        return;
      }
      if (!getToken()) {
        setUser(null);
        return;
      }
      try {
        const me = await api<{ user: AuthUser }>('/api/auth/me');
        setUser(me.user);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      setUser(null);
      const message = error instanceof Error ? error.message : String(error);
      setStatusError(`无法连接面板服务：${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      json: { username, password },
    });
    setToken(res.token);
    setUser(res.user);
    setNeedsSetup(false);
    setStatusError(null);
  }, []);

  const setup = useCallback(async (username: string, password: string, setupToken: string) => {
    const res = await api<{ token: string; user: AuthUser }>('/api/auth/setup', {
      method: 'POST',
      json: { username, password },
      headers: { 'X-Setup-Token': setupToken },
    });
    setToken(res.token);
    setUser(res.user);
    setNeedsSetup(false);
    setStatusError(null);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, needsSetup, statusError, login, setup, logout, refresh }),
    [user, loading, needsSetup, statusError, login, setup, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
