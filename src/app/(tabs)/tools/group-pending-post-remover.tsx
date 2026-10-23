import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { PickerModal, SelectorRow } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { StepField } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, EmptyState, Row, Screen, radius, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { declinePendingPost, getGroups, getPendingPosts, type GroupItem, type PendingPost } from '@/lib/fb/Group';
import { useT } from '@/lib/i18n';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const [pendingPosts, setPendingPosts] = useState<PendingPost[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const [threads, setThreads] = useState(8);
  const [delaySec, setDelaySec] = useState(0.2);
  const [limitLoad, setLimitLoad] = useState(100);

  const stopRef = useRef(false);
  const activeRef = useRef(false);
  const queueRef = useRef<PendingPost[]>([]);
  const fetchingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(true);
  const loadedRef = useRef(0);
  const deletedRef = useRef(0);
  const groupIdRef = useRef('');
  const limitRef = useRef(100);

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

  const resetForGroup = () => {
    stopRef.current = true;
    activeRef.current = false;
    setIsDeleting(false);
    setPendingPosts([]);
    setLoadedCount(0);
    setDeletedCount(0);
    queueRef.current = [];
  };

  const consumerWorker = async () => {
    while (!stopRef.current && activeRef.current) {
      const post = queueRef.current.shift();
      if (!post) {
        await sleep(200);
        continue;
      }
      try {
        await declinePendingPost({ dtsg, fbId, groupId: groupIdRef.current, postId: post.postId, memberId: post.memberId });
        deletedRef.current += 1;
        setDeletedCount(deletedRef.current);
        setPendingPosts((prev) => prev.filter((p) => p.id !== post.id));
      } catch (e) {
        setError(t('pendingRemover.deleteErr', { id: post.postId }) + ': ' + describeError(e));
      }
      if (delaySec > 0) await sleep(delaySec * 1000);
    }
  };

  const producerFetch = async (): Promise<void> => {
    if (!activeRef.current || stopRef.current) return;
    if (fetchingRef.current || !hasMoreRef.current) return;
    fetchingRef.current = true;
    try {
      const { posts, nextCursor } = await getPendingPosts(dtsg, fbId, groupIdRef.current, cursorRef.current);
      if (posts.length === 0) {
        hasMoreRef.current = false;
      } else {
        let fresh = posts;
        const limit = limitRef.current;
        if (limit > 0 && loadedRef.current + posts.length > limit) {
          fresh = posts.slice(0, Math.max(0, limit - loadedRef.current));
          if (!fresh.length) hasMoreRef.current = false;
        }
        if (fresh.length) {
          setPendingPosts((prev) => [...prev, ...fresh]);
          loadedRef.current += fresh.length;
          setLoadedCount(loadedRef.current);
          if (!stopRef.current && activeRef.current) queueRef.current.push(...fresh);
        }
        cursorRef.current = nextCursor;
        hasMoreRef.current = hasMoreRef.current && !!nextCursor;
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      fetchingRef.current = false;
    }
    if (hasMoreRef.current && !stopRef.current && activeRef.current) {
      setTimeout(producerFetch, 300);
    }
  };

  const start = () => {
    if (isDeleting) return;
    if (!selectedGroupId) {
      setError(t('pendingRemover.needGroup'));
      return;
    }
    setError('');
    setPendingPosts([]);
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

  const deleteOne = async (post: PendingPost) => {
    if (isDeleting) {
      showDialog(t('pendingRemover.waitAuto'));
      return;
    }
    try {
      await declinePendingPost({ dtsg, fbId, groupId: selectedGroupId, postId: post.postId, memberId: post.memberId });
      setPendingPosts((prev) => prev.filter((p) => p.id !== post.id));
      setDeletedCount((n) => n + 1);
    } catch (e) {
      setError(t('pendingRemover.deleteErr', { id: post.postId }) + ': ' + describeError(e));
    }
  };

  return (
    <>
      <Card>
        <SelectorRow label={t('pendingRemover.group')} avatar={currentGroup?.picture} text={currentGroup?.name}
          placeholder={groupsLoading ? '…' : t('pendingRemover.groupPlaceholder')} onPress={() => !isDeleting && setGroupPicker(true)} />

        <Row gap={8}>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.threads')} value={threads} min={1} onChange={setThreads} disabled={isDeleting} /></View>
          <View style={{ flex: 1 }}><StepField label={t('pendingRemover.delaySec')} value={delaySec} min={0} step={0.1} onChange={setDelaySec} disabled={isDeleting} /></View>
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

      {pendingPosts.length === 0 ? (
        <EmptyState icon="trash" title={t('pendingRemover.empty')} />
      ) : (
        pendingPosts.map((p) => (
          <Card key={p.id} padded={false} style={{ borderColor: '#f59e0b', borderWidth: 1.5 }}>
            <View style={{ height: 150, backgroundColor: c.chip, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={p.attachment?.type === 'photo' ? 'image' : p.attachment?.type === 'link' ? 'link' : 'document-text'} size={34} color={c.faint} />
              <Pressable onPress={() => deleteOne(p)} disabled={isDeleting}
                style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', opacity: isDeleting ? 0.5 : 1 }}>
                <Ionicons name="trash" size={16} color={c.danger} />
              </Pressable>
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, backgroundColor: 'rgba(0,0,0,0.45)' }}>
                {p.memberAvatar ? <Image source={{ uri: p.memberAvatar }} style={{ width: 20, height: 20, borderRadius: 10 }} /> : null}
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }} numberOfLines={1}>{p.memberName || p.memberId}</Text>
              </View>
            </View>
            <View style={{ padding: 12, gap: 6 }}>
              <Row gap={6}>
                <Ionicons name="time-outline" size={13} color={c.muted} />
                <Body muted size={11}>{formatDate(p.createdTime)}</Body>
              </Row>
              <Body size={13} numberOfLines={3}>
                {p.content || (p.attachment?.type === 'unavailable' ? (p.attachment.title || t('pendingRemover.unavailable')) : '…')}
              </Body>
            </View>
          </Card>
        ))
      )}

      <PickerModal visible={groupPicker} title={t('pendingRemover.group')} onClose={() => setGroupPicker(false)}
        items={groups} keyOf={(g) => g.id} labelOf={(g) => g.name} avatarOf={(g) => g.picture}
        selectedKeys={[selectedGroupId]} onToggle={(g) => { setSelectedGroupId(g.id); resetForGroup(); }} />
    </>
  );
}

export default function GroupPendingPostRemoverScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
