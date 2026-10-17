import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import * as storage from './storage';

/**
 * Mã máy gửi kèm khi đăng nhập Metus (thay cho fingerprint GPU/CPU của bản web).
 * Android: ANDROID_ID (cố định theo app + máy). iOS: identifierForVendor.
 */
export async function getMachineCode(): Promise<string> {
  const cached = storage.get<string>(storage.StorageKey.DEVICE_ID);
  if (cached) return cached;
  let raw: string | null = null;
  if (Platform.OS === 'android') raw = Application.getAndroidId();
  else if (Platform.OS === 'ios') raw = await Application.getIosIdForVendorAsync();
  raw ??= Crypto.randomUUID();
  const code = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `metus-app:${Platform.OS}:${raw}`);
  storage.set(storage.StorageKey.DEVICE_ID, code);
  return code;
}
