import { fromNativeResponse, toNativeSpec } from './serialize';
import type {
  AccountInfo,
  AccountSummary,
  HttpPolicy,
  MetusHttpClient,
  MetusHttpRequest,
  MetusHttpResponse,
  NativeResponse,
} from './types';
import type { MetusHttpNative } from './MetusHttpModule';

export class MetusHttpError extends Error {
  readonly code: string;
  readonly request?: { url: string; method: string };

  constructor(code: string, message: string, request?: { url: string; method: string }) {
    super(message);
    this.name = 'MetusHttpError';
    this.code = code;
    this.request = request;
  }
}

let counter = 0;
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface MetusAccounts {
  /** Tài khoản dùng khi credentials = "include" mà không truyền `account`. */
  current(): string | undefined;
  setCurrent(id: string | undefined): void;
  list(): Promise<AccountSummary[]>;
  /** Lưu phiên đăng nhập hiện có trong WebView thành một tài khoản. */
  importFromWebView(domain?: string): Promise<{ id: string; iUser: string | null }>;
  importCookieString(cookie: string, domain?: string): Promise<{ id: string; iUser: string | null }>;
  /** Chỉ gọi từ hành động chủ động của người dùng (nút "Sao chép cookie"). */
  exportCookieString(id: string, domain?: string): Promise<string>;
  info(id: string): Promise<AccountInfo>;
  remove(id: string): Promise<void>;
  clearWebView(domain?: string): Promise<void>;
  applyToWebView(id: string, domain?: string): Promise<void>;
}

export interface Metus {
  http: MetusHttpClient & { configure(policy: HttpPolicy): void };
  accounts: MetusAccounts;
}

export function createMetus(native: MetusHttpNative): Metus {
  let currentAccount: string | undefined;

  async function request<T>(options: MetusHttpRequest): Promise<MetusHttpResponse<T>> {
    const method = options.method ?? 'GET';
    const reqInfo = { url: options.url, method };
    const credentials = options.credentials ?? (options.account ? 'include' : 'omit');
    const account = credentials === 'include' ? (options.account ?? currentAccount) : undefined;
    if (credentials === 'include' && !account) {
      throw new MetusHttpError('ERR_METUS_NO_ACCOUNT', 'Chưa chọn tài khoản để gửi cookie', reqInfo);
    }
    if (options.signal?.aborted) throw new MetusHttpError('ERR_METUS_CANCELLED', 'Request đã bị hủy', reqInfo);

    const id = newId();
    let spec;
    try {
      spec = toNativeSpec(id, options, account);
    } catch (e) {
      throw new MetusHttpError('ERR_METUS_BAD_REQUEST', (e as Error).message, reqInfo);
    }

    const onAbort = () => native.cancel(id);
    options.signal?.addEventListener('abort', onAbort);
    const sub = options.onUploadProgress
      ? native.addListener('onProgress', (e) => {
          if (e.id === id) options.onUploadProgress!(e.sent, e.total);
        })
      : undefined;
    try {
      const raw = await native.request(JSON.stringify(spec));
      const parsed = JSON.parse(raw) as NativeResponse;
      try {
        return fromNativeResponse<T>(parsed, options.responseType);
      } catch (e) {
        throw new MetusHttpError('ERR_METUS_PARSE', `Không parse được response: ${(e as Error).message}`, reqInfo);
      }
    } catch (e) {
      if (e instanceof MetusHttpError) throw e;
      const err = e as { code?: string; message?: string };
      throw new MetusHttpError(err.code ?? 'ERR_METUS_NETWORK', err.message ?? String(e), reqInfo);
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      sub?.remove();
    }
  }

  const http: Metus['http'] = {
    configure: (policy) => native.configure(JSON.stringify(policy)),
    request,
    get: (url, o) => request({ ...o, url, method: 'GET' }),
    delete: (url, o) => request({ ...o, url, method: 'DELETE' }),
    post: (url, body, o) => request({ ...o, url, body, method: 'POST' }),
    put: (url, body, o) => request({ ...o, url, body, method: 'PUT' }),
    patch: (url, body, o) => request({ ...o, url, body, method: 'PATCH' }),
  };

  const FB = 'facebook.com';
  const accounts: MetusAccounts = {
    current: () => currentAccount,
    setCurrent: (id) => {
      currentAccount = id;
    },
    list: () => native.listAccounts(),
    importFromWebView: (domain = FB) => native.importFromWebView(domain),
    importCookieString: (cookie, domain = FB) => native.importCookieString(cookie, domain),
    exportCookieString: (id, domain = FB) => native.exportCookieString(id, domain),
    info: (id) => native.accountInfo(id),
    remove: async (id) => {
      await native.removeAccount(id);
      if (currentAccount === id) currentAccount = undefined;
    },
    clearWebView: (domain = FB) => native.clearWebViewCookies(domain),
    applyToWebView: (id, domain = FB) => native.applyAccountToWebView(id, domain),
  };

  return { http, accounts };
}
