// Phiên Ads dùng chung toàn app: tự scrape ads token + Pages + Ad accounts NGAY
// khi app khởi động và có phiên Facebook hợp lệ, rồi cache lại. Các tool Ads
// (đăng bài 2 ô…) dùng lại từ đây thay vì mỗi lần vào tool lại scrape.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { describeError } from '../api';
import { useFbAccounts } from './accounts';
import { loadAdsSession, type AdsSession } from './ads';

interface AdsSessionState {
  ads: AdsSession | null;
  loading: boolean;
  error: string | null;
  /** Buộc scrape lại (ví dụ sau khi token hết hạn). */
  reload: () => void;
}

const Ctx = createContext<AdsSessionState | null>(null);

export function AdsSessionProvider({ children }: { children: ReactNode }) {
  const { current, session } = useFbAccounts();
  const [ads, setAds] = useState<AdsSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedForId = useRef<string>('');
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (!current?.id || !session?.dtsg || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const s = await loadAdsSession();
      setAds(s);
      loadedForId.current = current.id;
    } catch (e) {
      setError(describeError(e));
      setAds(null);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [current?.id, session?.dtsg]);

  // Tự nạp khi có phiên FB hợp lệ; đổi tài khoản thì nạp lại; mất tài khoản thì xóa.
  useEffect(() => {
    if (!current?.id) {
      setAds(null);
      setError(null);
      loadedForId.current = '';
      return;
    }
    if (session?.dtsg && loadedForId.current !== current.id) {
      run();
    }
  }, [current?.id, session?.dtsg, run]);

  const reload = useCallback(() => {
    loadedForId.current = '';
    run();
  }, [run]);

  const value = useMemo<AdsSessionState>(() => ({ ads, loading, error, reload }), [ads, loading, error, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdsSession(): AdsSessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdsSession phải nằm trong AdsSessionProvider');
  return ctx;
}
