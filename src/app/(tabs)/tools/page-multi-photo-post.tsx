import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { DateTimePickerModal, PickerModal, SelectorRow, fmtDateTime } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { BgComposer, BgPresetModal, StepField, TickBox, type TextBg } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Card, Field, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError, type MetusUser } from '@/lib/api';
import type { AdPage } from '@/lib/fb/ads';
import { useAdsSession } from '@/lib/fb/adsSession';
import type { LocalFile } from '@/lib/fb/Group';
import { publishPagePhotoPost, uploadPagePhoto } from '@/lib/fb/pagePicsPost';
import { commentWithToken } from '@/lib/fb/reels';
import { likePost } from '@/lib/fb/videoCarousel';
import { useT } from '@/lib/i18n';
import { notifyNow } from '@/lib/notify';
import { pickMedia } from '@/lib/pickMedia';

/**
 * Đăng nhiều ảnh trong 1 bài lên nhiều Page — port từ metus-few
 * features/tools/page/page-multi-photo-post. Khác với page-pics-posts (mỗi ảnh ×
 * mỗi Page = 1 bài riêng): tool này gộp TẤT CẢ ảnh đã chọn vào 1 bài duy nhất cho
 * mỗi Page (N Page đã chọn = N bài, mỗi bài có đủ các ảnh). Ảnh chỉ upload thật
 * lúc bấm "Đăng" (không upload ngay lúc chọn như page-pics-posts). Hẹn giờ là
 * 1 mốc giờ chung cho tất cả, không phải lịch hàng loạt kiểu "mỗi N phút".
 */

type LocalPhoto = { key: string; uri: string; name: string; mimeType?: string; caption: string };
type PostStatus = 'pending' | 'success' | 'failed';
interface PageResult {
  pageId: string;
  pageName: string;
  pagePicture?: string;
  status: PostStatus;
  postId?: string;
  error?: string;
}

