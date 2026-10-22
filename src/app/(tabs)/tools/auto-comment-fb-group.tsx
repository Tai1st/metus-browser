import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { fmtDateTime } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { AdvancedCycle, fmtClock, fmtCycle, nextCustomRun } from '@/components/cycle';
import { GroupPicker, parseGroupId } from '@/components/groupPicker';
import { CenterModal, ModalFooter, RandomButtons, SectionTitle, SmallBtn, StepField, TickBox, exportJson, importJson } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Card, Field, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError, type MetusUser } from '@/lib/api';
import { joinGroupRequest } from '@/lib/fb/AutoJoinFbGroup';
import { useAdsSession } from '@/lib/fb/adsSession';
import { editComment, getGroupInfo, getGroupPostIds, getGroups, getLinkPreview, postComment, type CommentRange, type GroupItem, type LocalFile } from '@/lib/fb/Group';
import { useT } from '@/lib/i18n';
import { notifyNow } from '@/lib/notify';
import { pickMedia } from '@/lib/pickMedia';
import { spinContent } from '@/lib/spin';
import * as storage from '@/lib/storage';
import * as bg from '@metus/background';

/**
 * Bình luận nhóm tự động — port từ metus-few features/tools/group/auto-comment-fb-group.
 * Chọn nhóm (danh sách / UID nhóm / UID bài viết) → lấy N bài mới nhất mỗi nhóm →
 * bình luận (ảnh, tag {{EID(id)}}, số thứ tự {STT}, spin), lách bộ lọc admin (sửa
 * bình luận ngay sau khi tạo), nhiều luồng + delay, kịch bản, bộ lọc, chu trình.
 */

const REQUIRED_GROUP_IDS = ['886673622422686', '297274412711704'];
const sleep = (ms: number) => bg.sleep(ms);

interface CommentScenario {
  id: string;
  name: string;
  content: string;
  photo: LocalFile | null;
  enabled: boolean;
}

interface CommentPreset {
  id: string;
  name: string;
  content: string;
  photo: LocalFile | null;
  selectedGroupIds: string[];
  selectedPostIds: string[];
  thread: number;
  delayMin: number;
  delayMax: number;
  createdAt: number;
}

interface FormState {
  content: string;
  photo: LocalFile | null;
  isChecked: boolean;
  tagId: string;
  thread: number;
  delayMin: number;
  delayMax: number;
  limitComment: number;
  repeatEnabled: boolean;
  cycleMode: 'frequency' | 'custom';
  repeatIntervalHours: number;
  customTimes: string[];
  scenarioMode: 'random' | 'sequential';
}

interface Stored {
  form?: Partial<FormState>;
  selectedGroups?: string[];
  scenarios?: CommentScenario[];
  presets?: CommentPreset[];
}

type Status = 'pending' | 'success' | 'failed';
interface CommentItem {
  key: string;
  group: GroupItem;
  postId: string;
  status: Status;
  url?: string | null;
  note?: string;
}

const DEFAULT_FORM: FormState = {
  content: '',
  photo: null,
  isChecked: false,
  tagId: '',
  thread: 3,
  delayMin: 30,
  delayMax: 500,
  limitComment: 1,
  repeatEnabled: false,
  cycleMode: 'frequency',
  repeatIntervalHours: 24,
  customTimes: ['09:00'],
  scenarioMode: 'random',
};

const isFbLink = (s: string) => /^https?:\/\/(www\.|m\.)?facebook\.com\//.test(s) || /^https?:\/\/fb\.watch\//.test(s);

/** {{EID(id)}} → range tag người dùng (getTagNameRange của metus-few). */
function tagRange(input: string): CommentRange | null {
  const m = input.match(/{{EID\((\d+)\)}}/);
  if (!m) return null;
  return { entity: { id: m[1] }, length: m[0].length, offset: input.indexOf(m[0]) };
}

