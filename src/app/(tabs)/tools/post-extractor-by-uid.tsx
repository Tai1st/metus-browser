import * as Clipboard from 'expo-clipboard';
import * as FS from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { SmallBtn, TickBox } from '@/components/groupPost';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useAdsSession } from '@/lib/fb/adsSession';
import { checkUidType, fetchGroupPostsFast, fetchGroupPostsPageWeb, fetchProfilePostsPage, type ExtractedPost } from '@/lib/fb/PostExtractorByUid';
import { useT } from '@/lib/i18n';

/**
 * Quét bài đăng theo UID — port từ metus-few features/tools/group/post-extractor-by-uid.
 * Nhận UID cá nhân HOẶC Group ID (tự nhận diện qua checkUidType), chạy nhiều
 * luồng song song, mỗi luồng quét tuần tự theo trang (delay giữa các trang),
 * dừng khi đạt giới hạn bài/UID. Group có chế độ "Chạy nhanh" (Graph API token).
 */

function PostRow({ p, c }: { p: ExtractedPost; c: ReturnType<typeof useColors> }) {
  const sub = p.content.replace(p.message, '').trim();
  return (
    <Pressable onPress={() => p.url && Linking.openURL(p.url)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      {p.thumbnail ? (
        <Image source={{ uri: p.thumbnail }} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: c.chip }} contentFit="cover" />
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: c.chip }} />
      )}
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{p.actor.name || p.uidVia}</Text>
        {p.message ? <Body numberOfLines={2}>{p.message}</Body> : null}
        {!p.message && sub ? <Body muted numberOfLines={2}>{sub}</Body> : null}
        <Body muted size={11}>{p.creationTime ? new Date(p.creationTime * 1000).toLocaleString() : ''}</Body>
      </View>
      <Badge text={p.uidVia} tone="muted" />
    </Pressable>
  );
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const adsToken = ads?.token ?? '';

  const [uids, setUids] = useState('');
  const [threads, setThreads] = useState(1);
  const [delaySec, setDelaySec] = useState(10);
  const [postLimit, setPostLimit] = useState(50);
  const [fastMode, setFastMode] = useState(false);
  const [posts, setPosts] = useState<ExtractedPost[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  const addLog = (m: string) => setLog((p) => [`${new Date().toLocaleTimeString()} — ${m}`, ...p].slice(0, 50));
  const addPosts = (rows: ExtractedPost[]) =>
    setPosts((prev) => {
      const merged = [...prev, ...rows];
      return Array.from(new Map(merged.map((p) => [p.id, p])).values());
    });

  const scanProfile = async (uid: string) => {
    let cursor = '';
    let count = 0;
    while (!stopRef.current) {
      try {
        const page = await fetchProfilePostsPage(dtsg, fbId, uid, cursor);
        if (!page.posts.length) break;
        const limited = page.posts.slice(0, postLimit - count);
        count += limited.length;
        addPosts(limited);
        if (count >= postLimit || !page.hasNextPage || !page.endCursor) break;
        cursor = page.endCursor;
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      } catch (e) {
        addLog(t('pxu.scanErr', { id: uid, err: describeError(e) }));
        break;
      }
    }
  };

  const scanGroup = async (groupId: string) => {
    if (fastMode) {
      if (!adsToken) return addLog(t('pxu.noAdsToken'));
      try {
        addPosts(await fetchGroupPostsFast(groupId, adsToken, postLimit));
      } catch (e) {
        addLog(t('pxu.scanErr', { id: groupId, err: describeError(e) }));
      }
      return;
    }
    let cursor = '';
    let count = 0;
    while (!stopRef.current) {
      try {
        const page = await fetchGroupPostsPageWeb(dtsg, fbId, groupId, cursor);
        const limited = page.posts.slice(0, postLimit - count);
        count += limited.length;
        addPosts(limited);
        if (count >= postLimit || !page.nextCursor) break;
        cursor = page.nextCursor;
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      } catch (e) {
        addLog(t('pxu.scanErr', { id: groupId, err: describeError(e) }));
        break;
      }
    }
  };

  const start = async () => {
    if (running) return;
    const uidList = uids.split('\n').map((u) => u.trim()).filter(Boolean);
    if (!uidList.length) return;
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    setPosts([]);

    const queue = [...uidList];
    const workers = Array.from({ length: Math.max(1, threads) }).map(async () => {
      while (queue.length && !stopRef.current) {
        const uid = queue.shift();
        if (!uid) break;
        try {
          const type = await checkUidType(dtsg, fbId, uid);
          if (type === 'User') await scanProfile(uid);
          else if (type === 'Group') await scanGroup(uid);
          else addLog(t('pxu.unknownType', { id: uid }));
        } catch (e) {
          addLog(t('pxu.checkTypeErr', { id: uid, err: describeError(e) }));
        }
      }
    });
    await Promise.all(workers);
    setRunning(false);
  };

  const clearList = () => setPosts([]);

  const copyAll = async () => {
    await Clipboard.setStringAsync(posts.map((p) => p.id).join('\n'));
    showDialog(t('tool.copiedN', { n: posts.length }));
  };

  const exportCsv = async () => {
    try {
      const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['STT', 'UID VIA', 'ID Post', 'Actor', 'Message', 'Captions', 'Time', 'URL'].map(esc).join(',');
      const rows = posts.map((p, i) =>
        [
          i + 1,
          p.uidVia,
          p.id,
          p.actor.name || '-',
          p.message,
          p.attachments.map((a) => a.caption || '').join(' | '),
          p.creationTime ? new Date(p.creationTime * 1000).toLocaleString() : '',
          p.url,
        ].map(esc).join(','),
      );
      const csv = '﻿' + [header, ...rows].join('\n');
      const SAF = FS.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;
      const uri = await SAF.createFileAsync(perm.directoryUri, `post-list_${Date.now()}.csv`, 'text/csv');
      await FS.writeAsStringAsync(uri, csv);
      showDialog(t('gp.exported'));
    } catch (e) {
      showDialog(t('gp.exportErr'), describeError(e));
    }
  };

  return (
    <>
      <Card>
        <Field label={t('pxu.uidListLabel')} value={uids} onChangeText={setUids} multiline placeholder={t('pxu.uidListPh')} />
        <Row>
          <View style={{ flex: 1 }}>
            <NumberField label={t('pxu.threads')} value={threads} onChange={setThreads} min={1} max={10} />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField label={t('tool.delaySec')} value={delaySec} onChange={setDelaySec} min={0} max={60} />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField label={t('pxu.limitPerUid')} value={postLimit} onChange={setPostLimit} min={1} max={500} />
          </View>
        </Row>
        <TickBox label={t('pxu.fastMode')} value={fastMode} disabled={running} onBlocked={() => {}} onChange={setFastMode} />
        {running ? (
          <Button title={t('tool.stop')} variant="danger" onPress={() => { stopRef.current = true; setRunning(false); }} />
        ) : (
          <Button title={t('pxu.scanBtn')} onPress={start} disabled={!uids.trim()} />
        )}
      </Card>

      {posts.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('pxu.postsN', { n: posts.length })}</Label>
            <Row>
              <SmallBtn icon="copy" label={t('tool.copy')} tone="blue" onPress={copyAll} />
              <SmallBtn icon="download" label={t('tool.exportCsv')} tone="emerald" onPress={exportCsv} />
              <SmallBtn icon="trash" label={t('tool.clearList')} tone="red" onPress={clearList} />
            </Row>
          </Row>
          <ResultList items={posts} keyOf={(p) => p.id} render={(p) => <PostRow p={p} c={c} />} />
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

export default function PostExtractorByUidScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
