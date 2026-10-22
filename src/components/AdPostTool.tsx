import { Ionicons } from '@expo/vector-icons';
import { pickMedia as chooseMedia } from '@/lib/pickMedia';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/Logo';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, GradientText, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import * as storage from '@/lib/storage';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { useFbAccounts } from '@/lib/fb/accounts';
import { useAdsSession } from '@/lib/fb/adsSession';
import { type AdAccount } from '@/lib/fb/ads';
import { CTA_ACTIONS, createCarouselPost, deleteAdImage, getAdImages, uploadAdImage, uploadAdVideo, type AdImage, type AdPostMode, type CardData } from '@/lib/fb/videoCarousel';
import { showDialog } from '@/components/Dialog';
import { needsWatermark } from '@/lib/plan';
import { detectVideoLink, uploadAdVideoFromLink } from '@/lib/fb/videoFromLink';
import { ALBUM_LAYOUTS, AlbumLayoutPicker, FakeAlbumEditor, captureAlbum, type AlbumLayout } from '@/components/FakeAlbumEditor';

// Ảnh placeholder ô chọn video (theo ngôn ngữ).
// Nền chung (không chữ) cho ô chọn video — chữ đè lên bằng lang hiện tại, không cần 2 ảnh riêng.
const UPLOAD_BG = require('../../assets/images/upload-video-bg.png');

type PostRow = { pageId: string; pageName: string; status: 'pending' | 'done' | 'error'; note?: string };
type HistoryItem = { postId?: string; pageId: string; pageName: string; pagePicture?: string; status: 'done' | 'error'; at: number };

const defaultCard = (): CardData => ({ picture: '', name: 'Like Page 👉👉', description: '', CTAButton: 'LIKE_PAGE', websiteUrl: '' });
const ctaLabel = (v: string) => CTA_ACTIONS.find((a) => a.value === v)?.label ?? v;

const pad2 = (n: number) => String(n).padStart(2, '0');
export const fmtDateTime = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const QUICK_TIMES = ['09:00', '12:00', '14:30', '17:00', '20:00'];
type Pal = ReturnType<typeof useColors>;

function Stepper({ label, value, max, onChange, c }: { label: string; value: number; max: number; onChange: (v: number) => void; c: Pal }) {
  return (
    <View style={{ alignItems: 'center', gap: 5 }}>
      <Body muted size={11} weight="700">{label}</Body>
      <Row gap={10} style={{ alignItems: 'center' }}>
        <Pressable onPress={() => onChange((value - 1 + (max + 1)) % (max + 1))} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="remove" size={18} color={c.text} />
        </Pressable>
        <Body weight="700" size={18}>{pad2(value)}</Body>
        <Pressable onPress={() => onChange((value + 1) % (max + 1))} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="add" size={18} color={c.text} />
        </Pressable>
      </Row>
    </View>
  );
}

