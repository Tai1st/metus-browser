/**
 * Quản lý nhiều tài khoản Facebook (thay cho màn fb-accounts + INIT_SET_COOKIE /
 * SET_RAW_COOKIE / LOGIN_NEW_ACC của extension).
 *
 * Cookie chỉ nằm trong native (Keystore/Keychain). JS giữ id + tên + avatar.
 */
import { Metus } from '@metus/http';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as storage from '../storage';
import { fetchFbSession, isSessionValid, type FbSession } from './session';
import type { FbAccount } from './types';

export interface FbAccountRow extends FbAccount {
  hasSession: boolean;
}

interface FbAccountsState {
  accounts: FbAccountRow[];
  current: FbAccountRow | null;
  session: FbSession | null;
  sessionLoading: boolean;
  sessionError: string | null;
  refresh(): Promise<void>;
  select(id: string): Promise<void>;
  /** Lưu phiên đang đăng nhập trong WebView thành tài khoản. */
  importFromWebView(): Promise<FbAccountRow>;
  importCookie(cookie: string): Promise<FbAccountRow>;
  remove(id: string): Promise<void>;
  reloadSession(): Promise<void>;
}

const Ctx = createContext<FbAccountsState | null>(null);

type Profiles = Record<string, { name: string; picture: string }>;

const profiles = (): Profiles => storage.get<Profiles>(storage.StorageKey.FB_ACCOUNTS) ?? {};

function saveProfile(a: FbAccount) {
  storage.set(storage.StorageKey.FB_ACCOUNTS, { ...profiles(), [a.id]: { name: a.name, picture: a.picture } });
}

export function FbAccountsProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<FbAccountRow[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>(() => storage.get<FbAccount>(storage.StorageKey.FB_ACCOUNT)?.id);
  const [session, setSession] = useState<FbSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await Metus.accounts.list();
    const p = profiles();
    setAccounts(
      list.map((a) => ({
        id: a.id,
        hasSession: a.hasSession,
        name: p[a.id]?.name ?? a.id,
        picture: p[a.id]?.picture ?? '',
      })),
    );
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setSessionLoading(true);
    setSessionError(null);
    try {
      const s = await fetchFbSession();
      if (!isSessionValid(s, id)) {
        throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại tài khoản này');
      }
      // Giữ tên cũ nếu lần này không đọc được tên từ HTML.
      const prevName = profiles()[id]?.name;
      const acc = { id, name: s.account?.name || prevName || id, picture: s.account?.picture || `https://graph.facebook.com/${id}/picture?height=100` };
      saveProfile(acc);
      storage.set(storage.StorageKey.FB_ACCOUNT, acc);
      setSession({ ...s, account: acc });
      await refresh();
    } catch (e) {
      setSession(null);
      setSessionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionLoading(false);
    }
  }, [refresh]);

  const select = useCallback(async (id: string) => {
    Metus.accounts.setCurrent(id);
    setCurrentId(id);
    const p = profiles()[id];
    storage.set(storage.StorageKey.FB_ACCOUNT, { id, name: p?.name ?? id, picture: p?.picture ?? '' });
    await loadSession(id);
  }, [loadSession]);

  const afterImport = useCallback(async (id: string) => {
    await refresh();
    await select(id);
    const p = profiles()[id];
    return { id, name: p?.name ?? id, picture: p?.picture ?? '', hasSession: true };
  }, [refresh, select]);

  const importFromWebView = useCallback(async () => {
    const { id } = await Metus.accounts.importFromWebView();
    return afterImport(id);
  }, [afterImport]);

  const importCookie = useCallback(async (cookie: string) => {
    const { id } = await Metus.accounts.importCookieString(cookie);
    return afterImport(id);
  }, [afterImport]);

  const remove = useCallback(async (id: string) => {
    await Metus.accounts.remove(id);
    const p = profiles();
    delete p[id];
    storage.set(storage.StorageKey.FB_ACCOUNTS, p);
    if (id === currentId) {
      storage.clear(storage.StorageKey.FB_ACCOUNT);
      setCurrentId(undefined);
      setSession(null);
    }
    await refresh();
  }, [currentId, refresh]);

  useEffect(() => {
    refresh().catch(() => {});
    if (currentId) {
      Metus.accounts.setCurrent(currentId);
      loadSession(currentId).catch(() => {});
    }
    // Chỉ chạy lúc mở app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = accounts.find((a) => a.id === currentId) ?? null;

  const value = useMemo<FbAccountsState>(() => ({
    accounts,
    current,
    session,
    sessionLoading,
    sessionError,
    refresh,
    select,
    importFromWebView,
    importCookie,
    remove,
    reloadSession: () => (currentId ? loadSession(currentId) : Promise.resolve()),
  }), [accounts, current, session, sessionLoading, sessionError, refresh, select, importFromWebView, importCookie, remove, currentId, loadSession]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFbAccounts(): FbAccountsState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFbAccounts phải nằm trong FbAccountsProvider');
  return ctx;
}
