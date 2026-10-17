import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import * as storage from '@/lib/storage';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { useFbAccounts } from '@/lib/fb/accounts';
import { useAdsSession } from '@/lib/fb/adsSession';
import { type AdAccount } from '@/lib/fb/ads';
import { CTA_ACTIONS, createCarouselPost, uploadAdImage, uploadAdVideo, type CardData } from '@/lib/fb/videoCarousel';

// Ảnh placeholder ô chọn video (theo ngôn ngữ).
const UPLOAD_VI = require('../../../assets/images/upload-video-vi.png');
const UPLOAD_EN = require('../../../assets/images/upload-video-en.png');

type PostRow = { pageId: string; pageName: string; status: 'pending' | 'done' | 'error'; note?: string };
type HistoryItem = { postId?: string; pageId: string; pageName: string; pagePicture?: string; status: 'done' | 'error'; at: number };

const defaultCard = (): CardData => ({ picture: '', name: 'Like Page 👉👉', description: '', CTAButton: 'LIKE_PAGE', websiteUrl: '' });
const ctaLabel = (v: string) => CTA_ACTIONS.find((a) => a.value === v)?.label ?? v;

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtDateTime = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
function DateTimePickerModal({ visible, value, onClose, onConfirm }: { visible: boolean; value: Date | null; onClose: () => void; onConfirm: (d: Date) => void }) {
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
function SelectorRow({ label, avatar, text, placeholder, onPress }: { label: string; avatar?: string; text?: string; placeholder: string; onPress: () => void }) {
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
function PickerModal<T>({ visible, title, onClose, items, keyOf, labelOf, avatarOf, selectedKeys, onToggle, multi }: {
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

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const { scheme } = useTheme();
  const { lang } = useI18n();
  const uploadImg = lang === 'vi' ? UPLOAD_VI : UPLOAD_EN;
  const ctaBtnBg = scheme === 'dark' ? '#3B3D3E' : '#E2E5E9';
  const { accounts, current, select } = useFbAccounts();
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
  const [cards, setCards] = useState<CardData[]>([defaultCard(), defaultCard()]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => storage.get<HistoryItem[]>(storage.StorageKey.FB_POST_HISTORY) ?? []);

  const addHistory = (item: HistoryItem) =>
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 100);
      storage.set(storage.StorageKey.FB_POST_HISTORY, next);
      return next;
    });
  const clearHistory = () => {
    setHistory([]);
    storage.set(storage.StorageKey.FB_POST_HISTORY, []);
  };

  const [fbPicker, setFbPicker] = useState(false);
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
  const togglePage = (id: string) =>
    setSelectedPageIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const pickMedia = async (i: number) => {
    if (!adAccount) return;
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['image/*', 'video/*'] });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
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
    if (cards.some((cd) => !cd.picture)) return setError('Mỗi thẻ cần 1 ảnh hoặc video');
    let scheduleUnix: number | undefined;
    if (scheduleEnabled) {
      if (!scheduleAt) return setError('Chọn ngày giờ hẹn lịch');
      if (scheduleAt.getTime() < Date.now() + 35 * 60000) return setError('Hẹn lịch phải cách hiện tại ít nhất 35 phút');
      scheduleUnix = Math.floor(scheduleAt.getTime() / 1000);
    }
    setError('');
    setCreating(true);
    setPosts(selected.map((p) => ({ pageId: p.id, pageName: p.name, status: 'pending' })));
    for (const page of selected) {
      try {
        const postId = await createCarouselPost({ token, adAccountId: adAccount.id, page, dtsg, fbId, primaryText, cards, like: likeEnabled, scheduleUnix });
        setPosts((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'done', note: postId } : r)));
        addHistory({ postId, pageId: page.id, pageName: page.name, pagePicture: page.picture, status: 'done', at: Date.now() });
      } catch (e) {
        setPosts((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'error', note: describeError(e) } : r)));
        addHistory({ pageId: page.id, pageName: page.name, pagePicture: page.picture, status: 'error', at: Date.now() });
      }
    }
    setCreating(false);
  };

  const selectedPages = pages.filter((p) => selectedPageIds.includes(p.id));
  const pageText = selectedPages.length === 0 ? '' : selectedPages.length === 1 ? selectedPages[0].name : `${selectedPages.length} trang đã chọn`;
  const pageAvatar = selectedPages.length === 1 ? selectedPages[0].picture : undefined;

  return (
    <>
      {/* 3 dropdown: Tài khoản FB / Trang / Tài khoản Ads */}
      <Card>
        <SelectorRow label="Tài khoản Facebook" avatar={current?.picture as string | undefined} text={current?.name as string | undefined} placeholder="Chọn tài khoản" onPress={() => setFbPicker(true)} />
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
          {/* Mỗi thẻ: media (có border) + footer CTA + sửa */}
          {cards.map((card, i) => {
            const needUrl = CTA_ACTIONS.find((a) => a.value === card.CTAButton)?.input;
            return (
              <Card key={i}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Label>Thẻ {i + 1}</Label>
                  <Pressable onPress={() => Alert.alert('Thêm video từ Link', 'Dán link TikTok/CapCut sẽ được bổ sung sau. Hãy bấm vào ô bên dưới để chọn ảnh/video từ máy.')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Ionicons name="videocam" size={14} color="#fff" />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Thêm video từ Link</Text>
                  </Pressable>
                </Row>

                {/* Khung thẻ có border: media + footer CTA */}
                <View style={[{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.card }, shadow(c, 1)]}>
                  <Pressable onPress={() => pickMedia(i)} style={{ aspectRatio: 1, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    {card.preview || card.picture ? (
                      <Image source={{ uri: card.preview || card.picture }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    ) : (
                      <Image source={uploadImg} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
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
                      <Body weight="700" size={14} numberOfLines={1}>{card.name || `Thẻ ${i + 1}`}</Body>
                      {card.description ? <Body muted size={12} numberOfLines={1}>{card.description}</Body> : null}
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
                <Field label="Mô tả" value={card.description} onChangeText={(t) => patchCard(i, { description: t })} placeholder="Nhập mô tả thẻ" />
                {needUrl ? <Field label="Website URL" value={card.websiteUrl} onChangeText={(t) => patchCard(i, { websiteUrl: t })} placeholder="https://metus.vn" keyboardType="url" /> : null}
              </Card>
            );
          })}

          {/* Nội dung + hẹn lịch (ở dưới) */}
          <Card>
            <Field label="Nội dung bài viết" value={primaryText} onChangeText={setPrimaryText} multiline placeholder="Nhập nội dung bài đăng" />
            <Row style={{ justifyContent: 'space-between' }}>
              <Body weight="600" size={14}>Hẹn lịch</Body>
              <Switch value={scheduleEnabled} onValueChange={toggleSchedule} trackColor={{ true: c.accent }} />
            </Row>
            {scheduleEnabled ? (
              <Pressable onPress={() => setPickerOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 13 }}>
                <Ionicons name="calendar" size={18} color="#f97316" />
                <Body size={14.5} weight="600" color={scheduleAt ? c.text : c.faint}>{scheduleAt ? fmtDateTime(scheduleAt) : 'Chọn ngày giờ'}</Body>
                <View style={{ flex: 1 }} />
                {scheduleAt ? <Pressable onPress={() => setScheduleAt(null)} hitSlop={8}><Ionicons name="close" size={18} color={c.faint} /></Pressable> : null}
                <Ionicons name="time-outline" size={18} color={c.faint} />
              </Pressable>
            ) : null}
            <Row style={{ justifyContent: 'space-between' }}>
              <Body weight="600" size={14}>Tự động like sau khi đăng</Body>
              <Switch value={likeEnabled} onValueChange={setLikeEnabled} trackColor={{ true: c.accent }} />
            </Row>
          </Card>

          {error ? <Body color={c.danger} size={13}>{error}</Body> : null}
          <Button title={scheduleEnabled ? 'Hẹn lịch đăng' : 'Đăng bài'} icon={scheduleEnabled ? 'time' : 'send'} onPress={create} loading={creating} full />

          {posts.length ? (
            <Card>
              <Label>Kết quả ({posts.filter((p) => p.status === 'done').length}/{posts.length})</Label>
              <ResultList
                items={posts}
                keyOf={(p) => p.pageId}
                render={(p) => (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{p.pageName}</Text>
                      {p.status === 'error' && p.note ? <Body muted size={12} numberOfLines={2}>{p.note}</Body> : null}
                    </View>
                    <Badge text={p.status === 'done' ? 'Đã đăng' : p.status === 'error' ? 'Lỗi' : '...'} tone={p.status === 'done' ? 'success' : p.status === 'error' ? 'danger' : 'muted'} />
                  </Row>
                )}
              />
            </Card>
          ) : null}
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
      <PickerModal visible={fbPicker} title="Tài khoản Facebook" onClose={() => setFbPicker(false)} items={accounts}
        keyOf={(a) => a.id} labelOf={(a) => a.name} avatarOf={(a) => a.picture} selectedKeys={current ? [current.id] : []}
        onToggle={(a) => select(a.id)} />
      <PickerModal visible={pagePicker} title="Chọn trang" onClose={() => setPagePicker(false)} items={pages} multi
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={selectedPageIds}
        onToggle={(p) => togglePage(p.id)} />
      <PickerModal visible={adsPicker} title="Tài khoản quảng cáo" onClose={() => setAdsPicker(false)} items={adAccounts}
        keyOf={(a) => a.id} labelOf={(a) => `${a.name} (${a.account_id ?? a.id})`} selectedKeys={adAccount ? [adAccount.id] : []}
        onToggle={(a) => setAdAccount(a)} />
      <PickerModal visible={ctaCard !== null} title="Tùy chọn nút" onClose={() => setCtaCard(null)} items={CTA_ACTIONS}
        keyOf={(a) => a.value} labelOf={(a) => a.label} selectedKeys={ctaCard !== null ? [cards[ctaCard].CTAButton] : []}
        onToggle={(a) => { if (ctaCard !== null) patchCard(ctaCard, { CTAButton: a.value }); }} />
      <DateTimePickerModal visible={pickerOpen} value={scheduleAt} onClose={() => setPickerOpen(false)} onConfirm={(d) => { setScheduleAt(d); setPickerOpen(false); }} />
    </>
  );
}

export default function FbVideoCarouselScreen() {
  return (
    <Screen>
      <ToolGate>{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