/** Modal chọn ngày giờ (lịch tháng + shortcuts + giờ) — giống metus-few. */
export function DateTimePickerModal({ visible, value, onClose, onConfirm }: { visible: boolean; value: Date | null; onClose: () => void; onConfirm: (d: Date) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [sel, setSel] = useState<Date>(value ?? new Date(Date.now() + 40 * 60000));
  const [view, setView] = useState<{ y: number; m: number }>(() => { const v = value ?? new Date(); return { y: v.getFullYear(), m: v.getMonth() }; });

  useEffect(() => {
    if (visible) {
      const v = value ?? new Date(Date.now() + 40 * 60000);
      setSel(v);
      setView({ y: v.getFullYear(), m: v.getMonth() });
    }
  }, [visible, value]);

  const setDatePart = (day: number) => setSel((p) => new Date(view.y, view.m, day, p.getHours(), p.getMinutes(), 0, 0));
  const setTimePart = (h: number, mi: number) => setSel((p) => new Date(p.getFullYear(), p.getMonth(), p.getDate(), h, mi, 0, 0));
  const applyShortcut = (d: Date) => { setSel(d); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  const prevMonth = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  const today = startOfDay(new Date());
  const firstWd = new Date(view.y, view.m, 1).getDay();
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shortcuts: { label: string; make: () => Date }[] = [
    { label: 'Bây giờ', make: () => new Date(Date.now() + 40 * 60000) },
    { label: 'Sau 1 giờ', make: () => new Date(Date.now() + 60 * 60000) },
    { label: 'Mai 09:00', make: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: 'Thứ 2 tới', make: () => { const d = new Date(); const diff = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + diff); d.setHours(9, 0, 0, 0); return d; } },
    { label: 'Cuối ngày', make: () => { const d = new Date(); d.setHours(23, 59, 0, 0); return d; } },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Math.max(insets.bottom, 16), maxHeight: '90%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}><View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: c.border }} /></View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} showsVerticalScrollIndicator={false}>
            <Label>Lối tắt</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {shortcuts.map((s) => (
                <Pressable key={s.label} onPress={() => applyShortcut(s.make())} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.chip }}>
                  <Body weight="700" size={12.5}>{s.label}</Body>
                </Pressable>
              ))}
            </ScrollView>

            <Row style={{ justifyContent: 'space-between', paddingTop: 4 }}>
              <Pressable onPress={prevMonth} hitSlop={8} style={{ padding: 4 }}><Ionicons name="chevron-back" size={22} color={c.text} /></Pressable>
              <Body weight="700" size={16}>Tháng {view.m + 1} {view.y}</Body>
              <Pressable onPress={nextMonth} hitSlop={8} style={{ padding: 4 }}><Ionicons name="chevron-forward" size={22} color={c.text} /></Pressable>
            </Row>

            <Row>
              {WEEKDAYS.map((w) => <View key={w} style={{ flex: 1, alignItems: 'center' }}><Body muted size={12} weight="700">{w}</Body></View>)}
            </Row>

            <View>
              {Array.from({ length: cells.length / 7 }).map((_, r) => (
                <Row key={r}>
                  {cells.slice(r * 7, r * 7 + 7).map((day, ci) => {
                    if (day === null) return <View key={ci} style={{ flex: 1, aspectRatio: 1 }} />;
                    const past = startOfDay(new Date(view.y, view.m, day)) < today;
                    const selected = sel.getFullYear() === view.y && sel.getMonth() === view.m && sel.getDate() === day;
                    return (
                      <Pressable key={ci} disabled={past} onPress={() => setDatePart(day)} style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.accent : 'transparent' }}>
                          <Body weight={selected ? '700' : '500'} size={14} color={selected ? c.onAccent : past ? c.faint : c.text}>{day}</Body>
                        </View>
                      </Pressable>
                    );
                  })}
                </Row>
              ))}
            </View>

            <Row gap={8} style={{ alignItems: 'center' }}>
              <Ionicons name="time-outline" size={16} color={c.muted} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {QUICK_TIMES.map((t) => {
                  const [h, mi] = t.split(':').map(Number);
                  const active = sel.getHours() === h && sel.getMinutes() === mi;
                  return (
                    <Pressable key={t} onPress={() => setTimePart(h, mi)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: active ? c.accent : c.chip }}>
                      <Body weight="700" size={12.5} color={active ? c.onAccent : c.text}>{t}</Body>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Row>

            <Row gap={14} style={{ justifyContent: 'center', paddingVertical: 4 }}>
              <Stepper label="Giờ" value={sel.getHours()} max={23} onChange={(h) => setTimePart(h, sel.getMinutes())} c={c} />
              <Body weight="700" size={20} color={c.faint}>:</Body>
              <Stepper label="Phút" value={sel.getMinutes()} max={59} onChange={(mi) => setTimePart(sel.getHours(), mi)} c={c} />
            </Row>

            <View style={{ alignItems: 'center' }}><Body muted size={12}>Đã chọn: {fmtDateTime(sel)}</Body></View>
            <Button title="Xác nhận" icon="checkmark" onPress={() => onConfirm(sel)} full />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Hàng chọn kiểu dropdown (nhãn + avatar + tên + mũi tên) giống metus-few.
export function SelectorRow({ label, avatar, text, placeholder, onPress }: { label: string; avatar?: string; text?: string; placeholder: string; onPress: () => void }) {
  const c = useColors();
  return (
    <View style={{ gap: 7 }}>
      <Label>{label}</Label>
      <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }}>
        {avatar ? <Image source={{ uri: avatar }} style={{ width: 26, height: 26, borderRadius: 13 }} /> : null}
        <Body weight="700" size={14} numberOfLines={1} color={text ? c.text : c.faint}>{text || placeholder}</Body>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-down" size={18} color={c.faint} />
      </Pressable>
    </View>
  );
}

// Modal chọn 1 hoặc nhiều mục.
export function PickerModal<T>({ visible, title, onClose, items, keyOf, labelOf, avatarOf, selectedKeys, onToggle, multi }: {
  visible: boolean; title: string; onClose: () => void; items: T[]; keyOf: (t: T) => string; labelOf: (t: T) => string; avatarOf?: (t: T) => string | undefined; selectedKeys: string[]; onToggle: (t: T) => void; multi?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Math.max(insets.bottom, 16), maxHeight: '80%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}><View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: c.border }} /></View>
          <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 }}>
            <Body weight="700" size={18}>{title}</Body>
            {multi ? <Pressable onPress={onClose}><Body color={c.accent} weight="700">Xong</Body></Pressable> : null}
          </Row>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}>
            {items.map((it) => {
              const active = selectedKeys.includes(keyOf(it));
              const av = avatarOf?.(it);
              return (
                <Pressable key={keyOf(it)} onPress={() => { onToggle(it); if (!multi) onClose(); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: radius.md, borderWidth: 1.5, borderColor: active ? c.accent : c.border, backgroundColor: active ? c.accentSoft : c.card }}>
                  {av ? <Image source={{ uri: av }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : <Ionicons name="ellipse" size={20} color={c.faint} />}
                  <Body weight="600" size={15} numberOfLines={1} color={c.text} >{labelOf(it)}</Body>
                  <View style={{ flex: 1 }} />
                  <Ionicons name={active ? 'checkmark-circle' : multi ? 'ellipse-outline' : 'chevron-forward'} size={22} color={active ? c.accent : c.faint} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Modal nhập link video (TikTok / Facebook / CapCut) — giống ô dán link của metus-few. */
export function LinkVideoModal({ visible, onClose, onSubmit }: { visible: boolean; onClose: () => void; onSubmit: (url: string) => void }) {
  const c = useColors();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (visible) {
      setUrl('');
      setErr('');
    }
  }, [visible]);
  const submit = () => {
    const v = url.trim();
    if (!detectVideoLink(v)) return setErr('Vui lòng nhập link TikTok, Facebook hoặc CapCut hợp lệ');
    onSubmit(v);
  };
  const SOURCES: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }[] = [
    { icon: 'logo-tiktok', label: 'TikTok' },
    { icon: 'logo-facebook', label: 'Facebook' },
    { icon: 'cut-outline', label: 'CapCut' },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View style={[{ backgroundColor: c.bg, borderRadius: 20, padding: 20, gap: 14 }, shadow(c, 2)]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body weight="700" size={18}>Thêm video từ Link</Body>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={c.faint} /></Pressable>
          </Row>
          <Row gap={8}>
            {SOURCES.map((s) => (
              <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Ionicons name={s.icon} size={14} color={c.text} />
                <Body size={12} weight="600">{s.label}</Body>
              </View>
            ))}
          </Row>
          <Field label="Link video" value={url} onChangeText={(v) => { setUrl(v); setErr(''); }} placeholder="https://www.tiktok.com/@.../video/..." keyboardType="url" autoCapitalize="none" onSubmitEditing={submit} />
          {err ? <Body color={c.danger} size={13}>{err}</Body> : null}
          <Body muted size={12}>Video được Facebook tải thẳng về tài khoản quảng cáo, có thể mất 10–60 giây.</Body>
          <Button title="Tải video" icon="cloud-download-outline" onPress={submit} full />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Modal hiển thị tiến độ đăng bài (giống thiết kế Metus). */
function PostingModal({ visible, percent, pageLabel, scheduled }: {
  visible: boolean; percent: number; pageLabel: string; scheduled: boolean;
}) {
  const c = useColors();
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View style={[{ width: '100%', maxWidth: 420, backgroundColor: c.card, borderRadius: radius.lg, padding: 20, gap: 14 }, shadow(c, 2)]}>
          {/* Header: logo */}
          <Row gap={8}>
            <Logo size={30} />
            <Text style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>Metus</Text>
          </Row>

          {/* Minh hoạ: mây upload trong vòng sáng + icon video/ảnh */}
          <View style={{ alignItems: 'center', justifyContent: 'center', height: 150 }}>
            <View style={{ position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: c.accentSoft, opacity: 0.7 }} />
            <View style={{ position: 'absolute', width: 112, height: 112, borderRadius: 56, borderWidth: 2, borderColor: c.accent, opacity: 0.35 }} />
            <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="cloud-upload" size={46} color="#fff" />
            </View>
            <View style={{ position: 'absolute', left: '14%', top: 26, width: 40, height: 40, borderRadius: 10, backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-12deg' }] }}>
              <Ionicons name="play" size={20} color="#fff" />
            </View>
            <View style={{ position: 'absolute', right: '14%', top: 40, width: 40, height: 40, borderRadius: 10, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '10deg' }] }}>
              <Ionicons name="image" size={20} color="#fff" />
            </View>
          </View>

          {/* Tiêu đề */}
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>
              Đang <Text style={{ color: c.accent }}>{scheduled ? 'hẹn lịch' : 'đăng bài'}</Text>...
            </Text>
            <Text style={{ color: c.muted, fontSize: 13.5, textAlign: 'center' }}>Vui lòng đợi trong giây lát, Metus đang xử lý bài viết của bạn.</Text>
            {pageLabel ? <Text style={{ color: c.faint, fontSize: 12.5, textAlign: 'center' }} numberOfLines={1}>{pageLabel}</Text> : null}
          </View>

          {/* Thanh tiến độ */}
          <Row gap={12}>
            <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.chip, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', borderRadius: 5, backgroundColor: c.accent }} />
            </View>
            <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, minWidth: 44, textAlign: 'right' }}>{pct}%</Text>
          </Row>

          {/* Ghi chú */}
          <Row gap={10} style={{ backgroundColor: c.input, borderRadius: radius.md, padding: 12, alignItems: 'flex-start' }}>
            <Ionicons name="flash" size={18} color={c.info} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.text, fontSize: 13 }}>Quá trình đăng bài có thể mất vài giây tùy thuộc vào kích thước video.</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>Vui lòng không đóng ứng dụng.</Text>
            </View>
          </Row>
        </View>
      </View>
    </Modal>
  );
}

