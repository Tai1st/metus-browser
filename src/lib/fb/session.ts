/**
 * Phiên Facebook của tài khoản đang chọn: fb_dtsg + thông tin tài khoản.
 * Port từ metus-few: services/facebook/Param.ts (getFbdtsg) và
 * FacebookAccountToken.ts (fetchFacebookAccountInfo). Bỏ "CÁCH 2: lấy từ DOM"
 * vì app không chạy trong trang Facebook.
 */
import { exFetch } from './compat';
import type { FbAccount } from './types';


export interface FbSession {
  dtsg: string | null;
  asyncToken: string | null;
  account: FbAccount | null;
}

const picUrl = (uid: string) =>
  `https://graph.facebook.com/${uid}/picture?height=100&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662`;

/** Lấy UID đang đăng nhập từ nhiều dấu hiệu khác nhau trong HTML của Facebook. */
function extractUid(html: string): string | null {
  const patterns = [
    /"USER_ID":"(\d{5,})"/, // CurrentUserInitialData
    /"actorID":"(\d{5,})"/,
    /"viewerID":"(\d{5,})"/,
    /\\"user_id\\":\\"(\d{5,})\\"/,
    /"__user":"?(\d{5,})"?/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1] !== '0') return m[1];
  }
  return null;
}

export function parseSession(html: string): FbSession {
  const dtsg = html.match(/"DTSGInitData",\[\],\{"token":"(.*?)","async_get_token":"(.*?)"/);
  let account: FbAccount | null = null;
  // Tên (nếu có) từ CurrentUserInitialData.
  const nameMatch = html.match(/"NAME":"((?:[^"\\]|\\.)*)"/);
  const uid = extractUid(html);
  if (uid) {
    let name = '';
    try {
      name = nameMatch ? JSON.parse(`"${nameMatch[1]}"`) : '';
    } catch {
      name = '';
    }
    account = { id: uid, name, picture: picUrl(uid) };
  }
  return { dtsg: dtsg?.[1] ?? null, asyncToken: dtsg?.[2] ?? null, account };
}

/**
 * Phiên còn hợp lệ khi: lấy được fb_dtsg (chỉ trang đã đăng nhập mới có),
 * HOẶC nhận diện được UID đúng tài khoản. Không bắt buộc cả hai, tránh báo
 * nhầm "hết phiên" khi Facebook đổi markup.
 */
export function isSessionValid(s: FbSession, expectedId: string): boolean {
  if (s.account && s.account.id === expectedId) return true;
  // Có dtsg = đã đăng nhập; nếu không parse được UID (markup lạ) vẫn coi là hợp lệ
  // miễn không phát hiện UID của tài khoản KHÁC.
  if (s.dtsg && (!s.account || s.account.id === expectedId)) return true;
  return false;
}

/** Một request lấy cả fb_dtsg và tên tài khoản (bản gốc gọi 2 lần cùng URL). */
export async function fetchFbSession(): Promise<FbSession> {
  // Trang chủ comet chứa DTSGInitData + CurrentUserInitialData khi đã đăng nhập.
  const html = await exFetch<string>('https://www.facebook.com/');
  return parseSession(typeof html === 'string' ? html : '');
}
