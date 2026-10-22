import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { DateTimePickerModal, PickerModal, SelectorRow, fmtDateTime } from '@/components/AdPostTool';
import { AdvancedCycle, fmtClock, fmtCycle, nextCustomRun, parseTimes } from '@/components/cycle';
import { GroupPicker, parseGroupId } from '@/components/groupPicker';
import { BgComposer, BgPresetModal, CenterModal, PresetBar, RandomButtons, ScenarioSection, TickBox, type Preset, type Scenario, type TextBg } from '@/components/groupPost';
import { showDialog } from '@/components/Dialog';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, Segmented, radius, shadow, useColors } from '@/components/ui';
import type { MetusUser } from '@/lib/api';
import { joinGroupRequest } from '@/lib/fb/AutoJoinFbGroup';
import { useAdsSession } from '@/lib/fb/adsSession';
import { useFbAccounts } from '@/lib/fb/accounts';
import {
  createComment,
  createGroupPost,
  getAnonymousProfileId,
  getGroupInfo,
  getGroups,
  getLinkPreview,
  getPageProfiles,
  uploadGroupImage,
  uploadGroupVideo,
  type GroupItem,
  type PageProfile,
  type LocalFile,
} from '@/lib/fb/Group';
import { describeError } from '@/lib/api';
import { spinContent } from '@/lib/spin';
import { useT } from '@/lib/i18n';
import { pickMedia } from '@/lib/pickMedia';
import * as storage from '@/lib/storage';
import * as bg from '@metus/background';

/**
 * Đăng bài nhóm tự động — port từ metus-few features/tools/group/auto-post-fb-group.
 * Gồm: chọn nhóm (danh sách / nhập UID), đăng với tư cách Page, ảnh/video/link,
 * nền chữ, ẩn danh, cross-post, hẹn giờ (nhóm admin), bình luận sau khi đăng,
 * chạy nhiều luồng + delay ngẫu nhiên, lặp lại, kịch bản và bộ lọc đã lưu.
 * Gói miễn phí: tắt các tính năng trả phí + tự tham gia nhóm bắt buộc (giống metus-few).
 */

// Nhóm bắt buộc với gói miễn phí (metus-few REQUIRED_GROUP_IDS)
const REQUIRED_GROUP_IDS = ['886673622422686', '297274412711704'];

type Attach = 'text' | 'photos' | 'video';
type PostStatus = 'pending' | 'success' | 'failed';
type CommentStatus = 'pending' | 'success' | 'failed';

interface FormData {
  content: string;
  link: string;
  attach: Attach;
  photos: LocalFile[];
  video: LocalFile | null;
  pageId?: string;
  anonymous: boolean;
  crossPost: boolean;
  textFormatPresetId?: string;
  /** Nền chữ đang chọn (để hiển thị trong ô soạn). */
  textFormatBg?: TextBg;
  scheduledAt?: number;
  autoCommentEnabled: boolean;
  autoCommentContent: string;
  autoCommentPhoto?: LocalFile | null;
  thread: number;
  delayMin: number;
  delayMax: number;
  repeatEnabled: boolean;
  cycleMode: 'frequency' | 'custom';
  repeatIntervalHours: number;
  customTimes: string[];
  scenarioMode: 'random' | 'sequential';
}

interface PostItem {
  key: string;
  group: GroupItem;
  status: PostStatus;
  url: string | null;
  note?: string;
  commentStatus?: CommentStatus;
  commentUrl?: string | null;
}

interface Stored {
  form?: Partial<FormData>;
  scenarios?: Scenario[];
  presets?: Preset[];
}

const DEFAULT_FORM: FormData = {
  content: '',
  link: '',
  attach: 'text',
  photos: [],
  video: null,
  anonymous: false,
  crossPost: false,
  autoCommentEnabled: false,
  autoCommentContent: '',
  thread: 3,
  delayMin: 3,
  delayMax: 5,
  repeatEnabled: false,
  cycleMode: 'frequency',
  repeatIntervalHours: 24,
  customTimes: ['09:00'],
  scenarioMode: 'random',
};

const ATTACH_KEY: Record<Attach, string> = { text: 'gp.attachText', photos: 'gp.attachPhotos', video: 'gp.attachVideo' };
// Chờ bằng Handler native (vẫn chạy khi app ở nền / tắt màn hình)
const sleep = (ms: number) => bg.sleep(ms);
async function pickImages(): Promise<LocalFile[]> {
  return (await pickMedia('image', true)).map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? 'image/jpeg', size: a.size }));
}

// ───────────────────────────── Ảnh đính kèm ─────────────────────────────