function Runner({ dtsg, fbId, mode, watermark }: { dtsg: string; fbId: string; mode: AdPostMode; watermark: boolean }) {
  const numCards = mode === 'carousel2' ? 2 : 1;
  const imageOnly = mode === 'onePicture';
  const isAlbum = mode === 'fakeAlbum';
  // Mỗi loại bài giữ lịch sử riêng (2 ô giữ key cũ để không mất lịch sử).
  const historyKey = mode === 'carousel2' ? storage.StorageKey.FB_POST_HISTORY : `${storage.StorageKey.FB_POST_HISTORY}:${mode}`;
  const c = useColors();
  const { scheme } = useTheme();
  const { lang } = useI18n();
  const ctaBtnBg = scheme === 'dark' ? '#3B3D3E' : '#E2E5E9';
  const { session } = useFbAccounts();
  // Phiên Ads được nạp sẵn từ lúc mở app (AdsSessionProvider) — dùng lại, không scrape lại.
  const { ads, loading, error: adsError, reload } = useAdsSession();
  const token = ads?.token ?? '';
  const pages = ads?.pages ?? [];
  const adAccounts = ads?.adAccounts ?? [];
  const [adAccount, setAdAccount] = useState<AdAccount | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const [primaryText, setPrimaryText] = useState('');
  const [likeEnabled, setLikeEnabled] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const toggleSchedule = (v: boolean) => {
    setScheduleEnabled(v);
    if (v && !scheduleAt) setScheduleAt(new Date(Date.now() + 40 * 60000)); // mặc định +40 phút (FB >=35')
  };
  const [cards, setCards] = useState<CardData[]>(() => {
    const init = Array.from({ length: numCards }, () => (imageOnly ? { ...defaultCard(), name: 'Hello Metus' } : defaultCard()));
    // Đăng 2 ô: tự điền lại thẻ 2 đã dùng lần trước
    if (mode === 'carousel2') {
      const saved = storage.get<CardData>(storage.StorageKey.FB_CAROUSEL_CARD2);
      if (saved) init[1] = { ...init[1], ...saved, preview: undefined };
    }
    return init;
  });
  const card2 = cards[1];
  useEffect(() => {
    if (mode !== 'carousel2' || !card2) return;
    // preview là file tạm trên máy → không lưu; picture/video_id là URL/ID trên Facebook nên dùng lại được
    const { preview: _preview, ...rest } = card2;
    storage.set(storage.StorageKey.FB_CAROUSEL_CARD2, rest);
  }, [mode, card2]);
  // Ảnh 1 ô: link hiển thị + mô tả dưới link (giống metus-few).
  const [displayLink, setDisplayLink] = useState('facebook.com');
  const [displayLinkDescription, setDisplayLinkDescription] = useState('Post was auto generate by metus v2');
  // Album giả: bố cục + ảnh từng ô + link đích + ẩn bài.
  const [albumLayout, setAlbumLayout] = useState<AlbumLayout>('RegularImage');
  const [albumImages, setAlbumImages] = useState<(string | null)[]>([]);
  const [albumSlot, setAlbumSlot] = useState(0);
  const [albumWebsite, setAlbumWebsite] = useState('https://metus.vn');
  const [hidePost, setHidePost] = useState(false);
  const albumRef = useRef<View>(null);
  const albumSlots = ALBUM_LAYOUTS[albumLayout].rects.length;
  const setAlbumAt = (i: number, uri: string | null) =>
    setAlbumImages((prev) => {
      const next = [...prev];
      next[i] = uri;
      return next;
    });
  const [uploading, setUploading] = useState<number | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [postModal, setPostModal] = useState(false);
  const [postPercent, setPostPercent] = useState(0);
  const [postPageLabel, setPostPageLabel] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>(() => storage.get<HistoryItem[]>(historyKey) ?? []);

  const addHistory = (item: HistoryItem) =>
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 100);
      storage.set(historyKey, next);
      return next;
    });
  const clearHistory = () => {
    setHistory([]);
    storage.set(historyKey, []);
  };

  const [pagePicker, setPagePicker] = useState(false);
  const [adsPicker, setAdsPicker] = useState(false);
  const [ctaCard, setCtaCard] = useState<number | null>(null);

  // Khi phiên Ads sẵn sàng (hoặc đổi tài khoản → nạp lại), đặt mặc định ad account + page.
  useEffect(() => {
    if (!ads) return;
    setAdAccount(ads.adAccounts[0] ?? null);
    setSelectedPageIds(ads.pages[0] ? [ads.pages[0].id] : []);
  }, [ads]);

  const patchCard = (i: number, patch: Partial<CardData>) =>
    setCards((prev) => prev.map((cd, idx) => (idx === i ? { ...cd, ...patch } : cd)));

  // Thư viện media (ảnh đã có trên ad account) — bấm để gán cho thẻ đang chọn.
  const [selectedCard, setSelectedCard] = useState(0);
  const [library, setLibrary] = useState<AdImage[]>([]);
  const [libLoading, setLibLoading] = useState(false);
  const [libUploading, setLibUploading] = useState(false);
  const [libGrid, setLibGrid] = useState(false); // mặc định cuộn ngang

  const loadLibrary = async () => {
    if (!adAccount || !token) return;
    setLibLoading(true);
    try {
      setLibrary(await getAdImages(adAccount.id, token));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLibLoading(false);
    }
  };

  useEffect(() => {
    setLibrary([]);
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccount?.id, token]);

  const uploadToLibrary = async () => {
    if (!adAccount) return;
    const r = { assets: await chooseMedia('image', true) };
    if (!r.assets.length) return;
    setLibUploading(true);
    setError('');
    try {
      for (const a of r.assets) {
        await uploadAdImage(adAccount.id, token, { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined });
      }
      await loadLibrary();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLibUploading(false);
    }
  };

  const chooseFromLibrary = (img: AdImage) => {
    if (isAlbum) {
      setAlbumAt(albumSlot, img.url);
      if (albumSlot < albumSlots - 1) setAlbumSlot(albumSlot + 1);
      return;
    }
    patchCard(selectedCard, { picture: img.url, preview: undefined, video_id: undefined });
  };
  const libActive = (img: AdImage) => (isAlbum ? albumImages[albumSlot] === img.url : cards[selectedCard]?.picture === img.url);

  // Album giả: chọn ảnh từ máy cho ô i (chọn nhiều → điền lần lượt các ô tiếp theo).
  const pickAlbumSlot = async (i: number) => {
    const r = { assets: await chooseMedia('image', true) };
    if (!r.assets.length) return;
    setAlbumImages((prev) => {
      const next = [...prev];
      r.assets.slice(0, albumSlots - i).forEach((a, k) => (next[i + k] = a.uri));
      return next;
    });
    setAlbumSlot(Math.min(i + r.assets.length, albumSlots - 1));
  };

  const confirmDeleteImage = (img: AdImage) =>
    showDialog('Xóa ảnh?', 'Ảnh sẽ bị xóa khỏi thư viện của tài khoản quảng cáo.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          if (!adAccount) return;
          try {
            await deleteAdImage(adAccount.id, token, img.hash);
            setLibrary((prev) => prev.filter((x) => x.hash !== img.hash));
          } catch (e) {
            setError(describeError(e));
          }
        },
      },
    ]);
  const togglePage = (id: string) =>
    setSelectedPageIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  // Thêm video từ link (TikTok / Facebook / CapCut)
  const [linkCard, setLinkCard] = useState<number | null>(null);
  const addVideoFromLink = async (i: number, url: string) => {
    if (!adAccount) return setError('Chưa có tài khoản quảng cáo');
    setLinkCard(null);
    setSelectedCard(i);
    setUploading(i);
    setError('');
    try {
      const { videoId, picture } = await uploadAdVideoFromLink({ adAccountId: adAccount.id, token, url, asyncToken: session?.asyncToken, fbId });
      patchCard(i, { video_id: videoId, picture, preview: undefined });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setUploading(null);
    }
  };

  const pickMedia = async (i: number) => {
    if (!adAccount) return;
    setSelectedCard(i);
    const [a] = await chooseMedia(imageOnly ? 'image' : 'mixed');
    if (!a) return;
    const media = { uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined };
    setUploading(i);
    if (!(a.mimeType ?? "").startsWith("video/")) patchCard(i, { preview: a.uri });
    setError('');
    try {
      if ((a.mimeType ?? '').startsWith('video/')) {
        const { videoId, picture } = await uploadAdVideo(adAccount.id, token, media);
        patchCard(i, { video_id: videoId, picture });
      } else {
        const { url } = await uploadAdImage(adAccount.id, token, media);
        patchCard(i, { picture: url, video_id: undefined });
        loadLibrary();
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setUploading(null);
    }
  };

  const create = async () => {
    const selected = pages.filter((p) => selectedPageIds.includes(p.id));
    if (!adAccount) return setError('Chưa có tài khoản quảng cáo');
    if (selected.length === 0) return setError('Chọn ít nhất 1 Page');
    if (isAlbum) {
      if (Array.from({ length: albumSlots }, (_, k) => albumImages[k]).some((u) => !u)) return setError(`Bố cục này cần đủ ${albumSlots} ảnh`);
      if (!/^https?:\/\/\S+$/i.test(albumWebsite.trim())) return setError('Website URL không hợp lệ');
    } else if (cards.some((cd) => !cd.picture)) return setError(imageOnly ? 'Hãy tải lên 1 ảnh' : numCards > 1 ? 'Mỗi thẻ cần 1 ảnh hoặc video' : 'Hãy tải lên 1 ảnh hoặc video');
    let scheduleUnix: number | undefined;
    if (scheduleEnabled && !(isAlbum && hidePost)) {
      if (!scheduleAt) return setError('Chọn ngày giờ hẹn lịch');
      if (scheduleAt.getTime() < Date.now() + 35 * 60000) return setError('Hẹn lịch phải cách hiện tại ít nhất 35 phút');
      scheduleUnix = Math.floor(scheduleAt.getTime() / 1000);
    }
    setError('');
    setCreating(true);
    setPostPercent(0);
    setPostModal(true);
    setPosts(selected.map((p) => ({ pageId: p.id, pageName: p.name, status: 'pending' })));
    // Album giả: ghép ảnh (chụp khung xem trước) rồi upload 1 lần, dùng cho mọi trang.
    let albumImageUrl: string | undefined;
    if (isAlbum) {
      setPostPageLabel('Đang ghép & tải ảnh album…');
      try {
        const first = albumImages[0]!;
        if (albumLayout === 'RegularImage' && /^https?:/i.test(first)) {
          albumImageUrl = first;
        } else {
          const uri = albumLayout === 'RegularImage' ? first : await captureAlbum(albumRef, albumLayout);
          albumImageUrl = (await uploadAdImage(adAccount.id, token, { uri, name: `album-${Date.now()}.jpg`, mimeType: 'image/jpeg' })).url;
        }
      } catch (e) {
        setCreating(false);
        setPostModal(false);
        return setError(describeError(e));
      }
    }
    for (const [idx, page] of selected.entries()) {
      setPostPageLabel(`Trang ${idx + 1}/${selected.length}: ${page.name}`);
      const report = (f: number) => setPostPercent(((idx + f) / selected.length) * 100);
      try {
        const postId = await createCarouselPost({ mode, displayLink, displayLinkDescription, albumImageUrl, websiteUrl: albumWebsite.trim(), hidePost: isAlbum && hidePost, token, adAccountId: adAccount.id, page, dtsg, fbId, primaryText, cards, watermark, like: likeEnabled, scheduleUnix: isAlbum && hidePost ? undefined : scheduleUnix, onProgress: report });
        setPosts((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'done', note: postId } : r)));
        addHistory({ postId, pageId: page.id, pageName: page.name, pagePicture: page.picture, status: 'done', at: Date.now() });
      } catch (e) {
        setPosts((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'error', note: describeError(e) } : r)));
        addHistory({ pageId: page.id, pageName: page.name, pagePicture: page.picture, status: 'error', at: Date.now() });
      }
      report(1);
    }
    setCreating(false);
    setPostPercent(100);
    setTimeout(() => setPostModal(false), 600);
  };

  const selectedPages = pages.filter((p) => selectedPageIds.includes(p.id));
  const pageText = selectedPages.length === 0 ? '' : selectedPages.length === 1 ? selectedPages[0].name : `${selectedPages.length} trang đã chọn`;
  const pageAvatar = selectedPages.length === 1 ? selectedPages[0].picture : undefined;

  return (
    <>
      {/* 3 dropdown: Tài khoản FB / Trang / Tài khoản Ads */}
      <Card>
        <SelectorRow label="Trang" avatar={pageAvatar} text={pageText} placeholder="Chọn trang" onPress={() => setPagePicker(true)} />
        <SelectorRow label="Tài khoản Ads" text={adAccount ? (adAccount.account_id ?? adAccount.id) : ''} placeholder="Chọn tài khoản quảng cáo" onPress={() => setAdsPicker(true)} />
      </Card>

      {loading && !ads ? (
        <Card><Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>Đang lấy phiên Ads…</Body></Row></Card>
      ) : null}
      {adsError && !ads ? (
        <Card>
          <Body color={c.danger}>{adsError}</Body>
          <Button title="Thử lại" variant="secondary" icon="refresh" onPress={reload} full />
        </Card>
      ) : null}

      {token ? (
        <>
          {isAlbum ? (
            <Card>
              <FakeAlbumEditor
                layout={albumLayout}
                images={albumImages}
                selectedSlot={albumSlot}
                onSelectSlot={setAlbumSlot}
                onPickSlot={(i) => { setAlbumSlot(i); pickAlbumSlot(i); }}
                onRemoveSlot={(i) => setAlbumAt(i, null)}
                captureViewRef={albumRef}
                displayLink={displayLink}
              />
              <Field label="Website URL (link khi bấm vào ảnh)" value={albumWebsite} onChangeText={setAlbumWebsite} placeholder="https://metus.vn" keyboardType="url" autoCapitalize="none" />
              <Field label="Link hiển thị" value={displayLink} onChangeText={setDisplayLink} placeholder="facebook.com" autoCapitalize="none" />
            </Card>
          ) : null}

          {/* Mỗi thẻ: media (có border) + footer CTA + sửa */}
          {(isAlbum ? [] : cards).map((card, i) => {
            const needUrl = CTA_ACTIONS.find((a) => a.value === card.CTAButton)?.input;
            return (
              <Card key={i} onPress={() => setSelectedCard(i)} style={numCards > 1 && selectedCard === i ? { borderColor: c.accent, borderWidth: 2 } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row gap={6}>
                    <Label>{numCards > 1 ? `Thẻ ${i + 1}` : imageOnly ? 'Ảnh bài đăng' : 'Video / ảnh bài đăng'}</Label>
                    {numCards > 1 && selectedCard === i ? <Badge text="Đang chọn" tone="accent" /> : null}
                  </Row>
                  {imageOnly ? null : <Pressable onPress={() => setLinkCard(i)} disabled={uploading !== null} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Ionicons name="videocam" size={14} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Thêm video từ Link</Text>
                  </Pressable>}
                </Row>

                {/* Khung thẻ có border: media + footer CTA */}
                <View style={[{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.card }, shadow(c, 1)]}>
                  <Pressable onPress={() => pickMedia(i)} style={{ aspectRatio: 1, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    {card.preview || card.picture ? (
                      <Image source={{ uri: card.preview || card.picture }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    ) : (
                      imageOnly ? (
                        <View style={{ alignItems: 'center', gap: 10 }}>
                          <Ionicons name="image-outline" size={48} color={c.accent} />
                          <Body weight="700" size={15} color={c.accent}>{lang === 'vi' ? 'Nhấn để chọn ảnh' : 'Tap to choose image'}</Body>
                          <Body muted size={12}>{lang === 'vi' ? 'Tối đa 30MB · Tỉ lệ 1:1 (vuông)' : 'Max 30MB · 1:1 ratio (square)'}</Body>
                        </View>
                      ) : (
                        <>
                          <Image source={UPLOAD_BG} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                          <View style={{ position: 'absolute', left: 0, right: 0, bottom: '24%', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
                            <GradientText size={24}>{lang === 'vi' ? 'Nhấn để chọn video hoặc ảnh' : 'Tap to choose video or photo'}</GradientText>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                              <Row gap={6} style={{ alignItems: 'center' }}>
                                <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                                  <Ionicons name="videocam" size={12} color="#fff" />
                                </View>
                                <Text style={{ color: '#1d3f72', fontWeight: '700', fontSize: 12 }}>{lang === 'vi' ? 'Tối đa 100MB' : 'Max 100MB'}</Text>
                              </Row>
                              <View style={{ width: 1, height: 16, backgroundColor: 'rgba(29,63,114,0.25)' }} />
                              <Row gap={6} style={{ alignItems: 'center' }}>
                                <Ionicons name="scan-outline" size={16} color="#1d3f72" />
                                <Text style={{ color: '#1d3f72', fontWeight: '700', fontSize: 12 }}>{lang === 'vi' ? 'Tỉ lệ 1:1 (vuông)' : '1:1 ratio (square)'}</Text>
                              </Row>
                            </View>
                          </View>
                        </>
                      )
                    )}
                    {uploading === i ? (
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <ActivityIndicator color="#fff" size="large" />
                        <Text style={{ color: '#fff', fontWeight: '700' }}>Đang tải lên…</Text>
                      </View>
                    ) : null}
                    {card.video_id ? (
                      <View style={{ position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, padding: 4 }}>
                        <Ionicons name="videocam" size={14} color="#fff" />
                      </View>
                    ) : null}
                  </Pressable>
                  {/* Footer: tên + mô tả nhỏ + nút CTA */}
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center', padding: 12, borderTopWidth: 1, borderColor: c.border }}>
                    <View style={{ flex: 1, paddingRight: 8, gap: 2 }}>
                      {imageOnly && displayLink ? <Body muted size={11} numberOfLines={1}>{displayLink.toUpperCase()}</Body> : null}
                      <Body weight="700" size={14} numberOfLines={1}>{card.name || `Thẻ ${i + 1}`}</Body>
                      {imageOnly ? (
                        displayLinkDescription ? <Body muted size={12} numberOfLines={1}>{displayLinkDescription}</Body> : null
                      ) : card.description ? <Body muted size={12} numberOfLines={1}>{card.description}</Body> : null}
                    </View>
                    <View style={{ backgroundColor: ctaBtnBg, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 9 }}>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>{ctaLabel(card.CTAButton)}</Text>
                    </View>
                  </Row>
                </View>

                {/* Tùy chọn nút (dropdown) */}
                <Label>Tùy chọn nút</Label>
                <Pressable onPress={() => setCtaCard(i)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }}>
                  <Body weight="700" size={14}>{ctaLabel(card.CTAButton)}</Body>
                  <View style={{ flex: 1 }} />
                  <Ionicons name="chevron-down" size={18} color={c.faint} />
                </Pressable>

                <Field label="Tiêu đề" value={card.name} onChangeText={(t) => patchCard(i, { name: t })} placeholder="Nhập tiêu đề thẻ" />
                {imageOnly ? (
                  <>
                    <Field label="Link hiển thị" value={displayLink} onChangeText={setDisplayLink} placeholder="facebook.com" />
                    <Field label="Mô tả link hiển thị" value={displayLinkDescription} onChangeText={setDisplayLinkDescription} placeholder="Nhập mô tả dưới link" />
                  </>
                ) : (
                  <Field label="Mô tả" value={card.description} onChangeText={(t) => patchCard(i, { description: t })} placeholder="Nhập mô tả thẻ" />
                )}
                {needUrl ? <Field label="Website URL" value={card.websiteUrl} onChangeText={(t) => patchCard(i, { websiteUrl: t })} placeholder="https://metus.vn" keyboardType="url" /> : null}
              </Card>
            );
          })}

          {/* Album giả: chọn bố cục (section riêng, trên thư viện media) */}
          {isAlbum ? (
            <Card>
              <AlbumLayoutPicker layout={albumLayout} onChange={(l) => { setAlbumLayout(l); setAlbumSlot(0); }} />
            </Card>
          ) : null}

          {/* Thư viện media (giống FbMediaLibrarySection của metus-few) */}
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Label>Thư viện media ({library.length})</Label>
              <Row gap={6}>
                <Pressable onPress={() => setLibGrid(true)} hitSlop={6} style={{ padding: 6, borderRadius: radius.sm, backgroundColor: libGrid ? c.text : 'transparent' }}>
                  <Ionicons name="grid" size={16} color={libGrid ? c.bg : c.faint} />
                </Pressable>
                <Pressable onPress={() => setLibGrid(false)} hitSlop={6} style={{ padding: 6, borderRadius: radius.sm, backgroundColor: !libGrid ? c.text : 'transparent' }}>
                  <Ionicons name="reorder-four" size={16} color={!libGrid ? c.bg : c.faint} />
                </Pressable>
                <Pressable onPress={loadLibrary} hitSlop={6} style={{ padding: 6 }}>
                  <Ionicons name="refresh" size={16} color={c.faint} />
                </Pressable>
              </Row>
            </Row>
            <Body muted size={12}>Bấm ảnh để gán cho {isAlbum ? `ô Ảnh ${albumSlot + 1}` : `Thẻ ${selectedCard + 1}`} · Giữ lâu để xóa</Body>
            <Button title="Tải ảnh lên thư viện" icon="cloud-upload" variant="secondary" onPress={uploadToLibrary} loading={libUploading} full />
            {libLoading && library.length === 0 ? (
              <Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>Đang tải thư viện…</Body></Row>
            ) : library.length === 0 ? (
              <Body muted size={13}>Chưa có ảnh nào trong thư viện.</Body>
            ) : libGrid ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {library.map((img, idx) => {
                  const active = libActive(img);
                  return (
                    <Pressable key={`${img.hash}-${idx}`} onPress={() => chooseFromLibrary(img)} onLongPress={() => confirmDeleteImage(img)}
                      style={{ width: '31.5%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', borderWidth: active ? 3 : 1, borderColor: active ? c.accent : c.border }}>
                      <Image source={{ uri: img.url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {library.map((img, idx) => {
                  const active = libActive(img);
                  return (
                    <Pressable key={`${img.hash}-${idx}`} onPress={() => chooseFromLibrary(img)} onLongPress={() => confirmDeleteImage(img)}
                      style={{ width: 96, height: 96, borderRadius: radius.sm, overflow: 'hidden', borderWidth: active ? 3 : 1, borderColor: active ? c.accent : c.border }}>
                      <Image source={{ uri: img.url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Card>

          {/* Nội dung + hẹn lịch (ở dưới) */}
          <Card>
            <Field label="Nội dung bài viết" value={primaryText} onChangeText={setPrimaryText} multiline placeholder="Nhập nội dung bài đăng" />
            {isAlbum ? (
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Body weight="600" size={14}>Ẩn bài viết</Body>
                  <Body muted size={12}>Chỉ tạo bài (không hiện trên Page) để chạy quảng cáo</Body>
                </View>
                <Switch value={hidePost} onValueChange={setHidePost} trackColor={{ true: c.accent }} />
              </Row>
            ) : null}
            {isAlbum && hidePost ? null : <Row style={{ justifyContent: 'space-between' }}>
              <Body weight="600" size={14}>Hẹn lịch</Body>
              <Switch value={scheduleEnabled} onValueChange={toggleSchedule} trackColor={{ true: c.accent }} />
            </Row>}
            {scheduleEnabled && !(isAlbum && hidePost) ? (
              <Pressable onPress={() => setPickerOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 13 }}>
                <Ionicons name="calendar" size={18} color={c.accent} />
                <Body size={14.5} weight="600" color={scheduleAt ? c.text : c.faint}>{scheduleAt ? fmtDateTime(scheduleAt) : 'Chọn ngày giờ'}</Body>
                <View style={{ flex: 1 }} />
                {scheduleAt ? <Pressable onPress={() => setScheduleAt(null)} hitSlop={8}><Ionicons name="close" size={18} color={c.faint} /></Pressable> : null}
                <Ionicons name="time-outline" size={18} color={c.faint} />
              </Pressable>
            ) : null}
            {isAlbum && hidePost ? null : <Row style={{ justifyContent: 'space-between' }}>
              <Body weight="600" size={14}>Tự động like sau khi đăng</Body>
              <Switch value={likeEnabled} onValueChange={setLikeEnabled} trackColor={{ true: c.accent }} />
            </Row>}
          </Card>

          {error ? <Body color={c.danger} size={13}>{error}</Body> : null}
          <Button title={isAlbum && hidePost ? 'Tạo bài ẩn' : scheduleEnabled ? 'Hẹn lịch đăng' : 'Đăng bài'} icon={scheduleEnabled && !(isAlbum && hidePost) ? 'time' : 'send'} onPress={create} loading={creating} full />

        </>
      ) : null}

      {/* Lịch sử đăng bài (lưu lại qua các lần) */}
      {history.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>Lịch sử đăng bài ({history.length})</Label>
            <Pressable onPress={clearHistory} hitSlop={8}><Body size={12} color={c.danger} weight="600">Xóa</Body></Pressable>
          </Row>
          <ResultList
            items={history}
            keyOf={(h, i) => `${h.at}-${i}`}
            render={(h) => (
              <Pressable onPress={() => { if (h.status === 'done' && h.postId) Linking.openURL(`https://facebook.com/${h.postId}`); }}>
                <Row gap={10}>
                  {h.pagePicture ? <Image source={{ uri: h.pagePicture }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : <Ionicons name="flag" size={20} color={c.faint} />}
                  <View style={{ flex: 1 }}>
                    <Body weight="600" size={14} numberOfLines={1}>{h.pageName}</Body>
                    <Body muted size={11}>{new Date(h.at).toLocaleString('vi-VN')}</Body>
                  </View>
                  <Badge text={h.status === 'done' ? 'Đã đăng' : 'Lỗi'} tone={h.status === 'done' ? 'success' : 'danger'} />
                  {h.status === 'done' && h.postId ? <Ionicons name="open-outline" size={16} color={c.faint} /> : null}
                </Row>
              </Pressable>
            )}
          />
        </Card>
      ) : null}

      {/* Modals chọn */}
      <PickerModal visible={pagePicker} title="Chọn trang" onClose={() => setPagePicker(false)} items={pages} multi
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={selectedPageIds}
        onToggle={(p) => togglePage(p.id)} />
      <PickerModal visible={adsPicker} title="Tài khoản quảng cáo" onClose={() => setAdsPicker(false)} items={adAccounts}
        keyOf={(a) => a.id} labelOf={(a) => `${a.name} (${a.account_id ?? a.id})`} selectedKeys={adAccount ? [adAccount.id] : []}
        onToggle={(a) => setAdAccount(a)} />
      <PickerModal visible={ctaCard !== null} title="Tùy chọn nút" onClose={() => setCtaCard(null)} items={CTA_ACTIONS}
        keyOf={(a) => a.value} labelOf={(a) => a.label} selectedKeys={ctaCard !== null ? [cards[ctaCard].CTAButton] : []}
        onToggle={(a) => { if (ctaCard !== null) patchCard(ctaCard, { CTAButton: a.value }); }} />
      <LinkVideoModal visible={linkCard !== null} onClose={() => setLinkCard(null)} onSubmit={(url) => { if (linkCard !== null) addVideoFromLink(linkCard, url); }} />
      <PostingModal visible={postModal} percent={postPercent} pageLabel={postPageLabel} scheduled={scheduleEnabled && !(isAlbum && hidePost)} />
      <DateTimePickerModal visible={pickerOpen} value={scheduleAt} onClose={() => setPickerOpen(false)} onConfirm={(d) => { setScheduleAt(d); setPickerOpen(false); }} />
    </>
  );
}

/** Màn đăng bài Ads dùng chung: 2 ô, video 1 ô, ảnh 1 ô, 1 ô album giả. */
export function AdPostTool({ mode }: { mode: AdPostMode }) {
  return (
    <Screen>
      <ToolGate require={mode === 'carousel2' ? 'plan' : 'package'}>
        {(dtsg, fbId, user) => <Runner dtsg={dtsg} fbId={fbId} mode={mode} watermark={mode === 'carousel2' && needsWatermark(user)} />}
      </ToolGate>
    </Screen>
  );
}
