import { exFetch } from './compat';
import { waitVideoThumbnail } from './videoCarousel';

/**
 * "Thêm video từ Link" — port từ metus-few (useFbVideoCarousel.handleUploadLink):
 * lấy link tải trực tiếp (TikTok qua tikmate.to, CapCut qua 3bic.com, Facebook qua
 * video_data_async) rồi cho Facebook tự kéo video về ad account bằng `file_url`.
 * TikTok/CapCut gọi bằng fetch thường (không cần cookie FB, không qua allowlist).
 */
const GRAPH = 'https://graph.facebook.com';

export type VideoLinkSource = 'tiktok' | 'capcut' | 'facebook';

export function detectVideoLink(url: string): VideoLinkSource | null {
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('capcut.com')) return 'capcut';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
  return null;
}

const decodeHtml = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&quot;/g, '"');

async function fetchTiktokDownloadUrl(videoUrl: string): Promise<string> {
  const form = new URLSearchParams({ q: videoUrl, cursor: '0', page: '0', lang: 'vi' });
  const r = await fetch('https://tikmate.to/api/ajaxSearch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const json = (await r.json()) as { data?: string };
  // Không có DOMParser trên RN: tách các thẻ <a class="... tik-button-dl ..." href="...">…</a>
  const links = [...(json?.data ?? '').matchAll(/<a[^>]*class="[^"]*tik-button-dl[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((m) => {
    const tag = m[0];
    const href = tag.match(/href="([^"]+)"/)?.[1];
    return { href: href ? decodeHtml(href) : undefined, hd: /HD/.test(tag.replace(/<[^>]+>/g, ' ')) };
  });
  const url = (links.find((l) => l.hd && l.href) ?? links.find((l) => l.href))?.href;
  if (!url) throw new Error('Không lấy được link tải video TikTok');
  return url;
}

export async function fetchCapcutDownloadUrl(videoUrl: string): Promise<string> {
  const r = await fetch('https://3bic.com/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ url: videoUrl }).toString(),
  });
  const json = (await r.json().catch(() => null)) as { originalVideoUrl?: string } | null;
  if (!json?.originalVideoUrl) throw new Error('Không lấy được video CapCut');
  return `https://3bic.com${json.originalVideoUrl}`;
}

function extractFacebookVideoId(url: string): string | null {
  const patterns = [/\/reel\/(\d+)/, /\/videos\/(?:[^/]+\/)?(\d+)/, /[?&]v=(\d+)/, /\/video\.php\?v=(\d+)/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/** Link chia sẻ /share/v/..., /share/r/..., fb.watch → theo redirect để lấy link có video ID. */
async function resolveFacebookVideoId(url: string): Promise<string | null> {
  const direct = extractFacebookVideoId(url);
  if (direct) return direct;
  try {
    const r = await fetch(url, { method: 'GET' });
    const finalUrl = decodeURIComponent(r.url || '');
    return extractFacebookVideoId(finalUrl);
  } catch {
    return null;
  }
}

export async function fetchFacebookDownloadUrl(url: string, asyncToken: string, fbId: string): Promise<string> {
  const videoId = await resolveFacebookVideoId(url);
  if (!videoId) throw new Error('Không tìm thấy video ID Facebook');
  const raw = await exFetch<string>(
    `https://www.facebook.com/video/video_data_async/?video_id=${videoId}&fb_dtsg_ag=${encodeURIComponent(asyncToken)}&__user=${fbId}&__a=1`,
  );
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const payload = JSON.parse(text.replace(/^for \(;;\);/, ''))?.payload;
  if (!payload) throw new Error('Không tìm thấy dữ liệu video');
  const src = payload.hd_src || payload.sd_src;
  if (!src) throw new Error('Không tìm thấy link tải video');
  return src;
}

/** Lấy link tải trực tiếp → upload lên ad account (file_url) → đợi thumbnail. */
export async function uploadAdVideoFromLink(
  p: { adAccountId: string; token: string; url: string; asyncToken?: string | null; fbId: string },
): Promise<{ videoId: string; picture: string }> {
  const url = p.url.trim();
  const source = detectVideoLink(url);
  if (!source) throw new Error('Vui lòng nhập link TikTok, Facebook hoặc CapCut hợp lệ');

  let downloadUrl: string;
  if (source === 'tiktok') downloadUrl = await fetchTiktokDownloadUrl(url);
  else if (source === 'capcut') downloadUrl = await fetchCapcutDownloadUrl(url);
  else {
    if (!p.asyncToken) throw new Error('Phiên Facebook thiếu fb_dtsg_ag, hãy tải lại phiên');
    downloadUrl = await fetchFacebookDownloadUrl(url, p.asyncToken, p.fbId);
  }

  const res = await exFetch<{ id?: string; error?: { message?: string } }>(`${GRAPH}/v21.0/${p.adAccountId}/advideos`, {
    method: 'POST',
    body: { file_url: downloadUrl },
    params: { access_token: p.token },
    headers: { 'Content-Type': 'application/json' },
  }, 120000);
  if (!res?.id) throw new Error(res?.error?.message ?? 'Upload video thất bại');
  const picture = await waitVideoThumbnail(res.id, p.token);
  return { videoId: res.id, picture };
}
