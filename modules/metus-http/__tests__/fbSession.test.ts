// session.ts nhập compat -> barrel @metus/http (native). Mock để chạy trên Node.
jest.mock('../src/MetusHttpModule', () => ({ __esModule: true, default: {} }));

import { isSessionValid, parseSession } from '../../../src/lib/fb/session';

const ID = '100087888353276';

describe('parseSession', () => {
  it('lấy dtsg + UID + tên từ CurrentUserInitialData', () => {
    const html = `x["DTSGInitData",[],{"token":"AbC:123","async_get_token":"xyz"},99] ["CurrentUserInitialData",[],{"USER_ID":"${ID}","NAME":"Quốc Tài"},0]`;
    const s = parseSession(html);
    expect(s.dtsg).toBe('AbC:123');
    expect(s.account).toEqual({ id: ID, name: 'Quốc Tài', picture: expect.stringContaining(ID) });
  });

  it('nhận UID từ actorID khi không có CurrentUserInitialData', () => {
    const s = parseSession(`..."actorID":"${ID}"...`);
    expect(s.account?.id).toBe(ID);
    expect(s.account?.name).toBe('');
  });

  it('trang đăng xuất: không dtsg, không UID', () => {
    const s = parseSession('<form action="/login">...USER_ID":"0"...</form>');
    expect(s.dtsg).toBeNull();
    expect(s.account).toBeNull();
  });
});

describe('isSessionValid', () => {
  it('UID khớp -> hợp lệ', () => {
    expect(isSessionValid({ dtsg: null, asyncToken: null, account: { id: ID, name: '', picture: '' } }, ID)).toBe(true);
  });

  it('có dtsg nhưng markup lạ (không UID) -> vẫn hợp lệ', () => {
    expect(isSessionValid({ dtsg: 'tok', asyncToken: null, account: null }, ID)).toBe(true);
  });

  it('có dtsg nhưng UID là tài khoản khác -> KHÔNG hợp lệ', () => {
    expect(isSessionValid({ dtsg: 'tok', asyncToken: null, account: { id: '999', name: '', picture: '' } }, ID)).toBe(false);
  });

  it('không dtsg, không account -> hết phiên', () => {
    expect(isSessionValid({ dtsg: null, asyncToken: null, account: null }, ID)).toBe(false);
  });
});
