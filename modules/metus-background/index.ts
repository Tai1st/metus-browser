import { AppRegistry, PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Chạy nền cho tool (chu trình lặp lại). Android: foreground service + wake lock +
 * headless JS task. Nền tảng khác: no-op, sleep() dùng setTimeout.
 */
interface NativeBackground {
  start(title: string, text: string): Promise<void>;
  update(title: string, text: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  sleep(ms: number): Promise<void>;
}

const native = requireOptionalNativeModule<NativeBackground>('MetusBackground');

// Task giữ cho timer JS không bị dừng khi app ở nền — chạy tới khi native gọi finishTask.
AppRegistry.registerHeadlessTask('MetusKeepAlive', () => () => new Promise<void>(() => {}));

export const isSupported = !!native;

export async function start(title: string, text: string): Promise<void> {
  if (!native) return;
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).catch(() => undefined);
  }
  await native.start(title, text);
}

export async function update(title: string, text: string): Promise<void> {
  await native?.update(title, text);
}

export async function stop(): Promise<void> {
  await native?.stop();
}

export function isRunning(): boolean {
  return native?.isRunning() ?? false;
}

/** Chờ ms mili giây — Android dùng Handler native nên vẫn chạy khi tắt màn hình. */
export function sleep(ms: number): Promise<void> {
  return native ? native.sleep(ms) : new Promise((r) => setTimeout(r, ms));
}
