import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { PickerModal, SelectorRow } from '@/components/AdPostTool';
import { BulkScheduleSection, useBulkSchedule } from '@/components/bulkSchedule';
import { showDialog } from '@/components/Dialog';
import { DateRangeModal, fmtShortDate, startOfDay } from '@/components/DateRangeModal';
import { StepField } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, EmptyState, Field, Label, Row, Screen, Segmented, radius, shadow, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import type { AdAccount, AdPage } from '@/lib/fb/ads';
import { useAdsSession } from '@/lib/fb/adsSession';
import { extractMultiShareInfo } from '@/lib/fb/fbCarouselDeepClone';
import { fetchPagePostInfo, fetchPagePostsPage, type PagePostInfo, type PagePostRow, type PostType } from '@/lib/fb/pagePostAnalyze';
import { CTA_ACTIONS, createCarouselPost, uploadAdImage, uploadAdVideoFromUrl, type CardData } from '@/lib/fb/videoCarousel';
import { useT } from '@/lib/i18n';
import { pickMedia } from '@/lib/pickMedia';

const ALL_TYPES: PostType[] = ['photo', 'link', 'media_set', 'video', 'text', 'album', 'shared', 'others'];
type SortOption = 'time' | 'likes' | 'comments' | 'shares';
const TYPE_ICON: Record<PostType, keyof typeof Ionicons.glyphMap> = {
  photo: 'image', link: 'link', media_set: 'images', video: 'videocam',
  text: 'document-text', album: 'albums', shared: 'repeat', others: 'ellipsis-horizontal',
};

type LogStatus = 'pending' | 'success' | 'failed';
interface LogEntry {
  id: string;
  postImage: string | null;
  status: LogStatus;
  message: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function PostPreviewCard({
  post, sourcePageInfo, destPage, selected, onToggleSelect, message, onChangeMessage, isCustomMessage, onResetMessage,
  card2Image, card1Title, card1Description, card2Title, card2Description,
  onChangeCard1Title, onChangeCard1Description, onChangeCard2Title, onChangeCard2Description,
  onPickCard2Image, uploadingCard2, ctaLabel, scheduleText,
}: {
  post: PagePostRow; sourcePageInfo: PagePostInfo | null; destPage: AdPage | null; selected: boolean; onToggleSelect: () => void;
  message: string; onChangeMessage: (v: string) => void; isCustomMessage: boolean; onResetMessage: () => void;
  card2Image: string; card1Title: string; card1Description: string; card2Title: string; card2Description: string;
  onChangeCard1Title: (v: string) => void; onChangeCard1Description: (v: string) => void;
  onChangeCard2Title: (v: string) => void; onChangeCard2Description: (v: string) => void;
  onPickCard2Image: () => void; uploadingCard2: boolean;
  ctaLabel: string; scheduleText: string;
}) {
  const c = useColors();
  const t = useT();
  return (
    <View style={[{ borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }, shadow(c, 1)]}>
      {/* Header: Trang nguồn -> Trang đích + checkbox */}
      <Row style={{ justifyContent: 'space-between', padding: 12 }}>
        <Row gap={8} style={{ flex: 1 }}>
          <Image source={{ uri: sourcePageInfo?.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.chip }} />
          <Ionicons name="arrow-forward" size={16} color={c.faint} />
          <Image source={{ uri: destPage?.picture }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.chip }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{destPage?.name ?? t('postClone.destPagePlaceholder')}</Text>
            <Body muted size={11} numberOfLines={1}>{destPage?.id ?? ''}</Body>
          </View>
        </Row>
        <Pressable onPress={onToggleSelect} hitSlop={8}>
          <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={24} color={selected ? c.accent : c.faint} />
        </Pressable>
      </Row>

      {/* Nội dung bài — sửa được riêng cho từng bài */}
      <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 4 }}>
        <TextInput value={message} onChangeText={onChangeMessage} multiline placeholder={t('carouselClone.whatsOnMind')} placeholderTextColor={c.faint}
          style={{ fontSize: 13, color: c.text, minHeight: 36 }} />
        {isCustomMessage ? (
          <Pressable onPress={onResetMessage}><Body size={11} weight="700" color={c.accent}>{t('carouselClone.resetToOriginal')}</Body></Pressable>
        ) : null}
      </View>

