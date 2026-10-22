/**
 * Đăng Reels hàng loạt — port từ metus-few:
 * - services/facebook/UpToReelsToken.ts (publishReelsPost: Graph API /{page}/videos, token của Page)
 * - services/facebook/UpToReels.ts (resolveTiktokLink: 1 video hoặc cả kênh TikTok qua tikmate.to)
 * - utils/commentHelper.ts (createCommentWithAccessToken)
 * Video từ link được tải về bộ nhớ đệm của app rồi đăng như file chọn từ máy.
 */
import * as FS from 'expo-file-system/legacy';

import { tr } from '../i18n';
import { spinContent } from '../spin';
import { instance } from './compat';
import type { LocalFile } from './Group';

const GRAPH = 'https://graph.facebook.com/v21.0';

const decodeHtml = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const stripTags = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

// ───────────────────────────── TikTok (tikmate.to) ─────────────────────────────

export interface TiktokVideo {
  title: string;
  downloadUrl: string;
  thumbnailUrl: string;
}

export type TiktokResolveResult =
  | ({ type: 'video' } & TiktokVideo)
  | { type: 'channel'; videos: TiktokVideo[]; nextCursor: string; hasMore: boolean };

async function tiktokAjaxSearch(q: string, cursor: string, page: number): Promise<{ data?: string; pageType?: string; next_cursor?: string }> {
  const r = await fetch('https://tikmate.to/api/ajaxSearch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q, cursor, page: String(page), lang: 'vi' }).toString(),
  });
  return r.json();
}

/** Thuộc tính `name` của thẻ HTML đầu tiên có class chứa `cls` trong đoạn `html`. */
function attrOfClass(html: string, cls: string, name: string): string {
  const tag = html.match(new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'i'))?.[0] ?? '';
  return decodeHtml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '');
}

/** Ảnh (img src) nằm trong phần tử có class `cls`. */
function imgInClass(html: string, cls: string): string {
  const i = html.search(new RegExp(`class="[^"]*\\b${cls}\\b`));
  if (i < 0) return '';
  return decodeHtml(html.slice(i, i + 1500).match(/<img[^>]*\bsrc="([^"]+)"/)?.[1] ?? '');
}

/** Link 1 video (pageType "detail") hoặc link kênh/profile (pageType "profile", có phân trang). */
export async function resolveTiktokLink(url: string, cursor = '0', page = 0): Promise<TiktokResolveResult> {
  const res = await tiktokAjaxSearch(url, cursor, page);
  const html = res?.data ?? '';

  if (res?.pageType === 'profile') {
    const videos = html
      .split(/class="[^"]*\bvideo-item\b[^"]*"/)
      .slice(1)
      .map((chunk) => ({
        title: stripTags(chunk.match(/class="[^"]*\btext-title\b[^"]*"[^>]*>([\s\S]*?)<\//)?.[1] ?? ''),
        downloadUrl: attrOfClass(chunk, 'pro-dl-link', 'href'),
        thumbnailUrl: imgInClass(chunk, 'pro-thumbnail'),
      }))
      .filter((v) => v.downloadUrl);
    // Nút "next" của phân trang còn bấm được (không có class disabled)
    const next = html.match(/class="[^"]*\bnext\b[^"]*"[^>]*>\s*<a[^>]*>/)?.[0] ?? '';
    const hasMore = !!next && !/disabled/.test(next);
    return { type: 'channel', videos, nextCursor: res?.next_cursor || cursor, hasMore };
  }

  const links = [...html.matchAll(/<a[^>]*class="[^"]*tik-button-dl[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((m) => ({
    href: decodeHtml(m[0].match(/href="([^"]+)"/)?.[1] ?? ''),
    hd: /HD/.test(stripTags(m[0])),
  }));
  const downloadUrl = (links.find((l) => l.hd && l.href) ?? links.find((l) => l.href))?.href;
  if (!downloadUrl) throw new Error(tr('reels.err.tiktok'));
  const title = stripTags(html.match(/class="[^"]*\bcontent\b[^"]*"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '');
  return { type: 'video', downloadUrl, title, thumbnailUrl: imgInClass(html, 'thumbnail') };
}

// ───────────────────────────── Tải video về máy ─────────────────────────────

/** Tải video từ URL trực tiếp về thư mục cache của app → file để đăng. */
export async function downloadVideo(url: string): Promise<LocalFile> {
  const name = `reel_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mp4`;
  const target = `${FS.cacheDirectory}${name}`;
  const r = await FS.downloadAsync(url, target);
  if (r.status < 200 || r.status >= 300) throw new Error(tr('reels.err.download', { status: r.status }));
  const info = await FS.getInfoAsync(r.uri);
  return { uri: r.uri, name, type: 'video/mp4', size: info.exists ? info.size : undefined };
}

// ───────────────────────────── Đăng Reels / bình luận ─────────────────────────────

export interface PublishReelParams {
  pageId: string;
  pageToken: string;
  file: LocalFile;
  description?: string;
  /** Hẹn giờ (unix giây) — đăng ở chế độ chưa công khai, Facebook tự đăng đúng giờ. */
  scheduledUnix?: number;
  /** Lưu nháp (không đăng). */
  draft?: boolean;
}

/** POST /{page}/videos (video_type=REELS) bằng token của Page → id video. */
export async function publishReel(p: PublishReelParams): Promise<string> {
  const form = new FormData();
  form.append('source', { uri: p.file.uri, name: p.file.name, type: p.file.type ?? 'video/mp4' } as unknown as Blob);
  form.append('description', p.description ?? '');
  form.append('video_type', 'REELS');
  if (p.scheduledUnix) {
    form.append('published', 'false');
    form.append('scheduled_publish_time', String(p.scheduledUnix));
  } else {
    form.append('published', p.draft ? 'false' : 'true');
  }
  const { data } = await instance.post<any>(`${GRAPH}/${p.pageId}/videos`, form, {
    params: { access_token: p.pageToken },
    timeout: 900_000,
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const json = typeof data === 'string' ? JSON.parse(data) : data;
  if (json?.error) throw new Error(json.error.message ?? tr('gp.err.facebook'));
  if (!json?.id) throw new Error(tr('reels.err.publish'));
  return String(json.id);
}

/** Bình luận vào bài bằng token của Page (createCommentWithAccessToken của metus-few). */
export async function commentWithToken(postId: string, token: string, message: string, photo?: LocalFile | null): Promise<void> {
  const form = new FormData();
  if (message) form.append('message', spinContent(message));
  if (photo) form.append('source', { uri: photo.uri, name: photo.name, type: photo.type ?? 'image/jpeg' } as unknown as Blob);
  const { data } = await instance.post<any>(`${GRAPH}/${postId}/comments`, form, {
    params: { access_token: token },
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const json = typeof data === 'string' ? JSON.parse(data) : data;
  if (json?.error) throw new Error(json.error.message ?? tr('gp.err.facebook'));
}