async function pickPhoto(): Promise<LocalFile | null> {
  const [a] = await pickMedia('image');
  return a ? { uri: a.uri, name: a.name, type: a.mimeType ?? 'image/jpeg', size: a.size } : null;
}

// ───────────────────────────── Ảnh bình luận ─────────────────────────────

function PhotoSlot({ photo, onChange, disabled, size = 84 }: { photo: LocalFile | null; onChange: (p: LocalFile | null) => void; disabled?: boolean; size?: number }) {
  const c = useColors();
  const t = useT();
  if (photo) {
    return (
      <View style={{ alignSelf: 'flex-start' }}>
        <Image source={{ uri: photo.uri }} style={{ width: size, height: size, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border }} />
        {!disabled ? (
          <Pressable onPress={() => onChange(null)} hitSlop={6}
            style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={13} color="#fff" />
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <Pressable disabled={disabled} onPress={async () => { const p = await pickPhoto(); if (p) onChange(p); }}
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.accentSoft, opacity: disabled ? 0.5 : 1 }}>
      <Ionicons name="image-outline" size={16} color={c.accent} />
      <Text style={{ fontSize: 13, fontWeight: '600', color: c.accent }}>{t('gc.addPhoto')}</Text>
    </Pressable>
  );
}

// ───────────────────────────── Chọn nhanh Group (bộ lọc) ─────────────────────────────

function CommentPresetBar({ presets, setPresets, disabled, onSave, onLoad }: {
  presets: CommentPreset[]; setPresets: React.Dispatch<React.SetStateAction<CommentPreset[]>>; disabled?: boolean;
  onSave: (name: string) => void; onLoad: (p: CommentPreset) => void;
}) {
  const c = useColors();
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const doImport = async () => {
    const arr = await importJson(t);
    if (!arr) return;
    setPresets((prev) => [
      ...arr.map((p: any) => ({
        id: p.id ?? Crypto.randomUUID(), name: p.name ?? 'Preset', content: p.content ?? '', photo: p.photo ?? null,
        selectedGroupIds: p.selectedGroupIds ?? [], selectedPostIds: p.selectedPostIds ?? [], thread: p.thread ?? 3,
        delayMin: p.delayMin ?? 30, delayMax: p.delayMax ?? 500, createdAt: p.createdAt ?? Date.now(),
      })),
      ...prev,
    ]);
  };
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 10, gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6 }}>
        <SectionTitle>{t('gp.presetTitle')}{presets.length ? ` (${presets.length})` : ''}</SectionTitle>
        <Row gap={6}>
          <SmallBtn icon="cloud-upload-outline" label={t('gp.import')} tone="amber" disabled={disabled} onPress={doImport} />
          <SmallBtn icon="cloud-download-outline" label={t('gp.export')} tone="emerald" disabled={disabled || !presets.length} onPress={() => exportJson(`comment_presets_${Date.now()}.json`, presets, t)} />
          <SmallBtn icon="add" label={t('common.save')} tone="green" disabled={disabled} onPress={() => setName(t('gp.presetDefault', { n: presets.length + 1 }))} />
        </Row>
      </Row>
      {presets.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {presets.map((p) => (
            <Pressable key={p.id} disabled={disabled} onPress={() => onLoad(p)} onLongPress={() => showDialog(p.name, fmtDateTime(new Date(p.createdAt)))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 9, paddingRight: 5, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#bfdbfe', backgroundColor: 'rgba(59,130,246,0.08)', opacity: disabled ? 0.5 : 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#1d4ed8' }} numberOfLines={1}>{p.name}</Text>
              {p.selectedPostIds.length ? (
                <Row gap={2}><Ionicons name="document-text" size={11} color="#3b82f6" /><Text style={{ fontSize: 11, color: '#3b82f6' }}>{p.selectedPostIds.length}</Text></Row>
              ) : (
                <Row gap={2}><Ionicons name="people" size={11} color="#3b82f6" /><Text style={{ fontSize: 11, color: '#3b82f6' }}>{p.selectedGroupIds.length}</Text></Row>
              )}
              {p.photo ? <Ionicons name="image" size={11} color="#3b82f6" /> : null}
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

// ───────────────────────────── Kịch bản bình luận ─────────────────────────────

function CommentScenarioSection({ scenarios, setScenarios, mode, setMode, disabled, defaultContent, defaultPhoto }: {
  scenarios: CommentScenario[]; setScenarios: React.Dispatch<React.SetStateAction<CommentScenario[]>>;
  mode: 'random' | 'sequential'; setMode: (m: 'random' | 'sequential') => void; disabled?: boolean;
  defaultContent: string; defaultPhoto: LocalFile | null;
}) {
  const c = useColors();
  const t = useT();
  const [draft, setDraft] = useState<CommentScenario | null>(null);
  const enabled = scenarios.filter((s) => s.enabled).length;
  const doImport = async () => {
    const arr = await importJson(t);
    if (!arr) return;
    setScenarios((prev) => [
      ...prev,
      ...arr.map((s: any) => ({ id: s.id ?? Crypto.randomUUID(), name: s.name ?? t('gp.scenario'), content: s.content ?? '', photo: s.photo ?? null, enabled: s.enabled ?? true })),
    ]);
  };
  const save = () => {
    if (!draft) return;
    if (!draft.content.trim()) return showDialog(t('gc.scNeedContent'));
    setScenarios((prev) => (prev.some((s) => s.id === draft.id) ? prev.map((s) => (s.id === draft.id ? draft : s)) : [...prev, draft]));
    setDraft(null);
  };
  return (
    <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 10, gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6 }}>
        <SectionTitle>🎭 {t('gp.scenario')}{scenarios.length ? ` ${t('gp.scEnabledCount', { on: enabled, total: scenarios.length })}` : ''}</SectionTitle>
        <View style={{ flexDirection: 'row', borderRadius: 7, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          {(['random', 'sequential'] as const).map((m) => (
            <Pressable key={m} disabled={disabled} onPress={() => setMode(m)}
              style={{ paddingHorizontal: 8, paddingVertical: 5, backgroundColor: mode === m ? '#3b82f6' : c.card }}>
              <Text style={{ fontSize: 11.5, fontWeight: '600', color: mode === m ? '#fff' : c.muted }}>{t(m === 'random' ? 'gp.random' : 'gp.sequential')}</Text>
            </Pressable>
          ))}
        </View>
      </Row>
      <Row gap={6} style={{ justifyContent: 'flex-end' }}>
        <SmallBtn icon="cloud-upload-outline" label={t('gp.import')} tone="amber" disabled={disabled} onPress={doImport} />
        <SmallBtn icon="cloud-download-outline" label={t('gp.export')} tone="emerald" disabled={disabled || !scenarios.length} onPress={() => exportJson(`comment_scenarios_${Date.now()}.json`, scenarios, t)} />
        <SmallBtn icon="add" label={t('gp.scAdd')} tone="blue" disabled={disabled}
          onPress={() => setDraft({ id: Crypto.randomUUID(), name: t('gp.scenarioDefault', { n: scenarios.length + 1 }), content: defaultContent, photo: defaultPhoto, enabled: true })} />
      </Row>
      {!scenarios.length ? (
        <Text style={{ fontSize: 12, fontStyle: 'italic', color: c.faint }}>{t(mode === 'sequential' ? 'gp.scEmptySeq' : 'gp.scEmpty')}</Text>
      ) : (
        <View style={{ gap: 6 }}>
          {scenarios.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.input }}>
              <Pressable disabled={disabled} hitSlop={6} onPress={() => setScenarios((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))}>
                <Ionicons name={s.enabled ? 'checkbox' : 'square-outline'} size={19} color={s.enabled ? c.accent : c.faint} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: c.text }}>{s.name}</Text>
                <Text numberOfLines={1} style={{ fontSize: 11, color: c.faint }}>{s.content}</Text>
              </View>
              {s.photo ? <Image source={{ uri: s.photo.uri }} style={{ width: 24, height: 24, borderRadius: 4, borderWidth: 1, borderColor: c.border }} /> : null}
              <Pressable disabled={disabled} hitSlop={6} onPress={() => setDraft({ ...s })}><Ionicons name="create-outline" size={17} color="#3b82f6" /></Pressable>
              <Pressable disabled={disabled} hitSlop={6} onPress={() => setScenarios((prev) => prev.filter((x) => x.id !== s.id))}><Ionicons name="close" size={17} color="#ef4444" /></Pressable>
            </View>
          ))}
        </View>
      )}
      {draft ? (
        <CenterModal visible title={t('gp.scEditTitle')} onClose={() => setDraft(null)} footer={<ModalFooter onCancel={() => setDraft(null)} onSave={save} />}>
          <Field label={t('gp.scenarioName')} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder={t('gp.scNamePh')} />
          <Field label={t('gp.scenarioContent')} value={draft.content} onChangeText={(content) => setDraft({ ...draft, content })} multiline placeholder={t('gc.contentPh')} />
          <RandomButtons compact onInsert={(x) => setDraft({ ...draft, content: draft.content + x })} />
          <Label>{t('gp.scPhotosTab')}</Label>
          <PhotoSlot photo={draft.photo} onChange={(photo) => setDraft({ ...draft, photo })} />
        </CenterModal>
      ) : null}
    </View>
  );
}

