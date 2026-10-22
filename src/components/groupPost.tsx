/**
 * Thành phần dùng chung cho tool "Đăng bài nhóm" — port từ metus-few:
 * - BgComposer: ô soạn nội dung có nền chữ (nút Aa + 9 màu nhanh + "+")
 * - BgPresetModal: bảng nền chữ đầy đủ của Facebook
 * - RandomButtons: chèn {{RAN_T}}, {{RAN_D}}, {{RAN_M}}, spin
 * - PresetBar: "Chọn nhanh Group" (PostPresetList)
 * - ScenarioSection + ScenarioEditModal: "Kịch bản" (PostScenarioList)
 */
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { Body, Field, Label, Row, radius, shadow, useColors } from '@/components/ui';
import { getTextFormatPresets, type LocalFile, type TextFormatPreset, type TextFormatPresetData } from '@/lib/fb/Group';
import { useT } from '@/lib/i18n';
import { pickMedia } from '@/lib/pickMedia';

// ───────────────────────────── Kiểu dữ liệu ─────────────────────────────

export interface TextBg {
  color: string;
  image?: string;
}

export interface Scenario {
  id: string;
  name: string;
  content: string;
  link: string;
  photos: LocalFile[];
  video?: LocalFile | null;
  enabled: boolean;
  textFormatPresetId?: string;
  textFormatBg?: TextBg;
}

export interface Preset {
  id: string;
  name: string;
  content: string;
  link: string;
  photos: LocalFile[];
  selectedGroupIds: string[];
  textFormatPresetId?: string;
  textFormatBg?: TextBg;
  thread: number;
  delayMin: number;
  delayMax: number;
  createdAt: number;
}

/** 9 màu nhanh của metus-few (colorOptions) — trắng = không dùng nền. */
export const QUICK_BG: { color: string; presetId: string }[] = [
  { color: '#ffffff', presetId: '' },
  { color: '#c600ff', presetId: '106018623298955' },
  { color: '#e2013b', presetId: '1903718606535395' },
  { color: '#111111', presetId: '1881421442117417' },
  { color: '#ff0047', presetId: '249307305544279' },
  { color: '#5d3fda', presetId: '1777259169190672' },
  { color: '#5d6374', presetId: '122708641613922' },
  { color: '#ba4d59', presetId: '446330032368780' },
  { color: '#ec00be', presetId: '219266485227663' },
];
const AA_ICON = 'https://www.facebook.com/images/composer/SATP_Aa_square-2x.png';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ───────────────────────────── Modal chung ─────────────────────────────

export function CenterModal({ visible, title, onClose, children, footer }: { visible: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View style={[{ backgroundColor: c.bg, borderRadius: 20, padding: 20, gap: 12, maxHeight: '88%' }, shadow(c, 2)]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body weight="700" size={18}>{title}</Body>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={c.faint} /></Pressable>
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>{children}</ScrollView>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Nút Hủy / Lưu ở chân modal (giống metus-few). */
export function ModalFooter({ onCancel, onSave, saveLabel }: { onCancel: () => void; onSave: () => void; saveLabel?: string }) {
  const c = useColors();
  const t = useT();
  return (
    <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
      <Pressable onPress={onCancel} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: c.input }}>
        <Text style={{ color: c.muted, fontWeight: '600' }}>{t('common.cancel')}</Text>
      </Pressable>
      <Pressable onPress={onSave} style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: c.accent }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{saveLabel ?? t('common.save')}</Text>
      </Pressable>
    </Row>
  );
}

// ───────────────────────────── Nền chữ ─────────────────────────────

let presetCache: { key: string; data: TextFormatPresetData } | null = null;

