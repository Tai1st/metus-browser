import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { SelectorRow, PickerModal } from '@/components/AdPostTool';
import { BulkScheduleSection, useBulkSchedule } from '@/components/bulkSchedule';
import { showDialog } from '@/components/Dialog';
import { DateRangeModal, fmtShortDate, startOfDay } from '@/components/DateRangeModal';
import { StepField } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, EmptyState, Field, Label, Row, Screen, Segmented, radius, shadow, useColors } from '@/components/ui';
import { useAdsSession } from '@/lib/fb/adsSession';
import type { AdPage } from '@/lib/fb/ads';
import { fetchPagePostInfo, fetchPagePostsPage, type PagePostInfo, type PagePostRow, type PostType } from '@/lib/fb/pagePostAnalyze';
import { cloneSinglePost } from '@/lib/fb/pagePostClone';
import { useT } from '@/lib/i18n';

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

function PostCloneCard({
  post, sourcePageInfo, destPage, selected, onToggleSelect, message, onChangeMessage, isCustomMessage, onResetMessage, scheduleText,
}: {
  post: PagePostRow; sourcePageInfo: PagePostInfo | null; destPage: AdPage | null; selected: boolean; onToggleSelect: () => void;
  message: string; onChangeMessage: (v: string) => void; isCustomMessage: boolean; onResetMessage: () => void; scheduleText: string;
}) {
  const c = useColors();
  const t = useT();
  return (
    <View style={[{ borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }, shadow(c, 1)]}>
      <Row gap={10} style={{ padding: 12, alignItems: 'flex-start' }}>
        <View style={{ width: 90, height: 90, borderRadius: radius.sm, backgroundColor: c.chip, overflow: 'hidden' }}>
          {post.image ? <Image source={{ uri: post.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Body muted size={10}>{t('pageAnalyze.noImage')}</Body></View>
          )}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={6} style={{ flex: 1 }}>
              <Image source={{ uri: sourcePageInfo?.avatar }} style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: c.chip }} />
              <Ionicons name="arrow-forward" size={13} color={c.faint} />
              <Image source={{ uri: destPage?.picture }} style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: c.chip }} />
              <Text style={{ flex: 1, color: c.text, fontWeight: '700', fontSize: 11.5 }} numberOfLines={1}>{destPage?.name ?? t('postClone.destPagePlaceholder')}</Text>
            </Row>
            <Pressable onPress={onToggleSelect} hitSlop={8}>
              <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? c.accent : c.faint} />
            </Pressable>
          </Row>
          <TextInput value={message} onChangeText={onChangeMessage} multiline placeholder={t('carouselClone.whatsOnMind')} placeholderTextColor={c.faint}
            style={{ fontSize: 12.5, color: c.text, minHeight: 60, borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, backgroundColor: c.input, padding: 8, textAlignVertical: 'top' }} />
          {isCustomMessage ? (
            <Pressable onPress={onResetMessage} style={{ alignSelf: 'flex-end' }}><Body size={11} weight="700" color={c.accent}>{t('carouselClone.resetToOriginal')}</Body></Pressable>
          ) : null}
        </View>
      </Row>

      <View style={{ marginHorizontal: 12, marginBottom: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input }}>
        <Body size={12} color={c.muted}>{scheduleText}</Body>
      </View>

      <Row style={{ justifyContent: 'space-between', borderTopWidth: 1, borderColor: c.border, backgroundColor: c.accentSoft, paddingHorizontal: 12, paddingVertical: 10 }}>
        <Row gap={10}>
          <Ionicons name={TYPE_ICON[post.type]} size={13} color={c.accent} />
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

