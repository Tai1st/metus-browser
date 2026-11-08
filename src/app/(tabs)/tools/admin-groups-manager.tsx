import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { PickerModal, SelectorRow } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { SmallBtn, StepField } from '@/components/groupPost';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, Row, Screen, Segmented, radius, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import {
  deleteMemberPost, getBlockedMembers, getGroups, getMemberPosts, getPreapprovedMembers,
  removePreapproval, searchMemberById, searchMembersByName, unblockMember,
  type AdminMember, type GroupItem, type MemberPost,
} from '@/lib/fb/Group';
import { useT } from '@/lib/i18n';

/**
 * Quản lý nhóm (Admin) — port từ metus-few features/tools/group/admin-groups-manager.
 * Bản gốc có 5 mục nhưng chỉ 3 mục có API thật (gỡ phê duyệt trước, mở chặn
 * thành viên, xoá bài thành viên) — 2 mục "Xoá bình luận thành viên" và "Xoá
 * toàn bộ mod & admin" trong bản gốc chỉ hiện mờ (disabled), code còn ghi chú
 * thẳng là "chưa có request thật để implement". Vẫn giữ 2 mục này trong menu
 * (đúng với bản gốc có liệt kê) nhưng ở dạng "đang phát triển", không có logic.
 */

type Tab = 'preapproved' | 'blocked' | 'memberPosts' | 'memberComments' | 'modsAdmin';
const STUB_TABS: Tab[] = ['memberComments', 'modsAdmin'];

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [groupPicker, setGroupPicker] = useState(false);
  const [tab, setTab] = useState<Tab>('preapproved');

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const list = (await getGroups(dtsg, fbId)).filter((g) => g.isAdmin);
      setGroups(list);
      if (list.length) setGroupId((prev) => prev || list[0].id);
    } catch (e) {
      showDialog(t('adminGroups.loadGroupsErr'), describeError(e));
    } finally {
      setGroupsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtsg, fbId]);
  useEffect(() => {
    loadGroups();
  }, [loadGroups]);
  const currentGroup = groups.find((g) => g.id === groupId);

  // ───────────────────────────── Preapproved / Blocked ─────────────────────────────
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [threads, setThreads] = useState(5);
  const [delaySec, setDelaySec] = useState(2);
  const stopRef = useRef(false);

  const loadMembers = async () => {
    if (!groupId) return;
    setMemberLoading(true);
    setMembers([]);
    setSelected([]);
    try {
      const fetcher = tab === 'preapproved' ? getPreapprovedMembers : getBlockedMembers;
      let cursor: string | null | undefined = null;
      const all: AdminMember[] = [];
      for (let page = 0; page < 200; page++) {
        const { members: batch, nextCursor } = await fetcher(dtsg, fbId, groupId, cursor);
        all.push(...batch);
        setMembers([...all]);
        if (!nextCursor) break;
        cursor = nextCursor;
      }
    } catch (e) {
      showDialog(t('adminGroups.loadMembersErr'), describeError(e));
    } finally {
      setMemberLoading(false);
    }
  };

  const toggleMember = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllMembers = () => setSelected((prev) => (prev.length === members.length ? [] : members.map((m) => m.id)));

  const runMemberAction = async () => {
    if (!selected.length) return;
    stopRef.current = false;
    setMemberBusy(true);
    const ids = [...selected];
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < ids.length; i += threads) {
      if (stopRef.current) break;
      const batch = ids.slice(i, i + threads);
      await Promise.all(
        batch.map(async (id) => {
          try {
            if (tab === 'preapproved') await removePreapproval(dtsg, fbId, groupId, id);
            else await unblockMember(dtsg, fbId, groupId, id);
            ok++;
            setMembers((prev) => prev.filter((m) => m.id !== id));
            setSelected((prev) => prev.filter((x) => x !== id));
          } catch (e) {
            fail++;
            showDialog(t('adminGroups.actionErr', { id }), describeError(e));
          }
        }),
      );
      if (i + threads < ids.length && delaySec > 0 && !stopRef.current) await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
    setMemberBusy(false);
    showDialog(t('adminGroups.doneMsg', { ok, fail }));
  };

  // ───────────────────────────── Member posts ─────────────────────────────
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AdminMember[]>([]);
  const [activeMember, setActiveMember] = useState<AdminMember | null>(null);
  const [posts, setPosts] = useState<MemberPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  const [postsBusy, setPostsBusy] = useState(false);

  const search = async () => {
    const q = searchText.trim();
    if (q.length < 2 || !groupId) return;
    setSearching(true);
    setSearchResults([]);
    try {
      if (/^\d+$/.test(q)) {
        const m = await searchMemberById(dtsg, fbId, groupId, q);
        setSearchResults(m ? [m] : []);
      } else {
        const { members: found } = await searchMembersByName(dtsg, fbId, groupId, q);
        setSearchResults(found);
      }
    } catch (e) {
      showDialog(t('adminGroups.searchErr'), describeError(e));
    } finally {
      setSearching(false);
    }
  };

  const pickMember = async (m: AdminMember) => {
    setActiveMember(m);
    setSearchResults([]);
    setPosts([]);
    setSelectedPosts([]);
    setPostsLoading(true);
    stopRef.current = false;
    try {
      let cursor: string | null | undefined = null;
      const all: MemberPost[] = [];
      for (let page = 0; page < 200 && !stopRef.current; page++) {
        const { posts: batch, nextCursor } = await getMemberPosts(dtsg, fbId, groupId, m.id, cursor);
        all.push(...batch);
        setPosts([...all]);
        if (!nextCursor) break;
        cursor = nextCursor;
      }
    } catch (e) {
      showDialog(t('adminGroups.loadPostsErr'), describeError(e));
    } finally {
      setPostsLoading(false);
    }
  };

  const togglePost = (id: string) => setSelectedPosts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllPosts = () => setSelectedPosts((prev) => (prev.length === posts.length ? [] : posts.map((p) => p.id)));

  const runDeletePosts = async () => {
    if (!selectedPosts.length) return;
    stopRef.current = false;
    setPostsBusy(true);
    const targets = posts.filter((p) => selectedPosts.includes(p.id));
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i += threads) {
      if (stopRef.current) break;
      const batch = targets.slice(i, i + threads);
      await Promise.all(
        batch.map(async (p) => {
          try {
            await deleteMemberPost(dtsg, fbId, groupId, p.storyId);
            ok++;
            setPosts((prev) => prev.filter((x) => x.id !== p.id));
            setSelectedPosts((prev) => prev.filter((x) => x !== p.id));
          } catch (e) {
            fail++;
            showDialog(t('adminGroups.actionErr', { id: p.id }), describeError(e));
          }
        }),
      );
      if (i + threads < targets.length && delaySec > 0 && !stopRef.current) await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
    setPostsBusy(false);
    showDialog(t('adminGroups.doneMsg', { ok, fail }));
  };

  return (
    <>
      <Card>
        <SelectorRow label={t('adminGroups.group')} avatar={currentGroup?.picture} text={currentGroup?.name} placeholder={groupsLoading ? '…' : t('adminGroups.groupPh')} onPress={() => setGroupPicker(true)} />
        <Segmented
          value={tab}
          options={['preapproved', 'blocked', 'memberPosts', 'memberComments', 'modsAdmin'] as const}
          onChange={setTab}
          colorFor={(v) => (STUB_TABS.includes(v) ? c.faint : undefined)}
          labelFor={(v) =>
            t(
              v === 'preapproved' ? 'adminGroups.tabPreapproved'
              : v === 'blocked' ? 'adminGroups.tabBlocked'
              : v === 'memberPosts' ? 'adminGroups.tabPosts'
              : v === 'memberComments' ? 'adminGroups.tabMemberComments'
              : 'adminGroups.tabModsAdmin',
            )
          }
        />
        <Row>
          <View style={{ flex: 1 }}><StepField label={t('adminGroups.threads')} value={threads} min={1} onChange={setThreads} /></View>
          <View style={{ flex: 1 }}><StepField label={t('adminGroups.delaySec')} value={delaySec} min={0} onChange={setDelaySec} /></View>
        </Row>
      </Card>

      {STUB_TABS.includes(tab) ? (
        <Card>
          <Row gap={8}>
            <Ionicons name="construct-outline" size={18} color={c.faint} />
            <Body muted>{t('adminGroups.stubMsg')}</Body>
          </Row>
        </Card>
      ) : tab !== 'memberPosts' ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t(tab === 'preapproved' ? 'adminGroups.preapprovedN' : 'adminGroups.blockedN', { n: members.length })}</Label>
            <Row gap={6}>
              <SmallBtn icon="refresh" label={t('adminGroups.load')} tone="blue" disabled={memberLoading || !groupId} onPress={loadMembers} />
              <SmallBtn icon="checkbox-outline" label={t('adminGroups.selectAll')} tone="amber" disabled={!members.length} onPress={selectAllMembers} />
            </Row>
          </Row>
          {memberLoading ? <ActivityIndicator color={c.accent} /> : null}
          {members.length ? (
            <>
              <ResultList
                items={members}
                keyOf={(m) => m.id}
                render={(m) => (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Pressable onPress={() => toggleMember(m.id)} hitSlop={6}>
                      <Ionicons name={selected.includes(m.id) ? 'checkbox' : 'square-outline'} size={20} color={selected.includes(m.id) ? c.accent : c.faint} />
                    </Pressable>
                    {m.avatar ? <Image source={{ uri: m.avatar }} style={{ width: 32, height: 32, borderRadius: 16 }} /> : null}
                    <Text style={{ flex: 1, color: c.text }} numberOfLines={1}>{m.name}</Text>
                    <Body muted size={11}>{m.id}</Body>
                  </Row>
                )}
              />
              {memberBusy ? (
                <Button title={t('adminGroups.stop')} variant="danger" onPress={() => { stopRef.current = true; }} />
              ) : (
                <Button
                  title={t(tab === 'preapproved' ? 'adminGroups.removePreapprovedBtn' : 'adminGroups.unblockBtn', { n: selected.length })}
                  onPress={runMemberAction}
                  disabled={!selected.length}
                />
              )}
            </>
          ) : null}
        </Card>
      ) : (
        <>
          <Card>
            <Label>{t('adminGroups.searchLabel')}</Label>
            <Field value={searchText} onChangeText={setSearchText} placeholder={t('adminGroups.searchPh')} onSubmitEditing={search} />
            <Button title={t('adminGroups.searchBtn')} onPress={search} disabled={searching || searchText.trim().length < 2} loading={searching} />
            {searchResults.length ? (
              <View style={{ gap: 6 }}>
                {searchResults.map((m) => (
                  <Pressable key={m.id} onPress={() => pickMember(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border }}>
                    {m.avatar ? <Image source={{ uri: m.avatar }} style={{ width: 28, height: 28, borderRadius: 14 }} /> : null}
                    <Text style={{ flex: 1, color: c.text }} numberOfLines={1}>{m.name}</Text>
                    <Body muted size={11}>{m.id}</Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>

          {activeMember ? (
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <Label>{t('adminGroups.postsOf', { name: activeMember.name, n: posts.length })}</Label>
                <Row gap={6}>
                  {postsLoading ? <SmallBtn icon="stop-circle" label={t('adminGroups.stopLoading')} tone="red" onPress={() => { stopRef.current = true; }} /> : null}
                  <SmallBtn icon="checkbox-outline" label={t('adminGroups.selectAll')} tone="amber" disabled={!posts.length} onPress={selectAllPosts} />
                </Row>
              </Row>
              {postsLoading ? <ActivityIndicator color={c.accent} /> : null}
              {posts.length ? (
                <>
                  <ResultList
                    items={posts}
                    keyOf={(p) => p.id}
                    render={(p) => (
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Pressable onPress={() => togglePost(p.id)} hitSlop={6}>
                          <Ionicons name={selectedPosts.includes(p.id) ? 'checkbox' : 'square-outline'} size={20} color={selectedPosts.includes(p.id) ? c.accent : c.faint} />
                        </Pressable>
                        {p.thumbnail ? <Image source={{ uri: p.thumbnail }} style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: c.chip }} /> : <View style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: c.chip }} />}
                        <Text style={{ flex: 1, color: c.text }} numberOfLines={2}>{p.title || p.id}</Text>
                      </Row>
                    )}
                  />
                  {postsBusy ? (
                    <Button title={t('adminGroups.stop')} variant="danger" onPress={() => { stopRef.current = true; }} />
                  ) : (
                    <Button title={t('adminGroups.deletePostsBtn', { n: selectedPosts.length })} variant="danger" onPress={runDeletePosts} disabled={!selectedPosts.length} />
                  )}
                </>
              ) : null}
            </Card>
          ) : null}
        </>
      )}

      <PickerModal visible={groupPicker} title={t('adminGroups.group')} onClose={() => setGroupPicker(false)}
        items={groups} keyOf={(g) => g.id} labelOf={(g) => g.name} avatarOf={(g) => g.picture}
        selectedKeys={[groupId]} onToggle={(g) => { setGroupId(g.id); setGroupPicker(false); setMembers([]); setSelected([]); setActiveMember(null); setPosts([]); }} />
    </>
  );
}

export default function AdminGroupsManagerScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
