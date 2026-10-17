// apiClient.ts nhập barrel @metus/http (kéo theo native module) — mock để chạy trên Node.
jest.mock('../src/MetusHttpModule', () => ({ __esModule: true, default: {} }));

import { buildRequest, emptyDraft, parsePairs, prettyBody, toHistory, type ApiClientDraft } from '../../../src/lib/apiClient';
import { fileBody } from '../src/serialize';

const make = (f: (d: ApiClientDraft) => void): ApiClientDraft => {
  const d = { ...emptyDraft };
  f(d);
  return d;
};

const makeFile = (f: { uri: string; mimeType?: string }) => fileBody(f.uri, { type: f.mimeType });

describe('parsePairs', () => {
  it('bỏ dòng trống/comment, tách theo sep', () => {
    expect(parsePairs('a: 1\n# bỏ\n\nb:2', ':')).toEqual([['a', '1'], ['b', '2']]);
    expect(parsePairs('x=1\ny=a=b', '=')).toEqual([['x', '1'], ['y', 'a=b']]);
  });
});

describe('buildRequest', () => {
  it('bearer + json tự thêm content-type', () => {
    const d = make((x) => { x.authMode = 'bearer'; x.token = 'T'; x.bodyMode = 'json'; x.body = '{"a":1}'; });
    const r = buildRequest(d, null, makeFile);
    expect(r.headers.Authorization).toBe('Bearer T');
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(r.body).toEqual({ a: 1 });
  });

  it('basic auth mã hóa base64 utf-8', () => {
    const d = make((x) => { x.authMode = 'basic'; x.username = 'u'; x.password = 'p'; });
    expect(buildRequest(d, null, makeFile).headers.Authorization).toBe('Basic dTpw');
  });

  it('json lỗi cú pháp -> ném lỗi', () => {
    const d = make((x) => { x.bodyMode = 'json'; x.body = '{bad'; });
    expect(() => buildRequest(d, null, makeFile)).toThrow();
  });

  it('multipart đính kèm file ở trường @file', () => {
    const d = make((x) => { x.bodyMode = 'multipart'; x.body = 'name=x\nfile=@file'; });
    const r = buildRequest(d, { uri: 'file:///c/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg' }, makeFile);
    expect(r.body).toBeInstanceOf(FormData);
  });

  it('multipart thiếu file -> lỗi rõ ràng', () => {
    const d = make((x) => { x.bodyMode = 'multipart'; x.body = 'file=@file'; });
    expect(() => buildRequest(d, null, makeFile)).toThrow(/cần file/);
  });

  it('body file -> fileBody', () => {
    const d = make((x) => { x.bodyMode = 'file'; });
    const r = buildRequest(d, { uri: 'file:///c/v.mp4', name: 'v.mp4', mimeType: 'video/mp4' }, makeFile);
    expect(r.body).toMatchObject({ uri: 'file:///c/v.mp4' });
  });

  it('params tách riêng khỏi headers', () => {
    const d = make((x) => { x.params = 'access_token=abc\nlimit=10'; x.headers = 'X-Test: 1'; });
    const r = buildRequest(d, null, makeFile);
    expect(r.params).toEqual({ access_token: 'abc', limit: '10' });
    expect(r.headers).toEqual({ 'X-Test': '1' });
  });
});

describe('toHistory', () => {
  it('không lưu token/mật khẩu', () => {
    const d = make((x) => { x.token = 'secret'; x.password = 'pw'; });
    const h = toHistory(d, 200, 12);
    expect(h.draft.token).toBe('');
    expect(h.draft.password).toBe('');
    expect(h.status).toBe(200);
  });
});

describe('prettyBody', () => {
  it('format JSON và bỏ tiền tố for(;;);', () => {
    expect(prettyBody('for (;;);{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyBody('<html>')).toBe('<html>');
    expect(prettyBody(new ArrayBuffer(8))).toBe('<8 bytes nhị phân>');
  });
});
