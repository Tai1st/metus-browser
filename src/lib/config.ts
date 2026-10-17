import { Metus } from '@metus/http';

export const Config = {
  API_URL: process.env.EXPO_PUBLIC_BACKEND_API_URL ?? 'https://api.metus.vn/api',
  APP_URL: process.env.EXPO_PUBLIC_APP_URL ?? 'https://metus.vn',
};

/**
 * Chính sách mạng cho toàn app. Chỉ các host dưới đây gọi được qua native
 * HTTP; mọi host khác (kể cả localhost/IP nội bộ) bị chặn ở native.
 */
export function configureNetwork() {
  Metus.http.configure({
    allowedHosts: ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'instagram.com', 'tiktok.com', 'metus.vn'],
    allowHttp: false,
    // Khi dev chạy qua proxy loopback (USB reverse-tether), không chặn loopback.
    // Bản release luôn chặn địa chỉ nội bộ.
    blockPrivateNetworks: !__DEV__,
    maxConcurrent: 6,
  });
}
