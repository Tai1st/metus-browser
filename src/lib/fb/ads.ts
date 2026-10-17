// Nền tảng "phiên Ads" cho các tool dùng Facebook Ads API (đăng bài 2 ô, 1 ô…).
// metus-few lấy ads token từ extension; bản native tự scrape token EAA từ trang
// Ads Manager bằng cookie của tài khoản FB hiện tại, rồi gọi graph lấy Pages &
// Ad accounts. Tất cả chạy qua Metus native HTTP (compat.exFetch).
import { exFetch } from './compat';

export interface AdPage {
  id: string;
  name: string;
  access_token: string;
  picture?: string;
}

export interface AdAccount {
  id: string; // dạng act_xxx
  account_id?: string;
  name: string;
}

// Các trang có chứa access token EAA trong bootstrap HTML (thử lần lượt).
const TOKEN_SOURCES = [
  'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
  'https://www.facebook.com/adsmanager/manage/campaigns',
  'https://business.facebook.com/latest/home',
];

// Mẫu bắt token EAA (ads/business token của FB nội bộ, thường bắt đầu EAAG/EAAB).
const TOKEN_PATTERNS = [
  /"accessToken":"(EAA[A-Za-z0-9]+)"/,
  /accessToken="(EAA[A-Za-z0-9]+)"/,
  /\\"accessToken\\":\\"(EAA[A-Za-z0-9]+)\\"/,
  /(EAAG[A-Za-z0-9]{30,})/,
  /(EAAB[A-Za-z0-9]{30,})/,
];

function extractToken(html: string): string | null {
  for (const re of TOKEN_PATTERNS) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Scrape ads token (EAA…) từ phiên tài khoản hiện tại. */
export async function fetchAdsToken(): Promise<string> {
  let lastLen = 0;
  for (const url of TOKEN_SOURCES) {
    try {
      const html = await exFetch<string>(url, {}, 30000);
      const text = typeof html === 'string' ? html : JSON.stringify(html);
      lastLen = text.length;
      const token = extractToken(text);
      if (token) return token;
    } catch {
      // thử nguồn kế tiếp
    }
  }
  throw new Error(`Không lấy được ads token từ phiên hiện tại (len=${lastLen}). Hãy mở Facebook/Ads Manager và đăng nhập lại.`);
}

/** Danh sách Page quản lý (kèm page access token). */
export async function fetchPages(token: string): Promise<AdPage[]> {
  const res = await exFetch<any>('https://graph.facebook.com/v21.0/me/accounts', {
    params: { access_token: token, fields: 'id,name,access_token,picture{url}', limit: 200 },
  });
  const data: any[] = res?.data ?? [];
  return data.map((p) => ({
    id: String(p.id),
    name: p.name ?? String(p.id),
    access_token: p.access_token,
    picture: p.picture?.data?.url,
  }));
}

/** Danh sách tài khoản quảng cáo (act_xxx). */
export async function fetchAdAccounts(token: string): Promise<AdAccount[]> {
  const res = await exFetch<any>('https://graph.facebook.com/v21.0/me/adaccounts', {
    params: { access_token: token, fields: 'account_id,name', limit: 200 },
  });
  const data: any[] = res?.data ?? [];
  return data.map((a) => ({
    id: String(a.id), // graph trả id = act_xxx
    account_id: a.account_id ? String(a.account_id) : undefined,
    name: a.name ?? String(a.id),
  }));
}

export interface AdsSession {
  token: string;
  pages: AdPage[];
  adAccounts: AdAccount[];
}

/** Lấy toàn bộ phiên Ads: token + pages + ad accounts. */
export async function loadAdsSession(): Promise<AdsSession> {
  const token = await fetchAdsToken();
  const [pages, adAccounts] = await Promise.all([fetchPages(token), fetchAdAccounts(token)]);
  return { token, pages, adAccounts };
}
