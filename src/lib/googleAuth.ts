import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

/**
 * Đăng nhập Google native → Firebase idToken (cùng project Firebase với metus-few:
 * metus-3875b). Backend `/auth/login/social` nhận Firebase idToken, nên idToken của
 * Google được đổi qua Identity Toolkit REST (thay cho signInWithPopup trên web).
 */
/** Web API key của project Firebase — đặt trong .env (không commit), xem .env.example. */
const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '';

/** OAuth "Web client" của project Firebase (Firebase console → Authentication → Google). */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/** OAuth "iOS client" (CLIENT_ID trong GoogleService-Info.plist) — chỉ cần cho bản iOS. */
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

export class GoogleCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

let configured = false;

export async function getGoogleFirebaseIdToken(): Promise<string> {
  if (!WEB_CLIENT_ID) throw new Error('Chưa cấu hình EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  if (!FIREBASE_API_KEY) throw new Error('Chưa cấu hình EXPO_PUBLIC_FIREBASE_API_KEY');
  if (!configured) {
    if (Platform.OS === 'ios' && !IOS_CLIENT_ID) throw new Error('Chưa cấu hình EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
    GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID || undefined });
    configured = true;
  }

  let googleIdToken: string | null = null;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Luôn cho chọn lại tài khoản (giống popup trên web)
    await GoogleSignin.signOut().catch(() => {});
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') throw new GoogleCancelled();
    googleIdToken = res.data.idToken;
  } catch (e) {
    if (e instanceof GoogleCancelled) throw e;
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) throw new GoogleCancelled();
    if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Thiết bị chưa có Google Play Services');
    throw e;
  }
  if (!googleIdToken) throw new Error('Google không trả về idToken');

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
      returnIdpCredential: true,
    }),
  });
  const json = (await r.json()) as { idToken?: string; error?: { message?: string } };
  if (!r.ok || !json.idToken) throw new Error(json.error?.message ?? `Firebase lỗi ${r.status}`);
  return json.idToken;
}
