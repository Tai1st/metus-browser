export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * - "auto": JSON nếu Content-Type là JSON (hoặc parse được sau khi bỏ tiền tố
 *   `for (;;);` của Facebook), ngược lại là text. Giống exFetch cũ của extension.
 * - "file": lưu thẳng ra file trong cache của app, `data` là đường dẫn file://.
 */
export type ResponseType = 'auto' | 'json' | 'text' | 'arraybuffer' | 'file';

export interface ProxyConfig {
  type: 'http' | 'socks';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface RetryConfig {
  count: number;
  backoffMs?: number;
  /** Mặc định chỉ retry method idempotent (GET/HEAD/OPTIONS/PUT/DELETE). */
  nonIdempotent?: boolean;
}

export interface MetusHttpRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeout?: number;
  responseType?: ResponseType;
  /**
   * "include" = gửi cookie của tài khoản (`account`, hoặc tài khoản hiện tại).
   * Cookie không bao giờ đi qua JS — native tự gắn.
   */
  credentials?: 'omit' | 'include';
  /** Id tài khoản (c_user). Bỏ trống = tài khoản hiện tại khi credentials là "include". */
  account?: string;
  followRedirects?: boolean;
  proxy?: ProxyConfig;
  retry?: RetryConfig;
  signal?: AbortSignal;
  onUploadProgress?: (sent: number, total: number) => void;
  /** Tên file khi responseType = "file". */
  downloadFileName?: string;
}

export interface MetusHttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  url: string;
  durationMs: number;
  redirects: number;
}

export interface MetusHttpClient {
  request<T = unknown>(options: MetusHttpRequest): Promise<MetusHttpResponse<T>>;
  get<T = unknown>(url: string, options?: Partial<MetusHttpRequest>): Promise<MetusHttpResponse<T>>;
  post<T = unknown>(url: string, body?: unknown, options?: Partial<MetusHttpRequest>): Promise<MetusHttpResponse<T>>;
  put<T = unknown>(url: string, body?: unknown, options?: Partial<MetusHttpRequest>): Promise<MetusHttpResponse<T>>;
  patch<T = unknown>(url: string, body?: unknown, options?: Partial<MetusHttpRequest>): Promise<MetusHttpResponse<T>>;
  delete<T = unknown>(url: string, options?: Partial<MetusHttpRequest>): Promise<MetusHttpResponse<T>>;
}

export interface HttpPolicy {
  allowedHosts?: string[];
  allowHttp?: boolean;
  blockPrivateNetworks?: boolean;
  maxConcurrent?: number;
  maxQueued?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxDownloadBytes?: number;
  maxRedirects?: number;
}

export interface AccountSummary {
  id: string;
  hasSession: boolean;
  cookieCount: number;
}

export interface AccountInfo {
  id: string;
  cUser: string | null;
  iUser: string | null;
}

// ---------- Định dạng truyền xuống native (xem RequestSpec.kt / MetusHttpEngine.swift) ----------

export type NativeBody =
  | { type: 'none' }
  | { type: 'text'; text: string; contentType?: string }
  | { type: 'base64'; data: string; contentType?: string }
  | { type: 'form'; fields: [string, string][] }
  | { type: 'multipart'; parts: NativePart[] }
  | { type: 'file'; uri: string; contentType?: string; offset?: number; length?: number };

export type NativePart =
  | { name: string; value: string }
  | { name: string; uri: string; fileName: string; contentType?: string }
  | { name: string; base64: string; fileName: string; contentType?: string };

export interface NativeRequestSpec {
  id: string;
  url: string;
  method: HttpMethod;
  headers: [string, string][];
  body: NativeBody;
  account?: string;
  timeoutMs: number;
  followRedirects: boolean;
  responseType: 'text' | 'base64' | 'file';
  downloadFileName?: string;
  proxy?: ProxyConfig;
  retry?: { count: number; backoffMs: number; nonIdempotent: boolean };
  reportProgress: boolean;
}

export interface NativeResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  url: string;
  bodyType: 'text' | 'base64' | 'file';
  body: string;
  durationMs: number;
  redirects: number;
}
