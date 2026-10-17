import { NativeModule, requireNativeModule } from 'expo';

import type { AccountInfo, AccountSummary } from './types';

export type MetusHttpModuleEvents = {
  onProgress: (e: { id: string; sent: number; total: number }) => void;
};

declare class MetusHttpNative extends NativeModule<MetusHttpModuleEvents> {
  configure(policyJson: string): void;
  request(specJson: string): Promise<string>;
  cancel(id: string): void;

  listAccounts(): Promise<AccountSummary[]>;
  importFromWebView(domain: string): Promise<{ id: string; iUser: string | null }>;
  importCookieString(cookie: string, domain: string): Promise<{ id: string; iUser: string | null }>;
  exportCookieString(id: string, domain: string): Promise<string>;
  accountInfo(id: string): Promise<AccountInfo>;
  removeAccount(id: string): Promise<void>;
  clearWebViewCookies(domain: string): Promise<void>;
  applyAccountToWebView(id: string, domain: string): Promise<void>;
}

export type { MetusHttpNative };

export default requireNativeModule<MetusHttpNative>('MetusHttp');
