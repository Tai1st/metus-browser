/**
 * "Chu trình nâng cao" (lặp lại theo thời gian / giờ custom) — port AdvancedCycle của
 * metus-few, dùng chung cho tool đăng bài nhóm và bình luận nhóm.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { CenterModal } from '@/components/groupPost';
import { Body, Button, Row, radius, shadow, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};


export const parseTimes = (raw: string) =>
  raw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t))
    .map((t) => t.padStart(5, '0'));

/** Lần chạy kế tiếp theo danh sách giờ cố định trong ngày. */
export function nextCustomRun(times: string[]): Date | null {
  if (!times.length) return null;
  const now = new Date();
  const sorted = [...times].sort();
  for (const t of sorted) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > now.getTime()) return d;
  }
  const [h, m] = sorted[0].split(':').map(Number);
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
}


export const PURPLE = '#8b5cf6';
export const fmtCycle = (sec: number) => {
  const x = Math.max(0, Math.round(sec));
  const h = Math.floor(x / 3600);
  const m = Math.floor((x % 3600) / 60);
  const s = x % 60;
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
};

/** Chọn giờ (HH:mm) cho khung giờ chạy hằng ngày. */
export function TimeSlotModal({ value, onClose, onSave }: { value: string | null; onClose: () => void; onSave: (v: string) => void }) {
  const c = useColors();
  const t = useT();
  const [h, setH] = useState(9);
  const [m, setM] = useState(0);
  useEffect(() => {
    if (value) {
      const [hh, mm] = value.split(':').map(Number);
      setH(hh || 0);
      setM(mm || 0);
    }
  }, [value]);
  const Col = ({ v, set, max, step }: { v: number; set: (n: number) => void; max: number; step: number }) => (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Pressable onPress={() => set((v + step) % (max + 1))} hitSlop={8}><Ionicons name="chevron-up" size={26} color={PURPLE} /></Pressable>
      <Text style={{ fontSize: 36, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'] }}>{String(v).padStart(2, '0')}</Text>
      <Pressable onPress={() => set((v - step + max + 1) % (max + 1))} hitSlop={8}><Ionicons name="chevron-down" size={26} color={PURPLE} /></Pressable>
    </View>
  );
  return (
    <CenterModal visible={value !== null} title={t('gp.customTimesTitle')} onClose={onClose}>
      <Row style={{ justifyContent: 'center', gap: 18 }}>
        <Col v={h} set={setH} max={23} step={1} />
        <Text style={{ fontSize: 36, fontWeight: '800', color: c.text }}>:</Text>
        <Col v={m} set={setM} max={59} step={5} />
      </Row>
      <Button title={t('common.save')} icon="checkmark" full onPress={() => onSave(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)} />
    </CenterModal>
  );
}

/** "Chu trình nâng cao" — port AdvancedCycle của metus-few. */
export function AdvancedCycle({ enabled, setEnabled, blockedReason, disabled, cycleMode, setCycleMode, hours, setHours, times, setTimes, nextRun }: {
  enabled: boolean; setEnabled: (v: boolean) => void; blockedReason: string | null; disabled: boolean;
  cycleMode: 'frequency' | 'custom'; setCycleMode: (m: 'frequency' | 'custom') => void;
  hours: number; setHours: (h: number) => void; times: string[]; setTimes: (t: string[]) => void; nextRun: string | null;
}) {
  const c = useColors();
  const t = useT();
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const tabs: { k: 'frequency' | 'custom'; icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = [
    { k: 'frequency', icon: 'time-outline', label: t('gp.cycleFreq') },
    { k: 'custom', icon: 'options-outline', label: t('gp.cycleCustom') },
  ];
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 12, gap: 10 }}>
      <Pressable onPress={() => (blockedReason && !enabled ? showDialog(t('gp.advancedCycle'), blockedReason) : !disabled && setEnabled(!enabled))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: blockedReason && !enabled ? 0.5 : 1 }}>
        <Ionicons name={enabled ? 'checkbox' : 'square-outline'} size={20} color={enabled ? PURPLE : c.faint} />
        <Body weight="700" size={14}>{t('gp.advancedCycle')}</Body>
      </Pressable>
      {enabled ? (
        <>
          <Body muted size={11}>{t('gp.repeatHint')}</Body>
          <View style={{ flexDirection: 'row', backgroundColor: c.input, borderRadius: radius.sm, padding: 4, gap: 4 }}>
            {tabs.map((tb) => {
              const on = cycleMode === tb.k;
              return (
                <Pressable key={tb.k} disabled={disabled} onPress={() => setCycleMode(tb.k)}
                  style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8, backgroundColor: on ? c.card : 'transparent' }, on ? shadow(c, 1) : null]}>
                  <Ionicons name={tb.icon} size={15} color={on ? PURPLE : c.faint} />
                  <Text style={{ fontSize: 12.5, fontWeight: on ? '700' : '500', color: on ? PURPLE : c.muted }}>{tb.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {cycleMode === 'frequency' ? (
            <Row gap={10}>
              <Body size={13} color={c.muted}>{t('gp.repeatEvery')}</Body>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, backgroundColor: c.input }}>
                <Pressable disabled={disabled} onPress={() => setHours(Math.max(0.5, hours - 0.5))} style={{ paddingHorizontal: 10, paddingVertical: 8 }}><Ionicons name="remove" size={16} color={c.text} /></Pressable>
                <Text style={{ minWidth: 36, textAlign: 'center', fontWeight: '700', color: c.text }}>{hours}</Text>
                <Pressable disabled={disabled} onPress={() => setHours(hours + 0.5)} style={{ paddingHorizontal: 10, paddingVertical: 8 }}><Ionicons name="add" size={16} color={c.text} /></Pressable>
              </View>
              <Body size={13} color={c.muted}>{t('gp.hours')}</Body>
            </Row>
          ) : (
            <>
              <Body size={12} color={c.muted}>{t('gp.customTimesLabel', { n: times.length })}</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {times.map((tm, i) => (
                  <View key={`${tm}-${i}`} style={{ width: '31%', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Pressable disabled={disabled} onPress={() => setEditIdx(i)}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input }}>
                      <Ionicons name="time-outline" size={14} color={PURPLE} />
                      <Text style={{ fontWeight: '700', color: c.text }}>{tm}</Text>
                    </Pressable>
                    {times.length > 1 ? (
                      <Pressable disabled={disabled} onPress={() => setTimes(times.filter((_, k) => k !== i))} hitSlop={6}>
                        <Ionicons name="close" size={14} color={c.faint} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
              <Pressable disabled={disabled} onPress={() => setTimes([...times, '12:00'])} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: disabled ? 0.4 : 1 }}>
                <Ionicons name="add" size={14} color={PURPLE} />
                <Body size={12.5} weight="600" color={PURPLE}>{t('gp.addTime')}</Body>
              </Pressable>
              {nextRun ? (
                <Row style={{ justifyContent: 'space-between', borderWidth: 1, borderColor: '#c4b5fd', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: c.card }}>
                  <Row gap={4}><Ionicons name="time-outline" size={13} color="#a78bfa" /><Body size={11} color={c.muted}>{t('gp.nextRunLabel')}:</Body></Row>
                  <Text style={{ fontWeight: '800', color: PURPLE, fontVariant: ['tabular-nums'] }}>{nextRun}</Text>
                </Row>
              ) : null}
            </>
          )}
        </>
      ) : null}
      <TimeSlotModal value={editIdx !== null ? times[editIdx] ?? '12:00' : null} onClose={() => setEditIdx(null)}
        onSave={(v) => { if (editIdx !== null) setTimes(times.map((x, k) => (k === editIdx ? v : x))); setEditIdx(null); }} />
    </View>
  );
}
