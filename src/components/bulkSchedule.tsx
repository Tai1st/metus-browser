/**
 * Hẹn giờ hàng loạt — port AdvancedBulkSchedule của metus-few, dùng chung cho
 * tool đăng Reels và đăng Story: "Theo tần suất" (giờ bắt đầu + mỗi N phút) hoặc
 * "Tùy chỉnh" (ngày bắt đầu + các khung giờ mỗi ngày, có mẫu nhanh).
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { DateTimePickerModal, fmtDateTime } from '@/components/AdPostTool';
import { PURPLE, TimeSlotModal } from '@/components/cycle';
import { StepField, TickBox } from '@/components/groupPost';
import { Body, Row, radius, shadow, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

export const DEFAULT_TIMES = ['09:00', '12:00', '15:00', '18:00', '20:00', '22:00'];
const PRESETS: { label: string; times: string[] }[] = [
  { label: '3', times: ['09:00', '15:00', '21:00'] },
  { label: '4', times: ['08:00', '12:00', '17:00', '21:00'] },
  { label: '6', times: DEFAULT_TIMES },
  { label: '8', times: ['07:00', '09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00'] },
];

export const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dateOnly = (ms: number) => fmtDateTime(new Date(ms)).split(' ')[0];

export type BulkSchedule = ReturnType<typeof useBulkSchedule>;

/** State hẹn giờ hàng loạt + hàm tính giờ cho mục thứ i (calculateScheduledTime của metus-few). */
export function useBulkSchedule() {
  const [advanced, setAdvanced] = useState(false);
  const [mode, setMode] = useState<'frequency' | 'custom'>('frequency');
  const [bulkStart, setBulkStart] = useState(() => Date.now() + 3600_000);
  const [frequency, setFrequency] = useState(15);
  const [startDate, setStartDate] = useState(() => startOfDay(Date.now() + 86400_000));
  const [dailyTimes, setDailyTimes] = useState<string[]>(DEFAULT_TIMES);

  /** Giờ đăng (ms) của mục thứ `i` trên cùng 1 Page. */
  const scheduleAt = useCallback(
    (i: number): number => {
      if (mode === 'frequency') return bulkStart + i * frequency * 60_000;
      const times = [...dailyTimes].sort();
      const [h, m] = times[i % times.length].split(':').map(Number);
      const d = new Date(startDate + Math.floor(i / times.length) * 86400_000);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    },
    [mode, bulkStart, frequency, startDate, dailyTimes],
  );

  return { advanced, setAdvanced, mode, setMode, bulkStart, setBulkStart, frequency, setFrequency, startDate, setStartDate, dailyTimes, setDailyTimes, scheduleAt };
}

/** Gán lại giờ cho các mục đang hẹn (theo thứ tự trong từng Page) khi đổi cài đặt. */
export function reschedule<T extends { pageId: string; pending: boolean; isSchedule: boolean }>(
  items: T[],
  scheduleAt: (i: number) => number,
  apply: (item: T, at: number) => T,
): T[] {
  const idx: Record<string, number> = {};
  return items.map((it) => {
    if (!it.pending || !it.isSchedule) return it;
    const i = (idx[it.pageId] = (idx[it.pageId] ?? -1) + 1);
    return apply(it, scheduleAt(i));
  });
}

function DateRow({ label, value, onPress, disabled }: { label: string; value: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: c.muted }}>{label}</Text>
      <Pressable disabled={disabled} onPress={onPress}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input }}>
        <Ionicons name="calendar-outline" size={16} color={PURPLE} />
        <Text style={{ fontWeight: '600', color: c.text }}>{value}</Text>
      </Pressable>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 12, color: c.muted }}>{label}:</Text>
      <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>{value}</Text>
    </Row>
  );
}