      {/* 2 Card */}
      <Row gap={8} style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
        <View style={{ flex: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <View style={{ height: 130, backgroundColor: c.chip }}>
            {post.image ? <Image source={{ uri: post.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
            {post.type === 'video' ? (
              <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="play-circle" size={34} color="rgba(255,255,255,0.9)" />
              </View>
            ) : null}
          </View>
          <View style={{ padding: 8, gap: 4 }}>
            <TextInput value={card1Title} onChangeText={onChangeCard1Title} placeholder={t('carouselClone.cardTitleShort')} placeholderTextColor={c.faint}
              style={{ fontSize: 12.5, fontWeight: '700', color: c.text }} />
            <TextInput value={card1Description} onChangeText={onChangeCard1Description} placeholder={t('carouselClone.cardDescShort')} placeholderTextColor={c.faint}
              style={{ fontSize: 11.5, color: c.muted }} />
            <View style={{ marginTop: 4, backgroundColor: c.chip, borderRadius: radius.sm, paddingVertical: 7, alignItems: 'center' }}>
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: c.text }} numberOfLines={1}>{ctaLabel}</Text>
            </View>
          </View>
        </View>

        <View style={{ flex: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <View style={{ height: 130, backgroundColor: c.chip }}>
            {card2Image || destPage?.picture ? <Image source={{ uri: card2Image || destPage?.picture }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
            <Pressable onPress={onPickCard2Image} disabled={uploadingCard2}
              style={{ position: 'absolute', bottom: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
              {uploadingCard2 ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
            </Pressable>
          </View>
          <View style={{ padding: 8, gap: 4 }}>
            <TextInput value={card2Title} onChangeText={onChangeCard2Title} placeholder={t('carouselClone.cardTitleShort')} placeholderTextColor={c.faint}
              style={{ fontSize: 12.5, fontWeight: '700', color: c.text }} />
            <TextInput value={card2Description} onChangeText={onChangeCard2Description} placeholder={t('carouselClone.cardDescShort')} placeholderTextColor={c.faint}
              style={{ fontSize: 11.5, color: c.muted }} />
            <View style={{ marginTop: 4, backgroundColor: c.chip, borderRadius: radius.sm, paddingVertical: 7, alignItems: 'center' }}>
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: c.text }} numberOfLines={1}>{t('carouselClone.likePageLabel')}</Text>
            </View>
          </View>
        </View>
      </Row>

      {/* Giờ đăng */}
      <View style={{ marginHorizontal: 10, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input }}>
        <Body size={12.5} color={c.muted}>{scheduleText}</Body>
      </View>

      {/* Footer: like/comment/share + Xem bài đăng */}
      <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderColor: c.border, backgroundColor: c.accentSoft, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Row gap={10}>
          <Row gap={3}><Ionicons name="thumbs-up" size={13} color={c.accent} /><Body size={11} color={c.text}>{post.likes.toLocaleString()}</Body></Row>
          <Row gap={3}><Ionicons name="chatbubble" size={13} color={c.success} /><Body size={11} color={c.text}>{post.comments.toLocaleString()}</Body></Row>
          <Row gap={3}><Ionicons name="repeat" size={13} color={c.accentDeep} /><Body size={11} color={c.text}>{post.shares.toLocaleString()}</Body></Row>
          <Row gap={3}><Ionicons name="time-outline" size={12} color={c.muted} /><Body size={11} muted>{formatDate(post.createdTime)}</Body></Row>
        </Row>
        <Pressable onPress={() => Linking.openURL(post.permalinkUrl)} style={{ backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7 }}>
          <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 11.5 }}>{t('carouselClone.viewPost')}</Text>
        </Pressable>
      </Row>
    </View>
  );
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const { ads, loading: adsLoading, error: adsError, reload: reloadAds } = useAdsSession();
  const token = ads?.token ?? '';
  const pages = ads?.pages ?? [];
  const adAccounts = ads?.adAccounts ?? [];

  // Trang nguồn + quét bài
  const [pageInput, setPageInput] = useState('');
  const [pageInfo, setPageInfo] = useState<PagePostInfo | null>(null);
  const [posts, setPosts] = useState<PagePostRow[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [rangeStart, setRangeStart] = useState<Date | null>(() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - 1); return d; });
  const [rangeEnd, setRangeEnd] = useState<Date | null>(() => startOfDay(new Date()));
  const [rangeModal, setRangeModal] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('time');
  // Mặc định chỉ lọc loại "others" — nơi bài quảng cáo 2 ô (multi_share_no_end_card) rơi vào, giống bản gốc.
  const [typeFilters, setTypeFilters] = useState<Record<PostType, boolean>>(
    () => Object.fromEntries(ALL_TYPES.map((x) => [x, x === 'others'])) as Record<PostType, boolean>,
  );
  const toggleType = (type: PostType) => setTypeFilters((prev) => ({ ...prev, [type]: !prev[type] }));

  // Chọn bài
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Ad account + Trang đích — tự chọn mặc định mục đầu tiên (giống các tool đăng ads khác).
  const [adAccount, setAdAccount] = useState<AdAccount | null>(null);
  const [adsPicker, setAdsPicker] = useState(false);
  const [destPage, setDestPage] = useState<AdPage | null>(null);
  const [pagePicker, setPagePicker] = useState(false);
  useEffect(() => {
    if (adAccounts.length && !adAccount) setAdAccount(adAccounts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccounts]);
  useEffect(() => {
    if (pages.length && !destPage) setDestPage(pages[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  // Ghi đè Card 1 / Card 2 (áp dụng chung cho mọi bài, giống bản gốc)
  const [cardTitle, setCardTitle] = useState('');
  const [cardDescription, setCardDescription] = useState('');
  const [card2Title, setCard2Title] = useState('');
  const [card2Description, setCard2Description] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [ctaButton, setCtaButton] = useState(CTA_ACTIONS[0].value);
  const [ctaPicker, setCtaPicker] = useState(false);
  const [card2Image, setCard2Image] = useState('');
  // Đổi Trang đích -> ảnh Card 2 tự cập nhật theo avatar Trang mới (giống bản gốc).
  useEffect(() => {
    if (destPage?.picture) setCard2Image(destPage.picture);
  }, [destPage]);
  const [uploadingCard2, setUploadingCard2] = useState(false);
  const [customPostMessages, setCustomPostMessages] = useState<Record<string, string>>({});

  // Ảnh Card 1 luôn lấy từ bài gốc (video/ảnh thật), chỉ Card 2 ("Thích Trang") mới cần chọn thủ công.
  const pickCard2Image = async () => {
    if (!adAccount) return showDialog(t('carouselClone.noAdAccount'));
    const [a] = await pickMedia('image', false);
    if (!a) return;
    setUploadingCard2(true);
    try {
      const { url } = await uploadAdImage(adAccount.id, token, a);
      setCard2Image(url);
    } catch (e) {
      showDialog(describeError(e));
    } finally {
      setUploadingCard2(false);
    }
  };

  // Tuỳ chọn đăng lại
  const [delaySec, setDelaySec] = useState(1);
  const [keepOriginalCaption, setKeepOriginalCaption] = useState(true);
  const [bulkText, setBulkText] = useState('');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const sched = useBulkSchedule();

  // Clone
  const [log, setLog] = useState<LogEntry[]>([]);
  const [cloning, setCloning] = useState(false);

  const fetchPosts = async () => {
    const input = pageInput.trim();
    if (!input) return setError(t('postClone.needInput'));
    setFetching(true);
    setError('');
    setPosts([]);
    setPageInfo(null);
    setSelectedIds(new Set());
    try {
      const info = await fetchPagePostInfo(input, token);
      setPageInfo(info);
      const sinceUnix = rangeStart ? Math.floor(startOfDay(rangeStart).getTime() / 1000) : undefined;
      const untilUnix = rangeEnd ? Math.floor(startOfDay(rangeEnd).getTime() / 1000) + 86399 : Math.floor(Date.now() / 1000);
      let nextUrl: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 30; page++) {
        const { posts: pagePosts, nextUrl: next } = await fetchPagePostsPage({ pageId: info.id, token, nextUrl, sinceUnix, untilUnix });
        if (!pagePosts.length) break;
        const fresh = pagePosts.filter((p) => !seen.has(p.id));
        fresh.forEach((p) => seen.add(p.id));
        if (fresh.length) setPosts((prev) => [...prev, ...fresh]);
        if (!next || next === nextUrl) break;
        nextUrl = next;
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };

  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(ALL_TYPES.map((x) => [x, 0])) as Record<PostType, number>;
    posts.forEach((p) => counts[p.type]++);
    return counts;
  }, [posts]);

  const filteredPosts = useMemo(() => {
    const enabled = new Set(ALL_TYPES.filter((x) => typeFilters[x]));
    const result = posts.filter((p) => enabled.has(p.type));
    switch (sortBy) {
      case 'likes': return [...result].sort((a, b) => b.likes - a.likes);
      case 'comments': return [...result].sort((a, b) => b.comments - a.comments);
      case 'shares': return [...result].sort((a, b) => b.shares - a.shares);
      default: return [...result].sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
    }
  }, [posts, typeFilters, sortBy]);

  const getFinalMessage = (original: string) => {
    let msg = keepOriginalCaption ? original : bulkText;
    if (findText) msg = msg.replaceAll(findText, replaceText);
    return msg || '';
  };
  const getDisplayMessage = (post: PagePostRow) => customPostMessages[post.id] ?? getFinalMessage(post.content);

  const clone = async () => {
    const selected = posts.filter((p) => selectedIds.has(p.id));
    if (!selected.length) return showDialog(t('postClone.noPostsSelected'));
    if (!destPage) return showDialog(t('postClone.noDestPage'));
    if (!adAccount) return showDialog(t('carouselClone.noAdAccount'));
    setCloning(true);
    setLog([]);
    for (let i = 0; i < selected.length; i++) {
      const post = selected[i];
      const finalMessage = getDisplayMessage(post);
      const info = extractMultiShareInfo(post.attachments);
      const scheduledUnix = sched.advanced ? Math.floor(sched.scheduleAt(i) / 1000) : undefined;
      if (i > 0 && !sched.advanced && delaySec > 0) await new Promise((r) => setTimeout(r, delaySec * 1000));
      const logId = `${Date.now()}-${i}`;
      setLog((prev) => [{ id: logId, postImage: post.image, status: 'pending', message: t('carouselClone.creating') }, ...prev]);
      try {
        let videoId: string | undefined;
        let thumbnailUrl = '';
        if (info.videoUrl) {
          setLog((prev) => prev.map((l) => (l.id === logId ? { ...l, message: t('carouselClone.uploadingVideo') } : l)));
          const up = await uploadAdVideoFromUrl(adAccount.id, token, info.videoUrl);
          videoId = up.videoId;
          thumbnailUrl = up.picture;
        }
        const card1: CardData = {
          picture: thumbnailUrl || post.image || '',
          video_id: videoId,
          name: cardTitle.trim() || info.card1Title || '',
          description: cardDescription.trim() || info.card1Description || '',
          CTAButton: ctaButton,
          websiteUrl: websiteUrl.trim(),
        };
        const card2: CardData = {
          picture: card2Image || destPage.picture || '',
          name: card2Title.trim() || info.card2Title || destPage.name,
          description: card2Description.trim() || info.card2Description || destPage.name,
          CTAButton: 'LIKE_PAGE',
          websiteUrl: '',
        };
        const postId = await createCarouselPost({
          mode: 'carousel2', token, adAccountId: adAccount.id, page: destPage, dtsg, fbId,
          primaryText: finalMessage, cards: [card1, card2], scheduleUnix: scheduledUnix,
        });
        setLog((prev) => prev.map((l) => (l.id === logId ? {
          ...l, status: 'success',
          message: scheduledUnix ? t('postClone.scheduledMsg', { time: new Date(scheduledUnix * 1000).toLocaleString() }) : t('carouselClone.successMsg', { page: destPage.name }),
        } : l)));
        void postId;
      } catch (e) {
        setLog((prev) => prev.map((l) => (l.id === logId ? { ...l, status: 'failed', message: t('postClone.failedMsg', { page: destPage.name, error: e instanceof Error ? e.message : String(e) }) } : l)));
      }
    }
    setCloning(false);
  };

  if (adsLoading && !ads) {
    return <Card><Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>…</Body></Row></Card>;
  }
  if (adsError && !ads) {
    return (
      <Card>
        <Body color={c.danger}>{adsError}</Body>
        <Button title="↻" variant="secondary" icon="refresh" onPress={reloadAds} full />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Field label={t('postClone.sourceInput')} value={pageInput} onChangeText={setPageInput} placeholder={t('postClone.sourceInputPh')} autoCapitalize="none" />
        {fetching ? <Row gap={10}><ActivityIndicator color={c.accent} /><Body muted size={12}>…</Body></Row> : (
          <Button title={t('postClone.fetchStart')} onPress={fetchPosts} disabled={!pageInput.trim() || !token} />
        )}
        {error ? <Body muted>{error}</Body> : null}
      </Card>

      {pageInfo ? (
        <Card>
          <Row gap={10} style={{ alignItems: 'center' }}>
            <Image source={{ uri: pageInfo.avatar }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.chip }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800' }} numberOfLines={1}>{pageInfo.name}</Text>
              <Body muted size={12}>{t('pageAnalyze.followers', { n: pageInfo.fan_count.toLocaleString() })}</Body>
            </View>
          </Row>
        </Card>
      ) : null}

      <Card>
        <Label>{t('pageAnalyze.range')}</Label>
        <Pressable onPress={() => setRangeModal(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }}>
          <Ionicons name="calendar-outline" size={18} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Body weight="700" size={14}>
              {rangeStart ? `${fmtShortDate(rangeStart)}${rangeEnd ? ` → ${fmtShortDate(rangeEnd)}` : ''}` : t('pageAnalyze.rangePlaceholder')}
            </Body>
          </View>
          <Ionicons name="chevron-down" size={18} color={c.faint} />
        </Pressable>

        <Label>{t('pageAnalyze.sort')}</Label>
        <Segmented value={sortBy} options={['time', 'likes', 'comments', 'shares']} onChange={setSortBy}
          labelFor={(o) => t(`pageAnalyze.sort${o.charAt(0).toUpperCase()}${o.slice(1)}`)} />

        <Label>{t('pageAnalyze.typeFilter')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {ALL_TYPES.map((type) => {
            const active = typeFilters[type];
            return (
              <Pressable key={type} onPress={() => toggleType(type)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: active ? c.accentSoft : c.chip, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Ionicons name={TYPE_ICON[type]} size={13} color={active ? c.accentDeep : c.muted} />
                <Text style={{ color: active ? c.accentDeep : c.muted, fontWeight: '700', fontSize: 12 }}>
                  {t(`pageAnalyze.type.${type}`)} ({typeCounts[type] || 0})
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Body muted size={11}>{t('carouselClone.filterHint')}</Body>
      </Card>

      <Card>
        <SelectorRow label={t('postClone.destPage')} avatar={destPage?.picture} text={destPage?.name} placeholder={t('postClone.destPagePlaceholder')} onPress={() => setPagePicker(true)} />
        <SelectorRow label={t('carouselClone.adAccount')} text={adAccount ? (adAccount.account_id ?? adAccount.id) : ''} placeholder={t('carouselClone.adAccountPlaceholder')} onPress={() => setAdsPicker(true)} />

        <Field label={t('carouselClone.card1Title')} value={cardTitle} onChangeText={setCardTitle} placeholder={t('carouselClone.card1TitlePh')} />
        <Field label={t('carouselClone.card1Desc')} value={cardDescription} onChangeText={setCardDescription} placeholder={t('carouselClone.card1DescPh')} />
        <SelectorRow label={t('carouselClone.ctaButton')} text={t(CTA_ACTIONS.find((a) => a.value === ctaButton)?.labelKey ?? '')} placeholder={t('carouselClone.ctaButton')} onPress={() => setCtaPicker(true)} />
        {CTA_ACTIONS.find((a) => a.value === ctaButton)?.input ? (
          <Field label={t('carouselClone.websiteUrl')} value={websiteUrl} onChangeText={setWebsiteUrl} placeholder="https://..." autoCapitalize="none" keyboardType="url" />
        ) : null}

        <Row gap={10} style={{ alignItems: 'center' }}>
          <Pressable onPress={() => pickCard2Image()} disabled={uploadingCard2}
            style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {card2Image ? <Image source={{ uri: card2Image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: card2Image ? 'rgba(0,0,0,0.25)' : 'transparent' }}>
              {uploadingCard2 ? <ActivityIndicator size="small" color={card2Image ? '#fff' : c.accent} /> : <Ionicons name="camera" size={18} color={card2Image ? '#fff' : c.accent} />}
            </View>
          </Pressable>
          <Pressable onPress={() => pickCard2Image()} disabled={uploadingCard2} style={{ flex: 1 }}>
            <Body weight="700" size={13} color={c.accent}>{t('carouselClone.uploadCard2Image')}</Body>
          </Pressable>
        </Row>
        <Field label={t('carouselClone.card2Title')} value={card2Title} onChangeText={setCard2Title} placeholder={t('carouselClone.card2TitlePh')} />
        <Field label={t('carouselClone.card2Desc')} value={card2Description} onChangeText={setCard2Description} placeholder={t('carouselClone.card2DescPh')} />

        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('postClone.keepOriginal')}</Body>
          <Switch value={keepOriginalCaption} onValueChange={setKeepOriginalCaption} trackColor={{ true: c.accent }} />
        </Row>
        {!keepOriginalCaption ? <Field value={bulkText} onChangeText={setBulkText} multiline placeholder={t('postClone.bulkTextPh')} /> : null}
        <Row>
          <View style={{ flex: 1 }}><Field label={t('postClone.findText')} value={findText} onChangeText={setFindText} placeholder={t('postClone.findTextPh')} /></View>
          <View style={{ flex: 1 }}><Field label={t('postClone.replaceText')} value={replaceText} onChangeText={setReplaceText} placeholder={t('postClone.replaceTextPh')} /></View>
        </Row>

        <StepField label={t('postClone.delaySec')} value={delaySec} min={0} onChange={setDelaySec} disabled={sched.advanced} />

        <BulkScheduleSection s={sched} total={selectedIds.size} totalLabel={t('postClone.totalPosts')} />

        <Button title={cloning ? t('carouselClone.cloning') : t('carouselClone.cloneBtn')} icon="copy" onPress={clone} loading={cloning} disabled={!selectedIds.size || !destPage || !adAccount} full />
      </Card>

      {filteredPosts.length === 0 ? (
        <EmptyState icon="copy" title={t('postClone.empty')} />
      ) : (
        <View style={{ gap: 12 }}>
          {filteredPosts.map((p) => {
            const selected = selectedIds.has(p.id);
            const selectedOrder = [...selectedIds].indexOf(p.id);
            const scheduleText = sched.advanced && selected && selectedOrder >= 0
              ? new Date(sched.scheduleAt(selectedOrder)).toLocaleString()
              : t('carouselClone.postNow');
            return (
              <PostPreviewCard key={p.id} post={p} sourcePageInfo={pageInfo} destPage={destPage}
                selected={selected} onToggleSelect={() => toggleSelect(p.id)}
                message={getDisplayMessage(p)} onChangeMessage={(v) => setCustomPostMessages((prev) => ({ ...prev, [p.id]: v }))}
                isCustomMessage={customPostMessages[p.id] !== undefined} onResetMessage={() => setCustomPostMessages((prev) => { const n = { ...prev }; delete n[p.id]; return n; })}
                card2Image={card2Image}
                card1Title={cardTitle} card1Description={cardDescription} card2Title={card2Title} card2Description={card2Description}
                onChangeCard1Title={setCardTitle} onChangeCard1Description={setCardDescription}
                onChangeCard2Title={setCard2Title} onChangeCard2Description={setCard2Description}
                onPickCard2Image={() => pickCard2Image()}
                uploadingCard2={uploadingCard2}
                ctaLabel={t(CTA_ACTIONS.find((a) => a.value === ctaButton)?.labelKey ?? '')} scheduleText={scheduleText} />
            );
          })}
        </View>
      )}

      {log.length ? (
        <Card>
          <Label>{t('postClone.log')}</Label>
          {log.map((l) => (
            <Row key={l.id} gap={10} style={{ alignItems: 'center' }}>
              {l.postImage ? <Image source={{ uri: l.postImage }} style={{ width: 32, height: 32, borderRadius: 6 }} /> : <Ionicons name="document" size={20} color={c.faint} />}
              <View style={{ flex: 1 }}><Body size={12} numberOfLines={2}>{l.message}</Body></View>
              <Badge text={t(`postClone.st.${l.status}`)} tone={l.status === 'success' ? 'success' : l.status === 'failed' ? 'danger' : 'muted'} />
            </Row>
          ))}
        </Card>
      ) : null}

      <DateRangeModal visible={rangeModal} start={rangeStart} end={rangeEnd} onClose={() => setRangeModal(false)}
        onApply={(s, e) => { setRangeStart(s); setRangeEnd(e); setRangeModal(false); }} />
      <PickerModal visible={pagePicker} title={t('postClone.destPage')} onClose={() => setPagePicker(false)} items={pages}
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={destPage ? [destPage.id] : []}
        onToggle={(p) => setDestPage(p)} />
      <PickerModal visible={adsPicker} title={t('carouselClone.adAccount')} onClose={() => setAdsPicker(false)} items={adAccounts}
        keyOf={(a) => a.id} labelOf={(a) => `${a.name} (${a.account_id ?? a.id})`} selectedKeys={adAccount ? [adAccount.id] : []}
        onToggle={(a) => setAdAccount(a)} />
      <PickerModal visible={ctaPicker} title={t('carouselClone.ctaButton')} onClose={() => setCtaPicker(false)} items={CTA_ACTIONS}
        keyOf={(a) => a.value} labelOf={(a) => t(a.labelKey)} selectedKeys={[ctaButton]}
        onToggle={(a) => setCtaButton(a.value)} />
    </>
  );
}

export default function FbCarouselDeepCloneScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
