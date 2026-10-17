// Native HTTP không có trên web: mọi lời gọi đều báo lỗi rõ ràng thay vì
// lặng lẽ rơi về fetch() (fetch sẽ dính CORS và không có cookie jar).
const unsupported = () => {
  const e = new Error('Metus native HTTP chỉ chạy trên Android/iOS') as Error & { code: string };
  e.code = 'ERR_METUS_UNSUPPORTED';
  throw e;
};

const MetusHttpWeb = {
  configure: () => {},
  request: async () => unsupported(),
  cancel: () => {},
  listAccounts: async () => [],
  importFromWebView: async () => unsupported(),
  importCookieString: async () => unsupported(),
  exportCookieString: async () => unsupported(),
  accountInfo: async () => unsupported(),
  removeAccount: async () => {},
  clearWebViewCookies: async () => {},
  applyAccountToWebView: async () => unsupported(),
  addListener: () => ({ remove: () => {} }),
};

export default MetusHttpWeb;
