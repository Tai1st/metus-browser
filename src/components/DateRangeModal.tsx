// Modal chọn khoảng ngày (lịch tháng + preset + chọn start/end) — port UI/UX từ
// DateRangePickerReactDates của metus-few, dùng chung cho mọi tool "phân tích"
// (lọc theo khoảng thời gian) thay vì mỗi tool tự viết lại.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Row, radius, useColors } from '@/components/ui';
import { useI18n, useT } from '@/lib/i18n';

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a?: Date | null, b?: Date | null) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isBefore(a: Date, b: Date) {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}
function isAfter(a: Date, b: Date) {
  return startOfDay(a).getTime() > startOfDay(b).getTime();
}
function isBetween(d: Date, s: Date, e: Date) {
  return isAfter(d, s) && isBefore(d, e);
}
export function fmtShortDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function DateRangeModal({ visible, start, end, onClose, onApply }: {
  visible: boolean; start: Date | null; end: Date | null; onClose: () => void; onApply: (s: Date, e: Date) => void;
}) {
  const c = useColors();
  const t = useT();
  const { lang } = useI18n();
  const insets = useSafeAreaInsets();
  const today = startOfDay(new Date());
  const [temp, setTemp] = useState<{ start: Date | null; end: Date | null }>({ start, end });
  const [viewMonth, setViewMonth] = useState<{ y: number; m: number }>(() => {
    const base = start ?? new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  useEffect(() => {
    if (!visible) return;
    setTemp({ start, end });
    const base = start ?? new Date();
    setViewMonth({ y: base.getFullYear(), m: base.getMonth() });
  }, [visible, start, end]);

  const weekdayLabels = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(1970, 0, 4 + i)));
  }, [lang]);

  const monthLabel = new Date(viewMonth.y, viewMonth.m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const prevMonth = () => setViewMonth((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () => setViewMonth((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  const daysInMonth = new Date(viewMonth.y, viewMonth.m + 1, 0).getDate();
  const startWd = new Date(viewMonth.y, viewMonth.m, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const handleDay = (day: number) => {
    const picked = new Date(viewMonth.y, viewMonth.m, day);
    if (isAfter(picked, today)) return;
    if (!temp.start || temp.end) {
      setTemp({ start: picked, end: null });
    } else if (isBefore(picked, temp.start)) {
      setTemp({ start: picked, end: null });
    } else {
      setTemp({ ...temp, end: picked });
    }
  };

  const applyPreset = (months: number) => {
    const e = today;
    const s = startOfDay(new Date());
    s.setMonth(s.getMonth() - months);
    setTemp({ start: s, end: e });
    setViewMonth({ y: s.getFullYear(), m: s.getMonth() });
  };

  const clear = () => setTemp({ start: null, end: null });
  const apply = () => {
    if (!temp.start) return;
    onApply(temp.start, temp.end ?? temp.start);
  };

  const presets = [
    { label: t('dateRange.preset1m'), months: 1 },
    { label: t('dateRange.preset3m'), months: 3 },
    { label: t('dateRange.preset6m'), months: 6 },
    { label: t('dateRange.preset1y'), months: 12 },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Math.max(insets.bottom, 16), maxHeight: '90%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}><View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: c.border }} /></View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} showsVerticalScrollIndicator={false}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {presets.map((p) => (
                <Pressable key={p.label} onPress={() => applyPreset(p.months)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.chip }}>
                  <Body weight="700" size={12.5}>{p.label}</Body>
                </Pressable>
              ))}
              <Pressable onPress={clear} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.dangerSoft }}>
                <Body weight="700" size={12.5} color={c.danger}>{t('dateRange.clear')}</Body>
              </Pressable>
            </ScrollView>

            <Row style={{ justifyContent: 'space-between' }}>
              <Pressable onPress={prevMonth} hitSlop={8} style={{ padding: 4 }}><Ionicons name="chevron-back" size={22} color={c.text} /></Pressable>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16, textTransform: 'capitalize' }}>{monthLabel}</Text>
              <Pressable onPress={nextMonth} hitSlop={8} style={{ padding: 4 }}><Ionicons name="chevron-forward" size={22} color={c.text} /></Pressable>
            </Row>

            <View style={{ alignItems: 'center' }}>
              <Body muted size={12}>
                {temp.start
                  ? `${fmtShortDate(temp.start)}${temp.end ? ` → ${fmtShortDate(temp.end)}` : ` · ${t('dateRange.selectEnd')}`}`
                  : t('dateRange.selectStart')}
              </Body>
            </View>

            <Row>
              {weekdayLabels.map((w, i) => <View key={i} style={{ flex: 1, alignItems: 'center' }}><Body muted size={12} weight="700">{w}</Body></View>)}
            </Row>

            <View>
              {Array.from({ length: cells.length / 7 }).map((_, r) => (
                <Row key={r}>
                  {cells.slice(r * 7, r * 7 + 7).map((day, ci) => {
                    if (day === null) return <View key={ci} style={{ flex: 1, aspectRatio: 1 }} />;
                    const d = new Date(viewMonth.y, viewMonth.m, day);
                    const future = isAfter(d, today);
                    const isStart = isSameDay(d, temp.start);
                    const isEnd = isSameDay(d, temp.end);
                    const inRange = !!temp.start && !!temp.end && isBetween(d, temp.start, temp.end);
                    return (
                      <Pressable key={ci} disabled={future} onPress={() => handleDay(day)}
                        style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: inRange ? c.accentSoft : 'transparent' }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: isStart || isEnd ? c.accent : 'transparent' }}>
                          <Body weight={isStart || isEnd ? '700' : '500'} size={13} color={isStart || isEnd ? c.onAccent : future ? c.faint : c.text}>{day}</Body>
                        </View>
                      </Pressable>
                    );
                  })}
                </Row>
              ))}
            </View>

            <Row gap={10}>
              <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="secondary" onPress={onClose} /></View>
              <View style={{ flex: 1 }}><Button title={t('dateRange.apply')} onPress={apply} disabled={!temp.start} /></View>
            </Row>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
