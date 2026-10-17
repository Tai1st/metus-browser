import { createMetus, MetusHttpError } from '../src/client';
import type { MetusHttpNative } from '../src/MetusHttpModule';
import type { NativeRequestSpec } from '../src/types';

type Listener = (e: { id: string; sent: number; total: number }) => void;

function fakeNative(handler: (spec: NativeRequestSpec) => Promise<unknown>) {
  const listeners = new Set<Listener>();
  const cancelled: string[] = [];
  const native = {
    configure: jest.fn(),
    request: jest.fn(async (json: string) => JSON.stringify(await handler(JSON.parse(json)))),
    cancel: jest.fn((id: string) => cancelled.push(id)),
    addListener: jest.fn((_: string, l: Listener) => {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    }),
    listAccounts: jest.fn(async () => []),
    importFromWebView: jest.fn(async () => ({ id: '100', iUser: null })),
    importCookieString: jest.fn(async () => ({ id: '100', iUser: null })),
    exportCookieString: jest.fn(async () => 'c_user=100'),
    accountInfo: jest.fn(async (id: string) => ({ id, cUser: id, iUser: null })),
    removeAccount: jest.fn(async () => {}),
    clearWebViewCookies: jest.fn(async () => {}),
    applyAccountToWebView: jest.fn(async () => {}),
  };
  return { native: native as unknown as MetusHttpNative, raw: native, listeners, cancelled };
}

const ok = (body: string, headers: [string, string][] = []) => ({
  status: 200,
  statusText: 'OK',
  headers,
  url: 'https://www.facebook.com/',
  bodyType: 'text',
  body,
  durationMs: 3,
  redirects: 0,
});

describe('Metus.http', () => {
  it('request() trả Promise với status/headers/data', async () => {
    const { native } = fakeNative(async () => ok('{"ok":true}', [['Content-Type', 'application/json']]));
    const Metus = createMetus(native);
    const r = await Metus.http.request<{ ok: boolean }>({
      url: 'https://api.facebook.com/data',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { message: 'Hello Metus' },
      timeout: 30000,
    });
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
  });

  it('get/post đặt đúng method và body', async () => {
    const seen: NativeRequestSpec[] = [];
    const { native } = fakeNative(async (s) => {
      seen.push(s);
      return ok('');
    });
    const Metus = createMetus(native);
    await Metus.http.get('https://www.facebook.com/a', { params: { q: 1 } });
    await Metus.http.post('https://www.facebook.com/b', 'x=1', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(seen[0]).toMatchObject({ method: 'GET', url: 'https://www.facebook.com/a?q=1', body: { type: 'none' } });
    expect(seen[1]).toMatchObject({ method: 'POST', body: { type: 'text', text: 'x=1' } });
  });

  it('credentials: omit mặc định -> không gửi account', async () => {
    const seen: NativeRequestSpec[] = [];
    const { native } = fakeNative(async (s) => (seen.push(s), ok('')));
    const Metus = createMetus(native);
    Metus.accounts.setCurrent('100');
    await Metus.http.get('https://www.facebook.com/');
    expect(seen[0].account).toBeUndefined();
  });

  it('credentials: include dùng tài khoản hiện tại hoặc account chỉ định', async () => {
    const seen: NativeRequestSpec[] = [];
    const { native } = fakeNative(async (s) => (seen.push(s), ok('')));
    const Metus = createMetus(native);
    Metus.accounts.setCurrent('100');
    await Metus.http.get('https://www.facebook.com/', { credentials: 'include' });
    await Metus.http.get('https://www.facebook.com/', { account: '200' });
    expect(seen.map((s) => s.account)).toEqual(['100', '200']);
  });

  it('credentials: include khi chưa có tài khoản -> lỗi, không gọi native', async () => {
    const { native, raw } = fakeNative(async () => ok(''));
    const Metus = createMetus(native);
    await expect(Metus.http.get('https://www.facebook.com/', { credentials: 'include' })).rejects.toMatchObject({
      code: 'ERR_METUS_NO_ACCOUNT',
    });
    expect(raw.request).not.toHaveBeenCalled();
  });

  it('lỗi native giữ nguyên mã lỗi', async () => {
    const { native } = fakeNative(async () => {
      throw Object.assign(new Error('Host không nằm trong allowlist'), { code: 'ERR_METUS_BLOCKED_HOST' });
    });
    const Metus = createMetus(native);
    const err = await Metus.http.get('https://evil.example/').catch((e) => e);
    expect(err).toBeInstanceOf(MetusHttpError);
    expect(err.code).toBe('ERR_METUS_BLOCKED_HOST');
    expect(err.request).toEqual({ url: 'https://evil.example/', method: 'GET' });
  });

  it('AbortSignal gọi native.cancel với đúng id', async () => {
    let release!: () => void;
    const { native, cancelled } = fakeNative(
      (s) =>
        new Promise((_, reject) => {
          release = () => reject(Object.assign(new Error('cancel'), { code: 'ERR_METUS_CANCELLED', id: s.id }));
        }),
    );
    const Metus = createMetus(native);
    const ctrl = new AbortController();
    const p = Metus.http.get('https://www.facebook.com/', { signal: ctrl.signal });
    await Promise.resolve();
    ctrl.abort();
    release();
    await expect(p).rejects.toMatchObject({ code: 'ERR_METUS_CANCELLED' });
    expect(cancelled).toHaveLength(1);
  });

  it('signal đã abort -> không gửi', async () => {
    const { native, raw } = fakeNative(async () => ok(''));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(createMetus(native).http.get('https://www.facebook.com/', { signal: ctrl.signal })).rejects.toMatchObject({
      code: 'ERR_METUS_CANCELLED',
    });
    expect(raw.request).not.toHaveBeenCalled();
  });

  it('onUploadProgress chỉ nhận sự kiện của request mình và gỡ listener sau đó', async () => {
    const { native, listeners } = fakeNative(async (s) => {
      listeners.forEach((l) => l({ id: 'other', sent: 1, total: 9 }));
      listeners.forEach((l) => l({ id: s.id, sent: 5, total: 10 }));
      return ok('');
    });
    const progress: number[][] = [];
    await createMetus(native).http.post('https://upload.facebook.com/x', 'data', {
      onUploadProgress: (sent, total) => progress.push([sent, total]),
    });
    expect(progress).toEqual([[5, 10]]);
    expect(listeners.size).toBe(0);
  });

  it('chạy song song nhiều request với id khác nhau', async () => {
    const ids = new Set<string>();
    const { native } = fakeNative(async (s) => (ids.add(s.id), ok(s.url)));
    const Metus = createMetus(native);
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => Metus.http.get<string>(`https://www.facebook.com/${i}`, { responseType: 'text' })),
    );
    expect(results.map((r) => r.data)).toEqual(Array.from({ length: 25 }, (_, i) => `https://www.facebook.com/${i}`));
    expect(ids.size).toBe(25);
  });
});

describe('Metus.accounts', () => {
  it('remove tài khoản hiện tại thì bỏ chọn', async () => {
    const { native } = fakeNative(async () => ok(''));
    const Metus = createMetus(native);
    Metus.accounts.setCurrent('100');
    await Metus.accounts.remove('100');
    expect(Metus.accounts.current()).toBeUndefined();
  });

  it('mặc định domain facebook.com', async () => {
    const { native, raw } = fakeNative(async () => ok(''));
    await createMetus(native).accounts.importFromWebView();
    expect(raw.importFromWebView).toHaveBeenCalledWith('facebook.com');
  });
});
