import * as Clipboard from 'expo-clipboard';
import * as FS from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, useColors } from '@/components/ui';
import { SmallBtn } from '@/components/groupPost';
import { useT } from '@/lib/i18n';
import { fetchCollectionToken, fetchGroupsPage } from '@/lib/fb/GroupExtractorByUid';
import { showDialog } from '@/components/Dialog';

interface GroupRow {
  id: string;
  name: string;
  url: string;
  members: string;
  privacy: string;
  avatar: string;
  uidvia: string;
}

interface Edge {
  cursor?: string;
  node?: {
    title?: { text?: string };
    url?: string;
    description?: { text?: string };
    image?: { uri?: string };
    node?: {
      id?: string;
      group_member_profiles?: { formatted_count_text?: string };
      member_count?: number;
      privacy_scope?: string;
      visibility?: string;
    };
  };
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const [uids, setUids] = useState('');
  const [delaySec, setDelaySec] = useState(1);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  const addLog = (m: string) => setLog((p) => [`${new Date().toLocaleTimeString()} — ${m}`, ...p].slice(0, 50));

  const start = async () => {
    if (running) return;
    const uidList = uids.split('\n').map((u) => u.trim()).filter(Boolean);
    if (!uidList.length) return;
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    setGroups([]);
    const seen = new Set<string>();
    for (const uid of uidList) {
      if (stopRef.current) break;
      try {
        const token = await fetchCollectionToken({ dtsg, fbId, uid });
        if (!token) {
          addLog(t('tool.noToken'));
          continue;
        }
        let cursor = '';
        for (let page = 0; page < 200; page++) {
          if (stopRef.current) break;
          const data = await fetchGroupsPage({ dtsg, fbId, collectionToken: token, cursor });
          const edges: Edge[] = data?.data?.node?.pageItems?.edges ?? data?.node?.pageItems?.edges ?? [];
          if (!edges.length) break;
          const rows = edges
            .filter((e) => e.node?.node?.id && !seen.has(e.node.node.id))
            .map((e) => {
              const n = e.node!;
              seen.add(n.node!.id!);
              return {
                id: n.node!.id!,
                name: n.title?.text ?? '',
                url: n.url ?? `https://www.facebook.com/groups/${n.node!.id}`,
                members: (n.node?.group_member_profiles?.formatted_count_text ?? (n.node?.member_count?.toString() ?? '')).replace(/\s*thành viên\s*$/i, ''),
                privacy: n.node?.privacy_scope ?? n.node?.visibility ?? '',
                avatar: n.image?.uri ?? '',
                uidvia: uid,
              };
            });
          setGroups((prev) => [...prev, ...rows]);
          const last = edges[edges.length - 1]?.cursor;
          if (!last || last === cursor) break;
          cursor = last;
          await new Promise((r) => setTimeout(r, delaySec * 1000));
        }
      } catch (e) {
        addLog(t('tool.scanUidErr', { id: uid, err: e instanceof Error ? e.message : String(e) }));
      }
    }
    setRunning(false);
  };

  const clearList = () => setGroups([]);

  const copyAll = async () => {
    await Clipboard.setStringAsync(groups.map((g) => `${g.id}\t${g.name}\t${g.url}`).join('\n'));
    showDialog(t('tool.copiedN', { n: groups.length }));
  };

  const exportCsv = async () => {
    try {
      const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['STT', 'UID VIA', 'Group ID', 'Group name', 'Member count', 'Privacy', 'URL'].map(esc).join(',');
      const rows = groups.map((g, i) => [i + 1, g.uidvia, g.id, g.name, g.members, g.privacy, g.url].map(esc).join(','));
      const csv = '﻿' + [header, ...rows].join('\n');
      const SAF = FS.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;
      const uri = await SAF.createFileAsync(perm.directoryUri, `group-list_${Date.now()}.csv`, 'text/csv');
      await FS.writeAsStringAsync(uri, csv);
      showDialog(t('gp.exported'));
    } catch (e) {
      showDialog(t('gp.exportErr'), e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Card>
        <Field label={t('tool.uidListLabel')} value={uids} onChangeText={setUids} multiline placeholder="100123...\n100456..." />
        <NumberField label={t('tool.delaySec')} value={delaySec} onChange={setDelaySec} min={1} max={10} />
        {running ? (
          <Button title={t('tool.stop')} variant="danger" onPress={() => { stopRef.current = true; setRunning(false); }} />
        ) : (
          <Button title={t('tool.getGroups')} onPress={start} disabled={!uids.trim()} />
        )}
      </Card>

      {groups.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('tool.groupsN', { n: groups.length })}</Label>
            <Row>
              <SmallBtn icon="copy" label={t('tool.copy')} tone="blue" onPress={copyAll} />
              <SmallBtn icon="download" label={t('tool.exportCsv')} tone="emerald" onPress={exportCsv} />
              <SmallBtn icon="trash" label={t('tool.clearList')} tone="red" onPress={clearList} />
            </Row>
          </Row>
          <ResultList
            items={groups}
            keyOf={(g) => g.id}
            render={(g) => (
              <Row style={{ justifyContent: 'space-between' }}>
                {g.avatar ? (
                  <Image source={{ uri: g.avatar }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.chip }} contentFit="cover" />
                ) : (
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.chip }} />
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{g.name || g.id}</Text>
                  <Body muted>{g.members}{g.privacy ? ` · ${g.privacy}` : ''}</Body>
                </View>
                <Badge text={g.uidvia} tone="muted" />
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

export default function GroupExtractorByUidScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
