import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, Row, Screen, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fetchCollectionToken, fetchGroupsPage } from '@/lib/fb/GroupExtractorByUid';

interface GroupRow {
  id: string;
  name: string;
  url: string;
  members: string;
  privacy: string;
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
  const [uid, setUid] = useState('');
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const stopRef = useRef(false);

  const start = async () => {
    if (running) return;
    const target = uid.trim();
    if (!target) return;
    stopRef.current = false;
    setRunning(true);
    setError('');
    setGroups([]);
    try {
      const token = await fetchCollectionToken({ dtsg, fbId, uid: target });
      if (!token) {
        setError(t('tool.noToken'));
        setRunning(false);
        return;
      }
      let cursor = '';
      const seen = new Set<string>();
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
            };
          });
        setGroups((prev) => [...prev, ...rows]);
        const last = edges[edges.length - 1]?.cursor;
        if (!last || last === cursor) break;
        cursor = last;
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const copyAll = async () => {
    await Clipboard.setStringAsync(groups.map((g) => `${g.id}\t${g.name}\t${g.url}`).join('\n'));
    Alert.alert(t('tool.copiedN', { n: groups.length }));
  };

  return (
    <>
      <Card>
        <Field label={t('tool.uidAccount')} value={uid} onChangeText={setUid} placeholder="1000xxxxxxxxx" keyboardType="number-pad" />
        {running ? (
          <Button title={t('tool.stop')} variant="danger" onPress={() => { stopRef.current = true; setRunning(false); }} />
        ) : (
          <Button title={t('tool.getGroups')} onPress={start} disabled={!uid.trim()} />
        )}
        {error ? <Body muted>{error}</Body> : null}
      </Card>

      {groups.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('tool.groupsN', { n: groups.length })}</Label>
            <Button compact variant="secondary" title={t('tool.copy')} onPress={copyAll} />
          </Row>
          <ResultList
            items={groups}
            keyOf={(g) => g.id}
            render={(g) => (
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{g.name || g.id}</Text>
                  <Body muted>{g.members}{g.privacy ? ` · ${g.privacy}` : ''}</Body>
                </View>
              </Row>
            )}
          />
        </Card>
      ) : null}
    </>
  );
}

export default function GroupExtractorByUidScreen() {
  return (
    <Screen>
      <ToolGate>{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
