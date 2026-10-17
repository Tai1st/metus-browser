import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import * as storage from './storage';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  scheme: Scheme;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  // Mặc định SÁNG (khớp thiết kế); đọc lựa chọn đã lưu nếu có.
  const [mode, setModeState] = useState<ThemeMode>(() => storage.get<ThemeMode>(storage.StorageKey.THEME) ?? 'light');

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    storage.set(storage.StorageKey.THEME, m);
  }, []);

  const scheme: Scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const toggle = useCallback(() => setMode(scheme === 'dark' ? 'light' : 'dark'), [scheme, setMode]);

  const value = useMemo(() => ({ mode, scheme, setMode, toggle }), [mode, scheme, setMode, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme phải nằm trong ThemeProvider');
  return c;
}