// ───────────────────────────── Runner ─────────────────────────────

function Runner({ dtsg, fbId, user }: { dtsg: string; fbId: string; user: MetusUser | null }) {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const adsToken = ads?.token ?? '';
  const plan = user?.plan as { price?: number } | null | undefined;
  const isFreePlan = !plan || (plan.price ?? 0) <= 0;

  const stored = useMemo(() => storage.get<Stored>(storage.StorageKey.AUTO_COMMENT_GROUP) ?? {}, []);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM, ...stored.form });
  const [scenarios, setScenarios] = useState<CommentScenario[]>(stored.scenarios ?? []);
  const [presets, setPresets] = useState<CommentPreset[]>(stored.presets ?? []);
  const [selected, setSelected] = useState<string[]>(stored.selectedGroups ?? []);
  useEffect(() => {
    storage.set(storage.StorageKey.AUTO_COMMENT_GROUP, { form, scenarios, presets, selectedGroups: selected } satisfies Stored);
  }, [form, scenarios, presets, selected]);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Nhóm
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualRaw, setManualRaw] = useState('');
  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      setGroups(await getGroups(dtsg, fbId));
    } catch (e) {
      showDialog(t('gp.loadGroupsErr'), describeError(e));
    } finally {
      setGroupsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtsg, fbId]);
  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Gói miễn phí: tự tham gia nhóm bắt buộc (giống metus-few)
  const joinedRef = useRef(false);
  useEffect(() => {
    if (!isFreePlan || groupsLoading || !groups.length || joinedRef.current) return;
    joinedRef.current = true;
    const have = new Set(groups.map((g) => g.id));
    (async () => {
      for (const groupId of REQUIRED_GROUP_IDS.filter((id) => !have.has(id))) await joinGroupRequest({ dtsg, fbId, groupId }).catch(() => {});
    })();
  }, [isFreePlan, groups, groupsLoading, dtsg, fbId]);

  // Nhập UID bài viết (link Facebook tự đổi ra ID bài)
  const [postActive, setPostActive] = useState(false);
  const [postRaw, setPostRaw] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveErrors, setResolveErrors] = useState<string[]>([]);
  const postLines = postRaw.split('\n').map((l) => l.trim()).filter(Boolean);
  const postIds = Array.from(new Set(postLines.filter((l) => /^\d+(_\d+)?$/.test(l))));
  const invalidPosts = postLines.filter((l) => !/^\d+(_\d+)?$/.test(l) && !isFbLink(l));
  const pendingLinks = postLines.filter(isFbLink).length;
  useEffect(() => {
    if (!postActive || !pendingLinks) return;
    const timer = setTimeout(async () => {
      setResolving(true);
      const errors: string[] = [];
      const out = await Promise.all(
        postLines.map(async (line) => {
          if (!isFbLink(line)) return line;
          try {
            const { scrapeStr } = await getLinkPreview(dtsg, fbId, line);
            const o = scrapeStr ? JSON.parse(scrapeStr) : null;
            const id = Array.isArray(o?.share_params) && o.share_params[0] ? String(o.share_params[0]) : o?.object_id ? String(o.object_id) : null;
            if (id) return id;
          } catch {
            // giữ lỗi bên dưới
          }
          errors.push(line);
          return line;
        }),
      );
      setPostRaw(out.join('\n'));
      setResolveErrors(errors);
      setResolving(false);
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postRaw, postActive]);

  const groupIds = useMemo(
    () => (manual ? Array.from(new Set(manualRaw.split('\n').map(parseGroupId).filter((x): x is string => !!x))) : selected),
    [manual, manualRaw, selected],
  );
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // Chạy
  const [items, setItems] = useState<CommentItem[]>([]);
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState({ cur: 0, total: 0 });
  const [delayLeft, setDelayLeft] = useState<number | null>(null);
  const [cycleAt, setCycleAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const seqRef = useRef(0);
  const counterRef = useRef(0);

  const patch = (key: string, p: Partial<CommentItem>) => setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const comment = async (item: CommentItem): Promise<boolean> => {
    try {
      const enabled = scenarios.filter((s) => s.enabled && s.content.trim());
      let sc: CommentScenario | null = null;
      if (enabled.length) sc = form.scenarioMode === 'sequential' ? enabled[seqRef.current++ % enabled.length] : enabled[Math.floor(Math.random() * enabled.length)];
      const raw = sc ? sc.content : form.content;
      const photo = sc ? sc.photo : form.photo;
      const range = tagRange(raw);
      let text = raw.replace(/{{EID\(\d+\)}}/, '');
      // {STT} / {STT[n]} → số thứ tự bình luận
      text = text.replace(/\{STT(?:\[(\d+)\])?\}/, (_m, base?: string) => String((base ? +base : 1) + counterRef.current));
      text = spinContent(text);
      const numericId = item.postId.split('_')[1] || item.postId.split('_')[0];
      const res = await postComment({ dtsg, fbId, postId: numericId, text, photo, ranges: range ? [range] : [] });
      if (form.isChecked && res.legacyToken) {
        await editComment({ dtsg, fbId, legacyToken: res.legacyToken, text, attachments: res.attachments, ranges: range ? [range] : [] });
      }
      counterRef.current++;
      patch(item.key, { status: 'success', url: res.url });
      return true;
    } catch (e) {
      patch(item.key, { status: 'failed', note: describeError(e) });
      return false;
    }
  };

  const run = async () => {
    if (runningRef.current) return;
    const usingPosts = postActive;
    if (usingPosts ? !postIds.length : !groupIds.length) return showDialog(t('gp.needGroup'));
    if (!scenarios.some((s) => s.enabled && s.content.trim()) && !form.content.trim()) return showDialog(t('gc.needContent'));
    if (!usingPosts && !adsToken) return showDialog(t('gc.needAds'));

    stopRef.current = false;
    runningRef.current = true;
    setRunning(true);
    setCycleAt(null);
    setItems([]);
    seqRef.current = 0;

    // Danh sách bài: chế độ UID bài viết = 1 mục/UID, chế độ nhóm = limitComment mục/nhóm
    const all: CommentItem[] = [];
    if (usingPosts) {
      for (const id of postIds) all.push({ key: `${id}-${Crypto.randomUUID()}`, group: { id, name: `Post ${id}`, isAdmin: false }, postId: id, status: 'pending' });
    } else {
      for (const gid of groupIds) {
        if (stopRef.current) break;
        let g = groupById.get(gid);
        if (!g) g = await getGroupInfo(dtsg, fbId, gid).catch(() => ({ id: gid, name: gid, isAdmin: false }));
        try {
          const ids = await getGroupPostIds(gid, adsToken, Math.max(1, form.limitComment));
          for (const pid of ids) all.push({ key: `${pid}-${Crypto.randomUUID()}`, group: g, postId: pid, status: 'pending' });
        } catch (e) {
          all.push({ key: `${gid}-${Crypto.randomUUID()}`, group: g, postId: '', status: 'failed', note: describeError(e) });
        }
      }
    }
    const todo = all.filter((x) => x.postId);
    setItems(all.filter((x) => !x.postId));
    if (!todo.length) {
      runningRef.current = false;
      setRunning(false);
      return showDialog(t('gc.noPosts'));
    }

    const thread = Math.max(1, form.thread);
    setBatch({ cur: 0, total: Math.ceil(todo.length / thread) });
    let okCount = 0;
    let failCount = 0;
    for (let i = 0, b = 0; i < todo.length && !stopRef.current; i += thread, b++) {
      setBatch((x) => ({ ...x, cur: b + 1 }));
      const part = todo.slice(i, i + thread);
      setItems((prev) => [...prev, ...part]);
      const rs = await Promise.all(part.map(comment));
      okCount += rs.filter(Boolean).length;
      failCount += rs.filter((r) => !r).length;
      if (i + thread < todo.length && !stopRef.current) {
        const wait = Math.random() * Math.max(0, form.delayMax - form.delayMin) + form.delayMin;
        const end = Date.now() + wait * 1000;
        while (Date.now() < end && !stopRef.current) {
          setDelayLeft((end - Date.now()) / 1000);
          await sleep(200);
        }
        setDelayLeft(null);
      }
    }

    const stopped = stopRef.current;
    runningRef.current = false;
    setRunning(false);
    setBatch({ cur: 0, total: 0 });
    setDelayLeft(null);
    if (okCount + failCount > 0) notifyNow(t('gc.bgTitle'), t('notify.commentDone', { ok: okCount, fail: failCount }));
    if (!stopped && form.repeatEnabled && !isFreePlan) {
      setCycleAt(form.cycleMode === 'custom' ? nextCustomRun(form.customTimes)?.getTime() ?? null : Date.now() + form.repeatIntervalHours * 3600_000);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!cycleAt) return;
    let cancelled = false;
    (async () => {
      while (!cancelled && Date.now() < cycleAt) await sleep(Math.min(cycleAt - Date.now(), 15_000));
      if (!cancelled && !runningRef.current) {
        setCycleAt(null);
        runRef.current();
      }
    })();
    const ui = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(ui);
    };
  }, [cycleAt]);

  // Chạy nền
  const bgActive = running || cycleAt !== null;
  const bgText = running ? t('gp.bgRunning', { cur: batch.cur, total: batch.total }) : cycleAt ? t('gp.bgNext', { time: fmtDateTime(new Date(cycleAt)) }) : '';
  useEffect(() => {
    if (bgActive) bg.start(t('gc.bgTitle'), bgText).catch(() => {});
    else bg.stop().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgActive]);
  useEffect(() => {
    if (bgActive) bg.update(t('gc.bgTitle'), bgText).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgText]);
  useEffect(() => () => {
    bg.stop().catch(() => {});
  }, []);

  const stop = () => {
    stopRef.current = true;
    setCycleAt(null);
    setDelayLeft(null);
  };
  const startCustomCycle = () => {
    if (postActive ? !postIds.length : !groupIds.length) return showDialog(t('gp.needGroup'));
    const next = nextCustomRun(form.customTimes);
    if (!next) return showDialog(t('gp.invalidTimes'));
    setCycleAt(next.getTime());
  };

  const savePreset = (name: string) =>
    setPresets((prev) => [
      {
        id: Crypto.randomUUID(), name: name.trim() || t('gp.presetDefault', { n: prev.length + 1 }), content: form.content, photo: form.photo,
        selectedGroupIds: postActive ? [] : groupIds, selectedPostIds: postActive ? postIds : [], thread: form.thread,
        delayMin: form.delayMin, delayMax: form.delayMax, createdAt: Date.now(),
      },
      ...prev,
    ]);
  const loadPreset = (p: CommentPreset) => {
    setForm((f) => ({ ...f, content: p.content, photo: p.photo, thread: p.thread, delayMin: p.delayMin, delayMax: p.delayMax }));
    if (p.selectedPostIds.length) {
      setManual(false);
      setPostActive(true);
      setPostRaw(p.selectedPostIds.join('\n'));
    } else {
      setPostActive(false);
      setManual(false);
      setSelected(p.selectedGroupIds);
    }
  };

  const waiting = cycleAt !== null && !running;
  const done = items.filter((x) => x.status === 'success').length;
  const cycleBlocked = isFreePlan && form.repeatEnabled;

  return (
    <>
      <GroupPicker groups={groups} loading={groupsLoading} onReload={loadGroups} selected={selected} setSelected={setSelected}
        manual={manual} setManual={setManual} manualRaw={manualRaw} setManualRaw={setManualRaw} disabled={running || waiting}
        post={{ active: postActive, setActive: setPostActive, raw: postRaw, setRaw: setPostRaw, valid: postIds.length, invalid: invalidPosts, pendingLinks, resolving, errors: resolveErrors }} />

      <Card>
        {/* Nội dung bình luận */}
        <TextInput
          value={form.content}
          onChangeText={(v) => set('content', v)}
          editable={!running}
          multiline
          placeholder={t('gc.contentPh')}
          placeholderTextColor={c.faint}
          style={{ minHeight: 90, borderRadius: radius.md, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input, color: c.text, fontSize: 14.5, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top', opacity: running ? 0.6 : 1 }}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TickBox label={t('gc.bypassAdmin')} value={form.isChecked} disabled={running} onBlocked={() => {}} onChange={(v) => set('isChecked', v)} />
        </View>

        <CommentPresetBar presets={presets} setPresets={setPresets} disabled={running} onSave={savePreset} onLoad={loadPreset} />

        <PhotoSlot photo={form.photo} onChange={(p) => set('photo', p)} disabled={running} />

        <CommentScenarioSection scenarios={scenarios} setScenarios={setScenarios} mode={form.scenarioMode} setMode={(m) => set('scenarioMode', m)}
          disabled={running} defaultContent={form.content} defaultPhoto={form.photo} />

        {/* RANDOM + tag người dùng */}
        <View style={{ gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 8 }}>
          <RandomButtons compact disabled={running} onInsert={(x) => set('content', form.content + x)} />
          <Field value={form.tagId} onChangeText={(v) => set('tagId', v.replace(/\D/g, ''))} editable={!running} keyboardType="number-pad" placeholder={t('gc.tagPh')}
            icon="at" rightIcon="add" onRightIconPress={() => form.tagId.trim() && set('content', `${form.content}{{EID(${form.tagId.trim()})}}`)} />
        </View>

        {/* Luồng / delay / giới hạn */}
        <Row>
          <View style={{ flex: 1 }}><StepField label={t('gc.thread')} value={form.thread} min={1} onChange={(v) => set('thread', v)} disabled={running} /></View>
          <View style={{ flex: 1 }}><StepField label={t('gc.delayMin')} value={form.delayMin} min={0} onChange={(v) => setForm((f) => ({ ...f, delayMin: v, delayMax: Math.max(v, f.delayMax) }))} disabled={running} /></View>
          <View style={{ flex: 1 }}><StepField label={t('gc.delayMax')} value={form.delayMax} min={0} onChange={(v) => setForm((f) => ({ ...f, delayMax: Math.max(v, f.delayMin) }))} disabled={running} /></View>
        </Row>
        <StepField label={t('gc.limitPerGroup')} value={form.limitComment} min={1} onChange={(v) => set('limitComment', v)} disabled={running || postActive} />

        <AdvancedCycle
          enabled={form.repeatEnabled}
          setEnabled={(v) => set('repeatEnabled', v)}
          blockedReason={null}
          disabled={running || waiting}
          cycleMode={form.cycleMode}
          setCycleMode={(m) => set('cycleMode', m)}
          hours={form.repeatIntervalHours}
          setHours={(h) => set('repeatIntervalHours', h)}
          times={form.customTimes}
          setTimes={(ts) => set('customTimes', ts)}
          nextRun={waiting && form.cycleMode === 'custom' ? fmtClock(((cycleAt ?? now) - now) / 1000) : null}
        />

        {/* Nút chạy (giống metus-few) */}
        {(() => {
          let title: string;
          let color: string;
          let onPress: () => void;
          if (running) {
            color = '#ef4444';
            title = `${delayLeft !== null && delayLeft > 0 ? t('gp.waitingBtn', { s: delayLeft.toFixed(1) }) : t('gp.runningBtn', { cur: batch.cur, total: batch.total })} (${t('gp.stop')})`;
            onPress = stop;
          } else if (waiting && form.cycleMode === 'frequency') {
            color = '#8b5cf6';
            title = `⏳ ${t('gp.nextCycleIn')} ${fmtCycle(((cycleAt ?? now) - now) / 1000)} (${t('gp.stop')})`;
            onPress = stop;
          } else if (waiting) {
            color = '#8b5cf6';
            title = `⏰ ${fmtClock(((cycleAt ?? now) - now) / 1000)} (${t('gp.stop')})`;
            onPress = stop;
          } else if (cycleBlocked) {
            color = c.faint;
            title = t('gc.comment');
            onPress = () => showDialog(t('gp.advancedCycle'), t('gp.paidOnly'));
          } else if (form.repeatEnabled && form.cycleMode === 'custom') {
            color = '#8b5cf6';
            title = t('gp.activateSchedule');
            onPress = startCustomCycle;
          } else {
            color = c.accent;
            title = t('gc.comment');
            onPress = run;
          }
          return (
            <Pressable onPress={onPress} style={({ pressed }) => [{ backgroundColor: color, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', opacity: pressed || cycleBlocked ? 0.7 : 1 }, shadow(c, 1)]}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{title}</Text>
            </Pressable>
          );
        })()}
      </Card>

      {/* Kết quả */}
      {items.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('gp.results', { done, total: items.length })}</Label>
            {!running ? <Pressable onPress={() => setItems([])} hitSlop={8}><Body size={12} color={c.danger} weight="600">{t('common.delete')}</Body></Pressable> : null}
          </Row>
          <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled contentContainerStyle={{ gap: 8 }}>
            {items.map((x) => (
              <Pressable key={x.key} onPress={() => x.url && Linking.openURL(x.url)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                {x.group.picture ? <Image source={{ uri: x.group.picture }} style={{ width: 32, height: 32, borderRadius: 8 }} /> : <Ionicons name="chatbubbles" size={24} color={c.faint} />}
                <View style={{ flex: 1 }}>
                  <Body weight="600" size={14} numberOfLines={1}>{x.group.name}</Body>
                  <Body muted size={11} numberOfLines={2}>{x.note ?? x.postId}</Body>
                </View>
                {x.status === 'pending' ? <ActivityIndicator color={c.accent} /> : <Badge text={t(x.status === 'success' ? 'gc.commented' : 'gp.failed')} tone={x.status === 'success' ? 'success' : 'danger'} />}
              </Pressable>
            ))}
          </ScrollView>
        </Card>
      ) : null}
    </>
  );
}

export default function AutoCommentFbGroupScreen() {
  return (
    <Screen>
      {/* metus-few: requireLogin=false → không chặn theo gói */}
      <ToolGate require="none">{(dtsg, fbId, user) => <Runner dtsg={dtsg} fbId={fbId} user={user} />}</ToolGate>
    </Screen>
  );
}
