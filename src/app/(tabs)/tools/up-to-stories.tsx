import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { DateTimePickerModal, PickerModal, SelectorRow, fmtDateTime } from '@/components/AdPostTool';
import { BulkScheduleSection, reschedule, useBulkSchedule } from '@/components/bulkSchedule';
import { showDialog } from '@/components/Dialog';
import { PURPLE } from '@/components/cycle';
import { StepField } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Card, Field, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useAdsSession } from '@/lib/fb/adsSession';
import type { AdPage } from '@/lib/fb/ads';
import { useFbAccounts } from '@/lib/fb/accounts';
import type { LocalFile } from '@/lib/fb/Group';
import { downloadVideo, resolveTiktokLink } from '@/lib/fb/reels';
import { publishStory, storyAttachment, uploadStoryPhoto, uploadStoryVideo } from '@/lib/fb/stories';
import { detectVideoLink, fetchCapcutDownloadUrl, fetchFacebookDownloadUrl } from '@/lib/fb/videoFromLink';
import { useT } from '@/lib/i18n';
import { notifyNow } from '@/lib/notify';
import { pickMedia } from '@/lib/pickMedia';
import * as storage from '@/lib/storage';
import * as bg from '@metus/background';

/**
 * Đăng Story hàng loạt cho Page — port từ metus-few features/tools/page/up-to-stories.
 * Mỗi ảnh/video × mỗi Page đã chọn = 1 Story, có nút "Xem thêm" (link CTA), hẹn giờ
 * hàng loạt, giới hạn số Story, delay ngẫu nhiên trong khoảng min–max.
 */

type Status = 'unpublished' | 'uploading' | 'scheduled' | 'published' | 'error';

interface Story {
  key: string;
  page: AdPage;
  file: LocalFile;
  isVideo: boolean;
  cover?: string;
  linkUrl: string;
  isSchedule: boolean;
  scheduledTime?: number;
  status: Status;
  error?: string;
}

const LINK_KEY = 'upToStoriesBulkLink';
const MIN_SCHEDULE_MS = 45 * 60_000; // metus-few: hẹn giờ Story phải sau ít nhất 45 phút
const sleep = (ms: number) => bg.sleep(ms);

