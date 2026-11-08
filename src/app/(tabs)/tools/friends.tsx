import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as FS from 'expo-file-system/legacy';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { CenterModal, ModalFooter, SmallBtn } from '@/components/groupPost';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, Row, Screen, radius, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { getFriends, getFriendsRanking, pokeFriend, removeFriend, scanInteractions, type Friend, type FriendRanking, type InteractionCount } from '@/lib/fb/Friends';
import { useT } from '@/lib/i18n';
import * as storage from '@/lib/storage';

/**
 * Quản lý bạn bè Facebook — port từ metus-few features/tools/profile/friends.
 * Danh sách bạn bè (không phân trang ở tầng GraphQL, giống đúng bản gốc) + lọc/
 * sắp xếp/chọn nhiều ở client + chọc/huỷ kết bạn (đơn + hàng loạt có delay chống
 * ban) + theo dõi bạn đã huỷ kết bạn (so sánh cache cũ/mới) + "Xếp hạng bạn bè"
 * (thực chất là danh sách liên hệ Messenger do FB tự xếp hạng — giữ nguyên hành
 * vi gốc) + "Quét tương tác" (mint access_token qua OAuth giả rồi quét toàn bộ
 * bài đăng của mình). "Deep scan"/"Followers" trong bản gốc chỉ là nút hiện
 * "đang phát triển", chưa từng code — giữ nguyên là stub.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const PAGE_SIZE = 10;
const DEFAULT_AVATAR = 'https://scontent.fbmv1-1.fna.fbcdn.net/v/t1.30497-1/453178253_471506465671661_2781666950760530985_n.png';
const hasSpecialChar = (s: string) => /[^a-zA-Z0-9\sÀ-ỹ]/.test(s);

type SortKey = 'name' | 'likeCount' | 'commentCount' | 'totalInteractions' | null;

function filterBadges(f: Friend, t: ReturnType<typeof useT>): { label: string; tone: 'accent' | 'info' | 'danger' }[] {
  const out: { label: string; tone: 'accent' | 'info' | 'danger' }[] = [];
  if (!f.id.startsWith('1000')) out.push({ label: t('friends.badge.oddUid'), tone: 'info' });
  if (f.profilePicture?.includes(DEFAULT_AVATAR)) out.push({ label: t('friends.badge.noAvatar'), tone: 'accent' });
  if (hasSpecialChar(f.name)) out.push({ label: t('friends.badge.specialChar'), tone: 'danger' });
  return out;
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();

  const [friends, setFriends] = useState<Friend[]>(() => storage.get<Friend[]>(storage.StorageKey.FB_FRIENDS) ?? []);
  const [removedFriends, setRemovedFriends] = useState<Friend[]>(() => storage.get<Friend[]>(storage.StorageKey.FB_REMOVED_FRIENDS) ?? []);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pokingIds, setPokingIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [interactionData, setInteractionData] = useState<InteractionCount[]>([]);

  const [rankingOpen, setRankingOpen] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [ranking, setRanking] = useState<FriendRanking[]>([]);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  const dedupe = (list: Friend[]) => {
    const seen = new Set<string>();
    return list.filter((f) => (f?.id && !seen.has(f.id) ? (seen.add(f.id), true) : false));
  };

  const saveRemoved = (list: Friend[]) => {
    const clean = dedupe(list);
    setRemovedFriends(clean);
    storage.set(storage.StorageKey.FB_REMOVED_FRIENDS, clean);
  };

  const fetchFriends = async (compare: boolean) => {
    setLoading(true);
    try {
      const oldData = compare ? friends : [];
      const raw = await getFriends(dtsg, fbId);
      const fresh = dedupe(raw);
      if (compare && oldData.length) {
        const newIds = new Set(fresh.map((f) => f.id));
        const lost = oldData.filter((f) => !newIds.has(f.id));
        if (lost.length) saveRemoved([...removedFriends, ...lost]);
      }
      setFriends(fresh);
      storage.set(storage.StorageKey.FB_FRIENDS, fresh);
      storage.set(storage.StorageKey.FB_FRIENDS_LAST_FETCH, Date.now());
      const freshIds = new Set(fresh.map((f) => f.id));
      if (removedFriends.some((f) => freshIds.has(f.id))) saveRemoved(removedFriends.filter((f) => !freshIds.has(f.id)));
    } catch (e) {
      showDialog(t('friends.loadErr'), describeError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const lastFetch = storage.get<number>(storage.StorageKey.FB_FRIENDS_LAST_FETCH) ?? 0;
    if (Date.now() - lastFetch > ONE_HOUR_MS) fetchFriends(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withInteractions = useMemo(() => {
    if (!interactionData.length) return friends;
    const map = new Map(interactionData.map((i) => [i.uid, i]));
    return friends.map((f) => {
      const i = map.get(f.id);
      return { ...f, likeCount: i?.reactions ?? 0, commentCount: i?.comments ?? 0, totalInteractions: i?.totalInteractions ?? 0 };
    });
  }, [friends, interactionData]);

  const filtered = useMemo(() => {
    let list = search.trim() ? withInteractions.filter((f) => f.name.toLowerCase().includes(search.trim().toLowerCase())) : withInteractions;
    if (sortBy) {
      list = [...list].sort((a, b) => {
        const av = sortBy === 'name' ? a.name.toLowerCase() : a[sortBy];
        const bv = sortBy === 'name' ? b.name.toLowerCase() : b[sortBy];
        if (typeof av === 'string' && typeof bv === 'string') return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortOrder === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
      });
    }
    return list;
  }, [withInteractions, search, sortBy, sortOrder]);

  useEffect(() => setPage(1), [search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: Exclude<SortKey, null>) => {
    if (sortBy === key) setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortOrder(key === 'name' ? 'asc' : 'desc');
    }
  };

  const toggleSelect = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllOnPage = () => {
    const ids = pageItems.map((f) => f.id);
    const allIn = ids.every((id) => selected.includes(id));
    setSelected((prev) => (allIn ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]))));
  };
  const invertSelection = () => {
    const allIds = filtered.map((f) => f.id);
    setSelected((prev) => allIds.filter((id) => !prev.includes(id)));
  };

  const doPoke = async (id: string) => {
    setPokingIds((p) => [...p, id]);
    try {
      await pokeFriend(dtsg, fbId, id);
    } catch (e) {
      showDialog(t('friends.pokeErr'), describeError(e));
    } finally {
      setPokingIds((p) => p.filter((x) => x !== id));
    }
  };
  const doRemove = async (id: string): Promise<boolean> => {
    try {
      await removeFriend(dtsg, fbId, id);
      setFriends((prev) => {
        const next = prev.filter((f) => f.id !== id);
        storage.set(storage.StorageKey.FB_FRIENDS, next);
        return next;
      });
      setSelected((prev) => prev.filter((x) => x !== id));
      return true;
    } catch (e) {
      showDialog(t('friends.removeErr'), describeError(e));
      return false;
    }
  };

  const confirmSingle = (action: 'poke' | 'remove', f: Friend) => {
    showDialog(
      t(action === 'poke' ? 'friends.confirmPokeTitle' : 'friends.confirmRemoveTitle', { name: f.name }),
      t(action === 'poke' ? 'friends.confirmPokeMsg' : 'friends.confirmRemoveMsg'),
      [{ text: t('common.cancel'), style: 'cancel' }, { text: t(action === 'poke' ? 'friends.pokeBtn' : 'friends.removeBtn'), style: action === 'remove' ? 'destructive' : 'default', onPress: async () => { if (action === 'poke') await doPoke(f.id); else await doRemove(f.id); } }],
    );
  };

  const runBulk = async (action: 'poke' | 'remove', ids: string[]) => {
    const batchSize = 5;
    const totalBatches = Math.ceil(ids.length / batchSize);
    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize);
      const batch = ids.slice(i, i + batchSize);
      await Promise.all(batch.map((id) => (action === 'poke' ? doPoke(id) : doRemove(id))));
      if (i + batchSize < ids.length) {
        let d = totalBatches > 20 ? 6000 : totalBatches > 10 ? 4000 : 2000;
        if ((batchIndex + 1) % 5 === 0) d += 5000;
        await new Promise((r) => setTimeout(r, d));
      }
    }
  };

  const confirmBulk = (action: 'poke' | 'remove') => {
    if (!selected.length) return showDialog(t('friends.needSelection'));
    showDialog(
      t(action === 'poke' ? 'friends.confirmPokeBulkTitle' : 'friends.confirmRemoveBulkTitle', { n: selected.length }),
      t(action === 'poke' ? 'friends.confirmPokeMsg' : 'friends.confirmRemoveMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t(action === 'poke' ? 'friends.pokeBtn' : 'friends.removeBtn'),
          style: action === 'remove' ? 'destructive' : 'default',
          onPress: async () => {
            setBulkBusy(true);
            await runBulk(action, selected);
            setBulkBusy(false);
            if (action === 'remove') setSelected([]);
          },
        },
      ],
    );
  };

  const exportCsv = async () => {
    try {
      const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = [t('tool.column_stt'), 'ID', t('friends.colName'), t('friends.colUrl'), t('friends.colLike'), t('friends.colComment'), t('friends.colTotal')].map(esc).join(',');
      const rows = filtered.map((f, i) => [i + 1, f.id, f.name, f.profileUrl, f.likeCount, f.commentCount, f.totalInteractions].map(esc).join(','));
      const csv = '﻿' + [header, ...rows].join('\n');
      const SAF = FS.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;
      const uri = await SAF.createFileAsync(perm.directoryUri, `friends_${Date.now()}.csv`, 'text/csv');
      await FS.writeAsStringAsync(uri, csv);
      showDialog(t('gp.exported'));
    } catch (e) {
      showDialog(t('gp.exportErr'), describeError(e));
    }
  };

  const openRanking = async () => {
    setRankingOpen(true);
    setRankingLoading(true);
    try {
      setRanking(await getFriendsRanking(dtsg, 20));
    } catch (e) {
      showDialog(t('friends.rankingErr'), describeError(e));
    } finally {
      setRankingLoading(false);
    }
  };

  const startScan = async () => {
    setScanBusy(true);
    try {
      const result = await scanInteractions(dtsg, fbId, (p) => setScanMsg(p.message));
      setInteractionData(result);
    } catch (e) {
      showDialog(t('friends.scanErr'), describeError(e));
    } finally {
      setScanBusy(false);
    }
  };

  const stub = () => showDialog(t('friends.devTitle'));

  return (
    <>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>{t('friends.countN', { n: friends.length })}</Label>
          <Pressable onPress={() => fetchFriends(true)} disabled={loading} hitSlop={8}>
            {loading ? <ActivityIndicator color={c.accent} /> : <Ionicons name="refresh" size={20} color={c.accent} />}
          </Pressable>
        </Row>
        <Field icon="search" value={search} onChangeText={setSearch} placeholder={t('friends.searchPh')} />
        <Row style={{ flexWrap: 'wrap' }} gap={6}>
          <SmallBtn icon="checkbox-outline" label={t('friends.selectAll')} tone="blue" onPress={selectAllOnPage} />
          <SmallBtn icon="swap-horizontal" label={t('friends.invert')} tone="amber" onPress={invertSelection} />
          <SmallBtn icon="close-circle-outline" label={t('friends.clear')} tone="red" disabled={!selected.length} onPress={() => setSelected([])} />
          <SmallBtn icon="download-outline" label={t('tool.exportCsv')} tone="emerald" onPress={exportCsv} />
        </Row>
        <Row style={{ flexWrap: 'wrap' }} gap={6}>
          <SmallBtn icon="hand-right-outline" label={t('friends.bulkPoke', { n: selected.length })} tone="blue" disabled={!selected.length || bulkBusy} onPress={() => confirmBulk('poke')} />
          <SmallBtn icon="person-remove-outline" label={t('friends.bulkRemove', { n: selected.length })} tone="red" disabled={!selected.length || bulkBusy} onPress={() => confirmBulk('remove')} />
        </Row>
        <Label>{t('friends.toolsLabel')}</Label>
        <Row style={{ flexWrap: 'wrap' }} gap={6}>
          <SmallBtn icon="trophy-outline" label={t('friends.toolRank')} tone="amber" onPress={openRanking} />
          <SmallBtn icon="trash-bin-outline" label={t('friends.toolRemoved', { n: removedFriends.length })} tone="red" onPress={() => setRemovedOpen(true)} />
          <SmallBtn icon="pulse-outline" label={t('friends.toolScan')} tone="emerald" onPress={() => setScanOpen(true)} />
          <SmallBtn icon="layers-outline" label={t('friends.toolDeepScan')} tone="blue" onPress={stub} />
          <SmallBtn icon="people-outline" label={t('friends.toolFollowers')} tone="blue" onPress={stub} />
        </Row>
        <Label>{t('friends.sortLabel')}</Label>
        <Row style={{ flexWrap: 'wrap' }} gap={6}>
          {([
            ['name', 'friends.sortName'],
            ['likeCount', 'friends.sortLike'],
            ['commentCount', 'friends.sortComment'],
            ['totalInteractions', 'friends.sortTotal'],
          ] as const).map(([key, labelKey]) => (
            <Pressable key={key} onPress={() => toggleSort(key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: sortBy === key ? c.accent : c.border, backgroundColor: sortBy === key ? c.accentSoft : c.input }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: sortBy === key ? c.accent : c.muted }}>{t(labelKey)}</Text>
              {sortBy === key ? <Ionicons name={sortOrder === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} color={c.accent} /> : null}
            </Pressable>
          ))}
        </Row>
      </Card>

      {pageItems.length ? (
        <Card>
          <ResultList
            items={pageItems}
            keyOf={(f) => f.id}
            render={(f) => {
              const badges = filterBadges(f, t);
              const isSel = selected.includes(f.id);
              return (
                <View style={{ gap: 6 }}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Row style={{ flex: 1, alignItems: 'flex-start' }}>
                      <Pressable onPress={() => toggleSelect(f.id)} hitSlop={6}>
                        <Ionicons name={isSel ? 'checkbox' : 'square-outline'} size={20} color={isSel ? c.accent : c.faint} />
                      </Pressable>
                      {f.profilePicture ? <Image source={{ uri: f.profilePicture }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.chip }} /> : <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.chip }} />}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{f.name}</Text>
                        <Body muted size={11}>ID: {f.id}</Body>
                        {interactionData.length ? (
                          <Body muted size={11}>{t('friends.colLike')}: {f.likeCount} · {t('friends.colComment')}: {f.commentCount} · {t('friends.colTotal')}: {f.totalInteractions}</Body>
                        ) : null}
                      </View>
                    </Row>
                  </Row>
                  {badges.length ? (
                    <Row style={{ flexWrap: 'wrap' }} gap={4}>
                      {badges.map((b, i) => <Badge key={i} text={b.label} tone={b.tone} />)}
                    </Row>
                  ) : null}
                  <Row gap={8}>
                    <Pressable onPress={() => Linking.openURL(`https://www.facebook.com/friendship/${fbId}/${f.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border }}>
                      <Ionicons name="eye-outline" size={15} color={c.muted} /><Text style={{ fontSize: 12, color: c.muted }}>{t('friends.view')}</Text>
                    </Pressable>
                    <Pressable disabled={pokingIds.includes(f.id)} onPress={() => confirmSingle('poke', f)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border }}>
                      {pokingIds.includes(f.id) ? <ActivityIndicator size="small" color={c.accent} /> : <Ionicons name="hand-right-outline" size={15} color={c.accent} />}
                      <Text style={{ fontSize: 12, color: c.accent }}>{t('friends.poke')}</Text>
                    </Pressable>
                    <Pressable onPress={() => confirmSingle('remove', f)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border }}>
                      <Ionicons name="person-remove-outline" size={15} color={c.danger} /><Text style={{ fontSize: 12, color: c.danger }}>{t('friends.remove')}</Text>
                    </Pressable>
                  </Row>
                </View>
              );
            }}
          />
          <Row style={{ justifyContent: 'center' }} gap={12}>
            <Pressable disabled={page <= 1} onPress={() => setPage((p) => p - 1)} hitSlop={8}><Ionicons name="chevron-back" size={20} color={page <= 1 ? c.faint : c.accent} /></Pressable>
            <Body size={13}>{t('friends.pageInfo', { cur: page, total: totalPages })}</Body>
            <Pressable disabled={page >= totalPages} onPress={() => setPage((p) => p + 1)} hitSlop={8}><Ionicons name="chevron-forward" size={20} color={page >= totalPages ? c.faint : c.accent} /></Pressable>
          </Row>
        </Card>
      ) : !loading ? (
        <Card><Body muted>{t('friends.noData')}</Body></Card>
      ) : null}

      <CenterModal visible={rankingOpen} title={t('friends.rankingTitle')} onClose={() => setRankingOpen(false)}>
        {rankingLoading ? <ActivityIndicator color={c.accent} /> : ranking.length ? (
          ranking.map((r) => (
            <Row key={r.id} style={{ justifyContent: 'space-between' }}>
              {r.profilePicture ? <Image source={{ uri: r.profilePicture }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : null}
              <Text style={{ flex: 1, color: c.text }} numberOfLines={1}>{r.name}</Text>
            </Row>
          ))
        ) : <Body muted>{t('friends.rankingEmpty')}</Body>}
      </CenterModal>

      <CenterModal
        visible={removedOpen}
        title={t('friends.removedTitle', { n: removedFriends.length })}
        onClose={() => setRemovedOpen(false)}
        footer={<ModalFooter onCancel={() => setRemovedOpen(false)} onSave={() => { saveRemoved([]); setRemovedOpen(false); }} saveLabel={t('friends.removedClear')} />}>
        {removedFriends.length ? removedFriends.map((f) => (
          <Row key={f.id} style={{ justifyContent: 'space-between' }}>
            {f.profilePicture ? <Image source={{ uri: f.profilePicture }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : null}
            <Text style={{ flex: 1, color: c.text }} numberOfLines={1}>{f.name}</Text>
          </Row>
        )) : <Body muted>{t('friends.removedEmpty')}</Body>}
      </CenterModal>

      <CenterModal visible={scanOpen} title={t('friends.scanTitle')} onClose={() => setScanOpen(false)}>
        <Body muted>{scanBusy ? scanMsg : interactionData.length ? t('friends.scanDone', { n: interactionData.length }) : t('friends.scanIntro')}</Body>
        {scanBusy ? <ActivityIndicator color={c.accent} /> : <Button title={t('friends.scanStart')} onPress={startScan} />}
      </CenterModal>
    </>
  );
}

export default function FriendsScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