function Runner() {
  const c = useColors();
  const t = useT();
  const { ads, loading: adsLoading, error: adsError, reload: reloadAds } = useAdsSession();
  const token = ads?.token ?? '';
  const pages = ads?.pages ?? [];

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
  const [typeFilters, setTypeFilters] = useState<Record<PostType, boolean>>(
    () => Object.fromEntries(ALL_TYPES.map((x) => [x, true])) as Record<PostType, boolean>,
  );
  const toggleType = (type: PostType) => setTypeFilters((prev) => ({ ...prev, [type]: !prev[type] }));

  // Chọn bài
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Trang đích
  const [destPage, setDestPage] = useState<AdPage | null>(null);
  useEffect(() => {
    if (pages.length && !destPage) setDestPage(pages[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);
  const [pagePicker, setPagePicker] = useState(false);

  // Tuỳ chọn đăng lại
  const [delaySec, setDelaySec] = useState(1);
  const [hideAfterShare, setHideAfterShare] = useState(false);
  const [keepOriginalCaption, setKeepOriginalCaption] = useState(true);
  const [bulkText, setBulkText] = useState('');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const sched = useBulkSchedule();
  const [customPostMessages, setCustomPostMessages] = useState<Record<string, string>>({});

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
    setCloning(true);
    setLog([]);
    for (let i = 0; i < selected.length; i++) {
      const post = selected[i];
      const finalMsg = getDisplayMessage(post);
      const scheduledUnix = sched.advanced ? Math.floor(sched.scheduleAt(i) / 1000) : undefined;
      if (i > 0 && !sched.advanced && delaySec > 0) await new Promise((r) => setTimeout(r, delaySec * 1000));
      const logId = `${Date.now()}-${i}`;
      setLog((prev) => [{ id: logId, postImage: post.image, status: 'pending', message: t('postClone.cloning') }, ...prev]);
      const result = await cloneSinglePost(destPage, post, finalMsg, scheduledUnix, hideAfterShare);
      setLog((prev) => prev.map((l) => (l.id === logId ? {
        ...l,
        status: result.success ? 'success' : 'failed',
        message: result.success
          ? (scheduledUnix ? t('postClone.scheduledMsg', { time: new Date(scheduledUnix * 1000).toLocaleString() }) : t('postClone.successMsg', { page: destPage.name }))
          : t('postClone.failedMsg', { page: destPage.name, error: result.error ?? '' }),
      } : l)));
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

        {filteredPosts.length ? (
          <Row gap={10}>
            <Pressable onPress={() => setSelectedIds(new Set(filteredPosts.map((p) => p.id)))}>
              <Body size={12} weight="700" color={c.accent}>{t('postClone.selectAll')}</Body>
            </Pressable>
            <Pressable onPress={() => setSelectedIds(new Set())}>
              <Body size={12} weight="700" color={c.danger}>{t('postClone.unselectAll')}</Body>
            </Pressable>
          </Row>
        ) : null}
      </Card>

      <Card>
        <SelectorRow label={t('postClone.destPage')} avatar={destPage?.picture} text={destPage?.name} placeholder={t('postClone.destPagePlaceholder')} onPress={() => setPagePicker(true)} />

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
        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('postClone.hideAfterShare')}</Body>
          <Switch value={hideAfterShare} onValueChange={setHideAfterShare} trackColor={{ true: c.accent }} />
        </Row>

        <BulkScheduleSection s={sched} total={selectedIds.size} totalLabel={t('postClone.totalPosts')} />

        <Button title={cloning ? t('postClone.cloning') : t('postClone.cloneBtn')} icon="copy" onPress={clone} loading={cloning} disabled={!selectedIds.size || !destPage} full />
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
              <PostCloneCard key={p.id} post={p} sourcePageInfo={pageInfo} destPage={destPage}
                selected={selected} onToggleSelect={() => toggleSelect(p.id)}
                message={getDisplayMessage(p)} onChangeMessage={(v) => setCustomPostMessages((prev) => ({ ...prev, [p.id]: v }))}
                isCustomMessage={customPostMessages[p.id] !== undefined}
                onResetMessage={() => setCustomPostMessages((prev) => { const n = { ...prev }; delete n[p.id]; return n; })}
                scheduleText={scheduleText} />
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
    </>
  );
}

export default function PagePostsCloneScreen() {
  return (
    <Screen>
      <ToolGate require="package">{() => <Runner />}</ToolGate>
    </Screen>
  );
}