function StoryCard({ s, disabled, onLink, onSchedule, onPickTime, onDelete }: {
  s: Story; disabled: boolean; onLink: (v: string) => void; onSchedule: (v: boolean) => void; onPickTime: () => void; onDelete: () => void;
}) {
  const c = useColors();
  const t = useT();
  const locked = disabled || s.status !== 'unpublished';
  const tone = s.status === 'published' ? 'success' : s.status === 'scheduled' ? 'info' : s.status === 'error' ? 'danger' : s.status === 'uploading' ? 'accent' : 'muted';
  const preview = s.isVideo ? s.cover : s.file.uri;
  return (
    <View style={[{ flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }, shadow(c, 1)]}>
      <View style={{ width: 90, height: 160, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
        {preview ? <Image source={{ uri: preview }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Ionicons name="film" size={28} color="#888" />}
        {s.isVideo ? <View style={{ position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 3 }}><Ionicons name="videocam" size={12} color="#fff" /></View> : null}
        {s.status === 'uploading' ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>
        ) : null}
      </View>
      <View style={{ flex: 1, padding: 10, gap: 6 }}>
        <Row gap={6}>
          {s.page.picture ? <Image source={{ uri: s.page.picture }} style={{ width: 20, height: 20, borderRadius: 10 }} /> : null}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: c.text }}>{s.page.name}</Text>
          {!locked ? <Pressable onPress={onDelete} hitSlop={8}><Ionicons name="trash-outline" size={17} color={c.danger} /></Pressable> : null}
        </Row>
        <TextInput value={s.linkUrl} onChangeText={onLink} editable={!locked} autoCapitalize="none" keyboardType="url" placeholder={t('stories.linkPh')} placeholderTextColor={c.faint}
          style={{ fontSize: 12.5, color: c.text, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 8, backgroundColor: c.input, paddingHorizontal: 8, paddingVertical: 6 }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Badge text={t(`stories.st.${s.status}`)} tone={tone} />
          <Row gap={4}>
            <Text style={{ fontSize: 11.5, color: c.muted }}>{t('reels.schedule')}</Text>
            <Switch value={s.isSchedule} disabled={locked} onValueChange={onSchedule} trackColor={{ true: PURPLE }} style={{ transform: [{ scale: 0.8 }] }} />
          </Row>
        </Row>
        {s.isSchedule && s.scheduledTime ? (
          <Pressable disabled={locked} onPress={onPickTime} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="calendar-outline" size={13} color={PURPLE} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: PURPLE }}>{fmtDateTime(new Date(s.scheduledTime))}</Text>
          </Pressable>
        ) : null}
        {s.error ? <Text numberOfLines={3} style={{ fontSize: 11, color: c.danger }}>{s.error}</Text> : null}
      </View>
    </View>
  );
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const { session } = useFbAccounts();
  const pages = ads?.pages ?? [];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    if (pages.length && !selectedIds.length) setSelectedIds([pages[0].id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);
  const selectedPages = pages.filter((p) => selectedIds.includes(p.id));
  const [limit, setLimit] = useState(20);
  const [delayMin, setDelayMin] = useState(2);
  const [delayMax, setDelayMax] = useState(5);
  const [bulkLink, setBulkLinkState] = useState<string>(() => storage.get<string>(LINK_KEY) ?? '');
  const setBulkLink = (v: string) => {
    setBulkLinkState(v);
    storage.set(LINK_KEY, v);
  };
  const sched = useBulkSchedule();
  const { advanced, scheduleAt } = sched;

  const [stories, setStories] = useState<Story[]>([]);
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [countDown, setCountDown] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const stopImportRef = useRef(false);
  const runningRef = useRef(false);
  const [pagePicker, setPagePicker] = useState(false);
  const [dateFor, setDateFor] = useState<string | null>(null);

  // Đổi cài đặt hẹn giờ → tính lại giờ cho các Story chưa đăng
  useEffect(() => {
    if (!advanced) return;
    setStories((prev) =>
      reschedule(
        prev.map((s) => ({ ...s, pageId: s.page.id, pending: s.status === 'unpublished' })),
        scheduleAt,
        (s, at) => ({ ...s, scheduledTime: at }),
      ),
    );
  }, [advanced, scheduleAt]);

  const patch = (key: string, p: Partial<Story>) => setStories((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s)));

  /** Mỗi file × mỗi Page = 1 Story (addFilesToStories của metus-few). */
  const addFiles = (files: { file: LocalFile; isVideo: boolean }[], cover?: string) => {
    if (!selectedPages.length) {
      showDialog(t('reels.needPage'));
      return;
    }
    setStories((prev) => {
      const next = [...prev];
      const counts: Record<string, number> = {};
      for (const s of next) if (s.status === 'unpublished' && s.isSchedule) counts[s.page.id] = (counts[s.page.id] ?? 0) + 1;
      for (const f of files) {
        for (const page of selectedPages) {
          const i = counts[page.id] ?? 0;
          if (advanced) counts[page.id] = i + 1;
          next.push({
            key: Crypto.randomUUID(), page, file: f.file, isVideo: f.isVideo, cover, linkUrl: bulkLink,
            isSchedule: advanced, scheduledTime: advanced ? scheduleAt(i) : undefined, status: 'unpublished',
          });
        }
      }
      return next;
    });
  };

  const pickFiles = async () => {
    const picked = await pickMedia('mixed', true);
    if (picked.length) addFiles(picked.map((a) => ({ file: { uri: a.uri, name: a.name, type: a.mimeType ?? (a.isVideo ? 'video/mp4' : 'image/jpeg'), size: a.size }, isVideo: a.isVideo })));
  };

  const importLink = async () => {
    const url = videoUrl.trim();
    const source = detectVideoLink(url);
    if (!source) return showDialog(t('reels.invalidLink'));
    if (!selectedPages.length) return showDialog(t('reels.needPage'));
    stopImportRef.current = false;
    setImporting(true);
    try {
      if (source === 'tiktok') {
        const res = await resolveTiktokLink(url);
        if (res.type === 'channel') {
          let batch = res.videos;
          let cursor = res.nextCursor;
          let more = res.hasMore;
          let page = 1;
          let seen = 0;
          let ok = 0;
          // Tải từng trang của kênh, mỗi video tải xong là thêm ngay
          while (true) {
            seen += batch.length;
            for (const v of batch) {
              if (stopImportRef.current) break;
              try {
                addFiles([{ file: await downloadVideo(v.downloadUrl), isVideo: true }], v.thumbnailUrl || undefined);
                ok++;
              } catch {
                // bỏ qua video lỗi
              }
            }
            if (stopImportRef.current || !more) break;
            const next = await resolveTiktokLink(url, cursor, page++);
            if (next.type !== 'channel') break;
            batch = next.videos;
            cursor = next.nextCursor;
            more = next.hasMore;
          }
          if (!seen) return showDialog(t('reels.channelEmpty'));
          showDialog(ok ? t('reels.channelDone', { n: ok }) : t('reels.channelFailed'));
          return;
        }
        addFiles([{ file: await downloadVideo(res.downloadUrl), isVideo: true }], res.thumbnailUrl || undefined);
      } else if (source === 'facebook') {
        if (!session?.asyncToken) throw new Error(t('reels.needFbSession'));
        addFiles([{ file: await downloadVideo(await fetchFacebookDownloadUrl(url, session.asyncToken, fbId)), isVideo: true }]);
      } else {
        addFiles([{ file: await downloadVideo(await fetchCapcutDownloadUrl(url)), isVideo: true }]);
      }
      setVideoUrl('');
    } catch (e) {
      showDialog(t('reels.importErr'), describeError(e));
    } finally {
      setImporting(false);
    }
  };

  /** BẮT ĐẦU ĐĂNG STORY (handleRunBulk của metus-few). */
  const runBulk = async () => {
    const pending = stories.filter((s) => s.status === 'unpublished');
    if (!pending.length) return showDialog(t('stories.noStories'));
    const todo = pending.slice(0, limit);
    if (todo.some((s) => s.isSchedule && (s.scheduledTime ?? 0) < Date.now() + MIN_SCHEDULE_MS)) return showDialog(t('stories.scheduleTooSoon'));

    runningRef.current = true;
    setRunning(true);
    bg.start(t('stories.bgTitle'), t('stories.bgRunning', { done: 0, total: todo.length })).catch(() => {});
    let done = 0;
    let failed = 0;
    for (const [i, s] of todo.entries()) {
      if (!runningRef.current) break;
      patch(s.key, { status: 'uploading', error: undefined });
      try {
        const id = s.isVideo ? await uploadStoryVideo(dtsg, fbId, s.page.id, s.file) : await uploadStoryPhoto(dtsg, s.page.id, s.file);
        const scheduledUnix = s.isSchedule && s.scheduledTime ? Math.floor(s.scheduledTime / 1000) : undefined;
        await publishStory(dtsg, fbId, s.page.id, [storyAttachment(s.isVideo ? 'video' : 'photo', id, s.linkUrl.trim() || undefined)], scheduledUnix);
        patch(s.key, { status: scheduledUnix ? 'scheduled' : 'published' });
      } catch (e) {
        patch(s.key, { status: 'error', error: describeError(e) });
        failed++;
      }
      done++;
      bg.update(t('stories.bgTitle'), t('stories.bgRunning', { done, total: todo.length })).catch(() => {});
      // Delay ngẫu nhiên trong khoảng [min, max] giây giữa các Story
      if (i < todo.length - 1 && runningRef.current && delayMax > 0) {
        let wait = Math.floor(Math.random() * (Math.max(delayMax, delayMin) - delayMin + 1)) + delayMin;
        while (wait > 0 && runningRef.current) {
          setCountDown(wait);
          await sleep(1000);
          wait--;
        }
        setCountDown(0);
      }
    }
    runningRef.current = false;
    setRunning(false);
    bg.stop().catch(() => {});
    notifyNow(t('stories.bgTitle'), t('notify.storiesDone', { ok: done - failed, fail: failed }));
    showDialog(t('stories.processed', { n: done }));
  };
  const stop = () => {
    runningRef.current = false;
  };
  useEffect(() => () => {
    runningRef.current = false;
    bg.stop().catch(() => {});
  }, []);

  const busy = running || importing;
  const scheduledCount = stories.filter((s) => s.status === 'unpublished' && s.isSchedule).length;
  const pageText = selectedPages.length === 0 ? '' : selectedPages.length === 1 ? selectedPages[0].name : t('reels.pagesSelected', { n: selectedPages.length });
  const editing = dateFor ? stories.find((s) => s.key === dateFor) : undefined;

  return (
    <>
      {/* ========== Cài đặt ========== */}
      <Card>
        <SelectorRow label={t('reels.pages')} avatar={selectedPages.length === 1 ? selectedPages[0].picture : undefined} text={pageText} placeholder={t('reels.pickPages')} onPress={() => !busy && setPagePicker(true)} />
        <StepField label={t('stories.limit')} value={limit} min={1} onChange={setLimit} disabled={busy} />
        <Row>
          <View style={{ flex: 1 }}><StepField label={t('stories.delayMin')} value={delayMin} min={0} onChange={(v) => { setDelayMin(v); if (v > delayMax) setDelayMax(v); }} disabled={busy} /></View>
          <View style={{ flex: 1 }}><StepField label={t('stories.delayMax')} value={delayMax} min={0} onChange={(v) => setDelayMax(Math.max(v, delayMin))} disabled={busy} /></View>
        </Row>
        <Field label={t('stories.bulkLink')} value={bulkLink} onChangeText={setBulkLink} editable={!busy} autoCapitalize="none" keyboardType="url" placeholder={t('stories.bulkLinkPh')} icon="link-outline" />
        {stories.length ? (
          <Pressable disabled={busy} onPress={() => setStories((prev) => prev.map((s) => (s.status === 'unpublished' ? { ...s, linkUrl: bulkLink } : s)))} style={{ alignSelf: 'flex-start' }}>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: c.accent }}>{t('stories.applyLink')}</Text>
          </Pressable>
        ) : null}

        <BulkScheduleSection s={sched} disabled={busy} total={scheduledCount} totalLabel={t('stories.total')} />
        {advanced ? <Body muted size={11}>{t('stories.scheduleHint')}</Body> : null}

        <Pressable onPress={running ? stop : runBulk} disabled={importing}
          style={({ pressed }) => [{ backgroundColor: running ? '#ef4444' : '#f97316', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: importing ? 0.6 : pressed ? 0.85 : 1 }, shadow(c, 1)]}>
          {running ? <ActivityIndicator color="#fff" /> : null}
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
            {running ? `${countDown ? t('gp.waitingBtn', { s: countDown }) : t('stories.running')} (${t('gp.stop')})` : t('stories.run')}
          </Text>
        </Pressable>
      </Card>

      {/* ========== Thêm ảnh / video ========== */}
      <Card>
        <Pressable onPress={pickFiles} disabled={busy}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.md, backgroundColor: busy ? c.faint : '#f97316' }}>
          {importing ? <ActivityIndicator color="#fff" /> : <Ionicons name="images-outline" size={18} color="#fff" />}
          <Text style={{ color: '#fff', fontWeight: '800' }}>{importing ? t('reels.uploading') : t('stories.pick')}</Text>
        </Pressable>
        <Field value={videoUrl} onChangeText={setVideoUrl} editable={!importing} autoCapitalize="none" keyboardType="url" placeholder={t('stories.linkImportPh')}
          icon="link-outline" rightIcon={importing ? 'stop-circle' : 'cloud-download-outline'}
          onRightIconPress={importing ? () => (stopImportRef.current = true) : importLink} />
        <View style={{ padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: '#fed7aa', backgroundColor: 'rgba(249,115,22,0.08)' }}>
          <Text style={{ fontSize: 12.5, color: c.text, lineHeight: 18 }}>
            <Text style={{ fontWeight: '800', color: '#ea580c' }}>{t('reels.notePrefix')} </Text>
            {t('reels.channelHint')}
          </Text>
        </View>
      </Card>

      {/* ========== Danh sách Story ========== */}
      {stories.length ? (
        <View style={{ gap: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('stories.list', { n: stories.length })}</Label>
            {!busy ? <Pressable onPress={() => setStories([])} hitSlop={8}><Body size={12} color={c.danger} weight="600">{t('stories.clearAll')}</Body></Pressable> : null}
          </Row>
          {stories.map((s) => (
            <StoryCard key={s.key} s={s} disabled={busy}
              onLink={(v) => patch(s.key, { linkUrl: v })}
              onSchedule={(v) => patch(s.key, { isSchedule: v, scheduledTime: v ? s.scheduledTime ?? Date.now() + 3600_000 : undefined })}
              onPickTime={() => setDateFor(s.key)}
              onDelete={() => setStories((prev) => prev.filter((x) => x.key !== s.key))} />
          ))}
        </View>
      ) : null}

      <PickerModal visible={pagePicker} title={t('reels.pages')} onClose={() => setPagePicker(false)} items={pages} multi
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={selectedIds}
        onToggle={(p) => setSelectedIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))} />
      <DateTimePickerModal visible={dateFor !== null} value={new Date(editing?.scheduledTime ?? Date.now() + 3600_000)} onClose={() => setDateFor(null)}
        onConfirm={(d) => {
          if (dateFor) patch(dateFor, { scheduledTime: d.getTime(), isSchedule: true });
          setDateFor(null);
        }} />
    </>
  );
}

export default function UpToStoriesScreen() {
  return (
    <Screen>
      {/* metus-few: requirePackage=true */}
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
