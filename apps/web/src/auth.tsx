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
import { api, getToken, setToken } from './api';

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
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

  const refresh = useCallback(async () => {
    const status = await api<{ needsSetup: boolean }>('/api/auth/status');
    setNeedsSetup(status.needsSetup);
    if (status.needsSetup) {
      setUser(null);
      setLoading(false);
      return;
    }
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<{ user: AuthUser }>('/api/auth/me');
      setUser(me.user);
    } catch {
      setToken(null);
      setUser(null);
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
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, needsSetup, login, setup, logout, refresh }),
    [user, loading, needsSetup, login, setup, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
