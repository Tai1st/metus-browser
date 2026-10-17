import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage đồng bộ giống `utils/storage` của metus-few (localStorage), để các
 * service port sang dùng nguyên `storage.get(...)`. Dữ liệu nằm trong bộ nhớ,
 * ghi xuống AsyncStorage ở nền; phải gọi `hydrateStorage()` trước khi render.
 *
 * KHÔNG lưu cookie/mật khẩu ở đây — cookie nằm trong native (Keystore/Keychain).
 */
export enum StorageKey {
  ACCESS_TOKEN = 'access_token',
  USER = 'user',
  FB_ACCOUNT = 'fbAccount',
  FB_ACCOUNTS = 'fbAccounts',
  DEVICE_ID = 'device_id',
  API_CLIENT_HISTORY = 'apiClientHistory',
  THEME = 'theme',
  LANGUAGE = 'language',
  FB_POST_HISTORY = 'fbPostHistory',
}

const PREFIX = 'metus:';
const memory = new Map<string, unknown>();
let hydrated = false;

export async function hydrateStorage(): Promise<void> {
  if (hydrated) return;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  const pairs = await AsyncStorage.multiGet(keys);
  for (const [k, v] of pairs) {
    if (v == null) continue;
    try {
      memory.set(k.slice(PREFIX.length), JSON.parse(v));
    } catch {
      // bỏ qua giá trị hỏng
    }
  }
  hydrated = true;
}

export function get<T = any>(key: string): T | undefined {
  return memory.get(key) as T | undefined;
}

export function set(key: string, value: unknown): void {
  memory.set(key, value);
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
}

export function clear(key: string): void {
  memory.delete(key);
  AsyncStorage.removeItem(PREFIX + key).catch(() => {});
}
