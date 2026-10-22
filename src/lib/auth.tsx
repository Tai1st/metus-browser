import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { showDialog } from '@/components/Dialog';

import { Api, onUnauthorized, type MetusUser } from './api';
import { tr } from './i18n';
import { GoogleCancelled, getGoogleFirebaseIdToken } from './googleAuth';
import * as storage from './storage';

interface AuthState {
  user: MetusUser | null;
  isLoggedIn: boolean;
  login(email: string, password: string): Promise<void>;
  /** Trả về false nếu người dùng tự hủy chọn tài khoản Google. */
  loginWithGoogle(): Promise<boolean>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MetusUser | null>(() =>
    storage.get(storage.StorageKey.ACCESS_TOKEN) ? (storage.get<MetusUser>(storage.StorageKey.USER) ?? {}) : null,
  );

  // Token hết hạn (API trả 401) → đăng xuất + báo người dùng
  const loggedIn = user !== null;
  const loggedInRef = useRef(loggedIn);
  loggedInRef.current = loggedIn;
  useEffect(
    () =>
      onUnauthorized(() => {
        if (!loggedInRef.current) return;
        loggedInRef.current = false;
        setUser(null);
        showDialog(tr('auth.sessionExpired'), tr('auth.sessionExpiredDesc'));
      }),
    [],
  );

  // Kiểm tra token khi mở app và mỗi lần quay lại app (401 sẽ tự đăng xuất ở trên)
  useEffect(() => {
    if (!loggedIn) return;
    const check = () => {
      if (!storage.get(storage.StorageKey.ACCESS_TOKEN)) return;
      Api.me()
        .then((u) => storage.set(storage.StorageKey.USER, u))
        .catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [loggedIn]);

  const login = useCallback(async (email: string, password: string) => {
    const { accessToken, user: u } = await Api.login(email, password);
    storage.set(storage.StorageKey.ACCESS_TOKEN, accessToken);
    storage.set(storage.StorageKey.USER, u);
    setUser(u);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    let idToken: string;
    try {
      idToken = await getGoogleFirebaseIdToken();
    } catch (e) {
      if (e instanceof GoogleCancelled) return false;
      throw e;
    }
    const { accessToken, user: u } = await Api.loginSocial(idToken);
    storage.set(storage.StorageKey.ACCESS_TOKEN, accessToken);
    storage.set(storage.StorageKey.USER, u);
    setUser(u);
    return true;
  }, []);

  const logout = useCallback(() => {
    storage.clear(storage.StorageKey.ACCESS_TOKEN);
    storage.clear(storage.StorageKey.USER);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, isLoggedIn: user !== null, login, loginWithGoogle, logout }), [user, login, loginWithGoogle, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải nằm trong AuthProvider');
  return ctx;
}
