import * as Clipboard from 'expo-clipboard';
import * as FS from 'expo-file-system/legacy';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { SmallBtn, TickBox } from '@/components/groupPost';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, Segmented, radius, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { createMultiplePages, DEFAULT_BIO_TEXT, generateNameList, type PageCreationResult } from '@/lib/fb/CreatePage';
import { useT } from '@/lib/i18n';
import * as storage from '@/lib/storage';

/**
 * Tạo hàng loạt Fanpage — port từ metus-few features/tools/page/create-bm-pages.
 * Tạo Page qua GraphQL nội bộ (giống luồng "Tạo Trang" của web Facebook), tên
 * random từ 2 danh sách first/last name có sẵn, bio tuỳ chỉnh + emoji ngẫu nhiên.
 * Không có bước liên kết Business Manager nào trong bản gốc dù tên thư mục có
 * "bm" — giữ đúng hành vi, chỉ tạo Page đơn thuần.
 */

const LIMIT_OPTIONS = ['5', '10', '15', '20', '25', '30', '50'] as const;

interface Stored {
  limit?: number;
  delay?: number;
  pageNames?: string;
  bio?: string;
  randomEmoji?: boolean;
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const stored = useMemo(() => storage.get<Stored>(storage.StorageKey.CREATE_BM_PAGES) ?? {}, []);

  const [limit, setLimit] = useState(stored.limit ?? 10);
  const [delay, setDelay] = useState(stored.delay ?? 60);
  const [pageNames, setPageNames] = useState(stored.pageNames ?? generateNameList(200));
  const [bio, setBio] = useState(stored.bio ?? DEFAULT_BIO_TEXT);
  const [randomEmoji, setRandomEmoji] = useState(stored.randomEmoji ?? false);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PageCreationResult[]>([]);
  const [progress, setProgress] = useState({ cur: 0, total: 0 });
  const stopRef = useMemo(() => ({ current: false }), []);

  const save = (patch: Partial<Stored>) => {
    const next = { limit, delay, pageNames, bio, randomEmoji, ...patch };
    storage.set(storage.StorageKey.CREATE_BM_PAGES, next);
  };

  const nameList = useMemo(
    () => pageNames.split('\n').map((n) => n.trim()).filter(Boolean).slice(0, limit),
    [pageNames, limit],
  );

  const regenerateNames = () => {
    const next = generateNameList(200);
    setPageNames(next);
    save({ pageNames: next });
  };

  const start = async () => {
    if (running) return;
    if (!nameList.length) return showDialog(t('createPages.noNames'));
    stopRef.current = false;
    setRunning(true);
    setResults([]);
    setProgress({ cur: 0, total: nameList.length });
    try {
      const all = await createMultiplePages(dtsg, fbId, nameList, bio, {
        randomEmoji,
        emojiCount: 3,
        delaySeconds: delay,
        shouldStop: () => stopRef.current,
        onProgress: (_result, cur, total) => {
          setProgress({ cur, total });
          setResults((prev) => [...prev, _result]);
        },
      });
      const ok = all.filter((r) => r.success).length;
      showDialog(stopRef.current ? t('createPages.stoppedMsg', { ok, fail: all.length - ok }) : t('createPages.doneMsg', { ok, fail: all.length - ok }));
    } catch (e) {
      showDialog(t('createPages.err'), describeError(e));
    } finally {
      setRunning(false);
    }
  };
  const stop = () => {
    stopRef.current = true;
  };

  const copyLink = async (url: string) => {
    await Clipboard.setStringAsync(url);
    showDialog(t('gp.exported'));
  };

  const exportCsv = async () => {
    try {
      const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const success = results.filter((r) => r.success);
      const header = [t('createPages.colName'), t('createPages.colUrl')].map(esc).join(',');
      const rows = success.map((r) => [r.pageName, r.pageUrl ?? ''].map(esc).join(','));
      const csv = '﻿' + [header, ...rows].join('\n');
      const SAF = FS.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;
      const uri = await SAF.createFileAsync(perm.directoryUri, `created_pages_${Date.now()}.csv`, 'text/csv');
      await FS.writeAsStringAsync(uri, csv);
      showDialog(t('gp.exported'));
    } catch (e) {
      showDialog(t('gp.exportErr'), describeError(e));
    }
  };

  const doneCount = results.filter((r) => r.success).length;

  return (
    <>
      <Card>
        <Label>{t('createPages.limitLabel')}</Label>
        <Segmented value={String(limit) as (typeof LIMIT_OPTIONS)[number]} options={LIMIT_OPTIONS} onChange={(v) => { const n = Number(v); setLimit(n); save({ limit: n }); }} />
        <NumberField label={t('createPages.delayLabel')} value={delay} onChange={(v) => { setDelay(v); save({ delay: v }); }} min={0} max={300} />

        <Row style={{ justifyContent: 'space-between' }}>
          <Label>{t('createPages.namesLabel', { n: nameList.length })}</Label>
          <SmallBtn icon="shuffle" label={t('createPages.regenerate')} tone="blue" disabled={running} onPress={regenerateNames} />
        </Row>
        <Field value={pageNames} onChangeText={(v) => { setPageNames(v); save({ pageNames: v }); }} multiline editable={!running} placeholder={t('createPages.namesPh')} style={{ minHeight: 100 }} />

        <Label>{t('createPages.bioLabel')}</Label>
        <Field value={bio} onChangeText={(v) => { setBio(v); save({ bio: v }); }} multiline editable={!running} placeholder={t('createPages.bioPh')} />
        <TickBox label={t('createPages.randomEmoji')} value={randomEmoji} disabled={running} onBlocked={() => {}} onChange={(v) => { setRandomEmoji(v); save({ randomEmoji: v }); }} />

        {running ? (
          <Button title={t('createPages.stopBtn', { cur: progress.cur, total: progress.total })} variant="danger" onPress={stop} />
        ) : (
          <Button title={t('createPages.startBtn')} onPress={start} disabled={!nameList.length} />
        )}
      </Card>

      {results.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('createPages.resultsN', { ok: doneCount, total: results.length })}</Label>
            <SmallBtn icon="download" label={t('tool.exportCsv')} tone="emerald" disabled={!doneCount} onPress={exportCsv} />
          </Row>
          <ResultList
            items={results}
            keyOf={(r, i) => `${r.pageName}-${i}`}
            render={(r) => (
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{r.pageName}</Text>
                  {r.success ? (
                    <Row gap={10}>
                      <Pressable onPress={() => r.pageUrl && Linking.openURL(r.pageUrl)}><Body size={12} color={c.accent}>{t('createPages.open')}</Body></Pressable>
                      <Pressable onPress={() => r.pageUrl && copyLink(r.pageUrl)}><Body size={12} color={c.accent}>{t('createPages.copyLink')}</Body></Pressable>
                    </Row>
                  ) : (
                    <Body muted size={11} numberOfLines={2}>{r.error}</Body>
                  )}
                </View>
                <Badge text={t(r.success ? 'createPages.ok' : 'gp.failed')} tone={r.success ? 'success' : 'danger'} />
              </Row>
            )}
          />
        </Card>
      ) : null}

      {running ? (
        <Card>
          <Row style={{ justifyContent: 'center' }} gap={8}>
            <ActivityIndicator color={c.accent} />
            <Body size={13}>{t('createPages.progress', { cur: progress.cur, total: progress.total })}</Body>
          </Row>
        </Card>
      ) : null}
    </>
  );
}

export default function CreateBmPagesScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