function Runner({ dtsg, fbId, user }: { dtsg: string; fbId: string; user: MetusUser | null }) {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const pages = ads?.pages ?? [];
  const plan = user?.plan as { price?: number } | null | undefined;
  const isFreePlan = !plan || (plan.price ?? 0) <= 0;

  // Chọn Page
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    if (pages.length && !selectedIds.length) setSelectedIds([pages[0].id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);
  const selectedPages = pages.filter((p) => selectedIds.includes(p.id));
  const [pagePicker, setPagePicker] = useState(false);
  const togglePage = (p: AdPage) => {
    if (isFreePlan) return setSelectedIds([p.id]);
    setSelectedIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]));
  };

  // Nội dung chung
  const [content, setContent] = useState('');
  const [textFormatBg, setTextFormatBg] = useState<TextBg | undefined>(undefined);
  const [textFormatPresetId, setTextFormatPresetId] = useState<string | undefined>(undefined);
  const [bgOpen, setBgOpen] = useState(false);
  const pickBg = (presetId: string, b?: TextBg) => {
    setTextFormatPresetId(presetId || undefined);
    setTextFormatBg(presetId ? b : undefined);
  };

  // Ảnh (chỉ lưu local, upload lúc đăng)
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const pickPhotos = async () => {
    const picked = await pickMedia('image', true);
    if (!picked.length) return;
    setPhotos((prev) => [...prev, ...picked.map((a) => ({ key: Crypto.randomUUID(), uri: a.uri, name: a.name, mimeType: a.mimeType, caption: '' }))]);
  };
  const removePhoto = (key: string) => setPhotos((prev) => prev.filter((p) => p.key !== key));
  const setPhotoCaption = (key: string, caption: string) => setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, caption } : p)));

  // Tuỳ chọn đăng
  const [delaySec, setDelaySec] = useState(2);
  const [saveAsDraft, setSaveAsDraft] = useState(false);
  const [reshareToStory, setReshareToStory] = useState(false);
  const [isLikeEnabled, setIsLikeEnabled] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledTime, setScheduledTime] = useState(() => new Date(Date.now() + 3600_000));
  const [datePicker, setDatePicker] = useState(false);

  // Bình luận sau khi đăng
  const [commentOn, setCommentOn] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentPhoto, setCommentPhoto] = useState<LocalFile | null>(null);

  const [results, setResults] = useState<PageResult[]>([]);
  const [posting, setPosting] = useState(false);

  const post = async () => {
    if (!selectedPages.length) return showDialog(t('multiPost.needPage'));
    if (!photos.length) return showDialog(t('multiPost.needPhotos'));
    setPosting(true);
    setResults(selectedPages.map((p) => ({ pageId: p.id, pageName: p.name, pagePicture: p.picture, status: 'pending' })));
    let ok = 0;
    for (let i = 0; i < selectedPages.length; i++) {
      const page = selectedPages[i];
      try {
        const attachments = [];
        for (const photo of photos) {
          const { photoId, imageUrl } = await uploadPagePhoto(dtsg, fbId, page.id, { uri: photo.uri, name: photo.name, type: photo.mimeType ?? 'image/jpeg' });
          attachments.push({ photoId, imageUrl, caption: photo.caption });
        }
        const scheduledUnix = isScheduled && !saveAsDraft ? Math.floor(scheduledTime.getTime() / 1000) : undefined;
        const postId = await publishPagePhotoPost({
          dtsg, fbId, pageId: page.id, attachments, message: content,
          isDraft: saveAsDraft, scheduledUnix, reshareToStory, textFormatPresetId,
        });
        setResults((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'success', postId } : r)));
        if (postId && !saveAsDraft && !scheduledUnix) {
          if (commentOn && (commentText.trim() || commentPhoto)) {
            await commentWithToken(postId, page.access_token, commentText, commentPhoto).catch(() => {});
          }
          if (isLikeEnabled) {
            await likePost(postId, page.access_token).catch(() => {});
          }
        }
        ok++;
      } catch (e) {
        setResults((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'failed', error: describeError(e) } : r)));
      }
      if (i < selectedPages.length - 1 && delaySec > 0) await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
    setPosting(false);
    notifyNow(t('multiPost.bgTitle'), t('multiPost.doneMsg', { ok, total: selectedPages.length }));
  };

  const pageText = selectedPages.length === 0 ? '' : selectedPages.length === 1 ? selectedPages[0].name : t('picsPost.pagesSelected', { n: selectedPages.length });

  return (
    <>
      <Card>
        <SelectorRow label={t('picsPost.pages')} avatar={selectedPages.length === 1 ? selectedPages[0].picture : undefined} text={pageText} placeholder={t('picsPost.pickPages')} onPress={() => !posting && setPagePicker(true)} />
        {isFreePlan ? <Body muted size={11}>{t('picsPost.freeOnePage')}</Body> : null}

        <View style={{ gap: 6 }}>
          <Label>{t('picsPost.content')}</Label>
          <BgComposer value={content} onChangeText={setContent} bg={textFormatBg} presetId={textFormatPresetId}
            onPick={pickBg} onMore={() => setBgOpen(true)} disabled={posting} placeholder={t('picsPost.contentPh')} />
        </View>

        <Pressable onPress={pickPhotos} disabled={posting}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.md, backgroundColor: posting ? c.faint : c.accent }}>
          <Ionicons name="images-outline" size={18} color={c.onAccent} />
          <Text style={{ color: c.onAccent, fontWeight: '800' }}>{t('multiPost.pickPhotos')}</Text>
        </Pressable>

        <StepField label={t('postClone.delaySec')} value={delaySec} min={0} onChange={setDelaySec} disabled={posting} />

        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('multiPost.schedule')}</Body>
          <Switch value={isScheduled} onValueChange={setIsScheduled} trackColor={{ true: c.accent }} disabled={posting} />
        </Row>
        {isScheduled ? (
          <Pressable onPress={() => setDatePicker(true)} disabled={posting}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }}>
            <Ionicons name="calendar-outline" size={18} color={c.accent} />
            <Body weight="700" size={14}>{fmtDateTime(scheduledTime)}</Body>
          </Pressable>
        ) : null}

        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('picsPost.saveDraft')}</Body>
          <Switch value={saveAsDraft} onValueChange={setSaveAsDraft} trackColor={{ true: c.accent }} disabled={posting} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('picsPost.reshareToStory')}</Body>
          <Switch value={reshareToStory} onValueChange={setReshareToStory} trackColor={{ true: c.accent }} disabled={posting} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('picsPost.autoLike')}</Body>
          <Switch value={isLikeEnabled} onValueChange={setIsLikeEnabled} trackColor={{ true: c.accent }} disabled={posting} />
        </Row>

        <View style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body weight="600" size={14}>{t('picsPost.commentAfter')}</Body>
            <Switch value={commentOn} onValueChange={setCommentOn} trackColor={{ true: c.accent }} disabled={posting} />
          </Row>
          {commentOn ? (
            <>
              <Field value={commentText} onChangeText={setCommentText} multiline editable={!posting} placeholder={t('gp.commentPh')} />
              {commentPhoto ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <Image source={{ uri: commentPhoto.uri }} style={{ width: 72, height: 72, borderRadius: radius.sm }} />
                  <Pressable onPress={() => setCommentPhoto(null)} hitSlop={6}
                    style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={13} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <Pressable disabled={posting}
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

        <Pressable onPress={post} disabled={posting || !selectedPages.length || !photos.length}
          style={({ pressed }) => [{ backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: posting || !selectedPages.length || !photos.length ? 0.6 : pressed ? 0.85 : 1 }, shadow(c, 1)]}>
          {posting ? <ActivityIndicator color={c.onAccent} /> : null}
          <Text style={{ color: c.onAccent, fontWeight: '800', fontSize: 15 }}>{posting ? t('picsPost.running') : t('multiPost.postBtn')}</Text>
        </Pressable>
      </Card>

      {photos.length ? (
        <Card>
          <Label>{t('multiPost.photosN', { n: photos.length })}</Label>
          {photos.map((p) => (
            <Row key={p.key} gap={10} style={{ alignItems: 'center' }}>
              <Image source={{ uri: p.uri }} style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: c.chip }} contentFit="cover" />
              <TextInput value={p.caption} onChangeText={(v) => setPhotoCaption(p.key, v)} editable={!posting} placeholder={t('multiPost.photoCaptionPh')} placeholderTextColor={c.faint}
                style={{ flex: 1, fontSize: 13, color: c.text, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, backgroundColor: c.input, paddingHorizontal: 10, paddingVertical: 8 }} />
              {!posting ? (
                <Pressable onPress={() => removePhoto(p.key)} hitSlop={8}><Ionicons name="trash-outline" size={19} color={c.danger} /></Pressable>
              ) : null}
            </Row>
          ))}
        </Card>
      ) : null}

      {results.length ? (
        <Card>
          <Label>{t('multiPost.resultsN', { n: results.length })}</Label>
          {results.map((r) => (
            <Row key={r.pageId} gap={10} style={{ alignItems: 'center' }}>
              {r.pagePicture ? <Image source={{ uri: r.pagePicture }} style={{ width: 28, height: 28, borderRadius: 14 }} /> : <Ionicons name="flag" size={18} color={c.faint} />}
              <View style={{ flex: 1 }}>
                <Body weight="600" size={13} numberOfLines={1}>{r.pageName}</Body>
                {r.status === 'failed' && r.error ? <Body muted size={11} numberOfLines={2}>{r.error}</Body> : null}
              </View>
              {r.status === 'pending' ? <ActivityIndicator size="small" color={c.accent} /> : null}
              <Badge text={t(`multiPost.st.${r.status}`)} tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'danger' : 'muted'} />
            </Row>
          ))}
        </Card>
      ) : null}

      <PickerModal visible={pagePicker} title={t('picsPost.pages')} onClose={() => setPagePicker(false)} items={pages} multi={!isFreePlan}
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={selectedIds} onToggle={togglePage} />
      <DateTimePickerModal visible={datePicker} value={scheduledTime} onClose={() => setDatePicker(false)}
        onConfirm={(d) => { setScheduledTime(d); setDatePicker(false); }} />
      <BgPresetModal visible={bgOpen} onClose={() => setBgOpen(false)} selectedId={textFormatPresetId} dtsg={dtsg} fbId={fbId} pageId={selectedPages[0]?.id}
        onPick={(id, b) => { pickBg(id, b); setBgOpen(false); }} />
    </>
  );
}

export default function PageMultiPhotoPostScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId, user) => <Runner dtsg={dtsg} fbId={fbId} user={user} />}</ToolGate>
    </Screen>
  );
}
