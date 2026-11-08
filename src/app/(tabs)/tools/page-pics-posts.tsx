import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { DateTimePickerModal, PickerModal, SelectorRow, fmtDateTime } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { BulkScheduleSection, reschedule, useBulkSchedule } from '@/components/bulkSchedule';
import { BgComposer, BgPresetModal, StepField, TickBox, type TextBg } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Card, Field, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError, type MetusUser } from '@/lib/api';
import { useAdsSession } from '@/lib/fb/adsSession';
import type { AdPage } from '@/lib/fb/ads';
import type { LocalFile } from '@/lib/fb/Group';
import { publishPagePhotoPost, uploadPagePhoto } from '@/lib/fb/pagePicsPost';
import { commentWithToken } from '@/lib/fb/reels';
import { likePost } from '@/lib/fb/videoCarousel';
import { useT } from '@/lib/i18n';
import { notifyNow } from '@/lib/notify';
import { pickMedia } from '@/lib/pickMedia';
import * as bg from '@metus/background';

/**
 * Đăng ảnh thường lên Page hàng loạt — port từ metus-few
 * features/tools/page/page-pics-posts. Chọn nhiều Page → tải nhiều ảnh (upload
 * ngay lên từng Page) → mỗi ảnh × mỗi Page = 1 bài → chạy: đăng ngay / hẹn giờ /
 * lưu nháp, giới hạn mỗi Page + delay, reshare Story, tự like, bình luận sau đăng.
 */

type PicStatus = 'unpublished' | 'scheduled' | 'published' | 'error';

interface Pic {
  key: string;
  page: AdPage;
  photoId: string;
  imageUrl: string;
  title: string;
  isSchedule: boolean;
  scheduledTime?: number;
  status: PicStatus;
  error?: string;
  textFormatPresetId?: string;
}

