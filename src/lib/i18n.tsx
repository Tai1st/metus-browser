import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import * as storage from './storage';
import type { Dict } from './locales/types';
import vi from './locales/vi';
import en from './locales/en';
import zh from './locales/zh';
import bn from './locales/bn';
import hi from './locales/hi';
import fil from './locales/fil';
import ar from './locales/ar';
import fr from './locales/fr';

/**
 * i18n tối giản cho Metus Browser. Người dùng chọn ngôn ngữ ở lần mở app đầu
 * tiên (bottom sheet), lựa chọn được lưu vào storage. `t('key')` tra cứu chuỗi
 * theo ngôn ngữ hiện tại; thiếu key thì fallback sang en rồi trả về chính key.
 * Mỗi ngôn ngữ là 1 file riêng trong `./locales/<mã>.ts` (dễ thêm ngôn ngữ mới
 * sau này mà không phải đụng vào file logic này).
 */
export type Lang = 'vi' | 'en' | 'zh' | 'bn' | 'hi' | 'fil' | 'ar' | 'fr';

export const LANGUAGES: { code: Lang; label: string; native: string; flag: string }[] = [
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'zh', label: 'Chinese', native: '中文', flag: '🇨🇳' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', flag: '🇧🇩' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
  { code: 'fil', label: 'Filipino', native: 'Filipino', flag: '🇵🇭' },
  { code: 'ar', label: 'Arabic', native: 'العربية', flag: '🇦🇪' },
  { code: 'fr', label: 'French', native: 'Français', flag: '🇫🇷' },
];

// Tất cả 8 ngôn ngữ đã có bản dịch đầy đủ.
const DICTS: Partial<Record<Lang, Dict>> = { vi, en, zh, bn, hi, fil, ar, fr };

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

interface I18nState {
  lang: Lang;
  /** Người dùng đã chọn ngôn ngữ lần đầu hay chưa (để gate màn hình chọn). */
  chosen: boolean;
  setLang: (l: Lang) => void;
  t: TranslateFn;
}

const Ctx = createContext<I18nState | null>(null);

function applyVars(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

/**
 * Dịch ngoài component (service/lib ném lỗi hiển thị cho người dùng) — đọc
 * ngôn ngữ đang chọn từ storage, cùng bảng từ với useT().
 */
export function tr(key: string, vars?: Record<string, string | number>): string {
  const lang = storage.get<Lang>(storage.StorageKey.LANGUAGE) ?? 'vi';
  const table = DICTS[lang] ?? en;
  return applyVars(table[key] ?? en[key] ?? key, vars);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const saved = storage.get<Lang>(storage.StorageKey.LANGUAGE);
  const [lang, setLangState] = useState<Lang>(saved ?? 'vi');
  const [chosen, setChosen] = useState<boolean>(saved != null);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setChosen(true);
    storage.set(storage.StorageKey.LANGUAGE, l);
  }, []);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      const table = DICTS[lang] ?? en;
      return applyVars(table[key] ?? en[key] ?? key, vars);
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, chosen, setLang, t }), [lang, chosen, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n phải nằm trong I18nProvider');
  return c;
}

/** Hook tiện dụng chỉ lấy hàm dịch. */
export function useT(): TranslateFn {
  return useI18n().t;
}

/**
 * Phương thức nạp tiền mặc định (focus) theo ngôn ngữ — giống `defaultPaymentMethod`
 * trong config locales của metus-few: tiếng Việt (VND) ưu tiên chuyển khoản ngân
 * hàng, các ngôn ngữ khác (USD) ưu tiên USDT.
 */
export function defaultRechargeMethod(lang: Lang): 'bank' | 'usdt' {
  return lang === 'vi' ? 'bank' : 'usdt';
}

/** 1 USD = 26.000 VND (giống exchangeRate của metus-few). */
export const USD_RATE = 26000;

/**
 * Tiền tệ theo ngôn ngữ: tiếng Việt hiển thị VNĐ, các ngôn ngữ khác quy đổi sang
 * USD theo tỷ lệ 1/26000. `format(vnd)` nhận số tiền gốc (VND) và trả chuỗi đã
 * định dạng theo tiền tệ hiện tại.
 */
export function useCurrency() {
  const { lang } = useI18n();
  const isVnd = lang === 'vi';
  const format = (vnd: number) => {
    if (isVnd) return `${Math.round(vnd).toLocaleString('vi-VN')}đ`;
    const [int, dec] = (vnd / USD_RATE).toFixed(2).split('.');
    return `$${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
  };
  return { isVnd, currency: isVnd ? 'VND' : 'USD', rate: USD_RATE, format };
}