/** Bảng nền chữ đầy đủ của Facebook ("Dùng nhiều" + các danh mục). */
export function BgPresetModal({ visible, onClose, onPick, selectedId, dtsg, fbId, pageId }: {
  visible: boolean; onClose: () => void; onPick: (presetId: string, bg: TextBg) => void; selectedId?: string; dtsg: string; fbId: string; pageId?: string;
}) {
  const c = useColors();
  const t = useT();
  const key = `${fbId}:${pageId ?? ''}`;
  const [data, setData] = useState<TextFormatPresetData | null>(presetCache?.key === key ? presetCache.data : null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!visible || data) return;
    setLoading(true);
    getTextFormatPresets(dtsg, fbId, pageId)
      .then((d) => {
        presetCache = { key, data: d };
        setData(d);
      })
      .catch(() => showDialog(t('gp.loadBgErr')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return (
    <CenterModal visible={visible} title={t('gp.bg')} onClose={onClose}>
      {loading ? (
        <Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>{t('gp.loadingBg')}</Body></Row>
      ) : (
        [{ name: t('gp.bgRanked'), presets: data?.ranked ?? [] }, ...(data?.categories ?? [])]
          .filter((sec) => sec.presets.length)
          .map((sec) => (
            <View key={sec.name} style={{ gap: 8 }}>
              <Body size={12} weight="700" color={c.muted}>{sec.name}</Body>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {sec.presets.map((p: TextFormatPreset) => {
                  const on = selectedId === p.id;
                  const img = p.image ?? p.thumb;
                  return (
                    <Pressable key={`${sec.name}-${p.id}`} onPress={() => onPick(p.id, { color: p.color, image: img })}
                      style={{ width: 56, height: 56, borderRadius: 6, overflow: 'hidden', backgroundColor: p.color, borderWidth: on ? 3 : 0, borderColor: '#a3e635' }}>
                      {img ? <Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
      )}
    </CenterModal>
  );
}

/** Ô soạn nội dung có nền chữ (giống metus-few). onLocked: gói miễn phí bấm nút Aa. */
export function BgComposer({ value, onChangeText, bg, presetId, onPick, onMore, disabled, onLocked, placeholder, minHeight = 200 }: {
  value: string; onChangeText: (v: string) => void; bg?: TextBg; presetId?: string; onPick: (presetId: string, bg?: TextBg) => void;
  onMore: () => void; disabled?: boolean; onLocked?: () => void; placeholder?: string; minHeight?: number;
}) {
  const c = useColors();
  const [picker, setPicker] = useState(false);
  const on = !!bg;
  return (
    <View style={{ minHeight, borderRadius: radius.md, borderWidth: 1, borderColor: c.inputBorder, overflow: 'hidden', backgroundColor: bg?.color ?? c.input, opacity: disabled ? 0.6 : 1 }}>
      {bg?.image ? <Image source={{ uri: bg.image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        multiline
        placeholder={placeholder}
        placeholderTextColor={on ? 'rgba(255,255,255,0.75)' : c.faint}
        style={{
          minHeight, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 56,
          color: on ? '#fff' : c.text, fontSize: on ? 24 : 14.5, fontWeight: on ? '700' : '400',
          textAlign: on ? 'center' : 'left', textAlignVertical: on ? 'center' : 'top',
        }}
      />
      <View style={{ position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {!picker ? (
          <Pressable disabled={disabled} onPress={() => (onLocked ? onLocked() : setPicker(true))} style={{ opacity: onLocked ? 0.4 : 1 }}>
            <Image source={{ uri: AA_ICON }} style={{ width: 38, height: 38, borderRadius: 8 }} />
          </Pressable>
        ) : (
          <>
            <Pressable onPress={() => setPicker(false)} style={[{ width: 30, height: 30, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }, shadow(c, 1)]}>
              <Ionicons name="chevron-back" size={18} color={c.text} />
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, alignItems: 'center', paddingRight: 4 }}>
              {QUICK_BG.map((q) => {
                const sel = q.presetId ? presetId === q.presetId : !presetId;
                return (
                  <Pressable key={q.color} disabled={disabled} onPress={() => onPick(q.presetId, q.presetId ? { color: q.color } : undefined)}
                    style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: q.color, borderWidth: sel ? 2.5 : 1, borderColor: sel ? '#a3e635' : 'rgba(0,0,0,0.15)' }} />
                );
              })}
              <Pressable disabled={disabled} onPress={onMore}
                style={{ width: 30, height: 30, borderRadius: 7, borderWidth: 2, borderStyle: 'dashed', borderColor: c.faint, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card }}>
                <Ionicons name="add" size={16} color={c.muted} />
              </Pressable>
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

// ───────────────────────────── RANDOM T / D / M / SPIN ─────────────────────────────

export const RANDOM_INSERTS: { key: string; label: string; insert: string }[] = [
  { key: 'T', label: 'RANDOM T', insert: '{{RAN_T (18)}}' },
  { key: 'D', label: 'RANDOM D', insert: '{{RAN_D (18)}}' },
  { key: 'M', label: 'RANDOM M', insert: '{{RAN_M (18)}}' },
  { key: 'S', label: 'RANDOM SPIN', insert: '[[ nội dung 1 || nội dung 2 || nội dung 3 ]]' },
];

export function RandomButtons({ onInsert, disabled, compact }: { onInsert: (text: string) => void; disabled?: boolean; compact?: boolean }) {
  const c = useColors();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', gap: 6, borderWidth: compact ? 0 : 2, borderColor: c.border, borderRadius: radius.md, padding: compact ? 0 : 8 }}>
      {RANDOM_INSERTS.map((r) => (
        <Pressable key={r.key} disabled={disabled}
          onPress={() => onInsert(r.key === 'S' ? t('gp.spinSample') : r.insert)}
          onLongPress={() => showDialog(r.label, t(`gp.randomHint${r.key}`))}
          style={{ flex: 1, alignItems: 'center', paddingVertical: compact ? 5 : 7, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.input, opacity: disabled ? 0.5 : 1 }}>
          <Text numberOfLines={1} style={{ fontSize: compact ? 10 : 10.5, fontWeight: '800', color: c.muted }}>{compact ? r.label.replace('RANDOM ', '') : r.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ───────────────────────────── Nhập / Xuất JSON ─────────────────────────────

/** Xuất JSON: chọn thư mục (SAF) rồi ghi file. */
export async function exportJson(fileName: string, data: unknown, t: (k: string, v?: Record<string, string | number>) => string) {
  try {
    const SAF = FS.StorageAccessFramework;
    const perm = await SAF.requestDirectoryPermissionsAsync();
    if (!perm.granted) return;
    const uri = await SAF.createFileAsync(perm.directoryUri, fileName, 'application/json');
    await FS.writeAsStringAsync(uri, JSON.stringify(data, null, 2));
    showDialog(t('gp.exported'), fileName);
  } catch (e) {
    showDialog(t('gp.exportErr'), e instanceof Error ? e.message : String(e));
  }
}

/** Nhập JSON: chọn file .json → mảng (hoặc null). */
export async function importJson(t: (k: string) => string): Promise<unknown[] | null> {
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: ['application/json', 'text/plain', '*/*'] });
  if (r.canceled || !r.assets[0]) return null;
  try {
    const parsed = JSON.parse(await FS.readAsStringAsync(r.assets[0].uri));
    if (!Array.isArray(parsed)) throw new Error('JSON phải là một mảng');
    return parsed;
  } catch (e) {
    showDialog(t('gp.importErr'), e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function SmallBtn({ icon, label, tone, onPress, disabled }: { icon: IconName; label: string; tone: 'amber' | 'emerald' | 'green' | 'blue'; onPress: () => void; disabled?: boolean }) {
  const col = { amber: '#d97706', emerald: '#059669', green: '#16a34a', blue: '#2563eb' }[tone];
  const bgc = { amber: 'rgba(245,158,11,0.10)', emerald: 'rgba(16,185,129,0.10)', green: 'rgba(34,197,94,0.10)', blue: 'rgba(59,130,246,0.10)' }[tone];
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: col, backgroundColor: bgc, opacity: disabled ? 0.4 : 1 }}>
      <Ionicons name={icon} size={12} color={col} />
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: col }}>{label}</Text>
    </Pressable>
  );
}

export const SectionTitle = ({ children }: { children: ReactNode }) => {
  const c = useColors();
  return <Text style={{ fontSize: 11, fontWeight: '800', color: c.muted, textTransform: 'uppercase', flexShrink: 1 }}>{children}</Text>;
};

// ───────────────────────────── Chọn nhanh Group (bộ lọc) ─────────────────────────────

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function PresetBar({ presets, setPresets, disabled, onSave, onLoad }: {
  presets: Preset[]; setPresets: React.Dispatch<React.SetStateAction<Preset[]>>; disabled?: boolean;
  /** Tạo bộ lọc từ form hiện tại với tên đã nhập. */
  onSave: (name: string) => void; onLoad: (p: Preset) => void;
}) {
  const c = useColors();
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const doImport = async () => {
    const arr = await importJson(t);
    if (!arr) return;
    const imported: Preset[] = arr.map((p: any) => ({
      id: p.id ?? Crypto.randomUUID(), name: p.name ?? t('gp.presetDefault', { n: '' }).trim(), content: p.content ?? '', link: p.link ?? '',
      photos: Array.isArray(p.photos) ? p.photos : [], selectedGroupIds: p.selectedGroupIds ?? [], textFormatPresetId: p.textFormatPresetId,
      textFormatBg: p.textFormatBg, thread: p.thread ?? 3, delayMin: p.delayMin ?? 3, delayMax: p.delayMax ?? 5, createdAt: p.createdAt ?? Date.now(),
    }));
    setPresets((prev) => [...imported, ...prev]);
  };
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 10, gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6 }}>
        <SectionTitle>{t('gp.presetTitle')}{presets.length ? ` (${presets.length})` : ''}</SectionTitle>
        <Row gap={6}>
          <SmallBtn icon="cloud-upload-outline" label={t('gp.import')} tone="amber" disabled={disabled} onPress={doImport} />
          <SmallBtn icon="cloud-download-outline" label={t('gp.export')} tone="emerald" disabled={disabled || !presets.length} onPress={() => exportJson(`post_presets_${Date.now()}.json`, presets, t)} />
          <SmallBtn icon="add" label={t('common.save')} tone="green" disabled={disabled} onPress={() => setName(t('gp.presetDefault', { n: presets.length + 1 }))} />
        </Row>
      </Row>
      {presets.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {presets.map((p) => (
            <Pressable key={p.id} disabled={disabled} onPress={() => onLoad(p)} onLongPress={() => showDialog(p.name, fmtDate(p.createdAt))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 9, paddingRight: 5, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#bfdbfe', backgroundColor: 'rgba(59,130,246,0.08)', opacity: disabled ? 0.5 : 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#1d4ed8' }} numberOfLines={1}>{p.name}</Text>
              <Row gap={2}><Ionicons name="people" size={11} color="#3b82f6" /><Text style={{ fontSize: 11, color: '#3b82f6' }}>{p.selectedGroupIds.length}</Text></Row>
              {p.photos.length ? <Row gap={2}><Ionicons name="image" size={11} color="#3b82f6" /><Text style={{ fontSize: 11, color: '#3b82f6' }}>{p.photos.length}</Text></Row> : null}
              {p.link ? <Ionicons name="link" size={11} color="#3b82f6" /> : null}
              <Pressable hitSlop={6} disabled={disabled} onPress={() => setPresets((prev) => prev.filter((x) => x.id !== p.id))}>
                <Ionicons name="close" size={13} color="#93c5fd" />
              </Pressable>
            </Pressable>
          ))}
        </View>
      ) : null}
      <CenterModal visible={name !== null} title={t('gp.savePreset')} onClose={() => setName(null)}
        footer={<ModalFooter onCancel={() => setName(null)} onSave={() => { onSave(name ?? ''); setName(null); }} />}>
        <Field label={t('gp.presetName')} value={name ?? ''} onChangeText={setName} placeholder={t('gp.presetNamePh')} autoFocus />
      </CenterModal>
    </View>
  );
}

// ───────────────────────────── Kịch bản ─────────────────────────────

function ScenarioCard({ s, disabled, onToggle, onEdit, onRemove }: { s: Scenario; disabled?: boolean; onToggle: () => void; onEdit: () => void; onRemove: () => void }) {
  const c = useColors();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.input }}>
      <Pressable onPress={onToggle} disabled={disabled} hitSlop={6}>
        <Ionicons name={s.enabled ? 'checkbox' : 'square-outline'} size={19} color={s.enabled ? c.accent : c.faint} />
      </Pressable>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600', color: c.text }}>{s.name || t('gp.scenario')}</Text>
      <Row gap={4}>
        {s.textFormatBg ? <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: c.border, backgroundColor: s.textFormatBg.color }} /> : null}
        {s.link ? <Ionicons name="chatbox-ellipses-outline" size={14} color="#60a5fa" /> : null}
        {s.photos.slice(0, 2).map((p, i) => <Image key={i} source={{ uri: p.uri }} style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 1, borderColor: c.border }} />)}
        {s.photos.length > 2 ? <Text style={{ fontSize: 10, color: c.faint }}>+{s.photos.length - 2}</Text> : null}
        {s.video ? <Ionicons name="videocam-outline" size={14} color="#f472b6" /> : null}
      </Row>
      <Pressable onPress={onEdit} disabled={disabled} hitSlop={6}><Ionicons name="create-outline" size={17} color="#3b82f6" /></Pressable>
      <Pressable onPress={onRemove} disabled={disabled} hitSlop={6}><Ionicons name="close" size={17} color="#ef4444" /></Pressable>
    </View>
  );
}

type MediaTab = 'link' | 'photos' | 'video';

function ScenarioEditModal({ draft, setDraft, onSave, onCancel, dtsg, fbId, pageId, locked }: {
  draft: Scenario | null; setDraft: (s: Scenario | null) => void; onSave: () => void; onCancel: () => void;
  dtsg: string; fbId: string; pageId?: string; locked?: () => void;
}) {
  const c = useColors();
  const t = useT();
  const [tab, setTab] = useState<MediaTab>('link');
  const [bgOpen, setBgOpen] = useState(false);
  useEffect(() => {
    if (draft) setTab(draft.video ? 'video' : draft.photos.length ? 'photos' : 'link');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);
  if (!draft) return null;
  const patch = (p: Partial<Scenario>) => setDraft({ ...draft, ...p });
  const tabs: { k: MediaTab; label: string; icon: IconName; color: string; badge?: string }[] = [
    { k: 'link', label: t('gp.scLinkTab'), icon: 'chatbox-ellipses-outline', color: '#60a5fa', badge: draft.link ? '✓' : undefined },
    { k: 'photos', label: t('gp.scPhotosTab'), icon: 'image-outline', color: '#22c55e', badge: draft.photos.length ? `(${draft.photos.length})` : undefined },
    { k: 'video', label: t('gp.scVideoTab'), icon: 'videocam-outline', color: '#ec4899', badge: draft.video ? '✓' : undefined },
  ];
  return (
    <>
      <CenterModal visible title={t('gp.scEditTitle')} onClose={onCancel} footer={<ModalFooter onCancel={onCancel} onSave={onSave} />}>
        <Field label={t('gp.scenarioName')} value={draft.name} onChangeText={(name) => patch({ name })} placeholder={t('gp.scNamePh')} />
        <View style={{ gap: 6 }}>
          <Label>{t('gp.scenarioContent')}</Label>
          <BgComposer value={draft.content} onChangeText={(content) => patch({ content })} bg={draft.textFormatBg} presetId={draft.textFormatPresetId}
            onPick={(id, bg) => patch({ textFormatPresetId: id || undefined, textFormatBg: id ? bg : undefined })} onMore={() => setBgOpen(true)}
            onLocked={locked} placeholder={t('gp.scContentPh')} minHeight={150} />
          <RandomButtons compact onInsert={(s) => patch({ content: draft.content + s })} />
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {tabs.map((tb) => {
            const on = tab === tb.k;
            return (
              <Pressable key={tb.k} onPress={() => setTab(tb.k)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: 7, borderWidth: 1, borderColor: on ? tb.color : c.border, backgroundColor: on ? tb.color : c.card }}>
                <Ionicons name={tb.icon} size={15} color={on ? '#fff' : tb.color} />
                <Text style={{ fontSize: 12, fontWeight: on ? '700' : '500', color: on ? '#fff' : c.muted }}>{tb.label}{tb.badge ? ` ${tb.badge}` : ''}</Text>
              </Pressable>
            );
          })}
        </View>
        {tab === 'link' ? (
          <Field value={draft.link} onChangeText={(link) => patch({ link })} placeholder="https://..." autoCapitalize="none" keyboardType="url" icon="link-outline" />
        ) : tab === 'photos' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {draft.photos.map((p, i) => (
              <View key={`${p.uri}-${i}`}>
                <Image source={{ uri: p.uri }} style={{ width: 58, height: 58, borderRadius: 6, borderWidth: 1, borderColor: c.border }} />
                <Pressable onPress={() => patch({ photos: draft.photos.filter((_, k) => k !== i) })} hitSlop={6}
                  style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={async () => {
                const picked = await pickMedia('image', true);
                if (!picked.length) return;
                patch({ photos: [...draft.photos, ...picked.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? 'image/jpeg', size: a.size }))], video: null });
              }}
              style={{ width: 58, height: 58, borderRadius: 6, borderWidth: 2, borderStyle: 'dashed', borderColor: c.faint, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={22} color={c.faint} />
            </Pressable>
          </View>
        ) : draft.video ? (
          <Row style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.input }}>
            <Ionicons name="videocam-outline" size={16} color="#ec4899" />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: c.text }}>{draft.video.name}</Text>
            <Pressable onPress={() => patch({ video: null })} hitSlop={6}><Ionicons name="close" size={16} color={c.faint} /></Pressable>
          </Row>
        ) : (
          <Pressable
            onPress={async () => {
              const [a] = await pickMedia('video');
              if (!a) return;
              patch({ video: { uri: a.uri, name: a.name, type: a.mimeType ?? 'video/mp4', size: a.size }, photos: [] });
            }}
            style={{ paddingVertical: 12, borderRadius: 8, borderWidth: 2, borderStyle: 'dashed', borderColor: c.faint, alignItems: 'center' }}>
            <Text style={{ fontSize: 13, color: c.muted }}>+ {t('gp.scAddVideo')}</Text>
          </Pressable>
        )}
      </CenterModal>
      <BgPresetModal visible={bgOpen} onClose={() => setBgOpen(false)} selectedId={draft.textFormatPresetId} dtsg={dtsg} fbId={fbId} pageId={pageId}
        onPick={(id, bg) => { patch({ textFormatPresetId: id, textFormatBg: bg }); setBgOpen(false); }} />
    </>
  );
}

export function ScenarioSection({ scenarios, setScenarios, mode, setMode, disabled, snapshot, dtsg, fbId, pageId, locked }: {
  scenarios: Scenario[]; setScenarios: React.Dispatch<React.SetStateAction<Scenario[]>>;
  mode: 'random' | 'sequential'; setMode: (m: 'random' | 'sequential') => void; disabled?: boolean;
  /** Nội dung form hiện tại — kịch bản mới điền sẵn từ đây (giống metus-few). */
  snapshot: Omit<Scenario, 'id' | 'name' | 'enabled'>;
  dtsg: string; fbId: string; pageId?: string; locked?: () => void;
}) {
  const c = useColors();
  const t = useT();
  const [draft, setDraft] = useState<Scenario | null>(null);
  const enabled = scenarios.filter((s) => s.enabled).length;
  const doImport = async () => {
    const arr = await importJson(t);
    if (!arr) return;
    setScenarios((prev) => [
      ...prev,
      ...arr.map((s: any) => ({
        id: s.id ?? Crypto.randomUUID(), name: s.name ?? t('gp.scenario'), content: s.content ?? '', link: s.link ?? '', enabled: s.enabled ?? true,
        photos: Array.isArray(s.photos) ? s.photos : [], video: null, textFormatPresetId: s.textFormatPresetId, textFormatBg: s.textFormatBg,
      })),
    ]);
  };
  const save = () => {
    if (!draft) return;
    if (!draft.content.trim() && !draft.photos.length && !draft.video && !draft.link.trim()) return showDialog(t('gp.scenarioNeedContent'));
    setScenarios((prev) => (prev.some((s) => s.id === draft.id) ? prev.map((s) => (s.id === draft.id ? draft : s)) : [...prev, draft]));
    setDraft(null);
  };
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 10, gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6 }}>
        <SectionTitle>🎭 {t('gp.scenario')}{scenarios.length ? ` ${t('gp.scEnabledCount', { on: enabled, total: scenarios.length })}` : ''}</SectionTitle>
        <Row gap={6}>
          <View style={{ flexDirection: 'row', borderRadius: 7, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
            {(['random', 'sequential'] as const).map((m) => (
              <Pressable key={m} disabled={disabled} onPress={() => setMode(m)}
                onLongPress={() => showDialog(t(m === 'random' ? 'gp.random' : 'gp.sequential'), t(m === 'random' ? 'gp.scModeRandomHint' : 'gp.scModeSeqHint'))}
                style={{ paddingHorizontal: 8, paddingVertical: 5, backgroundColor: mode === m ? '#3b82f6' : c.card }}>
                <Text style={{ fontSize: 11.5, fontWeight: '600', color: mode === m ? '#fff' : c.muted }}>{t(m === 'random' ? 'gp.random' : 'gp.sequential')}</Text>
              </Pressable>
            ))}
          </View>
        </Row>
      </Row>
      <Row gap={6} style={{ justifyContent: 'flex-end' }}>
        <SmallBtn icon="cloud-upload-outline" label={t('gp.import')} tone="amber" disabled={disabled} onPress={doImport} />
        <SmallBtn icon="cloud-download-outline" label={t('gp.export')} tone="emerald" disabled={disabled || !scenarios.length}
          onPress={() => exportJson(`post_scenarios_${Date.now()}.json`, scenarios.map(({ video: _v, ...s }) => s), t)} />
        <SmallBtn icon="add" label={t('gp.scAdd')} tone="blue" disabled={disabled}
          onPress={() => setDraft({ id: Crypto.randomUUID(), name: t('gp.scenarioDefault', { n: scenarios.length + 1 }), enabled: true, ...snapshot })} />
      </Row>
      {!scenarios.length ? (
        <Text style={{ fontSize: 12, fontStyle: 'italic', color: c.faint }}>{t(mode === 'sequential' ? 'gp.scEmptySeq' : 'gp.scEmpty')}</Text>
      ) : (
        <View style={{ gap: 6 }}>
          {scenarios.map((s) => (
            <ScenarioCard key={s.id} s={s} disabled={disabled}
              onToggle={() => setScenarios((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))}
              onEdit={() => setDraft({ ...s })}
              onRemove={() => setScenarios((prev) => prev.filter((x) => x.id !== s.id))} />
          ))}
        </View>
      )}
      <ScenarioEditModal draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setDraft(null)} dtsg={dtsg} fbId={fbId} pageId={pageId} locked={locked} />
    </View>
  );
}

