import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { DateRangeModal, fmtShortDate, startOfDay } from '@/components/DateRangeModal';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, EmptyState, Field, Label, Row, Screen, Segmented, radius, useColors } from '@/components/ui';
import { useAdsSession } from '@/lib/fb/adsSession';
import { fetchPagePostInfo, fetchPagePostsPage, type PagePostInfo, type PagePostRow, type PostType } from '@/lib/fb/pagePostAnalyze';
import { useT } from '@/lib/i18n';

const ALL_TYPES: PostType[] = ['photo', 'link', 'media_set', 'video', 'text', 'album', 'shared', 'others'];
type SortOption = 'time' | 'likes' | 'comments' | 'shares';
const LIKES_THRESHOLD = 40;
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
  const { ads, loading: adsLoading, error: adsError, reload: reloadAds } = useAdsSession();
  const token = ads?.token ?? '';

  const [pageInput, setPageInput] = useState('');
  const [pageInfo, setPageInfo] = useState<PagePostInfo | null>(null);
  const [posts, setPosts] = useState<PagePostRow[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [rangeStart, setRangeStart] = useState<Date | null>(() => { const d = startOfDay(new Date()); d.setDate(d.getDate() - 30); return d; });
  const [rangeEnd, setRangeEnd] = useState<Date | null>(() => startOfDay(new Date()));
  const [rangeModal, setRangeModal] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('time');
  const [typeFilters, setTypeFilters] = useState<Record<PostType, boolean>>(
    () => Object.fromEntries(ALL_TYPES.map((x) => [x, true])) as Record<PostType, boolean>,
  );
  const stopRef = useRef(false);

  const toggleType = (type: PostType) => setTypeFilters((prev) => ({ ...prev, [type]: !prev[type] }));

  const start = async () => {
    if (running) return;
    const input = pageInput.trim();
    if (!input) {
      setError(t('pageAnalyze.needInput'));
      return;
    }
    stopRef.current = false;
    setRunning(true);
    setError('');
    setPosts([]);
    setPageInfo(null);
    try {
      const info = await fetchPagePostInfo(input, token);
      setPageInfo(info);
      const sinceUnix = rangeStart ? Math.floor(startOfDay(rangeStart).getTime() / 1000) : undefined;
      const untilUnix = rangeEnd ? Math.floor(startOfDay(rangeEnd).getTime() / 1000) + 86399 : Math.floor(Date.now() / 1000);
      let nextUrl: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 50 && !stopRef.current; page++) {
        const { posts: pagePosts, nextUrl: next } = await fetchPagePostsPage({ pageId: info.id, token, nextUrl, sinceUnix, untilUnix });
        if (!pagePosts.length) break;
        const fresh = pagePosts.filter((p) => !seen.has(p.id));
        fresh.forEach((p) => seen.add(p.id));
        if (fresh.length) setPosts((prev) => [...prev, ...fresh]);
        if (!next || next === nextUrl) break;
        nextUrl = next;
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    stopRef.current = true;
    setRunning(false);
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
      case 'likes':
        return result.sort((a, b) => b.likes - a.likes);
      case 'comments':
        return result.sort((a, b) => b.comments - a.comments);
      case 'shares':
        return result.sort((a, b) => b.shares - a.shares);
      default:
        return result.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
    }
  }, [posts, typeFilters, sortBy]);

  const copyAll = async () => {
    const text = filteredPosts
      .map((p) => `${p.id}\t${p.type}\t${p.createdTime}\t${p.likes}\t${p.comments}\t${p.shares}\t${p.content.replace(/\s+/g, ' ')}`)
      .join('\n');
    await Clipboard.setStringAsync(text);
    showDialog(t('pageAnalyze.copiedN', { n: filteredPosts.length }));
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
        <Field label={t('pageAnalyze.input')} value={pageInput} onChangeText={setPageInput} placeholder={t('pageAnalyze.inputPh')} autoCapitalize="none" />
        {running ? (
          <Button title={t('pageAnalyze.stop')} variant="danger" onPress={stop} />
        ) : (
          <Button title={t('pageAnalyze.start')} onPress={start} disabled={!pageInput.trim() || !token} />
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

        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          <Badge text={t('pageAnalyze.loaded', { n: posts.length })} tone="muted" />
          <Badge text={t('pageAnalyze.showing', { n: filteredPosts.length })} tone="accent" />
        </Row>
        {filteredPosts.length ? <Button compact variant="secondary" title={t('pageAnalyze.copy')} icon="copy" onPress={copyAll} /> : null}
      </Card>

      {filteredPosts.length === 0 ? (
        <EmptyState icon="bar-chart" title={t('pageAnalyze.empty')} />
      ) : (
        filteredPosts.map((p) => (
          <Card key={p.id} padded={false} onPress={() => Linking.openURL(`https://www.facebook.com/${p.id}`)}
            style={p.likes < LIKES_THRESHOLD ? { borderColor: c.danger, borderWidth: 1.5 } : undefined}>
            <View style={{ height: 150, backgroundColor: c.chip, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, overflow: 'hidden' }}>
              {p.image ? (
                <Image source={{ uri: p.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Body muted size={12}>{t('pageAnalyze.noImage')}</Body>
                </View>
              )}
            </View>
            <View style={{ padding: 12, gap: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={6}>
                  <Ionicons name={TYPE_ICON[p.type]} size={14} color={c.accent} />
                  <Body muted size={11}>{formatDate(p.createdTime)}</Body>
                </Row>
              </Row>
              <Body size={13} numberOfLines={3}>{p.content || '…'}</Body>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={4}><Ionicons name="thumbs-up" size={13} color={c.accent} /><Body size={12} weight="700">{p.likes.toLocaleString()}</Body></Row>
                <Row gap={4}><Ionicons name="chatbubble" size={13} color={c.muted} /><Body size={12}>{p.comments.toLocaleString()}</Body></Row>
                <Row gap={4}><Ionicons name="repeat" size={13} color={c.muted} /><Body size={12}>{p.shares.toLocaleString()}</Body></Row>
              </Row>
            </View>
          </Card>
        ))
      )}

      <DateRangeModal visible={rangeModal} start={rangeStart} end={rangeEnd} onClose={() => setRangeModal(false)}
        onApply={(s, e) => { setRangeStart(s); setRangeEnd(e); setRangeModal(false); }} />
    </>
  );
}

export default function PagePostAnalysisScreen() {
  return (
    <Screen>
      <ToolGate require="package">{() => <Runner />}</ToolGate>
    </Screen>
  );
}