function PicCard({ p, disabled, onTitle, onSchedule, onPickTime, onDelete }: {
  p: Pic; disabled: boolean; onTitle: (v: string) => void; onSchedule: (v: boolean) => void; onPickTime: () => void; onDelete: () => void;
}) {
  const c = useColors();
  const t = useT();
  const tone = p.status === 'published' ? 'success' : p.status === 'scheduled' ? 'info' : p.status === 'error' ? 'danger' : 'muted';
  const locked = disabled || p.status !== 'unpublished';
  return (
    <View style={[{ borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }, shadow(c, 1)]}>
      <View style={{ flexDirection: 'row' }}>
        <Image source={{ uri: p.imageUrl }} style={{ width: 96, height: 120, backgroundColor: c.chip }} contentFit="cover" />
        <View style={{ flex: 1, padding: 10, gap: 6 }}>
          <Row gap={6}>
            {p.page.picture ? <Image source={{ uri: p.page.picture }} style={{ width: 20, height: 20, borderRadius: 10 }} /> : null}
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '700', color: c.text }}>{p.page.name}</Text>
            {!locked ? <Pressable onPress={onDelete} hitSlop={8}><Ionicons name="trash-outline" size={17} color={c.danger} /></Pressable> : null}
          </Row>
          <TextInput value={p.title} onChangeText={onTitle} editable={!locked} multiline placeholder={t('picsPost.titlePh')} placeholderTextColor={c.faint}
            style={{ minHeight: 44, maxHeight: 80, fontSize: 13, color: c.text, borderWidth: 1, borderColor: c.inputBorder, borderRadius: 8, backgroundColor: c.input, paddingHorizontal: 8, paddingVertical: 6, textAlignVertical: 'top' }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge text={t(`picsPost.st.${p.status}`)} tone={tone} />
            <Row gap={4}>
              <Text style={{ fontSize: 11.5, color: c.muted }}>{t('picsPost.schedule')}</Text>
              <Switch value={p.isSchedule} disabled={locked} onValueChange={onSchedule} trackColor={{ true: c.accent }} style={{ transform: [{ scale: 0.8 }] }} />
            </Row>
          </Row>
          {p.isSchedule && p.scheduledTime ? (
            <Pressable disabled={locked} onPress={onPickTime} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="calendar-outline" size={13} color={c.accent} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: c.accent }}>{fmtDateTime(new Date(p.scheduledTime))}</Text>
            </Pressable>
          ) : null}
          {p.error ? <Text numberOfLines={3} style={{ fontSize: 11, color: c.danger }}>{p.error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function Runner({ dtsg, fbId, user }: { dtsg: string; fbId: string; user: MetusUser | null }) {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
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
  const [reshareToStory, setReshareToStory] = useState(false);
  const [isLikeEnabled, setIsLikeEnabled] = useState(false);
  const [content, setContent] = useState('');
  const [textFormatBg, setTextFormatBg] = useState<TextBg | undefined>(undefined);
  const [textFormatPresetId, setTextFormatPresetId] = useState<string | undefined>(undefined);
  const [bgOpen, setBgOpen] = useState(false);
  const pickBg = (presetId: string, b?: TextBg) => {
    setTextFormatPresetId(presetId || undefined);
    setTextFormatBg(presetId ? b : undefined);
  };
  // Hẹn giờ hàng loạt (AdvancedBulkSchedule)
  const sched = useBulkSchedule();
  const { advanced, scheduleAt } = sched;
  // Bình luận sau khi đăng (CommentCard)
  const [commentOn, setCommentOn] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentPhoto, setCommentPhoto] = useState<LocalFile | null>(null);

  const [pics, setPics] = useState<Pic[]>([]);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);

  // Modal
  const [pagePicker, setPagePicker] = useState(false);
  const [dateFor, setDateFor] = useState<string | null>(null);

  // Đổi cài đặt hẹn giờ → tính lại giờ cho các ảnh chưa đăng
  useEffect(() => {
    if (!advanced) return;
    setPics((prev) =>
      reschedule(
        prev.map((p) => ({ ...p, pageId: p.page.id, pending: p.status === 'unpublished' })),
        scheduleAt,
        (p, at) => ({ ...p, scheduledTime: at }),
      ),
    );
  }, [advanced, scheduleAt]);

  const togglePage = (p: AdPage) => {
    if (isFreePlan) return setSelectedIds([p.id]); // gói miễn phí: chỉ 1 Page
    setSelectedIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]));
  };

  const busy = running || uploading;

  /** Tải ảnh lên: mỗi ảnh × mỗi Page đã chọn = upload ngay + 1 card (processImages của metus-few). */
  const pickPhotos = async () => {
    if (!selectedPages.length) return showDialog(t('picsPost.needPage'));
    const files = await pickMedia('image', true);
    if (!files.length) return;
    setUploading(true);
    const counts: Record<string, number> = {};
    for (const r of pics) if (r.status === 'unpublished' && r.isSchedule) counts[r.page.id] = (counts[r.page.id] ?? 0) + 1;
    for (const file of files) {
      for (const page of selectedPages) {
        try {
          const { photoId, imageUrl } = await uploadPagePhoto(dtsg, fbId, page.id, { uri: file.uri, name: file.name, type: file.mimeType ?? 'image/jpeg' });
          const i = counts[page.id] ?? 0;
          if (advanced) counts[page.id] = i + 1;
          setPics((prev) => [
            ...prev,
            {
              key: Crypto.randomUUID(),
              page,
              photoId,
              imageUrl,
              title: content.trim() ? content : (useFileName ? file.name.replace(/\.[^/.]+$/, '') : content),
              isSchedule: advanced,
              scheduledTime: advanced ? scheduleAt(i) : undefined,
              status: 'unpublished',
              textFormatPresetId,
            },
          ]);
        } catch (e) {
          showDialog(t('picsPost.uploadErr', { page: page.name, err: describeError(e) }));
        }
      }
    }
    setUploading(false);
  };

  const patch = (key: string, p: Partial<Pic>) => setPics((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  /** RUN BULK (handleRunBulk của metus-few). */
  const runBulk = async () => {
    const todo = pics.filter((p) => p.status === 'unpublished');
    if (!todo.length) return showDialog(t('picsPost.noPics'));
    if (advanced && sched.mode === 'custom') {
      const scheduled = todo.filter((p) => p.isSchedule).length;
      const days = Math.ceil(scheduled / Math.max(1, sched.dailyTimes.length));
      if (days > 30) return showDialog(t('picsPost.tooManyDays', { days, total: scheduled }));
    }
    if (todo.some((p) => p.isSchedule && (p.scheduledTime ?? 0) < Date.now() + 10 * 60_000)) return showDialog(t('picsPost.scheduleTooSoon'));

    setRunning(true);
    bg.start(t('picsPost.bgTitle'), t('picsPost.bgRunning', { done: 0, total: todo.length })).catch(() => {});
    const perPage = new Map<string, number>();
    let done = 0;
    let failed = 0;
    for (const p of todo) {
      const count = perPage.get(p.page.id) ?? 0;
      if (count >= limit) continue;
      try {
        const scheduledUnix = p.isSchedule && p.scheduledTime ? Math.floor(p.scheduledTime / 1000) : undefined;
        const postId = await publishPagePhotoPost({
          dtsg, fbId, pageId: p.page.id, attachments: [{ photoId: p.photoId, imageUrl: p.imageUrl, caption: p.title }], message: p.title,
          isDraft: saveAsDraft, scheduledUnix, reshareToStory, textFormatPresetId: p.textFormatPresetId,
        });
        const status: PicStatus = saveAsDraft ? 'unpublished' : scheduledUnix ? 'scheduled' : 'published';
        patch(p.key, { status, error: saveAsDraft ? t('picsPost.savedDraft') : undefined });
        if (status === 'published' && postId) {
          if (commentOn && (commentText.trim() || commentPhoto)) {
            await commentWithToken(postId, p.page.access_token, commentText, commentPhoto).catch((e) =>
              patch(p.key, { error: `${t('picsPost.commentErr')}: ${describeError(e)}` }),
            );
          }
          if (isLikeEnabled) {
            await likePost(postId, p.page.access_token).catch((e) => patch(p.key, { error: `${t('picsPost.likeErr')}: ${describeError(e)}` }));
          }
        }
        perPage.set(p.page.id, count + 1);
      } catch (e) {
        patch(p.key, { status: 'error', error: describeError(e) });
        failed++;
      }
      done++;
      bg.update(t('picsPost.bgTitle'), t('picsPost.bgRunning', { done, total: todo.length })).catch(() => {});
      if ((perPage.get(p.page.id) ?? 0) < limit) await new Promise((r) => setTimeout(r, delay * 1000));
    }
    bg.stop().catch(() => {});
    setRunning(false);
    notifyNow(t('picsPost.bgTitle'), t('notify.picsPostDone', { ok: done - failed, fail: failed }));
  };
  useEffect(() => () => {
    bg.stop().catch(() => {});
  }, []);

  const scheduledCount = pics.filter((p) => p.status === 'unpublished' && p.isSchedule).length;
  const quota = useMemo(() => {
    const m = new Map<string, { page: AdPage; published: number }>();
    for (const p of pics) {
      if (!m.has(p.page.id)) m.set(p.page.id, { page: p.page, published: 0 });
      if (p.status === 'published') m.get(p.page.id)!.published++;
    }
    return [...m.values()];
  }, [pics]);
  const pageText = selectedPages.length === 0 ? '' : selectedPages.length === 1 ? selectedPages[0].name : t('picsPost.pagesSelected', { n: selectedPages.length });
  const editing = dateFor ? pics.find((p) => p.key === dateFor) : undefined;

  return (
    <>
      {/* ========== Cài đặt ========== */}
      <Card>
        <SelectorRow label={t('picsPost.pages')} avatar={selectedPages.length === 1 ? selectedPages[0].picture : undefined} text={pageText} placeholder={t('picsPost.pickPages')} onPress={() => !busy && setPagePicker(true)} />
        {isFreePlan ? <Body muted size={11}>{t('picsPost.freeOnePage')}</Body> : null}
        <Row>
          <View style={{ flex: 1 }}><StepField label={t('picsPost.limit')} value={limit} min={1} onChange={setLimit} disabled={busy} /></View>
          <View style={{ flex: 1 }}><StepField label={t('picsPost.delay')} value={delay} min={0} step={0.5} onChange={setDelay} disabled={busy} /></View>
        </Row>
        <TickBox label={t('picsPost.useFileName')} value={useFileName} disabled={busy} onBlocked={() => {}} onChange={setUseFileName} />

        <View style={{ gap: 6 }}>
          <Label>{t('picsPost.content')}</Label>
          <BgComposer value={content} onChangeText={setContent} bg={textFormatBg} presetId={textFormatPresetId}
            onPick={pickBg} onMore={() => setBgOpen(true)} disabled={busy} placeholder={t('picsPost.contentPh')} />
        </View>

        {/* Tải ảnh lên */}
        <Pressable onPress={pickPhotos} disabled={busy}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.md, backgroundColor: busy ? c.faint : c.accent }}>
          {uploading ? <ActivityIndicator color={c.onAccent} /> : <Ionicons name="cloud-upload-outline" size={18} color={c.onAccent} />}
          <Text style={{ color: c.onAccent, fontWeight: '800' }}>{uploading ? t('picsPost.uploading') : t('picsPost.upload')}</Text>
        </Pressable>

        {quota.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {quota.map(({ page, published }) => {
              const remaining = Math.max(0, limit - published);
              return (
                <View key={page.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                  {page.picture ? <Image source={{ uri: page.picture }} style={{ width: 16, height: 16, borderRadius: 8 }} /> : null}
                  <Text numberOfLines={1} style={{ maxWidth: 100, fontSize: 11.5, fontWeight: '600', color: c.text }}>{page.name}</Text>
                  <Text style={{ fontSize: 11.5, fontWeight: '800', color: remaining ? c.success : c.danger }}>{t('picsPost.remaining', { n: remaining, limit })}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Hẹn giờ hàng loạt */}
        <BulkScheduleSection s={sched} disabled={busy} total={scheduledCount} totalLabel={t('picsPost.totalPics')} />

        <TickBox label={t('picsPost.saveDraft')} value={saveAsDraft} disabled={busy} onBlocked={() => {}} onChange={setSaveAsDraft} />
        <TickBox label={t('picsPost.reshareToStory')} value={reshareToStory} disabled={busy} onBlocked={() => {}} onChange={setReshareToStory} />
        <TickBox label={t('picsPost.autoLike')} value={isLikeEnabled} disabled={busy} onBlocked={() => {}} onChange={setIsLikeEnabled} />

        {/* Bình luận sau khi đăng */}
        <View style={{ gap: 8 }}>
          <TickBox label={t('picsPost.commentAfter')} value={commentOn} disabled={busy} onBlocked={() => {}} onChange={setCommentOn} />
          {commentOn ? (
            <>
              <Field value={commentText} onChangeText={setCommentText} multiline editable={!busy} placeholder={t('gp.commentPh')} />
              {commentPhoto ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <Image source={{ uri: commentPhoto.uri }} style={{ width: 72, height: 72, borderRadius: radius.sm }} />
                  <Pressable onPress={() => setCommentPhoto(null)} hitSlop={6}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={13} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <Pressable disabled={busy}
                  onPress={async () => {
                    const [a] = await pickMedia('image', false);
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
          style={({ pressed }) => [{ backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: busy ? 0.6 : pressed ? 0.85 : 1 }, shadow(c, 1)]}>
          {running ? <ActivityIndicator color={c.onAccent} /> : null}
          <Text style={{ color: c.onAccent, fontWeight: '800', fontSize: 15 }}>{running ? t('picsPost.running') : t('picsPost.runBulk')}</Text>
        </Pressable>
      </Card>

      {/* ========== Danh sách ảnh ========== */}
      {pics.length ? (
        <View style={{ gap: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('picsPost.list', { n: pics.length })}</Label>
            {!busy ? <Pressable onPress={() => setPics([])} hitSlop={8}><Body size={12} color={c.danger} weight="600">{t('common.delete')}</Body></Pressable> : null}
          </Row>
          {pics.map((p) => (
            <PicCard key={p.key} p={p} disabled={busy}
              onTitle={(v) => patch(p.key, { title: v })}
              onSchedule={(v) => patch(p.key, { isSchedule: v, scheduledTime: v ? p.scheduledTime ?? Date.now() + 3600_000 : undefined })}
              onPickTime={() => setDateFor(p.key)}
              onDelete={() => setPics((prev) => prev.filter((x) => x.key !== p.key))} />
          ))}
        </View>
      ) : null}

      {/* Modals */}
      <PickerModal visible={pagePicker} title={t('picsPost.pages')} onClose={() => setPagePicker(false)} items={pages} multi={!isFreePlan}
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={selectedIds} onToggle={togglePage} />
      <DateTimePickerModal visible={dateFor !== null} value={new Date(editing?.scheduledTime ?? Date.now() + 3600_000)}
        onClose={() => setDateFor(null)}
        onConfirm={(d) => {
          if (dateFor) patch(dateFor, { scheduledTime: d.getTime(), isSchedule: true });
          setDateFor(null);
        }} />
      <BgPresetModal visible={bgOpen} onClose={() => setBgOpen(false)} selectedId={textFormatPresetId} dtsg={dtsg} fbId={fbId} pageId={selectedPages[0]?.id}
        onPick={(id, b) => { pickBg(id, b); setBgOpen(false); }} />
    </>
  );
}

export default function PagePicsPostsScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId, user) => <Runner dtsg={dtsg} fbId={fbId} user={user} />}</ToolGate>
    </Screen>
  );
}
