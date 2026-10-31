import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, EmptyState, Field, Row, Screen, useColors } from '@/components/ui';
import { getGroups, leaveGroup, type GroupItem } from '@/lib/fb/Group';
import { useT } from '@/lib/i18n';

function formatDate(unixSec?: number) {
  if (!unixSec) return '—';
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [leavingBatch, setLeavingBatch] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setGroups(await getGroups(dtsg, fbId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const filteredGroups = useMemo(() => {
    let result = groups;
    const kw = search.trim().toLowerCase();
    if (kw) result = result.filter((g) => g.name.toLowerCase().includes(kw));
    if (showOnlySelected) result = result.filter((g) => selectedIds.has(g.id));
    return result;
  }, [groups, search, showOnlySelected, selectedIds]);

  const selectAll = () => setSelectedIds(new Set(filteredGroups.map((g) => g.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const invertSelection = () => {
    const filteredIds = new Set(filteredGroups.map((g) => g.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredIds.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const leaveOne = async (groupId: string) => {
    setLeavingIds((prev) => new Set(prev).add(groupId));
    try {
      const ok = await leaveGroup(dtsg, fbId, groupId);
      if (ok) {
        setGroups((prev) => prev.filter((g) => g.id !== groupId));
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(groupId); return n; });
      } else {
        showDialog(t('leaveGroup.leaveFailed'));
      }
    } catch (e) {
      showDialog(t('leaveGroup.leaveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setLeavingIds((prev) => { const n = new Set(prev); n.delete(groupId); return n; });
    }
  };

  const leaveBatch = () => {
    if (!selectedIds.size) return;
    showDialog(t('leaveGroup.confirmBatchTitle'), t('leaveGroup.confirmBatchMsg', { n: selectedIds.size }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('leaveGroup.leaveBtn'), style: 'destructive', onPress: async () => {
          setLeavingBatch(true);
          const ids = [...selectedIds];
          let ok = 0;
          for (const id of ids) {
            setLeavingIds((prev) => new Set(prev).add(id));
            try {
              if (await leaveGroup(dtsg, fbId, id)) {
                ok++;
                setGroups((prev) => prev.filter((g) => g.id !== id));
                setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
              }
            } catch {
              // bỏ qua, tiếp tục nhóm kế tiếp
            } finally {
              setLeavingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
            }
            await new Promise((r) => setTimeout(r, 300));
          }
          setLeavingBatch(false);
          showDialog(t('leaveGroup.batchDone', { ok, total: ids.length }));
        },
      },
    ]);
  };

  return (
    <>
      <Card>
        <Field icon="search" value={search} onChangeText={setSearch} placeholder={t('leaveGroup.searchPh')} />
        <Row gap={14}>
          <Pressable onPress={selectAll}><Body size={12} weight="700" color={c.accent}>{t('leaveGroup.selectAll')}</Body></Pressable>
          <Pressable onPress={invertSelection}><Body size={12} weight="700" color={c.accent}>{t('leaveGroup.invertSelection')}</Body></Pressable>
          <Pressable onPress={clearSelection}><Body size={12} weight="700" color={c.danger}>{t('leaveGroup.clearSelection')}</Body></Pressable>
          <Pressable onPress={() => setShowOnlySelected((v) => !v)}>
            <Body size={12} weight="700" color={showOnlySelected ? c.accent : c.muted}>{t('leaveGroup.onlySelected')}</Body>
          </Pressable>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Badge text={t('leaveGroup.totalN', { n: filteredGroups.length })} tone="muted" />
          {selectedIds.size ? (
            <Button compact variant="danger" icon="exit" title={t('leaveGroup.leaveSelectedN', { n: selectedIds.size })} onPress={leaveBatch} loading={leavingBatch} disabled={leavingBatch} />
          ) : null}
        </Row>
        {error ? <Body color={c.danger}>{error}</Body> : null}
      </Card>

      {loading ? (
        <Card><Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>…</Body></Row></Card>
      ) : filteredGroups.length === 0 ? (
        <EmptyState icon="exit" title={t('leaveGroup.empty')} />
      ) : (
        <Card>
          <ResultList
            items={filteredGroups}
            keyOf={(g) => g.id}
            render={(g) => {
              const selected = selectedIds.has(g.id);
              const isLeaving = leavingIds.has(g.id);
              return (
                <Row gap={10} style={{ alignItems: 'center' }}>
                  <Pressable onPress={() => toggleSelect(g.id)} disabled={leavingBatch || isLeaving} hitSlop={8}>
                    <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? c.accent : c.faint} />
                  </Pressable>
                  <Pressable onPress={() => g.url && Linking.openURL(g.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    {g.picture ? <Image source={{ uri: g.picture }} style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: c.chip }} /> : <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: c.chip }} />}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{g.name || g.id}</Text>
                      <Row gap={6}>
                        <Badge text={g.isAdmin ? t('leaveGroup.admin') : t('leaveGroup.member')} tone={g.isAdmin ? 'success' : 'muted'} />
                        <Body muted size={11}>{formatDate(g.lastPostTime)}</Body>
                      </Row>
                    </View>
                  </Pressable>
                  <Pressable onPress={() => leaveOne(g.id)} disabled={leavingBatch || isLeaving} hitSlop={8}>
                    {isLeaving ? <ActivityIndicator size="small" color={c.danger} /> : <Ionicons name="trash-outline" size={19} color={c.danger} />}
                  </Pressable>
                </Row>
              );
            }}
          />
        </Card>
      )}
    </>
  );
}

export default function AutoLeaveGroupScreen() {
  return (
    <Screen>
      <ToolGate require="none">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
