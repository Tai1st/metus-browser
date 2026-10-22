# Metus Browser (app)

Ứng dụng Android + iOS (Expo / React Native) chạy các công cụ Facebook của
metus-few bằng **HTTP client native**, không cần extension, không dính CORS.

Request đi thẳng từ máy (OkHttp trên Android, URLSession trên iOS) nên:

- Không bị CORS của trình duyệt — đặt được `Origin`, `Referer`, `Sec-Fetch-*`, `User-Agent` tùy ý.
- Cookie đăng nhập Facebook nằm trong cookie jar **riêng từng tài khoản**, lưu mã hóa (Android Keystore / iOS Keychain). Cookie **không** lộ ra JavaScript trừ khi người dùng chủ động bấm "Sao chép cookie".
- JavaScript gọi qua API `Metus.http.request()` / `Metus.accounts.*`.

## Yêu cầu

- Node 20+, và một trong hai: Android Studio / Android SDK (build Android) hoặc EAS + tài khoản Apple (build iOS).
- Android SDK cần: platform `android-36`, build-tools `36.0.0`, NDK `27.1.12297006` (giống React Native 0.86).

## Cài đặt

```bash
npm install
```

Tạo `.env` từ file mẫu rồi điền giá trị (`.env` **không** commit lên git):

```bash
cp .env.example .env
```

| Biến | Ý nghĩa |
|---|---|
| `EXPO_PUBLIC_BACKEND_API_URL`, `EXPO_PUBLIC_APP_URL` | Địa chỉ backend / web Metus |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | OAuth Web client của Firebase project (đăng nhập Google) |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Web API key của Firebase project |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | OAuth iOS client (chỉ cần khi build iOS) |

Sau khi sửa `.env` phải khởi động lại Metro (`npx expo start --clear`) vì biến `EXPO_PUBLIC_*` chỉ được đọc lúc khởi động.

## Chạy dev (development build — BẮT BUỘC, không dùng Expo Go)

Module native `modules/metus-http` không có trong Expo Go, nên phải tạo dev build:

```bash
# Android (máy Windows/Linux/Mac đều được)
npx expo run:android

# iOS (chỉ trên macOS, hoặc dùng EAS)
npx expo run:ios
```

## Build APK / app store

```bash
# Build cloud bằng EAS (không cần Xcode/Android Studio cục bộ)
npx eas-cli@latest build --platform android --profile preview   # APK cài tay
npx eas-cli@latest build --platform ios --profile preview       # cần Apple Developer
```

> Lưu ý phát hành: app tự động hóa tài khoản Facebook + xử lý cookie bên thứ ba
> dễ bị Apple App Store / Google Play từ chối. Thực tế nên phát hành qua APK
> (Android) và TestFlight / Ad-hoc / Enterprise (iOS).

## Kiểm thử

```bash
npm test            # JS SDK: serialize, client, apiClient (Jest)
npm run typecheck   # tsc --noEmit
# Engine native (Kotlin, OkHttp + MockWebServer):
cd android && ./gradlew :metus-http:testDebugUnitTest
```

## Kiến trúc

```
modules/metus-http/            # Native HTTP engine (local Expo module)
  android/.../core/            # Kotlin: HttpEngine, HttpPolicy, AccountCookieJar, RequestSpec
  android/.../android/         # AccountStore (Keystore), AndroidFileAccess, WebViewCookies
  android/.../MetusHttpModule.kt
  android/src/test/            # Unit test JVM (MockWebServer)
  ios/                         # Swift: MetusHttpEngine (URLSession), MetusCookieJar, Keychain store
  src/                         # SDK TypeScript: client, serialize, types, base64
  __tests__/                   # Jest

src/
  app/                         # Màn hình (expo-router)
    login, index, accounts, fb-login, browser, api-client
    tools/auto-join-fb-group, tools/group-extractor-by-uid
  lib/
    config, storage, device, api, auth
    fb/compat.ts               # exFetch() + instance (axios-like) chạy trên native HTTP
    fb/session, fb/accounts, fb/AutoJoinFbGroup, fb/GroupExtractorByUid
  components/ui.tsx, components/tool.tsx
```

## JavaScript SDK

```ts
import { Metus } from '@metus/http';

// Cấu hình chính sách (allowlist host, chặn IP nội bộ…)
Metus.http.configure({ allowedHosts: ['facebook.com', 'metus.vn'], blockPrivateNetworks: true });

// Request như Postman, có cookie của tài khoản FB đang chọn
const res = await Metus.http.request({
  url: 'https://graph.facebook.com/me',
  method: 'GET',
  credentials: 'include',   // dùng cookie jar của tài khoản
});
console.log(res.status, res.headers, res.data);

// Tài khoản
await Metus.accounts.importFromWebView();   // lưu phiên đăng nhập trong WebView
const list = await Metus.accounts.list();   // [{ id, hasSession, cookieCount }]
```

## Bảo mật

- Allowlist host + chặn SSRF (localhost / IP private / CGNAT / link-local), kiểm tra cả sau khi phân giải DNS.
- TLS luôn được kiểm tra — không có tùy chọn bỏ qua chứng chỉ.
- Giới hạn số request đồng thời, kích thước request/response/download.
- Cookie của tài khoản không đi vào log, không trả về JS tự động.
- WebView (đăng nhập / trình duyệt) **không** được cấp bridge vào native HTTP.

## Còn lại (đợt sau)

- Port tiếp các tool còn lại của metus-few (page/profile, upload reel/story…).
- Màn `metus://api-client` đã có sẵn trong app (tab API Client).
- iOS: kiểm chứng proxy (cần iOS 17+) và upload nền cho video lớn.