/** Ô tick nhỏ (Đăng chéo / Chế độ ẩn danh). Bị khoá thì bấm vào để xem lý do. */
export function TickBox({ label, value, disabled, onChange, onBlocked }: { label: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void; onBlocked: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={() => (disabled ? onBlocked() : onChange(!value))} hitSlop={6}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: disabled && !value ? 0.5 : 1 }}>
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={17} color={value ? c.accent : c.faint} />
      <Body size={13} color={c.muted}>{label}</Body>
    </Pressable>
  );
}

/** Ô số có nút −/+ (NumberStepper của metus-few). */
export function StepField({ label, value, onChange, min = 0, step = 1, disabled }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number; disabled?: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: c.muted }} numberOfLines={1}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, backgroundColor: c.input, opacity: disabled ? 0.6 : 1 }}>
        <Pressable disabled={disabled} onPress={() => onChange(Math.max(min, +(value - step).toFixed(2)))} style={{ paddingHorizontal: 8, paddingVertical: 8 }}><Ionicons name="remove" size={15} color={c.text} /></Pressable>
        <TextInput value={String(value)} editable={!disabled} keyboardType="decimal-pad"
          onChangeText={(v) => onChange(Math.max(min, Number(v.replace(/[^\d.]/g, '')) || 0))}
          style={{ flex: 1, textAlign: 'center', fontWeight: '700', color: c.text, paddingVertical: 6 }} />
        <Pressable disabled={disabled} onPress={() => onChange(+(value + step).toFixed(2))} style={{ paddingHorizontal: 8, paddingVertical: 8 }}><Ionicons name="add" size={15} color={c.text} /></Pressable>
      </View>
    </View>
  );
}
