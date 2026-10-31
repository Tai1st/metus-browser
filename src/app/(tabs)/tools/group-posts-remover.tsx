import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { PickerModal, SelectorRow } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { StepField } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, EmptyState, Label, Row, Screen, radius, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { deleteGroupPost, getGroupFeedPosts, getGroups, type GroupFeedPost, type GroupFeedPostType, type GroupItem } from '@/lib/fb/Group';
import { useT } from '@/lib/i18n';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ALL_TYPES: GroupFeedPostType[] = ['photo', 'link', 'media_set', 'video', 'text', 'others'];
const TYPE_ICON: Record<GroupFeedPostType, keyof typeof Ionicons.glyphMap> = {
  photo: 'image', link: 'link', media_set: 'images', video: 'videocam', text: 'document-text', others: 'ellipsis-horizontal',
};

function formatDate(ts: number) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupPicker, setGroupPicker] = useState(false);

  const [typeFilters, setTypeFilters] = useState<Record<GroupFeedPostType, boolean>>(
    () => Object.fromEntries(ALL_TYPES.map((x) => [x, true])) as Record<GroupFeedPostType, boolean>,
  );
  const [likeLess, setLikeLess] = useState(40);
  const toggleType = (ty: GroupFeedPostType) => setTypeFilters((prev) => ({ ...prev, [ty]: !prev[ty] }));
  const typeFiltersRef = useRef(typeFilters);
  const likeLessRef = useRef(likeLess);
  useEffect(() => { typeFiltersRef.current = typeFilters; }, [typeFilters]);
  useEffect(() => { likeLessRef.current = likeLess; }, [likeLess]);

  const [posts, setPosts] = useState<GroupFeedPost[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const [threads, setThreads] = useState(8);
  const [delaySec, setDelaySec] = useState(2);
  const [limitLoad, setLimitLoad] = useState(200);

  const stopRef = useRef(false);
  const activeRef = useRef(false);
  const queueRef = useRef<GroupFeedPost[]>([]);
  const fetchingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(true);
  const loadedRef = useRef(0);
  const deletedRef = useRef(0);
  const groupIdRef = useRef('');
  const limitRef = useRef(200);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const list = (await getGroups(dtsg, fbId)).filter((g) => g.isAdmin);
      setGroups(list);
      if (list.length && !selectedGroupId) setSelectedGroupId(list[0].id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setGroupsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtsg, fbId]);

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentGroup = groups.find((g) => g.id === selectedGroupId);
  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(ALL_TYPES.map((x) => [x, 0])) as Record<GroupFeedPostType, number>;
    posts.forEach((p) => counts[p.type]++);
    return counts;
  }, [posts]);

  const resetForGroup = () => {
    stopRef.current = true;
    activeRef.current = false;
    setIsDeleting(false);
    setPosts([]);
    setLoadedCount(0);
    setDeletedCount(0);
    queueRef.current = [];
  };

  const passesFilter = (p: GroupFeedPost) => typeFiltersRef.current[p.type] && p.likes < likeLessRef.current;

  const consumerWorker = async () => {
    while (!stopRef.current && activeRef.current) {
      const post = queueRef.current.shift();
      if (!post) {
        await sleep(200);
        continue;
      }
      try {
        await deleteGroupPost(dtsg, fbId, groupIdRef.current, post.id);
        deletedRef.current += 1;
        setDeletedCount(deletedRef.current);
        setPosts((prev) => prev.filter((p) => p.id !== post.id));
      } catch (e) {
        setError(t('postRemover.deleteErr', { id: post.id }) + ': ' + describeError(e));
      }
      if (delaySec > 0) await sleep(delaySec * 1000);
    }
  };

  const producerFetch = async (): Promise<void> => {
    if (!activeRef.current || stopRef.current) return;
    if (fetchingRef.current || !hasMoreRef.current) return;
    fetchingRef.current = true;
    try {
      const { posts: fetched, nextCursor, hasNextPage } = await getGroupFeedPosts(dtsg, fbId, groupIdRef.current, cursorRef.current);
      if (fetched.length === 0) {
        hasMoreRef.current = false;
      } else {
        loadedRef.current += fetched.length;
        setLoadedCount(loadedRef.current);
        let matched = fetched.filter(passesFilter);
        const limit = limitRef.current;
        if (limit > 0 && deletedRef.current + queueRef.current.length + matched.length > limit) {
          matched = matched.slice(0, Math.max(0, limit - deletedRef.current - queueRef.current.length));
        }
        if (matched.length) {
          setPosts((prev) => [...prev, ...matched]);
          if (!stopRef.current && activeRef.current) queueRef.current.push(...matched);
        }
        cursorRef.current = nextCursor;
        hasMoreRef.current = hasNextPage && !!nextCursor;
        if (limit > 0 && deletedRef.current + queueRef.current.length >= limit) hasMoreRef.current = false;
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      fetchingRef.current = false;
    }
    if (hasMoreRef.current && !stopRef.current && activeRef.current) {
      setTimeout(producerFetch, 500);
    }
  };

  const start = () => {
    if (isDeleting) return;
    if (!selectedGroupId) {
      setError(t('postRemover.needGroup'));
      return;
    }
    setError('');
    setPosts([]);
    setLoadedCount(0);
    setDeletedCount(0);
    groupIdRef.current = selectedGroupId;
    limitRef.current = limitLoad;
    cursorRef.current = undefined;
    hasMoreRef.current = true;
    loadedRef.current = 0;
    deletedRef.current = 0;
    queueRef.current = [];
    stopRef.current = false;
    activeRef.current = true;
    setIsDeleting(true);
    for (let i = 0; i < threads; i++) consumerWorker();
    producerFetch();
  };

  const stop = () => {
    stopRef.current = true;
    activeRef.current = false;
    setIsDeleting(false);
  };

  const deleteOne = async (post: GroupFeedPost) => {
    if (isDeleting) {
      showDialog(t('spamRemover.waitAuto'));
      return;
    }
    try {
      await deleteGroupPost(dtsg, fbId, selectedGroupId, post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setDeletedCount((n) => n + 1);
    } catch (e) {
      setError(t('postRemover.deleteErr', { id: post.id }) + ': ' + describeError(e));
    }
  };

  return (
    <>
      <Card>
        <SelectorRow label={t('spamRemover.group')} avatar={currentGroup?.picture} text={currentGroup?.name}
          placeholder={groupsLoading ? '…' : t('spamRemover.groupPlaceholder')} onPress={() => !isDeleting && setGroupPicker(true)} />

        <Label>{t('postRemover.typeFilter')}</Label>
        <Row style={{ flexWrap: 'wrap' }} gap={6}>
          {ALL_TYPES.map((type) => {
            const active = typeFilters[type];
            return (
              <Pressable key={type} onPress={() => toggleType(type)} disabled={isDeleting}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: active ? c.accentSoft : c.chip, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, opacity: isDeleting ? 0.6 : 1 }}>
                <Ionicons name={TYPE_ICON[type]} size={13} color={active ? c.accentDeep : c.muted} />
                <Text style={{ color: active ? c.accentDeep : c.muted, fontWeight: '700', fontSize: 12 }}>
                  {t(`postRemover.type.${type}`)} ({typeCounts[type] || 0})
                </Text>
              </Pressable>
            );
          })}
        </Row>

        <StepField label={t('postRemover.likeLess')} value={likeLess} min={0} step={10} onChange={setLikeLess} disabled={isDeleting} />
        <Row gap={8}>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.threads')} value={threads} min={1} onChange={setThreads} disabled={isDeleting} /></View>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.delaySec')} value={delaySec} min={0} step={0.5} onChange={setDelaySec} disabled={isDeleting} /></View>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.limitLoad')} value={limitLoad} min={0} step={10} onChange={setLimitLoad} disabled={isDeleting} /></View>
        </Row>

        {isDeleting ? (
          <Button title={t('pendingRemover.stop')} variant="danger" onPress={stop} />
        ) : (
          <Button title={t('pendingRemover.start')} onPress={start} disabled={!selectedGroupId} />
        )}

        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          <Badge text={t('pendingRemover.loaded', { n: loadedCount })} tone="muted" />
          <Badge text={t('pendingRemover.removed', { n: deletedCount })} tone="accent" />
        </Row>
        {error ? <Body color={c.danger} size={12}>{error}</Body> : null}
      </Card>

      {posts.length === 0 ? (
        <EmptyState icon="trash" title={t('postRemover.empty')} />
      ) : (
        posts.map((p) => (
          <Card key={p.id} padded={false} style={{ borderColor: c.danger, borderWidth: 1.5 }}>
            <View style={{ height: 150, backgroundColor: c.chip, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, overflow: 'hidden' }}>
              {p.image ? (
                <Image source={{ uri: p.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={TYPE_ICON[p.type]} size={34} color={c.faint} />
                </View>
              )}
              <Pressable onPress={() => deleteOne(p)} disabled={isDeleting}
                style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', opacity: isDeleting ? 0.5 : 1 }}>
                <Ionicons name="trash" size={16} color={c.danger} />
              </Pressable>
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, backgroundColor: 'rgba(0,0,0,0.45)' }}>
                {p.authorAvatar ? <Image source={{ uri: p.authorAvatar }} style={{ width: 20, height: 20, borderRadius: 10 }} /> : null}
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11, flex: 1 }} numberOfLines={1}>{p.authorName}</Text>
              </View>
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
                  <Row gap={3}><Ionicons name="repeat" size={12} color={c.accentDeep} /><Body size={11}>{p.shares}</Body></Row>
                </Row>
              </Row>
              <Body size={13} numberOfLines={3}>{p.content || '…'}</Body>
            </View>
          </Card>
        ))
      )}

      <PickerModal visible={groupPicker} title={t('spamRemover.group')} onClose={() => setGroupPicker(false)}
        items={groups} keyOf={(g) => g.id} labelOf={(g) => g.name} avatarOf={(g) => g.picture}
        selectedKeys={[selectedGroupId]} onToggle={(g) => { setSelectedGroupId(g.id); resetForGroup(); }} />
    </>
  );
}

export default function GroupPostsRemoverScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
