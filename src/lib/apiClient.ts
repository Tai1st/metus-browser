/** Logic thuần của màn API Client (tách riêng để unit test). */
import { bytesToBase64, type HttpMethod } from '@metus/http';

export const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const BODY_MODES = ['none', 'json', 'text', 'form', 'multipart', 'file'] as const;
export type BodyMode = (typeof BODY_MODES)[number];
export const AUTH_MODES = ['none', 'bearer', 'basic'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export interface ApiClientDraft {
  method: HttpMethod;
  url: string;
  params: string;
  headers: string;
  bodyMode: BodyMode;
  body: string;
  authMode: AuthMode;
  token: string;
  username: string;
  password: string;
  useAccount: boolean;
}

export const emptyDraft: ApiClientDraft = {
  method: 'GET',
  url: 'https://graph.facebook.com/me',
  params: '',
  headers: '',
  bodyMode: 'none',
  body: '',
  authMode: 'none',
  token: '',
  username: '',
  password: '',
  useAccount: false,
};

/** "key: value" hoặc "key=value", mỗi dòng một cặp; dòng bắt đầu bằng # bị bỏ qua. */
export function parsePairs(text: string, sep: ':' | '='): [string, string][] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf(sep);
      return i < 0 ? ([l, ''] as [string, string]) : ([l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string]);
    })
    .filter(([k]) => k.length > 0);
}

function utf8Base64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

export interface BuiltRequest {
  headers: Record<string, string>;
  params: Record<string, string>;
  body: unknown;
}

/**
 * Dựng headers/params/body từ form. `file` dùng cho mode "file" (body là file)
 * và "multipart" (dòng có giá trị "@file" sẽ đính kèm file đã chọn).
 */
export function buildRequest(d: ApiClientDraft, file: PickedFile | null, makeFileBody: (f: PickedFile) => unknown): BuiltRequest {
  const headers: Record<string, string> = {};
  for (const [k, v] of parsePairs(d.headers, ':')) headers[k] = v;
  const params: Record<string, string> = {};
  for (const [k, v] of parsePairs(d.params, '=')) params[k] = v;

  if (d.authMode === 'bearer' && d.token) headers.Authorization = `Bearer ${d.token}`;
  if (d.authMode === 'basic') headers.Authorization = `Basic ${utf8Base64(`${d.username}:${d.password}`)}`;

  const hasCT = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
  let body: unknown;
  switch (d.bodyMode) {
    case 'none':
      body = undefined;
      break;
    case 'json':
      body = d.body.trim() ? JSON.parse(d.body) : {};
      if (!hasCT) headers['Content-Type'] = 'application/json';
      break;
    case 'text':
      body = d.body;
      break;
    case 'form':
      body = new URLSearchParams(parsePairs(d.body, '='));
      break;
    case 'multipart': {
      const fd = new FormData();
      for (const [k, v] of parsePairs(d.body, '=')) {
        if (v === '@file') {
          if (!file) throw new Error(`Trường "${k}" cần file nhưng chưa chọn file`);
          fd.append(k, { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
        } else {
          fd.append(k, v);
        }
      }
      body = fd;
      break;
    }
    case 'file':
      if (!file) throw new Error('Chưa chọn file');
      body = makeFileBody(file);
      break;
  }
  return { headers, params, body };
}

export interface HistoryItem {
  at: number;
  draft: ApiClientDraft;
  status?: number;
  durationMs?: number;
}

/** Không lưu bí mật (token/mật khẩu) vào lịch sử. */
export function toHistory(d: ApiClientDraft, status?: number, durationMs?: number): HistoryItem {
  return { at: Date.now(), draft: { ...d, token: '', password: '' }, status, durationMs };
}

export function prettyBody(data: unknown): string {
  if (typeof data === 'string') {
    try {
      return JSON.stringify(JSON.parse(data.replace(/^for \(;;\);/, '')), null, 2);
    } catch {
      return data;
    }
  }
  if (data instanceof ArrayBuffer) return `<${data.byteLength} bytes nhị phân>`;
  return JSON.stringify(data, null, 2);
}
