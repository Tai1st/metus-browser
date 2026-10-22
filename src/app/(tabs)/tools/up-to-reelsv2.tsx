import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { DateTimePickerModal, PickerModal, SelectorRow, fmtDateTime } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { BulkScheduleSection, reschedule, useBulkSchedule } from '@/components/bulkSchedule';
import { PURPLE } from '@/components/cycle';
import { StepField, TickBox } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Card, Field, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError, type MetusUser } from '@/lib/api';
import { useAdsSession } from '@/lib/fb/adsSession';
import type { AdPage } from '@/lib/fb/ads';
import { useFbAccounts } from '@/lib/fb/accounts';
import type { LocalFile } from '@/lib/fb/Group';
import { commentWithToken, downloadVideo, publishReel, resolveTiktokLink } from '@/lib/fb/reels';
import { detectVideoLink, fetchCapcutDownloadUrl, fetchFacebookDownloadUrl } from '@/lib/fb/videoFromLink';
import { useT } from '@/lib/i18n';
import { notifyNow } from '@/lib/notify';
import { pickMedia } from '@/lib/pickMedia';
import * as bg from '@metus/background';

/**
 * Đăng Reels hàng loạt — port từ metus-few features/tools/page/up-to-reelsv2.
 * Chọn nhiều Page → thêm video (từ máy, hoặc link TikTok / TikTok kênh / Facebook / CapCut)
 * → mỗi video tạo 1 Reel cho mỗi Page → chạy: đăng ngay / hẹn giờ / lưu nháp, giới hạn
 * mỗi Page + delay, bình luận sau khi đăng (token của Page).
 */

type ReelStatus = 'unpublished' | 'uploading' | 'scheduled' | 'published' | 'error';

interface Reel {
  key: string;
  page: AdPage;
  file: LocalFile;
  thumbnail?: string;
  title: string;
  isSchedule: boolean;
  scheduledTime?: number;
  status: ReelStatus;
  error?: string;
  videoId?: string;
}

