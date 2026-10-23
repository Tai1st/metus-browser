// Kiểm tra bản cập nhật mới — đọc setting "APP_VERSION_METUS_BROWSER" từ backend
// Metus (giống cơ chế BANK_INFO/GUIDE_LINK đã có), không cần build/deploy app để
// đổi link tải, chỉ cần admin sửa giá trị setting trên server.
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { Api } from './api';

export interface VersionInfo {
  /** Phiên bản mới nhất, dạng "1.0.2". */
  version: string;
  /** Link tải APK bản mới (Android). */
  apkUrl: string;
  /** Link tải IPA/TestFlight bản mới (iOS). */
  iosUrl?: string;
  /** Ghi chú thay đổi (tuỳ chọn), hiển thị trong hộp thoại. */
  notes?: string;
}

/** Link tải đúng theo nền tảng hiện tại; fallback apkUrl nếu thiếu iosUrl. */
export function downloadUrlFor(info: VersionInfo): string {
  return Platform.OS === 'ios' ? (info.iosUrl || info.apkUrl) : info.apkUrl;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdate(): Promise<{ hasUpdate: boolean; info: VersionInfo } | null> {
  try {
    const info = await Api.getSetting<VersionInfo>('APP_VERSION_METUS_BROWSER');
    if (!info?.version || !info?.apkUrl) return null;
    const current = Application.nativeApplicationVersion ?? '0';
    return { hasUpdate: compareVersions(info.version, current) > 0, info };
  } catch {
    return null;
  }
}
