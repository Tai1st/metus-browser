/**
 * Lớp tương thích để port service từ metus-few gần như nguyên văn:
 * - `exFetch()` thay cho cầu nối EX_FETCH của extension.
 * - `instance` (giống axios) thay cho axios instance gắn cookie qua DNR.
 *
 * Cả hai chạy bằng Metus native HTTP với cookie jar của tài khoản FB hiện
 * tại — không còn CORS, rule DNR hay chuỗi cookie trong JS.
 */
import { Metus, type MetusHttpResponse } from '@metus/http';

/**
 * Facebook trả HTML/token khác nhau tùy User-Agent. Extension cũ set UA qua
 * DNR; bản native phải tự gắn UA trình duyệt, nếu không FB coi như client lạ
 * và không trả trang đã đăng nhập (mất DTSGInitData -> tưởng hết phiên).
 */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const DEFAULT_FB_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="129", "Not=A?Brand";v="8", "Google Chrome";v="129"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

/** Gộp header mặc định, KHÔNG ghi đè header do caller truyền (so sánh không phân biệt hoa thường). */
function withDefaults(headers?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_FB_HEADERS };
  const lower = new Set(Object.keys(out).map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(headers ?? {})) {
    // bỏ default nếu caller đã có header cùng tên
    for (const dk of Object.keys(out)) {
      if (dk.toLowerCase() === k.toLowerCase()) delete out[dk];
    }
    out[k] = v;
    lower.add(k.toLowerCase());
  }
  return out;
}

export type ExFetchRequest = {
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  params?: any;
};

/** Giống background của extension: JSON nếu content-type là JSON, ngược lại text. */
function parseLikeFetch(res: MetusHttpResponse<string>): any {
  const ct = res.headers['content-type'] ?? '';
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(res.data);
    } catch {
      return res.data;
    }
  }
  return res.data;
}

export async function exFetch<T = any>(input: string, config?: ExFetchRequest, timeoutMs = 20000): Promise<T> {
  const res = await Metus.http.request<string>({
    url: input,
    method: config?.method ?? 'GET',
    headers: withDefaults(config?.headers),
    params: config?.params,
    body: config?.body,
    timeout: timeoutMs,
    responseType: 'text',
    credentials: 'include',
  });
  return parseLikeFetch(res) as T;
}

export interface AxiosLikeConfig {
  headers?: Record<string, string>;
  params?: Record<string, any>;
  responseType?: 'json' | 'text' | 'arraybuffer';
  transformResponse?: (raw: any) => any;
  timeout?: number;
  signal?: AbortSignal;
  onUploadProgress?: (e: { loaded: number; total: number }) => void;
  /** Hành động dưới danh nghĩa Page (cookie i_user=<pageId> cho riêng request). */
  iUser?: string;
}

export interface AxiosLikeResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

/** Lỗi giống axios: status ngoài 2xx -> reject kèm `response`. */
export class HttpStatusError extends Error {
  constructor(public response: AxiosLikeResponse) {
    super(`Request failed with status code ${response.status}`);
    this.name = 'AxiosError';
  }
}

async function axiosRequest<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, body: unknown, config: AxiosLikeConfig = {}) {
  const res = await Metus.http.request<string | ArrayBuffer>({
    url,
    method,
    body,
    headers: withDefaults(config.headers),
    params: config.params,
    timeout: config.timeout ?? 120_000,
    signal: config.signal,
    responseType: config.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
    credentials: 'include',
    iUser: config.iUser,
    onUploadProgress: config.onUploadProgress
      ? (sent, total) => config.onUploadProgress!({ loaded: sent, total })
      : undefined,
  });

  let data: any = res.data;
  if (config.transformResponse) {
    data = config.transformResponse(data);
  } else if (config.responseType !== 'text' && config.responseType !== 'arraybuffer' && typeof data === 'string') {
    // axios mặc định: thử JSON.parse, không được thì giữ chuỗi (không bỏ "for (;;);").
    try {
      data = JSON.parse(data);
    } catch {
      // giữ text
    }
  }
  const out: AxiosLikeResponse<T> = { data, status: res.status, statusText: res.statusText, headers: res.headers };
  if (res.status < 200 || res.status >= 300) throw new HttpStatusError(out);
  return out;
}

export const instance = {
  get: <T = any>(url: string, config?: AxiosLikeConfig) => axiosRequest<T>('GET', url, undefined, config),
  delete: <T = any>(url: string, config?: AxiosLikeConfig) => axiosRequest<T>('DELETE', url, undefined, config),
  post: <T = any>(url: string, data?: unknown, config?: AxiosLikeConfig) => axiosRequest<T>('POST', url, data, config),
  put: <T = any>(url: string, data?: unknown, config?: AxiosLikeConfig) => axiosRequest<T>('PUT', url, data, config),
  patch: <T = any>(url: string, data?: unknown, config?: AxiosLikeConfig) => axiosRequest<T>('PATCH', url, data, config),
};

export type AxiosLikeInstance = typeof instance;

export function getErrorMessage(e: unknown): string {
  if (e instanceof HttpStatusError) return `HTTP ${e.response.status}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
