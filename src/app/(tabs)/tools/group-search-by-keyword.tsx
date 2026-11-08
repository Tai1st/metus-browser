import * as Clipboard from 'expo-clipboard';
import * as FS from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { SmallBtn } from '@/components/groupPost';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, useColors } from '@/components/ui';
import { fetchGroupSearchPage } from '@/lib/fb/GroupSearchByKeyword';
import { useT } from '@/lib/i18n';

/**
 * Tìm nhóm theo từ khóa — port từ metus-few features/tools/group/group-search-by-keyword.
 * Dùng Facebook Comet Search (search/groups?q=...) để tìm nhóm MỚI (chưa tham gia)
 * theo danh sách từ khóa, khác với group-extractor-by-uid (lấy nhóm của 1 UID có sẵn).
 * Bản gốc không có filter/join/bulk-select, chỉ tìm + xuất danh sách.
 */

interface GroupRow {
  id: string;
  name: string;
  url: string;
  avatar?: string;
  privacy?: string;
  memberCount?: string;
  postFrequency?: string;
  keyword: string;
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const [keywords, setKeywords] = useState('');
  const [delaySec, setDelaySec] = useState(1);
  const [maxPages, setMaxPages] = useState(5);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  const addLog = (m: string) => setLog((p) => [`${new Date().toLocaleTimeString()} — ${m}`, ...p].slice(0, 50));

  const start = async () => {
    if (running) return;
    const keywordList = keywords.split('\n').map((k) => k.trim()).filter(Boolean);
    if (!keywordList.length) return;
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    setGroups([]);

    for (const keyword of keywordList) {
      if (stopRef.current) break;
      let cursor: string | null = null;
      let hasNextPage = true;
      let page = 0;
      while (hasNextPage && page < maxPages && !stopRef.current) {
        page += 1;
        try {
          const result = await fetchGroupSearchPage({ dtsg, fbId, keyword, cursor });
          if (result.items.length) {
            const newRows: GroupRow[] = result.items.map((item) => ({ ...item, keyword }));
            setGroups((prev) => {
              const merged = [...prev, ...newRows];
              return Array.from(new Map(merged.map((g) => [g.id, g])).values());
            });
          }
          hasNextPage = result.hasNextPage && Boolean(result.endCursor);
          cursor = result.endCursor;
          if (hasNextPage) await new Promise((r) => setTimeout(r, delaySec * 1000));
        } catch (e) {
          addLog(t('tool.scanUidErr', { id: keyword, err: e instanceof Error ? e.message : String(e) }));
          hasNextPage = false;
        }
      }
    }
    setRunning(false);
  };

  const clearList = () => setGroups([]);

  const copyAll = async () => {
    await Clipboard.setStringAsync(groups.map((g) => g.id).join('\n'));
    showDialog(t('tool.copiedN', { n: groups.length }));
  };

  const exportCsv = async () => {
    try {
      const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = [t('tool.column_stt'), t('tool.column_keyword'), t('tool.column_group_id'), t('tool.column_group_name'), t('tool.column_member_count'), t('tool.column_privacy'), t('tool.column_post_frequency'), t('tool.column_url')].map(esc).join(',');
      const rows = groups.map((g, i) => [i + 1, g.keyword, g.id, g.name, g.memberCount ?? '-', g.privacy ?? '-', g.postFrequency ?? '-', g.url].map(esc).join(','));
      const csv = '﻿' + [header, ...rows].join('\n');
      const SAF = FS.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;
      const uri = await SAF.createFileAsync(perm.directoryUri, `group-search-by-keyword_${Date.now()}.csv`, 'text/csv');
      await FS.writeAsStringAsync(uri, csv);
      showDialog(t('gp.exported'));
    } catch (e) {
      showDialog(t('gp.exportErr'), e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Card>
        <Field label={t('gsk.keywordsLabel')} value={keywords} onChangeText={setKeywords} multiline placeholder={t('gsk.keywordsPh')} />
        <Row>
          <View style={{ flex: 1 }}>
            <NumberField label={t('tool.delaySec')} value={delaySec} onChange={setDelaySec} min={1} max={5} />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField label={t('gsk.maxPages')} value={maxPages} onChange={setMaxPages} min={1} max={20} />
          </View>
        </Row>
        {running ? (
          <Button title={t('tool.stop')} variant="danger" onPress={() => { stopRef.current = true; setRunning(false); }} />
        ) : (
          <Button title={t('gsk.searchBtn')} onPress={start} disabled={!keywords.trim()} />
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
                  <Body muted numberOfLines={1}>{[g.memberCount, g.privacy, g.postFrequency].filter(Boolean).join(' · ')}</Body>
                </View>
                <Badge text={g.keyword} tone="muted" />
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

export default function GroupSearchByKeywordScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
