import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { PickerModal, SelectorRow } from '@/components/AdPostTool';
import { DateRangeModal, fmtShortDate, startOfDay } from '@/components/DateRangeModal';
import { showDialog } from '@/components/Dialog';
import { StepField } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, EmptyState, Label, Row, Screen, radius, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useAdsSession } from '@/lib/fb/adsSession';
import { fetchPagePostsPage, type PagePostRow, type PostType } from '@/lib/fb/pagePostAnalyze';
import { hidePagePost } from '@/lib/fb/PagePostsManage';
import { useT } from '@/lib/i18n';

/**
 * Ẩn bài đăng Fanpage — port từ metus-few features/tools/page/page-posts-hide.
 * Hành động ẩn dùng đúng Graph API `POST /{postId}` body `timeline_visibility:
 * 'hidden'` của bản gốc (không phải `is_hidden`). Phần liệt kê bài để chọn ẩn
 * dùng lại `fetchPagePostsPage` (đã có sẵn trong app) thay vì port lại query
 * GraphQL Business Content Manager rất phức tạp/dễ vỡ của bản gốc — cùng mục
 * đích (liệt kê bài theo Page + khoảng ngày), đáng tin cậy hơn nhiều.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ALL_TYPES: PostType[] = ['photo', 'link', 'media_set', 'video', 'text', 'album', 'shared', 'others'];
const TYPE_ICON: Record<PostType, keyof typeof Ionicons.glyphMap> = {
  photo: 'image', link: 'link', media_set: 'images', video: 'videocam',
  text: 'document-text', album: 'albums', shared: 'repeat', others: 'ellipsis-horizontal',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Runner() {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const pages = ads?.pages ?? [];

  const [pageId, setPageId] = useState('');
  const [pagePicker, setPagePicker] = useState(false);
  const page = pages.find((p) => p.id === pageId);
  useEffect(() => {
    if (!pageId && pages.length) setPageId(pages[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(() => startOfDay(new Date()));
  const [rangeModal, setRangeModal] = useState(false);

  // Bản gốc chỉ bật sẵn loại "Link / Share" theo mặc định (quirk có thật, giữ nguyên).
  const [typeFilters, setTypeFilters] = useState<Record<PostType, boolean>>(
    () => Object.fromEntries(ALL_TYPES.map((x) => [x, x === 'link'])) as Record<PostType, boolean>,
  );
  const toggleType = (ty: PostType) => setTypeFilters((prev) => ({ ...prev, [ty]: !prev[ty] }));
  const typeFiltersRef = useRef(typeFilters);
  useEffect(() => { typeFiltersRef.current = typeFilters; }, [typeFilters]);

  const [posts, setPosts] = useState<PagePostRow[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');

  const [threads, setThreads] = useState(10);
  const [delaySec, setDelaySec] = useState(5);
  const [limitLoad, setLimitLoad] = useState(500);

  const stopRef = useRef(false);
  const activeRef = useRef(false);
  const queueRef = useRef<PagePostRow[]>([]);
  const fetchingRef = useRef(false);
  const nextUrlRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(true);
  const loadedRef = useRef(0);
  const hiddenRef = useRef(0);
  const pageRef = useRef<{ id: string; token: string }>({ id: '', token: '' });
  const limitRef = useRef(500);
  const rangeRef = useRef<{ since?: number; until?: number }>({});

  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(ALL_TYPES.map((x) => [x, 0])) as Record<PostType, number>;
    posts.forEach((p) => counts[p.type]++);
    return counts;
  }, [posts]);

  const resetForPage = () => {
    stopRef.current = true;
    activeRef.current = false;
    setIsRunning(false);
    setPosts([]);
    setLoadedCount(0);
    setHiddenCount(0);
    queueRef.current = [];
  };

  const passesFilter = (p: PagePostRow) => typeFiltersRef.current[p.type];

  const consumerWorker = async () => {
    while (!stopRef.current && activeRef.current) {
      const post = queueRef.current.shift();
      if (!post) {
        await sleep(200);
        continue;
      }
      try {
        await hidePagePost(post.id, pageRef.current.token);
        hiddenRef.current += 1;
        setHiddenCount(hiddenRef.current);
        setPosts((prev) => prev.filter((p) => p.id !== post.id));
      } catch (e) {
        setError(t('pagePostsHide.hideErr', { id: post.id }) + ': ' + describeError(e));
      }
      if (delaySec > 0) await sleep(delaySec * 1000);
    }
  };

  const producerFetch = async (): Promise<void> => {
    if (!activeRef.current || stopRef.current) return;
    if (fetchingRef.current || !hasMoreRef.current) return;
    fetchingRef.current = true;
    try {
      const { posts: fetched, nextUrl } = await fetchPagePostsPage({
        pageId: pageRef.current.id, token: pageRef.current.token, nextUrl: nextUrlRef.current,
        sinceUnix: rangeRef.current.since, untilUnix: rangeRef.current.until,
      });
      if (fetched.length === 0) {
        hasMoreRef.current = false;
      } else {
        loadedRef.current += fetched.length;
        setLoadedCount(loadedRef.current);
        let matched = fetched.filter(passesFilter);
        const limit = limitRef.current;
        if (limit > 0 && hiddenRef.current + queueRef.current.length + matched.length > limit) {
          matched = matched.slice(0, Math.max(0, limit - hiddenRef.current - queueRef.current.length));
        }
        if (matched.length) {
          setPosts((prev) => [...prev, ...matched]);
          if (!stopRef.current && activeRef.current) queueRef.current.push(...matched);
        }
        nextUrlRef.current = nextUrl;
        hasMoreRef.current = !!nextUrl;
        if (limit > 0 && hiddenRef.current + queueRef.current.length >= limit) hasMoreRef.current = false;
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      fetchingRef.current = false;
    }
    if (hasMoreRef.current && !stopRef.current && activeRef.current) setTimeout(producerFetch, 500);
  };

  const start = () => {
    if (isRunning) return;
    if (!page) return showDialog(t('pagePostsHide.needPage'));
    setError('');
    setPosts([]);
    setLoadedCount(0);
    setHiddenCount(0);
    pageRef.current = { id: page.id, token: page.access_token };
    rangeRef.current = {
      since: rangeStart ? Math.floor(startOfDay(rangeStart).getTime() / 1000) : undefined,
      until: rangeEnd ? Math.floor(startOfDay(rangeEnd).getTime() / 1000) + 86399 : undefined,
    };
    limitRef.current = limitLoad;
    nextUrlRef.current = undefined;
    hasMoreRef.current = true;
    loadedRef.current = 0;
    hiddenRef.current = 0;
    queueRef.current = [];
    stopRef.current = false;
    activeRef.current = true;
    setIsRunning(true);
    for (let i = 0; i < threads; i++) consumerWorker();
    producerFetch();
  };

  const stop = () => {
    stopRef.current = true;
    activeRef.current = false;
    setIsRunning(false);
  };

  const hideOne = async (post: PagePostRow) => {
    if (isRunning) return showDialog(t('pagePostsHide.waitAuto'));
    try {
      await hidePagePost(post.id, page!.access_token);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setHiddenCount((n) => n + 1);
    } catch (e) {
      setError(t('pagePostsHide.hideErr', { id: post.id }) + ': ' + describeError(e));
    }
  };

  return (
    <>
      <Card>
        <SelectorRow label={t('pagePostsHide.page')} avatar={page?.picture} text={page?.name}
          placeholder={t('pagePostsHide.pagePlaceholder')} onPress={() => !isRunning && setPagePicker(true)} />

        <Label>{t('pagePostsRemover.range')}</Label>
        <Pressable onPress={() => !isRunning && setRangeModal(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.input, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11 }}>
          <Ionicons name="calendar-outline" size={18} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Body weight="700" size={14}>
              {rangeStart ? `${fmtShortDate(rangeStart)}${rangeEnd ? ` → ${fmtShortDate(rangeEnd)}` : ''}` : t('pagePostsRemover.rangeAll')}
            </Body>
          </View>
          <Ionicons name="chevron-down" size={18} color={c.faint} />
        </Pressable>

        <Label>{t('pagePostsRemover.typeFilter')}</Label>
        <Row style={{ flexWrap: 'wrap' }} gap={6}>
          {ALL_TYPES.map((type) => {
            const active = typeFilters[type];
            return (
              <Pressable key={type} onPress={() => toggleType(type)} disabled={isRunning}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: active ? c.accentSoft : c.chip, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, opacity: isRunning ? 0.6 : 1 }}>
                <Ionicons name={TYPE_ICON[type]} size={13} color={active ? c.accentDeep : c.muted} />
                <Text style={{ color: active ? c.accentDeep : c.muted, fontWeight: '700', fontSize: 12 }}>
                  {t(`pageAnalyze.type.${type}`)} ({typeCounts[type] || 0})
                </Text>
              </Pressable>
            );
          })}
        </Row>

        <Row gap={8}>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.threads')} value={threads} min={1} onChange={setThreads} disabled={isRunning} /></View>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.delaySec')} value={delaySec} min={0} onChange={setDelaySec} disabled={isRunning} /></View>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.limitLoad')} value={limitLoad} min={0} step={50} onChange={setLimitLoad} disabled={isRunning} /></View>
        </Row>

        {isRunning ? (
          <Button title={t('pendingRemover.stop')} variant="danger" onPress={stop} />
        ) : (
          <Button title={t('pagePostsHide.start')} onPress={start} disabled={!page} />
        )}

        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          <Badge text={t('pendingRemover.loaded', { n: loadedCount })} tone="muted" />
          <Badge text={t('pagePostsHide.hidden', { n: hiddenCount })} tone="accent" />
        </Row>
        {error ? <Body color={c.danger} size={12}>{error}</Body> : null}
      </Card>

      {posts.length === 0 ? (
        <EmptyState icon="eye-off" title={t('pagePostsHide.empty')} />
      ) : (
        posts.map((p) => (
          <Card key={p.id} padded={false} style={{ borderColor: c.accent, borderWidth: 1.5 }}>
            <View style={{ height: 150, backgroundColor: c.chip, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, overflow: 'hidden' }}>
              {p.image ? (
                <Image source={{ uri: p.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={TYPE_ICON[p.type]} size={34} color={c.faint} />
                </View>
              )}
              <Pressable onPress={() => hideOne(p)} disabled={isRunning}
                style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', opacity: isRunning ? 0.5 : 1 }}>
                <Ionicons name="eye-off" size={16} color={c.accent} />
              </Pressable>
            </View>
            <View style={{ padding: 12, gap: 6 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={6}>
                  <Ionicons name="time-outline" size={13} color={c.muted} />
                  <Body muted size={11}>{formatDate(p.createdTime)}</Body>
                </Row>
                <Row gap={10}>
                  <Row gap={3}><Ionicons name="thumbs-up" size={12} color={c.accent} /><Body size={11}>{p.likes}</Body></Row>
                  <Row gap={3}><Ionicons name="chatbubble" size={12} color={c.success} /><Body size={11}>{p.comments}</Body></Row>
                </Row>
              </Row>
              <Body size={13} numberOfLines={3}>{p.content || '…'}</Body>
            </View>
          </Card>
        ))
      )}

      <PickerModal visible={pagePicker} title={t('pagePostsHide.page')} onClose={() => setPagePicker(false)}
        items={pages} keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture}
        selectedKeys={[pageId]} onToggle={(p) => { setPageId(p.id); setPagePicker(false); resetForPage(); }} />

      <DateRangeModal visible={rangeModal} start={rangeStart} end={rangeEnd} onClose={() => setRangeModal(false)}
        onApply={(s, e) => { setRangeStart(s); setRangeEnd(e); setRangeModal(false); }} />
    </>
  );
}

export default function PagePostsHideScreen() {
  return (
    <Screen>
      <ToolGate require="package">{() => <Runner />}</ToolGate>
    </Screen>
  );
}
