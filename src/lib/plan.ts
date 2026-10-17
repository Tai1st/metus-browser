import type { MetusUser } from './api';

export interface PlanInfo {
  name?: string;
  active: boolean;
  until?: string;
  daysLeft?: number;
}

const isExAudience = (v?: string) => (v ?? '').toLowerCase() === 'ex';

/** Gói đang dùng của user — chỉ tính gói nhóm "ex" (Metus Browser); gói APP/WEB không tính. */
export function planInfo(u: MetusUser | null): PlanInfo {
  const plan = (u?.plan as { name?: string; audience?: string; type?: string } | undefined) ?? undefined;
  const cp = (u?.customerPlan as { expirationDate?: string; audience?: string } | undefined) ?? undefined;
  const isEx = isExAudience(plan?.audience) || isExAudience(plan?.type) || isExAudience(cp?.audience);
  if (!plan?.name || !isEx) return { name: undefined, active: false };
  const exp = cp?.expirationDate ? new Date(cp.expirationDate) : undefined;
  const until = exp ? exp.toLocaleDateString('vi-VN') : undefined;
  const daysLeft = exp ? Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000)) : undefined;
  return { name: plan.name, active: exp ? exp.getTime() > Date.now() : true, until, daysLeft };
}

/**
 * Mức gói tool yêu cầu — giống cờ của metus-few (HomeConstant):
 * - `none`    : requireLogin=false (vd. auto-join) → không kiểm tra gói
 * - `plan`    : requireLogin=true, requirePackage=false → chỉ cần có gói (FREE cũng được)
 * - `package` : requirePackage=true → cần gói trả phí còn hạn
 */
export type PlanRequirement = 'none' | 'plan' | 'package';

/** Lý do chặn (trùng key thông báo của metus-few: tool.*). null = được dùng. */
export type PlanBlock = 'loadingPlan' | 'needFreePlan' | 'upgradePlan' | 'expired' | null;

type RawPlan = { price?: number; type?: string; audience?: string } | null | undefined;

const isExpired = (u: MetusUser | null) => {
  const exp = (u?.customerPlan as { expirationDate?: string } | undefined)?.expirationDate;
  // dayjs(undefined).isBefore(now) = false → không có ngày hết hạn thì coi như còn hạn
  return !!exp && new Date(exp).getTime() < Date.now();
};

/** Port từ ToolCard.onUseTool của metus-few. */
export function checkPlan(u: MetusUser | null, req: PlanRequirement): PlanBlock {
  if (req === 'none') return null;
  const plan = u?.plan as RawPlan;
  if (typeof plan === 'undefined') return 'loadingPlan';
  if (!plan) return 'needFreePlan';
  // Gói FREE dùng chung cho cả app/ex, các gói khác chỉ audience EX mới dùng được bên ex
  if (plan.type !== 'FREE' && plan.audience !== 'EX') return 'needFreePlan';
  if (req === 'package') {
    if ((plan.price ?? 0) <= 0) return 'upgradePlan';
    if (isExpired(u)) return 'expired';
  }
  return null;
}

/** Gói miễn phí hoặc đã hết hạn → gắn watermark "Đăng 2 ô tại Metus" (giống metus-few). */
export function needsWatermark(u: MetusUser | null): boolean {
  const plan = u?.plan as RawPlan;
  if (!plan) return true;
  return (plan.price ?? 0) <= 0 || isExpired(u);
}