const FREE_SUFFIX = '#metus POST BY : metus';
const sleep = (ms: number) => bg.sleep(ms);
function ReelCard({ r, disabled, onTitle, onSchedule, onPickTime, onDelete }: {
  r: Reel; disabled: boolean; onTitle: (v: string) => void; onSchedule: (v: boolean) => void; onPickTime: () => void; onDelete: () => void;
}) {
  const c = useColors();
  const t = useT();
  const tone = r.status === 'published' ? 'success' : r.status === 'scheduled' ? 'info' : r.status === 'error' ? 'danger' : r.status === 'uploading' ? 'accent' : 'muted';
  const locked = disabled || r.status !== 'unpublished';
  return (
    <View style={[{ borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }, shadow(c, 1)]}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 96, height: 140, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
          {r.thumbnail ? <Image source={{ uri: r.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Ionicons name="film" size={30} color="#888" />}
          {r.status === 'uploading' ? (
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, padding: 10, gap: 6 }}>
          <Row gap={6}>
            {r.page.picture ? <Image source={{ uri: r.page.picture }} style={{ width: 20, height: 20, borderRadius: 10 }} /> : null}
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: c.text }}>{r.page.name}</Text>
            {!locked ? <Pressable onPress={onDelete} hitSlop={8}><Ionicons name="trash-outline" size={17} color={c.danger} /></Pressable> : null}
          </Row>
          <TextInput value={r.title} onChangeText={onTitle} editable={!locked} multiline placeholder={t('reels.titlePh')} placeholderTextColor={c.faint}
            style={{ minHeight: 44, maxHeight: 80, fontSize: 13, color: c.text, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 8, backgroundColor: c.input, paddingHorizontal: 8, paddingVertical: 6, textAlignVertical: 'top' }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge text={t(`reels.st.${r.status}`)} tone={tone} />
            <Row gap={4}>
              <Text style={{ fontSize: 11.5, color: c.muted }}>{t('reels.schedule')}</Text>
              <Switch value={r.isSchedule} disabled={locked} onValueChange={onSchedule} trackColor={{ true: PURPLE }} style={{ transform: [{ scale: 0.8 }] }} />
            </Row>
          </Row>
          {r.isSchedule && r.scheduledTime ? (
            <Pressable disabled={locked} onPress={onPickTime} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="calendar-outline" size={13} color={PURPLE} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: PURPLE }}>{fmtDateTime(new Date(r.scheduledTime))}</Text>
            </Pressable>
          ) : null}
          {r.error ? <Text numberOfLines={3} style={{ fontSize: 11, color: c.danger }}>{r.error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function Runner({ user }: { user: MetusUser | null }) {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const { current, session } = useFbAccounts();
  const pages = ads?.pages ?? [];
  const plan = user?.plan as { price?: number } | null | undefined;
  const isFreePlan = !plan || (plan.price ?? 0) <= 0;

  // Cài đặt
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    if (pages.length && !selectedIds.length) setSelectedIds([pages[0].id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);
  const selectedPages = pages.filter((p) => selectedIds.includes(p.id));
  const [limit, setLimit] = useState(20);
  const [delay, setDelay] = useState(2);
  const [useFileName, setUseFileName] = useState(false);
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [content, setContent] = useState('');
  // Hẹn giờ hàng loạt (AdvancedBulkSchedule)
  const sched = useBulkSchedule();
  const { advanced, scheduleAt } = sched;
  // Bình luận sau khi đăng (CommentCard)
  const [commentOn, setCommentOn] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentPhoto, setCommentPhoto] = useState<LocalFile | null>(null);

  const [reels, setReels] = useState<Reel[]>([]);
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const stopImportRef = useRef(false);

  // Modal
  const [pagePicker, setPagePicker] = useState(false);
  const [dateFor, setDateFor] = useState<string | null>(null);

  // Đổi cài đặt hẹn giờ → tính lại giờ cho các Reel chưa đăng
  useEffect(() => {
    if (!advanced) return;
    setReels((prev) =>
      reschedule(
        prev.map((r) => ({ ...r, pageId: r.page.id, pending: r.status === 'unpublished' })),
        scheduleAt,
        (r, at) => ({ ...r, scheduledTime: at }),
      ),
    );
  }, [advanced, scheduleAt]);

  const togglePage = (p: AdPage) => {
    if (isFreePlan) return setSelectedIds([p.id]); // gói miễn phí: chỉ 1 Page (applyFreePlanPageLimit)
    setSelectedIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]));
  };

  /** Thêm video: mỗi file × mỗi Page đã chọn = 1 Reel (processVideo của metus-few). */
  const addVideos = (files: LocalFile[], titleOverride?: string, thumbnail?: string) => {
    if (!selectedPages.length) {
      showDialog(t('reels.needPage'));
      return;
    }
    setReels((prev) => {
      const next = [...prev];
      const counts: Record<string, number> = {};
      for (const r of next) if (r.status === 'unpublished' && r.isSchedule) counts[r.page.id] = (counts[r.page.id] ?? 0) + 1;
      for (const file of files) {
        for (const page of selectedPages) {
          const i = counts[page.id] ?? 0;
          if (advanced) counts[page.id] = i + 1;
          next.push({
            key: Crypto.randomUUID(),
            page,
            file,
            thumbnail,
            title: content.trim() ? content : (titleOverride ?? (useFileName ? file.name.replace(/\.[^/.]+$/, '') : content)),
            isSchedule: advanced,
            scheduledTime: advanced ? scheduleAt(i) : undefined,
            status: 'unpublished',
          });
        }
      }
      return next;
    });
  };

  const pickFiles = async () => {
    const picked = await pickMedia('video', true);
    if (picked.length) addVideos(picked.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? 'video/mp4', size: a.size })));
  };

  /** Link TikTok (1 video / cả kênh) / Facebook / CapCut → tải về → thêm vào danh sách. */
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
          const videos = [...res.videos];
          let cursor = res.nextCursor;
          let more = res.hasMore;
          let page = 1;
          while (more && !stopImportRef.current) {
            const next = await resolveTiktokLink(url, cursor, page++);
            if (next.type !== 'channel') break;
            videos.push(...next.videos);
            cursor = next.nextCursor;
            more = next.hasMore;
          }
          if (!videos.length) return showDialog(t('reels.channelEmpty'));
          let ok = 0;
          for (const v of videos) {
            if (stopImportRef.current) break;
            try {
              addVideos([await downloadVideo(v.downloadUrl)], v.title, v.thumbnailUrl || undefined);
              ok++;
            } catch {
              // bỏ qua video lỗi, tải tiếp
            }
          }
          showDialog(ok ? t('reels.channelDone', { n: ok }) : t('reels.channelFailed'));
          return;
        }
        addVideos([await downloadVideo(res.downloadUrl)], res.title, res.thumbnailUrl || undefined);
      } else if (source === 'facebook') {
        if (!session?.asyncToken || !current) throw new Error(t('reels.needFbSession'));
        addVideos([await downloadVideo(await fetchFacebookDownloadUrl(url, session.asyncToken, current.id))]);
      } else {
        addVideos([await downloadVideo(await fetchCapcutDownloadUrl(url))]);
      }
      setVideoUrl('');
    } catch (e) {
      showDialog(t('reels.importErr'), describeError(e));
    } finally {
      setImporting(false);
    }
  };

  const patch = (key: string, p: Partial<Reel>) => setReels((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  /** RUN BULK (handleRunBulk của metus-few). */
  const runBulk = async () => {
    const todo = reels.filter((r) => r.status === 'unpublished');
    if (!todo.length) return showDialog(t('reels.noVideos'));
    if (advanced && sched.mode === 'custom') {
      const scheduled = todo.filter((r) => r.isSchedule).length;
      const days = Math.ceil(scheduled / Math.max(1, sched.dailyTimes.length));
      if (days > 30) return showDialog(t('reels.tooManyDays', { days, total: scheduled }));
    }
    if (todo.some((r) => r.isSchedule && (r.scheduledTime ?? 0) < Date.now() + 10 * 60_000)) return showDialog(t('reels.scheduleTooSoon'));

    setRunning(true);
    bg.start(t('reels.bgTitle'), t('reels.bgRunning', { done: 0, total: todo.length })).catch(() => {});
    const perPage = new Map<string, number>();
    let done = 0;
    let failed = 0;
    for (const [i, r] of todo.entries()) {
      const count = perPage.get(r.page.id) ?? 0;
      if (count >= limit) continue;
      patch(r.key, { status: 'uploading', error: undefined });
      try {
        let title = r.title;
        if (isFreePlan) title = title ? `${title} ${FREE_SUFFIX}` : FREE_SUFFIX;
        const scheduledUnix = r.isSchedule && r.scheduledTime ? Math.floor(r.scheduledTime / 1000) : undefined;
        const id = await publishReel({ pageId: r.page.id, pageToken: r.page.access_token, file: r.file, description: title, scheduledUnix, draft: saveAsDraft });
        const status: ReelStatus = saveAsDraft ? 'unpublished' : scheduledUnix ? 'scheduled' : 'published';
        patch(r.key, { status, videoId: id, error: saveAsDraft ? t('reels.savedDraft') : undefined });
        if (status === 'published' && commentOn && (commentText.trim() || commentPhoto)) {
          await commentWithToken(id, r.page.access_token, commentText, commentPhoto).catch((e) =>
            patch(r.key, { error: `${t('reels.commentErr')}: ${describeError(e)}` }),
          );
        }
        perPage.set(r.page.id, count + 1);
      } catch (e) {
        patch(r.key, { status: 'error', error: describeError(e) });
        failed++;
      }
      done++;
      bg.update(t('reels.bgTitle'), t('reels.bgRunning', { done, total: todo.length })).catch(() => {});
      if (i < todo.length - 1 && (perPage.get(r.page.id) ?? 0) < limit) await sleep(delay * 1000);
    }
    bg.stop().catch(() => {});
    setRunning(false);
    notifyNow(t('reels.bgTitle'), t('notify.reelsDone', { ok: done - failed, fail: failed }));
  };
  useEffect(() => () => {
    bg.stop().catch(() => {});
  }, []);

  const scheduledCount = reels.filter((r) => r.status === 'unpublished' && r.isSchedule).length;
  const quota = useMemo(() => {
    const m = new Map<string, { page: AdPage; published: number }>();
    for (const r of reels) {
      if (!m.has(r.page.id)) m.set(r.page.id, { page: r.page, published: 0 });
      if (r.status === 'published') m.get(r.page.id)!.published++;
    }
    return [...m.values()];
  }, [reels]);
  const busy = running || importing;
  const pageText = selectedPages.length === 0 ? '' : selectedPages.length === 1 ? selectedPages[0].name : t('reels.pagesSelected', { n: selectedPages.length });
  const editing = dateFor ? reels.find((r) => r.key === dateFor) : undefined;

  return (
    <>
      {/* ========== Cài đặt ========== */}
      <Card>
        <SelectorRow label={t('reels.pages')} avatar={selectedPages.length === 1 ? selectedPages[0].picture : undefined} text={pageText} placeholder={t('reels.pickPages')} onPress={() => !busy && setPagePicker(true)} />
        {isFreePlan ? <Body muted size={11}>{t('reels.freeOnePage')}</Body> : null}
        <Row>
          <View style={{ flex: 1 }}><StepField label={t('reels.limit')} value={limit} min={1} onChange={setLimit} disabled={busy} /></View>
          <View style={{ flex: 1 }}><StepField label={t('reels.delay')} value={delay} min={0} step={0.5} onChange={setDelay} disabled={busy} /></View>
        </Row>
        <TickBox label={t('reels.useFileName')} value={useFileName} disabled={busy} onBlocked={() => {}} onChange={setUseFileName} />
        <Field label={t('reels.content')} value={content} onChangeText={setContent} multiline editable={!busy} placeholder={t('reels.contentPh')} />

        {/* Hẹn giờ hàng loạt */}
        <BulkScheduleSection s={sched} disabled={busy} total={scheduledCount} totalLabel={t('reels.totalVideos')} />

        <TickBox label={t('reels.saveDraft')} value={saveAsDraft} disabled={busy} onBlocked={() => {}} onChange={setSaveAsDraft} />

        {/* Bình luận sau khi đăng */}
        <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 10, gap: 8 }}>
          <TickBox label={t('reels.commentAfter')} value={commentOn} disabled={busy} onBlocked={() => {}} onChange={setCommentOn} />
          {commentOn ? (
            <>
              <Field value={commentText} onChangeText={setCommentText} multiline editable={!busy} placeholder={t('gp.commentPh')} />
              {commentPhoto ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <Image source={{ uri: commentPhoto.uri }} style={{ width: 72, height: 72, borderRadius: radius.sm }} />
                  <Pressable onPress={() => setCommentPhoto(null)} hitSlop={6}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={13} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <Pressable disabled={busy}
                  onPress={async () => {
                    const [a] = await pickMedia('image');
                    if (a) setCommentPhoto({ uri: a.uri, name: a.name, type: a.mimeType ?? 'image/jpeg' });
                  }}
                  style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.accentSoft }}>
                  <Ionicons name="image-outline" size={16} color={c.accent} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: c.accent }}>{t('gp.commentAddPhoto')}</Text>
                </Pressable>
              )}
            </>
          ) : null}
        </View>

        <Pressable onPress={runBulk} disabled={busy}
          style={({ pressed }) => [{ backgroundColor: '#f97316', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: busy ? 0.6 : pressed ? 0.85 : 1 }, shadow(c, 1)]}>
          {running ? <ActivityIndicator color="#fff" /> : null}
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{running ? t('reels.running') : t('reels.runBulk')}</Text>
        </Pressable>
      </Card>

      {/* ========== Thêm video ========== */}
      <Card>
        <Pressable onPress={pickFiles} disabled={busy}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.md, backgroundColor: busy ? c.faint : '#f97316' }}>
          {importing ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-upload-outline" size={18} color="#fff" />}
          <Text style={{ color: '#fff', fontWeight: '800' }}>{importing ? t('reels.uploading') : t('reels.upload')}</Text>
        </Pressable>
        <Field value={videoUrl} onChangeText={setVideoUrl} editable={!importing} autoCapitalize="none" keyboardType="url" placeholder={t('reels.linkPh')}
          icon="link-outline" rightIcon={importing ? 'stop-circle' : 'cloud-download-outline'}
          onRightIconPress={importing ? () => (stopImportRef.current = true) : importLink} />
        <View style={{ padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: '#fed7aa', backgroundColor: 'rgba(249,115,22,0.08)' }}>
          <Text style={{ fontSize: 12.5, color: c.text, lineHeight: 18 }}>
            <Text style={{ fontWeight: '800', color: '#ea580c' }}>{t('reels.notePrefix')} </Text>
            {t('reels.channelHint')} {t('reels.freeNote')} <Text style={{ fontWeight: '800', color: '#ea580c' }}>{FREE_SUFFIX}</Text> {t('reels.freeNoteSuffix')}
          </Text>
        </View>
        {quota.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {quota.map(({ page, published }) => {
              const remaining = Math.max(0, limit - published);
              return (
                <View key={page.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                  {page.picture ? <Image source={{ uri: page.picture }} style={{ width: 16, height: 16, borderRadius: 8 }} /> : null}
                  <Text numberOfLines={1} style={{ maxWidth: 100, fontSize: 11.5, fontWeight: '600', color: c.text }}>{page.name}</Text>
                  <Text style={{ fontSize: 11.5, fontWeight: '800', color: remaining ? c.success : c.danger }}>{t('reels.remaining', { n: remaining, limit })}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </Card>

      {/* ========== Danh sách Reel ========== */}
      {reels.length ? (
        <View style={{ gap: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('reels.list', { n: reels.length })}</Label>
            {!busy ? <Pressable onPress={() => setReels([])} hitSlop={8}><Body size={12} color={c.danger} weight="600">{t('common.delete')}</Body></Pressable> : null}
          </Row>
          {reels.map((r) => (
            <ReelCard key={r.key} r={r} disabled={busy}
              onTitle={(v) => patch(r.key, { title: v })}
              onSchedule={(v) => patch(r.key, { isSchedule: v, scheduledTime: v ? r.scheduledTime ?? Date.now() + 3600_000 : undefined })}
              onPickTime={() => setDateFor(r.key)}
              onDelete={() => setReels((prev) => prev.filter((x) => x.key !== r.key))} />
          ))}
        </View>
      ) : null}

      {/* Modals */}
      <PickerModal visible={pagePicker} title={t('reels.pages')} onClose={() => setPagePicker(false)} items={pages} multi={!isFreePlan}
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={selectedIds} onToggle={togglePage} />
      <DateTimePickerModal visible={dateFor !== null} value={new Date(editing?.scheduledTime ?? Date.now() + 3600_000)}
        onClose={() => setDateFor(null)}
        onConfirm={(d) => {
          if (dateFor) patch(dateFor, { scheduledTime: d.getTime(), isSchedule: true });
          setDateFor(null);
        }} />
    </>
  );
}

export default function UpToReelsScreen() {
  return (
    <Screen>
      {/* metus-few: requirePackage=true */}
      <ToolGate require="package">{(_dtsg, _fbId, user) => <Runner user={user} />}</ToolGate>
    </Screen>
  );
}
