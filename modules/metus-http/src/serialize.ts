import { base64ToBytes, bytesToBase64 } from './base64';
import type {
  MetusHttpRequest,
  MetusHttpResponse,
  NativeBody,
  NativePart,
  NativeRequestSpec,
  NativeResponse,
} from './types';

const FILE_TAG = '__metusFile';

/** Body là một file trên máy (ví dụ từ expo-document-picker), upload dạng stream. */
export interface MetusFileBody {
  [FILE_TAG]: true;
  uri: string;
  type?: string;
  offset?: number;
  length?: number;
}

export function fileBody(uri: string, opts: { type?: string; offset?: number; length?: number } = {}): MetusFileBody {
  return { [FILE_TAG]: true, uri, ...opts };
}

function isFileBody(v: unknown): v is MetusFileBody {
  return typeof v === 'object' && v !== null && (v as Record<string, unknown>)[FILE_TAG] === true;
}

/** File trong FormData của React Native: { uri, name, type }. */
interface RNFilePart {
  uri: string;
  name?: string;
  type?: string;
}

function isRNFile(v: unknown): v is RNFilePart {
  return typeof v === 'object' && v !== null && typeof (v as RNFilePart).uri === 'string';
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

/** FormData của RN có getParts(); FormData chuẩn có entries(). */
function formDataParts(fd: unknown): NativePart[] | null {
  const anyFd = fd as {
    getParts?: () => { fieldName: string; string?: string; uri?: string; name?: string; type?: string }[];
    entries?: () => Iterable<[string, unknown]>;
  };
  if (typeof fd === 'object' && fd !== null && typeof anyFd.getParts === 'function') {
    return anyFd.getParts().map((p) =>
      typeof p.uri === 'string'
        ? { name: p.fieldName, uri: p.uri, fileName: p.name ?? 'file', contentType: p.type }
        : { name: p.fieldName, value: String(p.string ?? '') },
    );
  }
  if (typeof FormData !== 'undefined' && fd instanceof FormData && typeof anyFd.entries === 'function') {
    const parts: NativePart[] = [];
    for (const [name, value] of anyFd.entries()) {
      if (typeof value === 'string') parts.push({ name, value });
      else if (isRNFile(value)) parts.push({ name, uri: value.uri, fileName: value.name ?? 'file', contentType: value.type });
      else throw new TypeError(`FormData field "${name}": Blob/File của trình duyệt không hỗ trợ — dùng { uri, name, type }`);
    }
    return parts;
  }
  return null;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

export function serializeBody(body: unknown, headers: Record<string, string>): NativeBody {
  if (body === undefined || body === null) return { type: 'none' };
  const ct = findHeader(headers, 'content-type');
  if (typeof body === 'string') return { type: 'text', text: body, contentType: ct };
  if (isFileBody(body)) {
    return { type: 'file', uri: body.uri, contentType: ct ?? body.type, offset: body.offset, length: body.length };
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return { type: 'form', fields: Array.from(body.entries()) };
  }
  const parts = formDataParts(body);
  if (parts) return { type: 'multipart', parts };
  const bytes = toBytes(body);
  if (bytes) return { type: 'base64', data: bytesToBase64(bytes), contentType: ct ?? 'application/octet-stream' };
  if (typeof body === 'object') {
    if (ct && ct.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      const fields = Object.entries(body as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string]);
      return { type: 'form', fields };
    }
    return { type: 'text', text: JSON.stringify(body), contentType: ct ?? 'application/json' };
  }
  return { type: 'text', text: String(body), contentType: ct };
}

export function buildUrl(url: string, params?: MetusHttpRequest['params']): string {
  if (!params) return url;
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return url;
  const [base, hash] = url.split('#', 2);
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${sep}${qs}${hash !== undefined ? `#${hash}` : ''}`;
}

export function toNativeSpec(id: string, req: MetusHttpRequest, account: string | undefined): NativeRequestSpec {
  const headers = { ...(req.headers ?? {}) };
  const rt = req.responseType ?? 'auto';
  return {
    id,
    url: buildUrl(req.url, req.params),
    method: req.method ?? 'GET',
    headers: Object.entries(headers),
    body: serializeBody(req.body, headers),
    account,
    timeoutMs: req.timeout ?? 30_000,
    followRedirects: req.followRedirects ?? true,
    responseType: rt === 'arraybuffer' ? 'base64' : rt === 'file' ? 'file' : 'text',
    downloadFileName: req.downloadFileName,
    proxy: req.proxy,
    retry: req.retry
      ? { count: req.retry.count, backoffMs: req.retry.backoffMs ?? 500, nonIdempotent: req.retry.nonIdempotent ?? false }
      : undefined,
    reportProgress: typeof req.onUploadProgress === 'function',
  };
}

/** Facebook chèn tiền tố chống XSSI "for (;;);" trước JSON. */
export function stripXssi(text: string): string {
  return text.startsWith('for (;;);') ? text.slice(9) : text;
}

export function fromNativeResponse<T>(raw: NativeResponse, responseType: MetusHttpRequest['responseType']): MetusHttpResponse<T> {
  const headers: Record<string, string> = {};
  for (const [k, v] of raw.headers) {
    const key = k.toLowerCase();
    headers[key] = headers[key] === undefined ? v : `${headers[key]}, ${v}`;
  }
  const rt = responseType ?? 'auto';
  let data: unknown;
  if (raw.bodyType === 'file') {
    data = raw.body.startsWith('file://') ? raw.body : `file://${raw.body}`;
  } else if (raw.bodyType === 'base64') {
    const bytes = base64ToBytes(raw.body);
    data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } else if (rt === 'text') {
    data = raw.body;
  } else if (rt === 'json') {
    data = raw.body === '' ? null : JSON.parse(stripXssi(raw.body));
  } else {
    const isJson = /[/+]json\b/i.test(headers['content-type'] ?? '');
    const stripped = stripXssi(raw.body);
    if (isJson || stripped !== raw.body) {
      try {
        data = JSON.parse(stripped);
      } catch {
        data = raw.body;
      }
    } else {
      data = raw.body;
    }
  }
  return {
    status: raw.status,
    statusText: raw.statusText,
    headers,
    data: data as T,
    url: raw.url,
    durationMs: raw.durationMs,
    redirects: raw.redirects,
  };
}
