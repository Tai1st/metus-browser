import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { MetusUser } from './api';
import { tr } from './i18n';
import { planInfo } from './plan';

const CHANNEL = 'metus-default';
const PLAN_IDS = ['plan-expiry-3d', 'plan-expiry-1d'];
const DAY = 86400_000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let ready: Promise<boolean> | null = null;

/** Tạo kênh + xin quyền thông báo (chỉ hỏi 1 lần mỗi phiên). */
export function ensureNotifications(): Promise<boolean> {
  ready ??= (async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Metus', importance: Notifications.AndroidImportance.DEFAULT });
      }
      const cur = await Notifications.getPermissionsAsync();
      if (cur.granted) return true;
      if (!cur.canAskAgain) return false;
      return (await Notifications.requestPermissionsAsync()).granted;
    } catch {
      return false;
    }
  })();
  return ready;
}

/** Hiện thông báo ngay (vd. tool chạy xong). Lỗi/không có quyền → bỏ qua. */
export async function notifyNow(title: string, body: string): Promise<void> {
  try {
    if (!(await ensureNotifications())) return;
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch {
    // bỏ qua
  }
}

export async function cancelPlanReminders(): Promise<void> {
  await Promise.all(PLAN_IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

/** Nhắc gói sắp hết hạn: trước 3 ngày và trước 1 ngày. */
export async function syncPlanReminders(user: MetusUser | null): Promise<void> {
  try {
    await cancelPlanReminders();
    const info = planInfo(user);
    const raw = (user?.customerPlan as { expirationDate?: string } | undefined)?.expirationDate;
    const exp = raw ? new Date(raw).getTime() : NaN;
    if (!info.name || Number.isNaN(exp) || exp <= Date.now()) return;
    if (!(await ensureNotifications())) return;
    const slots: [string, number, number][] = [['plan-expiry-3d', 3, 3], ['plan-expiry-1d', 1, 1]];
    for (const [id, before, n] of slots) {
      const at = exp - before * DAY;
      if (at <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: { title: tr('notify.planTitle'), body: tr('notify.planBody', { plan: info.name, n }) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: CHANNEL },
      });
    }
  } catch {
    // bỏ qua
  }
}