export function BulkScheduleSection({ s, disabled, total, totalLabel }: {
  s: BulkSchedule; disabled?: boolean;
  /** Số mục đang hẹn giờ (để tính số ngày dự kiến). */
  total: number; totalLabel: string;
}) {
  const c = useColors();
  const t = useT();
  const [picker, setPicker] = useState<'bulk' | 'start' | null>(null);
  const [slotIdx, setSlotIdx] = useState<number | null>(null);
  const estDays = total ? Math.ceil(total / Math.max(1, s.dailyTimes.length)) : 0;

  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 10, gap: 10 }}>
      <TickBox label={t('reels.advanced')} value={s.advanced} disabled={disabled} onBlocked={() => {}} onChange={s.setAdvanced} />
      {s.advanced ? (
        <>
          <View style={{ flexDirection: 'row', backgroundColor: c.input, borderRadius: radius.sm, padding: 4, gap: 4 }}>
            {(['frequency', 'custom'] as const).map((m) => {
              const on = s.mode === m;
              return (
                <Pressable key={m} disabled={disabled} onPress={() => s.setMode(m)}
                  style={[{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, backgroundColor: on ? c.card : 'transparent' }, on ? shadow(c, 1) : null]}>
                  <Text style={{ fontSize: 12.5, fontWeight: on ? '700' : '500', color: on ? PURPLE : c.muted }}>{t(m === 'frequency' ? 'reels.modeFrequency' : 'reels.modeCustom')}</Text>
                </Pressable>
              );
            })}
          </View>
          {s.mode === 'frequency' ? (
            <>
              <DateRow label={t('reels.startTime')} value={fmtDateTime(new Date(s.bulkStart))} onPress={() => setPicker('bulk')} disabled={disabled} />
              <StepField label={t('reels.everyMinutes')} value={s.frequency} min={1} onChange={s.setFrequency} disabled={disabled} />
            </>
          ) : (
            <>
              <DateRow label={t('reels.startDate')} value={dateOnly(s.startDate)} onPress={() => setPicker('start')} disabled={disabled} />
              <Body size={12} color={c.muted}>{t('reels.slotsPerDay', { n: s.dailyTimes.length })}</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {s.dailyTimes.map((tm, i) => (
                  <View key={`${tm}-${i}`} style={{ width: '31%', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Pressable disabled={disabled} onPress={() => setSlotIdx(i)}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input }}>
                      <Text style={{ fontWeight: '700', color: c.text }}>{tm}</Text>
                    </Pressable>
                    {s.dailyTimes.length > 1 ? (
                      <Pressable disabled={disabled} hitSlop={6} onPress={() => s.setDailyTimes(s.dailyTimes.filter((_, k) => k !== i))}><Ionicons name="close" size={14} color={c.faint} /></Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
              <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6 }}>
                <Pressable disabled={disabled} onPress={() => s.setDailyTimes([...s.dailyTimes, '12:00'])} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="add" size={14} color={PURPLE} />
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: PURPLE }}>{t('reels.addSlot')}</Text>
                </Pressable>
                <Row gap={4}>
                  <Text style={{ fontSize: 11, color: c.muted }}>{t('reels.presets')}:</Text>
                  {PRESETS.map((p) => (
                    <Pressable key={p.label} disabled={disabled} onPress={() => s.setDailyTimes(p.times)}
                      style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                      <Text style={{ fontSize: 10.5, color: c.text }}>{t('reels.presetSlots', { n: p.label })}</Text>
                    </Pressable>
                  ))}
                </Row>
              </Row>
              <View style={{ gap: 3, padding: 8, borderRadius: 8, backgroundColor: c.input }}>
                <SummaryRow label={totalLabel} value={String(total)} />
                <SummaryRow label={t('reels.estDays')} value={t('reels.days', { n: estDays })} />
                <SummaryRow label={t('reels.estEnd')} value={estDays ? dateOnly(s.startDate + (estDays - 1) * 86400_000) : '---'} />
              </View>
            </>
          )}
        </>
      ) : null}
      <DateTimePickerModal visible={picker !== null} value={new Date(picker === 'start' ? s.startDate + 9 * 3600_000 : s.bulkStart)} onClose={() => setPicker(null)}
        onConfirm={(d) => {
          if (picker === 'bulk') s.setBulkStart(d.getTime());
          else s.setStartDate(startOfDay(d.getTime()));
          setPicker(null);
        }} />
      <TimeSlotModal value={slotIdx !== null ? s.dailyTimes[slotIdx] ?? '12:00' : null} onClose={() => setSlotIdx(null)}
        onSave={(v) => { if (slotIdx !== null) s.setDailyTimes(s.dailyTimes.map((x, k) => (k === slotIdx ? v : x))); setSlotIdx(null); }} />
    </View>
  );
}
