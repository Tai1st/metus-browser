import { base64ToBytes, bytesToBase64 } from '../src/base64';
import { buildUrl, fileBody, fromNativeResponse, serializeBody, toNativeSpec } from '../src/serialize';
import type { NativeResponse } from '../src/types';

const res = (over: Partial<NativeResponse>): NativeResponse => ({
  status: 200,
  statusText: 'OK',
  headers: [],
  url: 'https://www.facebook.com/',
  bodyType: 'text',
  body: '',
  durationMs: 1,
  redirects: 0,
  ...over,
});

describe('base64', () => {
  it('round-trips mọi độ dài', () => {
    for (let n = 0; n < 20; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
    expect(bytesToBase64(new TextEncoder().encode('Metus'))).toBe('TWV0dXM=');
  });
});

describe('buildUrl', () => {
  it('nối params giống axios, bỏ null/undefined', () => {
    expect(buildUrl('https://graph.facebook.com/me', { access_token: 'a b', skip: undefined, n: 1 })).toBe(
      'https://graph.facebook.com/me?access_token=a%20b&n=1',
    );
    expect(buildUrl('https://x.facebook.com/a?metuscors=0#h', { b: 'c' })).toBe('https://x.facebook.com/a?metuscors=0&b=c#h');
  });
});

describe('serializeBody', () => {
  it('object -> JSON mặc định', () => {
    expect(serializeBody({ message: 'Hello Metus' }, {})).toEqual({
      type: 'text',
      text: '{"message":"Hello Metus"}',
      contentType: 'application/json',
    });
  });

  it('object + x-www-form-urlencoded -> form', () => {
    expect(
      serializeBody({ fb_dtsg: 't', variables: { a: 1 }, skip: undefined }, { 'Content-Type': 'application/x-www-form-urlencoded' }),
    ).toEqual({ type: 'form', fields: [['fb_dtsg', 't'], ['variables', '{"a":1}']] });
  });

  it('string giữ nguyên, URLSearchParams -> form', () => {
    expect(serializeBody('a=1', { 'content-type': 'text/plain' })).toEqual({ type: 'text', text: 'a=1', contentType: 'text/plain' });
    expect(serializeBody(new URLSearchParams({ a: '1', b: '2' }), {})).toEqual({ type: 'form', fields: [['a', '1'], ['b', '2']] });
  });

  it('binary -> base64', () => {
    expect(serializeBody(new Uint8Array([1, 2, 3]), {})).toEqual({
      type: 'base64',
      data: 'AQID',
      contentType: 'application/octet-stream',
    });
  });

  it('fileBody -> file stream có offset', () => {
    expect(serializeBody(fileBody('file:///cache/v.mp4', { type: 'video/mp4', offset: 10, length: 5 }), {})).toEqual({
      type: 'file',
      uri: 'file:///cache/v.mp4',
      contentType: 'video/mp4',
      offset: 10,
      length: 5,
    });
  });

  it('FormData của RN -> multipart, file theo uri', () => {
    // FormData của React Native (Jest mặc định dùng FormData của Node).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RNFormData = require('react-native/Libraries/Network/FormData').default;
    const fd = new RNFormData();
    fd.append('__user', '123');
    fd.append('file', { uri: 'file:///cache/a.jpg', name: 'a.jpg', type: 'image/jpeg' } as unknown as Blob);
    const body = serializeBody(fd, {});
    expect(body).toEqual({
      type: 'multipart',
      parts: [
        { name: '__user', value: '123' },
        { name: 'file', uri: 'file:///cache/a.jpg', fileName: 'a.jpg', contentType: 'image/jpeg' },
      ],
    });
  });
});

describe('toNativeSpec', () => {
  it('map đầy đủ trường', () => {
    const spec = toNativeSpec(
      'id1',
      {
        url: 'https://api.facebook.com/data',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { message: 'Hello Metus' },
        timeout: 5000,
        responseType: 'arraybuffer',
        retry: { count: 2 },
        onUploadProgress: () => {},
      },
      '100',
    );
    expect(spec).toMatchObject({
      id: 'id1',
      method: 'POST',
      account: '100',
      timeoutMs: 5000,
      responseType: 'base64',
      followRedirects: true,
      retry: { count: 2, backoffMs: 500, nonIdempotent: false },
      reportProgress: true,
      headers: [['Content-Type', 'application/json']],
    });
  });
});

describe('fromNativeResponse', () => {
  it('auto: JSON theo content-type', () => {
    const r = fromNativeResponse(res({ headers: [['Content-Type', 'application/json']], body: '{"a":1}' }), undefined);
    expect(r.data).toEqual({ a: 1 });
    expect(r.headers['content-type']).toBe('application/json');
  });

  it('auto: bỏ tiền tố for (;;); của Facebook', () => {
    const r = fromNativeResponse(res({ headers: [['content-type', 'application/x-javascript']], body: 'for (;;);{"payload":1}' }), 'auto');
    expect(r.data).toEqual({ payload: 1 });
  });

  it('auto: HTML giữ là text', () => {
    expect(fromNativeResponse(res({ headers: [['content-type', 'text/html']], body: '<html>' }), 'auto').data).toBe('<html>');
  });

  it('text không parse, json bắt buộc parse', () => {
    expect(fromNativeResponse(res({ body: '{"a":1}' }), 'text').data).toBe('{"a":1}');
    expect(() => fromNativeResponse(res({ body: 'nope' }), 'json')).toThrow();
  });

  it('header trùng được gộp', () => {
    const r = fromNativeResponse(res({ headers: [['Vary', 'a'], ['vary', 'b']] }), 'text');
    expect(r.headers.vary).toBe('a, b');
  });

  it('base64 -> ArrayBuffer, file -> file:// uri', () => {
    const bin = fromNativeResponse<ArrayBuffer>(res({ bodyType: 'base64', body: 'AQID' }), 'arraybuffer');
    expect(Array.from(new Uint8Array(bin.data))).toEqual([1, 2, 3]);
    expect(fromNativeResponse(res({ bodyType: 'file', body: '/data/x.mp4' }), 'file').data).toBe('file:///data/x.mp4');
  });
});
