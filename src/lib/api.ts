/** Gọi backend Metus (api.metus.vn) — cùng endpoint với metus-few/services/api. */
import { Metus, MetusHttpError } from '@metus/http';

import { Config } from './config';
import { getMachineCode } from './device';
import * as storage from './storage';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const token = storage.get<string>(storage.StorageKey.ACCESS_TOKEN);
  const res = await Metus.http.request<any>({
    url: `${Config.API_URL}${path}`,
    method,
    body,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    responseType: 'auto',
    timeout: 60_000,
  });
  if (res.status < 200 || res.status >= 300) {
    const msg = typeof res.data === 'object' && res.data?.message ? String(res.data.message) : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return res.data as T;
}

export interface MetusUser {
  _id?: string;
  email?: string;
  name?: string;
  balance?: number;
  bankCode?: string;
  [k: string]: unknown;
}

/** Thông tin ngân hàng nhận tiền (setting BANK_INFO). */
export interface BankInfoSetting {
  accountName: string;
  accountNumber: string;
  bankName: string;
  depositPromotion?: number;
}

/** 1 mệnh giá thẻ cào kèm phí chiết khấu (%). */
export interface CardValue {
  value: number;
  fees: number;
}

/** card-rate: map tên nhà mạng -> danh sách mệnh giá. */
export type CardRate = Record<string, CardValue[]>;

export interface CreatePhoneCardDto {
  pin: string;
  seri: string;
  cardType: string;
  cardValue: number;
}

/** Gói dịch vụ (giống IPlan của metus-few). */
export interface PlanItem {
  _id: string;
  name: string;
  description?: string;
  price: number;
  daysUse: number;
  percentDiscount?: number;
  support?: boolean;
  maxDevices?: number;
  type?: string;
  audience?: string;
}

/** Kết quả mua gói: PENDING = cần thanh toán thêm (có qr), SUCCESS = đã kích hoạt. */
export interface BuyPlanResult {
  status?: 'PENDING' | 'SUCCESS' | string;
  order?: { _id?: string; status?: string; expiresAt?: string };
  qr?: string;
}

export const Api = {
  async login(email: string, password: string) {
    const machineCode = await getMachineCode();
    const res = await call<{ data: { accessToken: string; user: MetusUser } }>('POST', '/auth/login', {
      email,
      password,
      machineCode,
    });
    return res.data;
  },
  me: () => call<{ data: MetusUser }>('GET', '/customer/me').then((r) => r.data),

  // --- Nạp tiền (giống metus-few) ---
  /** Lấy 1 setting theo key, trả về phần `value`. */
  getSetting: <T = unknown>(key: string) =>
    call<{ data: { key: string; value: T } }>('GET', `/setting/value?key=${encodeURIComponent(key)}`).then((r) => r.data.value),
  /** Bảng tỉ giá / chiết khấu thẻ cào theo nhà mạng. */
  getCardRate: () => call<{ data: CardRate }>('GET', '/phone-card/card-rate').then((r) => r.data),
  /** Nạp thẻ cào; trả về message từ server. */
  rechargePhoneCard: (body: CreatePhoneCardDto) => call<{ data: string }>('POST', '/phone-card', body).then((r) => r.data),

  // --- Gói dịch vụ ---
  /** Danh sách gói dịch vụ (GET /plan/ex); chỉ lấy gói nhóm "ex" (audience/type = EX). */
  getPlans: () =>
    call<{ data: PlanItem[] }>('GET', '/plan/ex').then((r) =>
      (r.data ?? []).filter((p) => [p.audience, p.type].some((v) => (v ?? '').toLowerCase() === 'ex')),
    ),
  /** Mua gói theo id (POST /plan). */
  buyPlan: (id: string) => call<{ data: BuyPlanResult }>('POST', '/plan', { id }).then((r) => r.data),
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof MetusHttpError) return `${e.message} (${e.code})`;
  if (e instanceof Error) return e.message;
  return String(e);
}
