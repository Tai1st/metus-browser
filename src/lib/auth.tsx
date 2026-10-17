import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { Api, type MetusUser } from './api';
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