function PhotoStrip({ photos, onChange, disabled }: { photos: LocalFile[]; onChange: (p: LocalFile[]) => void; disabled?: boolean }) {
  const c = useColors();
  const t = useT();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {photos.map((p, i) => (
        <View key={`${p.uri}-${i}`} style={{ width: 84, height: 84, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
          <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} />
          {!disabled ? (
            <Pressable onPress={() => onChange(photos.filter((_, k) => k !== i))} hitSlop={6}
              style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 2 }}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      ))}
      {!disabled ? (
        <Pressable onPress={async () => onChange([...photos, ...(await pickImages())])}
          style={{ width: 84, height: 84, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft }}>
          <Ionicons name="add" size={26} color={c.accent} />
          <Body size={11} color={c.accent} weight="600">{t('gp.addPhoto')}</Body>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// ───────────────────────────── Runner ─────────────────────────────

function Runner({ dtsg, fbId, user }: { dtsg: string; fbId: string; user: MetusUser | null }) {
  const c = useColors();
  const t = useT();
  const { current } = useFbAccounts();
  const { ads } = useAdsSession();
  const adsPages = ads?.pages ?? [];
  // Page trải nghiệm mới: hành động bằng ID hồ sơ (i_user), không phải ID Page Graph
  const [profiles, setProfiles] = useState<PageProfile[]>([]);
  useEffect(() => {
    getPageProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, [fbId]);
  // Form đã lưu ID Page kiểu Graph (bản trước) → đổi sang ID hồ sơ
  useEffect(() => {
    const pf = profiles.find((p) => p.pageId && p.pageId === form.pageId);
    if (pf) setForm((f) => ({ ...f, pageId: pf.profileId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);
  /** Danh sách "Đăng với tư cách": id = ID hành động (ID hồ sơ nếu có, không thì ID Page). */
  const pages = useMemo(() => {
    const byPage = new Map(profiles.filter((p) => p.pageId).map((p) => [p.pageId!, p]));
    const list: { id: string; name: string; picture?: string }[] = adsPages.map((pg) => {
      const pf = byPage.get(pg.id);
      return { id: pf?.profileId ?? pg.id, name: pg.name, picture: pg.picture ?? pf?.picture };
    });
    for (const pf of profiles) if (!list.some((x) => x.id === pf.profileId)) list.push({ id: pf.profileId, name: pf.name, picture: pf.picture });
    return list;
  }, [adsPages, profiles]);
  const plan = user?.plan as { price?: number } | null | undefined;
  const isFreePlan = !plan || (plan.price ?? 0) <= 0;

  const stored = useMemo(() => storage.get<Stored>(storage.StorageKey.AUTO_POST_GROUP) ?? {}, []);
  const [form, setForm] = useState<FormData>(() => {
    const f = { ...DEFAULT_FORM, ...stored.form, scheduledAt: undefined } as FormData;
    // bản cũ lưu customTimes dạng chuỗi "09:00, 14:30"
    const ct = f.customTimes as unknown;
    if (typeof ct === 'string') f.customTimes = parseTimes(ct).length ? parseTimes(ct) : ['09:00'];
    return f;
  });
  const [scenarios, setScenarios] = useState<Scenario[]>(stored.scenarios ?? []);
  const [presets, setPresets] = useState<Preset[]>(stored.presets ?? []);
  useEffect(() => {
    // video là file tạm lớn → không lưu
    storage.set(storage.StorageKey.AUTO_POST_GROUP, { form: { ...form, video: null, scheduledAt: undefined }, scenarios, presets } satisfies Stored);
  }, [form, scenarios, presets]);
  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Nhóm
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [manualRaw, setManualRaw] = useState('');
  // Đăng với tư cách Page → lấy nhóm của Page (request gắn i_user=<pageId>)
  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      setGroups(await getGroups(dtsg, fbId, form.pageId));
    } catch (e) {
      showDialog(t('gp.loadGroupsErr'), describeError(e));
    } finally {
      setGroupsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtsg, fbId, form.pageId]);
  useEffect(() => {
    setGroups([]);
    setSelected([]);
    loadGroups();
  }, [loadGroups]);

  // Gói miễn phí: tự tham gia nhóm bắt buộc (chạy ngầm 1 lần, giống metus-few)
  const joinedRef = useRef(false);
  useEffect(() => {
    if (!isFreePlan || form.pageId || groupsLoading || !groups.length || joinedRef.current) return;
    joinedRef.current = true;
    const have = new Set(groups.map((g) => g.id));
    const missing = REQUIRED_GROUP_IDS.filter((id) => !have.has(id));
    (async () => {
      for (const groupId of missing) await joinGroupRequest({ dtsg, fbId, groupId }).catch(() => {});
    })();
  }, [isFreePlan, form.pageId, groups, groupsLoading, dtsg, fbId]);

  // Gói miễn phí: tắt các tính năng trả phí
  useEffect(() => {
    if (!isFreePlan) return;
    setForm((f) =>
      f.anonymous || f.crossPost || f.textFormatPresetId || f.scheduledAt || f.autoCommentEnabled
        ? { ...f, anonymous: false, crossPost: false, textFormatPresetId: undefined, textFormatBg: undefined, scheduledAt: undefined, autoCommentEnabled: false }
        : f,
    );
  }, [isFreePlan]);

  const targetIds = useMemo(
    () => (manual ? Array.from(new Set(manualRaw.split('\n').map(parseGroupId).filter((x): x is string => !!x))) : selected),
    [manual, manualRaw, selected],
  );
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const canSchedule = targetIds.length > 0 && targetIds.every((id) => groupById.get(id)?.isAdmin);
  useEffect(() => {
    if (form.scheduledAt && !canSchedule) set('scheduledAt', undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSchedule]);

  // Nền chữ
  const [bgOpen, setBgOpen] = useState(false);
  const pickBg = (presetId: string, bg?: TextBg) => setForm((f) => ({ ...f, textFormatPresetId: presetId || undefined, textFormatBg: presetId ? bg : undefined }));

  // Modal phụ
  const [pagePicker, setPagePicker] = useState(false);
  const [datePicker, setDatePicker] = useState(false);

  // Chạy
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState({ cur: 0, total: 0 });
  const [delayLeft, setDelayLeft] = useState<number | null>(null);
  const [cycleAt, setCycleAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const seqRef = useRef(0);
  const groupCache = useRef(new Map<string, GroupItem>());

  const patchPost = (key: string, patch: Partial<PostItem>) => setPosts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const resolveGroup = async (id: string): Promise<GroupItem> => {
    const known = groupById.get(id) ?? groupCache.current.get(id);
    if (known) return known;
    try {
      const g = await getGroupInfo(dtsg, fbId, id, form.pageId);
      groupCache.current.set(id, g);
      return g;
    } catch {
      return { id, name: id, isAdmin: false };
    }
  };

  type PostData = {
    content: string; link: string; photos: LocalFile[]; video: LocalFile | null; textFormatPresetId?: string;
    crossPostGroupIds?: string[]; scheduledPublishTime?: number; autoComment?: string; commentPhoto?: LocalFile | null;
  };

  const postToGroup = async (groupId: string, d: PostData, key: string): Promise<boolean> => {
    try {
      const attachments: unknown[] = [];
      if (d.video) {
        const id = await uploadGroupVideo({ dtsg, fbId, file: d.video, pageId: form.pageId });
        attachments.push({ video: { id } });
      } else if (d.link.trim()) {
        const { scrapeStr: scrape } = await getLinkPreview(dtsg, fbId, d.link.trim(), form.pageId);
        if (scrape) attachments.push({ link: { share_scrape_data: scrape } });
      } else if (d.photos.length) {
        const ids = await Promise.all(d.photos.map((file) => uploadGroupImage({ dtsg, fbId, file, pageId: form.pageId })));
        attachments.push(...ids.map((id) => ({ photo: { id } })));
      }

      let anonymousProfileId: string | undefined;
      if (form.anonymous && !form.pageId && !isFreePlan) anonymousProfileId = (await getAnonymousProfileId(dtsg, fbId, groupId)) ?? undefined;

      const { postId } = await createGroupPost({
        dtsg, fbId, groupId, text: spinContent(d.content), attachments,
        mode: anonymousProfileId ? 'anonymous' : 'normal', anonymousProfileId, pageId: form.pageId,
        // Nền chữ chỉ áp dụng cho bài chỉ có chữ
        textFormatPresetId: attachments.length ? undefined : d.textFormatPresetId,
        groupIds: d.crossPostGroupIds, scheduledPublishTime: d.scheduledPublishTime,
      });
      patchPost(key, { status: 'success', url: postId ? `https://www.facebook.com/${postId}` : `https://www.facebook.com/groups/${groupId}`, note: postId ? undefined : d.scheduledPublishTime ? t('gp.scheduled') : t('gp.sentPending') });

      if ((d.autoComment?.trim() || d.commentPhoto) && postId && !d.scheduledPublishTime) {
        patchPost(key, { commentStatus: 'pending' });
        try {
          await sleep(1500);
          const commentUrl = await createComment({ dtsg, fbId, postId, text: spinContent(d.autoComment ?? ''), pageId: form.pageId, photo: d.commentPhoto });
          patchPost(key, { commentStatus: 'success', commentUrl });
        } catch {
          patchPost(key, { commentStatus: 'failed' });
        }
      }
      return true;
    } catch (e) {
      patchPost(key, { status: 'failed', note: describeError(e) });
      return false;
    }
  };

  const run = async () => {
    if (runningRef.current) return;
    const ids = targetIds;
    if (!ids.length) return showDialog(t('gp.needGroup'));
    const enabledScenarios = scenarios.filter((s) => s.enabled);
    if (!enabledScenarios.length && !form.content.trim() && !(form.attach === 'photos' && form.photos.length) && !(form.attach === 'video' && form.video) && !(form.attach === 'text' && form.link.trim())) {
      return showDialog(t('gp.needContent'));
    }
    const crossPost = form.crossPost && !isFreePlan;
    if (crossPost && ids.length < 2) return showDialog(t('gp.crossNeed2'));
    const scheduledPublishTime = form.scheduledAt && !isFreePlan && canSchedule ? Math.floor(form.scheduledAt / 1000) : undefined;
    if (scheduledPublishTime && scheduledPublishTime * 1000 < Date.now() + 10 * 60000) return showDialog(t('gp.schedule10'));

    stopRef.current = false;
    runningRef.current = true;
    setRunning(true);
    setCycleAt(null);

    const mainIds = crossPost ? ids.slice(0, 1) : ids;
    const xpostIds = crossPost ? ids.slice(1) : [];
    const thread = Math.max(1, form.thread);
    setBatch({ cur: 0, total: Math.ceil(mainIds.length / thread) });

    for (let i = 0, b = 0; i < mainIds.length && !stopRef.current; i += thread, b++) {
      setBatch((x) => ({ ...x, cur: b + 1 }));
      const batchIds = mainIds.slice(i, i + thread);

      // Kịch bản: ngẫu nhiên hoặc lần lượt
      let sc: Scenario | null = null;
      if (enabledScenarios.length) {
        sc = form.scenarioMode === 'sequential' ? enabledScenarios[seqRef.current++ % enabledScenarios.length] : enabledScenarios[Math.floor(Math.random() * enabledScenarios.length)];
      }
      const data: PostData = {
        content: sc ? sc.content : form.content,
        link: sc ? sc.link : form.attach === 'text' ? form.link : '',
        photos: sc ? sc.photos : form.attach === 'photos' ? form.photos : [],
        video: sc ? (sc.video ?? null) : form.attach === 'video' ? form.video : null,
        textFormatPresetId: isFreePlan ? undefined : sc ? sc.textFormatPresetId : form.textFormatPresetId,
        crossPostGroupIds: xpostIds.length ? xpostIds : undefined,
        scheduledPublishTime,
        autoComment: form.autoCommentEnabled && !isFreePlan ? form.autoCommentContent : undefined,
        commentPhoto: form.autoCommentEnabled && !isFreePlan ? form.autoCommentPhoto ?? null : null,
      };

      const rows: PostItem[] = [];
      for (const id of [...batchIds, ...(b === 0 ? xpostIds : [])]) {
        rows.push({ key: `${id}-${Crypto.randomUUID()}`, group: await resolveGroup(id), status: 'pending', url: null });
      }
      setPosts((prev) => [...rows, ...prev]);

      const results = await Promise.all(batchIds.map((id, k) => postToGroup(id, data, rows[k].key)));
      // Cross-post: nhóm chính thành công thì các nhóm kèm theo cũng đã được Facebook nhận
      rows.slice(batchIds.length).forEach((r) =>
        patchPost(r.key, results[0] ? { status: 'success', url: `https://www.facebook.com/groups/${r.group.id}`, note: t('gp.crossPost') } : { status: 'failed', note: t('gp.mainFailed') }),
      );

      if (i + thread < mainIds.length && !stopRef.current) {
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

    // Lặp lại (chỉ khi app còn mở) — gói miễn phí không dùng được
    if (!stopped && form.repeatEnabled && !isFreePlan) {
      const next = form.cycleMode === 'custom' ? nextCustomRun(form.customTimes)?.getTime() ?? null : Date.now() + form.repeatIntervalHours * 3600_000;
      setCycleAt(next);
    }
  };

  const runRef = useRef(run);
  runRef.current = run;
  // Chờ tới lần lặp tiếp theo: kích hoạt bằng sleep native (chạy cả khi ở nền / tắt màn hình),
  // còn setInterval chỉ để cập nhật đồng hồ đếm ngược trên màn hình.
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

  // Chạy nền: khi đang đăng hoặc đang chờ chu trình → foreground service + thông báo
  const bgActive = running || cycleAt !== null;
  const bgText = running
    ? t('gp.bgRunning', { cur: batch.cur, total: batch.total })
    : cycleAt
      ? t('gp.bgNext', { time: fmtDateTime(new Date(cycleAt)) })
      : '';
  useEffect(() => {
    if (bgActive) bg.start(t('gp.bgTitle'), bgText).catch(() => {});
    else bg.stop().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgActive]);
  useEffect(() => {
    if (bgActive) bg.update(t('gp.bgTitle'), bgText).catch(() => {});
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
    if (!targetIds.length) return showDialog(t('gp.needGroup'));
    const next = nextCustomRun(form.customTimes);
    if (!next) return showDialog(t('gp.invalidTimes'));
    setCycleAt(next.getTime());
  };

  // Bộ lọc đã lưu
  const savePreset = (name: string) => {
    const p: Preset = {
      id: Crypto.randomUUID(), name: name.trim() || t('gp.presetDefault', { n: presets.length + 1 }), content: form.content, link: form.link, photos: form.photos,
      selectedGroupIds: targetIds, textFormatPresetId: form.textFormatPresetId, textFormatBg: form.textFormatBg,
      thread: form.thread, delayMin: form.delayMin, delayMax: form.delayMax, createdAt: Date.now(),
    };
    setPresets((prev) => [p, ...prev]);
  };
  const applyPreset = (p: Preset) => {
    setForm((f) => ({
      ...f, content: p.content, link: p.link, photos: p.photos, attach: p.link ? 'text' : p.photos.length ? 'photos' : 'text',
      textFormatPresetId: isFreePlan ? undefined : p.textFormatPresetId, textFormatBg: isFreePlan ? undefined : p.textFormatBg,
      thread: p.thread, delayMin: p.delayMin, delayMax: p.delayMax,
    }));
    setManual(false);
    setSelected(p.selectedGroupIds);
  };

  const pageName = form.pageId ? pages.find((p) => p.id === form.pageId)?.name : undefined;
  const pageAvatar = form.pageId ? pages.find((p) => p.id === form.pageId)?.picture : (current?.picture as string | undefined);
  const paid = (label: string) => (isFreePlan ? t('gp.paidSuffix', { label }) : label);
  const done = posts.filter((p) => p.status === 'success').length;
  const waiting = cycleAt !== null && !running;

  return (
    <>
      <GroupPicker groups={groups} loading={groupsLoading} onReload={loadGroups} selected={selected} setSelected={setSelected}
        manual={manual} setManual={setManual} manualRaw={manualRaw} setManualRaw={setManualRaw} disabled={running} />

      {/* Nội dung */}
      <Card>
        <SelectorRow label={t('gp.postAs')} avatar={pageAvatar} text={pageName ?? (current?.name as string | undefined) ?? t('gp.personal')} placeholder={t('gp.personal')} onPress={() => !running && setPagePicker(true)} />
        {/* Ô soạn nội dung có nền chữ (giống metus-few) */}
        <View style={{ gap: 6 }}>
          <Label>{t('gp.content')}</Label>
          <BgComposer value={form.content} onChangeText={(v) => set('content', v)} bg={form.textFormatBg} presetId={form.textFormatPresetId}
            onPick={pickBg} onMore={() => setBgOpen(true)} disabled={running} placeholder={t('gp.spinHint')}
            onLocked={isFreePlan ? () => showDialog(t('gp.bg'), t('gp.bgPaidOnly')) : undefined} />
          {form.textFormatPresetId && form.attach !== 'text' ? <Body muted size={11}>{t('gp.bgTextOnly')}</Body> : null}
        </View>

        {/* Đăng chéo + ẩn danh: ô tick nhỏ góc phải (giống metus-few) */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16 }}>
          <TickBox label={t('gp.crossPost')} value={form.crossPost} disabled={running || isFreePlan || targetIds.length < 2}
            onBlocked={() => showDialog(t('gp.crossPost'), isFreePlan ? t('gp.paidOnly') : t('gp.crossHintNeed'))} onChange={(v) => set('crossPost', v)} />
          <TickBox label={t('gp.anonymous')} value={form.anonymous} disabled={running || isFreePlan || !!form.pageId}
            onBlocked={() => showDialog(t('gp.anonymous'), form.pageId ? t('gp.anonPageHint') : t('gp.paidOnly'))} onChange={(v) => set('anonymous', v)} />
        </View>
        {form.crossPost ? <Body muted size={11}>{t('gp.crossHint')}</Body> : null}

        <AttachTabs value={form.attach} onChange={(v) => !running && set('attach', v)} />
        {form.attach === 'text' ? (
          <LinkInput value={form.link} onChange={(v) => set('link', v)} disabled={running} dtsg={dtsg} fbId={fbId} pageId={form.pageId} />
        ) : form.attach === 'photos' ? (
          <PhotoStrip photos={form.photos} onChange={(p) => set('photos', p)} disabled={running} />
        ) : (
          <Pressable disabled={running}
            onPress={async () => {
              const [a] = await pickMedia('video');
              if (a) set('video', { uri: a.uri, name: a.name, type: a.mimeType ?? 'video/mp4', size: a.size });
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.accentSoft }}>
            <Ionicons name="videocam" size={24} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Body weight="700" size={14} numberOfLines={1} color={c.accent}>{form.video ? form.video.name : t('gp.chooseVideo')}</Body>
              {form.video?.size ? <Body muted size={12}>{(form.video.size / 1048576).toFixed(1)} MB</Body> : null}
            </View>
            {form.video && !running ? <Pressable onPress={() => set('video', null)} hitSlop={8}><Ionicons name="close-circle" size={20} color={c.faint} /></Pressable> : null}
          </Pressable>
        )}

        <PresetBar presets={presets} setPresets={setPresets} disabled={running} onSave={savePreset} onLoad={applyPreset} />
        <RandomButtons disabled={running} onInsert={(x) => set('content', form.content + x)} />
        <ScenarioSection scenarios={scenarios} setScenarios={setScenarios} mode={form.scenarioMode} setMode={(m) => set('scenarioMode', m)} disabled={running}
          dtsg={dtsg} fbId={fbId} pageId={form.pageId} locked={isFreePlan ? () => showDialog(t('gp.bg'), t('gp.bgPaidOnly')) : undefined}
          snapshot={{
            content: form.content,
            link: form.attach === 'text' ? form.link : '',
            photos: form.attach === 'photos' ? form.photos : [],
            video: form.attach === 'video' ? form.video : null,
            textFormatPresetId: form.textFormatPresetId,
            textFormatBg: form.textFormatBg,
          }} />
      </Card>

      {/* Tuỳ chọn */}
      <Card>
        <OptionRow label={paid(t('gp.schedule'))} hint={canSchedule ? t('gp.scheduleHint') : t('gp.scheduleAdminOnly')}
          value={!!form.scheduledAt} disabled={running || isFreePlan || !canSchedule}
          onChange={(v) => (v ? setDatePicker(true) : set('scheduledAt', undefined))} />
        {form.scheduledAt ? (
          <Pressable onPress={() => setDatePicker(true)} disabled={running} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 12 }}>
            <Ionicons name="calendar" size={18} color={c.accent} />
            <Body weight="600">{fmtDateTime(new Date(form.scheduledAt))}</Body>
          </Pressable>
        ) : null}
        <OptionRow label={paid(t('gp.autoComment'))} value={form.autoCommentEnabled} disabled={running || isFreePlan} onChange={(v) => set('autoCommentEnabled', v)} />
        {form.autoCommentEnabled ? (
          <>
            <Field value={form.autoCommentContent} onChangeText={(v) => set('autoCommentContent', v)} multiline editable={!running} placeholder={t('gp.commentPh')} />
            {/* Ảnh kèm bình luận */}
            {form.autoCommentPhoto ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Image source={{ uri: form.autoCommentPhoto.uri }} style={{ width: 84, height: 84, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border }} />
                {!running ? (
                  <Pressable onPress={() => set('autoCommentPhoto', null)} hitSlop={6}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={13} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Pressable disabled={running}
                onPress={async () => {
                  const [a] = await pickMedia('image');
                  if (a) set('autoCommentPhoto', { uri: a.uri, name: a.name, type: a.mimeType ?? 'image/jpeg', size: a.size });
                }}
                style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.accentSoft }}>
                <Ionicons name="image-outline" size={16} color={c.accent} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.accent }}>{t('gp.commentAddPhoto')}</Text>
              </Pressable>
            )}
            <Body muted size={11}>{t('gp.commentHint')}</Body>
          </>
        ) : null}
        <Row>
          <View style={{ flex: 1 }}><NumberField label={t('gp.threads')} value={form.thread} onChange={(v) => set('thread', v)} min={1} max={10} icon="git-branch-outline" /></View>
          <View style={{ flex: 1 }}><NumberField label={t('gp.delayFrom')} value={form.delayMin} onChange={(v) => setForm((f) => ({ ...f, delayMin: v, delayMax: Math.max(v, f.delayMax) }))} min={0} max={3600} icon="time-outline" /></View>
          <View style={{ flex: 1 }}><NumberField label={t('gp.delayTo')} value={form.delayMax} onChange={(v) => setForm((f) => ({ ...f, delayMax: Math.max(v, f.delayMin) }))} min={0} max={3600} icon="time-outline" /></View>
        </Row>
        <AdvancedCycle
          enabled={form.repeatEnabled && !isFreePlan}
          setEnabled={(v) => setForm((f) => ({ ...f, repeatEnabled: v, scheduledAt: v ? undefined : f.scheduledAt }))}
          blockedReason={isFreePlan ? t('gp.paidOnly') : form.scheduledAt ? t('gp.cycleNoSchedule') : null}
          disabled={running || waiting}
          cycleMode={form.cycleMode}
          setCycleMode={(m) => set('cycleMode', m)}
          hours={form.repeatIntervalHours}
          setHours={(h) => set('repeatIntervalHours', h)}
          times={form.customTimes}
          setTimes={(ts) => set('customTimes', ts)}
          nextRun={waiting && form.cycleMode === 'custom' ? fmtClock(((cycleAt ?? now) - now) / 1000) : null}
        />
      </Card>

      {/* Nút chạy — đổi màu/chữ theo trạng thái (giống metus-few) */}
      {(() => {
        const cycleCustom = form.repeatEnabled && form.cycleMode === 'custom' && !isFreePlan;
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
        } else if (cycleCustom) {
          color = '#8b5cf6';
          title = t('gp.activateSchedule');
          onPress = startCustomCycle;
        } else if (form.scheduledAt) {
          color = '#8b5cf6';
          title = `⏰ ${t('gp.scheduleAt', { time: fmtDateTime(new Date(form.scheduledAt)) })}`;
          onPress = run;
        } else {
          color = c.accent;
          title = t('gp.postN', { n: targetIds.length });
          onPress = run;
        }
        return (
          <Pressable onPress={onPress} style={({ pressed }) => [{ backgroundColor: color, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', opacity: pressed ? 0.85 : 1 }, shadow(c, 1)]}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{title}</Text>
          </Pressable>
        );
      })()}

      {/* Kết quả */}
      {posts.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('gp.results', { done, total: posts.length })}</Label>
            {!running ? <Pressable onPress={() => setPosts([])} hitSlop={8}><Body size={12} color={c.danger} weight="600">{t('common.delete')}</Body></Pressable> : null}
          </Row>
          <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled contentContainerStyle={{ gap: 8 }}>
            {posts.map((p) => (
              <Pressable key={p.key} onPress={() => p.url && Linking.openURL(p.url)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                {p.group.picture ? <Image source={{ uri: p.group.picture }} style={{ width: 32, height: 32, borderRadius: 8 }} /> : <Ionicons name="people" size={24} color={c.faint} />}
                <View style={{ flex: 1 }}>
                  <Body weight="600" size={14} numberOfLines={1}>{p.group.name}</Body>
                  {p.note ? <Body muted size={11} numberOfLines={2}>{p.note}</Body> : null}
                  {p.commentStatus ? (
                    <Text style={{ fontSize: 11, color: p.commentStatus === 'success' ? c.success : p.commentStatus === 'failed' ? c.danger : c.muted }}>
                      {t('gp.comment', { s: t(p.commentStatus === 'success' ? 'gp.cDone' : p.commentStatus === 'failed' ? 'gp.cFail' : 'gp.cPending') })}
                    </Text>
                  ) : null}
                </View>
                {p.status === 'pending' ? <ActivityIndicator color={c.accent} /> : <Badge text={t(p.status === 'success' ? 'gp.posted' : 'gp.failed')} tone={p.status === 'success' ? 'success' : 'danger'} />}
              </Pressable>
            ))}
          </ScrollView>
        </Card>
      ) : null}

      {/* Modals */}
      <PickerModal visible={pagePicker} title={t('gp.postAs')} onClose={() => setPagePicker(false)}
        items={[{ id: '', name: t('gp.personalSuffix', { name: (current?.name as string | undefined) ?? t('gp.personal') }), picture: current?.picture as string | undefined }, ...pages]}
        keyOf={(p) => p.id || 'me'} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={[form.pageId || 'me']}
        onToggle={(p) => setForm((f) => ({ ...f, pageId: p.id || undefined, anonymous: p.id ? false : f.anonymous }))} />
      <DateTimePickerModal visible={datePicker} value={form.scheduledAt ? new Date(form.scheduledAt) : new Date(Date.now() + 30 * 60000)}
        onClose={() => setDatePicker(false)} onConfirm={(d) => { set('scheduledAt', d.getTime()); setDatePicker(false); }} />
      <BgPresetModal visible={bgOpen} onClose={() => setBgOpen(false)} selectedId={form.textFormatPresetId} dtsg={dtsg} fbId={fbId} pageId={form.pageId}
        onPick={(id, b) => { pickBg(id, b); setBgOpen(false); }} />
    </>
  );
}

const LINK_FALLBACK_IMG = 'https://d33wubrfki0l68.cloudfront.net/b4759e96fa9ada8ee8caa4c771fcd503f289d791/5cf1a/img/triangle_background.jpg';

/** Ô link + thẻ xem trước (LinkInput của metus-few): gọi preview sau khi ngừng gõ 1 giây. */
function LinkInput({ value, onChange, disabled, dtsg, fbId, pageId }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; dtsg: string; fbId: string; pageId?: string;
}) {
  const c = useColors();
  const t = useT();
  const [preview, setPreview] = useState<{ title: string; image: string; url: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const url = value.trim();
    if (!url) {
      setPreview(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await getLinkPreview(dtsg, fbId, url, pageId);
        if (alive) setPreview(r.scrapeStr ? { title: r.title, image: r.image, url } : null);
      } catch {
        if (alive) setPreview(null);
      } finally {
        if (alive) setLoading(false);
      }
    }, 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [value, dtsg, fbId, pageId]);
  const clear = () => {
    setPreview(null);
    onChange('');
  };
  return (
    <View style={{ gap: 8 }}>
      <Field icon="link-outline" value={value} onChangeText={onChange} editable={!disabled} autoCapitalize="none" keyboardType="url" placeholder={t('gp.linkPh')}
        rightIcon={value ? 'close' : undefined} onRightIconPress={disabled ? undefined : clear} />
      {loading && !preview ? (
        <Row gap={8}><ActivityIndicator color={c.accent} size="small" /><Body muted size={12}>{t('gp.loadingPreview')}</Body></Row>
      ) : null}
      {preview ? (
        <View style={{ borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
          <Image source={{ uri: preview.image || LINK_FALLBACK_IMG }} style={{ width: '100%', height: 180 }} resizeMode="cover" />
          <View style={{ padding: 10, backgroundColor: c.input }}>
            <Body weight="700" size={14} numberOfLines={1}>{preview.title || preview.url}</Body>
            <Body muted size={12} numberOfLines={1}>{preview.url}</Body>
          </View>
          {!disabled ? (
            <Pressable onPress={clear} hitSlop={8} style={[{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }, shadow(c, 1)]}>
              <Ionicons name="close" size={16} color={c.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const ATTACH_ICON: Record<Attach, React.ComponentProps<typeof Ionicons>['name']> = {
  text: 'chatbox-ellipses-outline',
  photos: 'image-outline',
  video: 'videocam-outline',
};

/** Tab chọn loại đính kèm có icon (giống metus-few). */
function AttachTabs({ value, onChange }: { value: Attach; onChange: (v: Attach) => void }) {
  const c = useColors();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: c.input, borderRadius: radius.md, padding: 4, gap: 4 }}>
      {(['text', 'photos', 'video'] as const).map((k) => {
        const on = value === k;
        return (
          <Pressable key={k} onPress={() => onChange(k)}
            style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: radius.sm, backgroundColor: on ? c.card : 'transparent' }, on ? shadow(c, 1) : null]}>
            <Ionicons name={ATTACH_ICON[k]} size={15} color={on ? c.accent : c.faint} />
            <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: on ? '700' : '500', color: on ? c.accent : c.muted }}>{t(ATTACH_KEY[k])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OptionRow({ label, hint, value, disabled, onChange }: { label: string; hint?: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  return (
    <Row style={{ justifyContent: 'space-between', opacity: disabled && !value ? 0.55 : 1 }}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Body weight="600" size={14}>{label}</Body>
        {hint ? <Body muted size={12}>{hint}</Body> : null}
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: c.accent }} />
    </Row>
  );
}

export default function AutoPostFbGroupScreen() {
  return (
    <Screen>
      <ToolGate require="plan">{(dtsg, fbId, user) => <Runner dtsg={dtsg} fbId={fbId} user={user} />}</ToolGate>
    </Screen>
  );
}
