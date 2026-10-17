import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { ResultList, statusColor, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fetchGroupInfo, joinGroupRequest } from '@/lib/fb/AutoJoinFbGroup';

interface Group {
  id: string;
  name: string;
  members: string;
  avatar: string;
  url: string;
  status?: 'done' | 'loading' | 'error';
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const [uids, setUids] = useState('');
  const [thread, setThread] = useState(1);
  const [delay, setDelay] = useState(120);
  const [limit, setLimit] = useState(10);
  const [groups, setGroups] = useState<Group[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  const addLog = (m: string) => setLog((p) => [`${new Date().toLocaleTimeString()} — ${m}`, ...p].slice(0, 50));

  const fetchInfo = async (groupId: string): Promise<Group | null> => {
    try {
      const json = await fetchGroupInfo({ dtsg, fbId, groupId });
      const node = json?.data?.node ?? json?.data?.group ?? null;
      if (!node) return null;
      const g = node?.comet_hovercard_renderer?.group ?? node;
      const joinAction = node?.join_action_with_menu ?? g?.join_action_with_menu;
      if (joinAction?.__typename === 'GroupJoinedGroupAction') return null;
      const members = g?.group_member_profiles?.formatted_count_text ?? node?.group_member_profiles?.formatted_count_text ?? '';
      return {
        id: groupId,
        name: g?.name ?? node?.name ?? groupId,
        members: members.replace(/\s*thành viên\s*$/i, ''),
        avatar: g?.profile_picture?.uri ?? node?.profile_picture?.uri ?? '',
        url: `https://www.facebook.com/groups/${groupId}`,
      };
    } catch (e) {
      addLog(t('tool.logInfoErr', { id: groupId, err: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  };

  const joinOne = async (list: Group[], index: number) => {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, status: 'loading' } : g)));
    const group = list[index];
    try {
      const data = await joinGroupRequest({ dtsg, fbId, groupId: group.id });
      const edges = data?.data?.group_request_to_join?.viewer?.groups_tab?.tab_groups_list?.edges ?? [];
      const joined = edges.some((e) => e?.node?.id == group.id);
      setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, status: joined ? 'done' : 'error' } : g)));
      addLog(t(joined ? 'tool.logJoined' : 'tool.logNotJoined', { name: group.name }));
    } catch (e) {
      setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, status: 'error' } : g)));
      addLog(t('tool.logJoinErr', { id: group.id, err: e instanceof Error ? e.message : String(e) }));
    }
  };

  const start = async () => {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    const uidList = uids.split('\n').map((u) => u.trim()).filter(Boolean).slice(0, limit);
    const infoList: Group[] = [];
    for (const uid of uidList) {
      if (stopRef.current) break;
      const info = await fetchInfo(uid);
      if (!info) continue;
      infoList.push({ ...info, status: undefined });
      setGroups([...infoList]);
    }
    if (infoList.length === 0) {
      addLog(t('tool.noGroupsToJoin'));
      setRunning(false);
      return;
    }
    const worker = async (startIndex: number) => {
      for (let i = startIndex; i < infoList.length; i += thread) {
        if (stopRef.current) break;
        await joinOne(infoList, i);
        await new Promise((r) => setTimeout(r, delay * 1000));
      }
    };
    await Promise.all(Array.from({ length: thread }, (_, i) => worker(i)));
    setRunning(false);
    addLog(t('tool.doneLog'));
  };

  return (
    <>
      <Card>
        <Field label={t('tool.uidListLabel')} value={uids} onChangeText={setUids} multiline placeholder="100123...\n100456..." />
        <Row>
          <View style={{ flex: 1 }}><NumberField label={t('tool.thread')} value={thread} onChange={setThread} min={1} max={10} /></View>
          <View style={{ flex: 1 }}><NumberField label={t('tool.delaySec')} value={delay} onChange={setDelay} min={0} max={3600} /></View>
          <View style={{ flex: 1 }}><NumberField label={t('tool.limit')} value={limit} onChange={setLimit} min={1} max={1000} /></View>
        </Row>
        {running ? (
          <Button title={t('tool.stop')} variant="danger" onPress={() => { stopRef.current = true; setRunning(false); }} />
        ) : (
          <Button title={t('tool.start')} onPress={start} disabled={!uids.trim()} />
        )}
      </Card>

      {groups.length ? (
        <Card>
          <Label>{t('tool.groupsN', { n: groups.length })}</Label>
          <ResultList
            items={groups}
            keyOf={(g) => g.id}
            render={(g) => (
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{g.name}</Text>
                  <Body muted>{g.members}</Body>
                </View>
                <Badge
                  text={g.status === 'done' ? t('tool.st.sent') : g.status === 'error' ? t('tool.st.error') : g.status === 'loading' ? '...' : t('tool.st.waiting')}
                  tone={g.status === 'done' ? 'success' : g.status === 'error' ? 'danger' : 'muted'}
                />
              </Row>
            )}
          />
        </Card>
      ) : null}

      {log.length ? (
        <Card>
          <Label>{t('tool.log')}</Label>
          {log.map((l, i) => <Body key={i} muted>{l}</Body>)}
        </Card>
      ) : null}
    </>
  );
}

export default function AutoJoinFbGroupScreen() {
  return (
    <Screen>
      <ToolGate require="none">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
