import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { DateTimePickerModal, PickerModal, SelectorRow, fmtDateTime } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { RandomButtons, StepField, TickBox } from '@/components/groupPost';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Card, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import type { AdPage } from '@/lib/fb/ads';
import { useAdsSession } from '@/lib/fb/adsSession';
import { fetchPagePostsPage, type PagePostRow } from '@/lib/fb/pagePostAnalyze';
import { fetchPostComments, hideComment, likeComment } from '@/lib/fb/pageCommentBot';
import { commentWithToken } from '@/lib/fb/reels';
import { useT } from '@/lib/i18n';
import { notifyNow } from '@/lib/notify';
import * as storage from '@/lib/storage';
import * as bg from '@metus/background';

/**
 * Bot trả lời bình luận Page — port từ metus-few features/tools/auto-comment.
 * Bản gốc dùng Facebook Webhook (app Graph API chính thức, backend riêng) để
 * nhận bình luận mới theo thời gian thực; ở đây thay bằng polling định kỳ
 * (quét bình luận mới trên các bài gần nhất của Page). Chỉ giữ 4 tính năng
 * thực sự hoạt động trong bản gốc: tự động thích, ẩn tất cả bình luận, chỉ
 * trả lời bình luận cấp 1, giới hạn tốc độ trả lời.
 */

interface FormState {
  pageId: string;
  isAutoLike: boolean;
  isHiddenAllComment: boolean;
  isReplyLevelOne: boolean;
  isRateLimited: boolean;
  rateLimitSeconds: number;
  content: string;
  pollSeconds: number;
  postScanLimit: number;
}

interface Stored {
  form?: Partial<FormState>;
  sinceUnix?: number;
}

type LogStatus = 'success' | 'failed';
interface LogItem {
  key: string;
  postName: string;
  fromName: string;
  message: string;
  actions: string[];
  status: LogStatus;
  note?: string;
}

const DEFAULT_FORM: FormState = {
  pageId: '',
  isAutoLike: true,
  isHiddenAllComment: false,
  isReplyLevelOne: true,
  isRateLimited: true,
  rateLimitSeconds: 5,
  content: '',
  pollSeconds: 30,
  postScanLimit: 10,
};

function Runner() {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const pages = ads?.pages ?? [];

  const stored = useMemo(() => storage.get<Stored>(storage.StorageKey.PAGE_COMMENTS_BOT) ?? {}, []);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM, ...stored.form });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    storage.set(storage.StorageKey.PAGE_COMMENTS_BOT, { form, sinceUnix: sinceRef.current } satisfies Stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const selectedPage = pages.find((p) => p.id === form.pageId) ?? null;
  const [pagePicker, setPagePicker] = useState(false);
  useEffect(() => {
    if (!form.pageId && pages.length) set('pageId', pages[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const sinceRef = useRef<number>(stored.sinceUnix ?? Math.floor(Date.now() / 1000));
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const lastReplyAtRef = useRef(0);

  const [watching, setWatching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [nextScanAt, setNextScanAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [items, setItems] = useState<LogItem[]>([]);
  const [stats, setStats] = useState({ ok: 0, fail: 0 });
  // Chỉ xử lý bình luận tạo SAU mốc này (mặc định = thời điểm bấm Bắt đầu).
  const [sinceAt, setSinceAt] = useState(new Date());
  const [sincePicker, setSincePicker] = useState(false);

  useEffect(() => {
    if (!watching) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [watching]);

  const pushItem = (it: LogItem) => setItems((prev) => [it, ...prev].slice(0, 200));

  const scanOnce = async (page: AdPage) => {
    const { posts } = await fetchPagePostsPage({ pageId: page.id, token: page.access_token });
    const scanPosts: PagePostRow[] = posts.slice(0, Math.max(1, form.postScanLimit));
    let maxSeen = sinceRef.current;
    for (const post of scanPosts) {
      if (stopRef.current) break;
      let comments;
      try {
        comments = await fetchPostComments(post.id, page.access_token, 25);
      } catch {
        continue;
      }
      for (const cm of comments) maxSeen = Math.max(maxSeen, cm.createdUnix);
      const fresh = comments
        .filter((cm) => cm.fromId !== page.id && cm.createdUnix > sinceRef.current && (!form.isReplyLevelOne || cm.isTopLevel))
        .sort((a, b) => a.createdUnix - b.createdUnix);
      for (const cm of fresh) {
        if (stopRef.current) break;
        const actions: string[] = [];
        try {
          if (form.isHiddenAllComment) {
            await hideComment(cm.id, page.access_token);
            actions.push(t('cmtBot.act.hidden'));
          }
          if (form.isAutoLike) {
            await likeComment(cm.id, page.access_token);
            actions.push(t('cmtBot.act.liked'));
          }
          if (form.content.trim()) {
            if (form.isRateLimited) {
              const wait = form.rateLimitSeconds * 1000 - (Date.now() - lastReplyAtRef.current);
              if (wait > 0) await bg.sleep(wait);
            }
            const replyText = form.content.split('{{user_full_name}}').join(cm.fromName || '');
            await commentWithToken(cm.id, page.access_token, replyText);
            lastReplyAtRef.current = Date.now();
            actions.push(t('cmtBot.act.replied'));
          }
          pushItem({ key: `${cm.id}-${cm.createdUnix}`, postName: post.content || post.id, fromName: cm.fromName, message: cm.message, actions, status: 'success' });
          setStats((s) => ({ ...s, ok: s.ok + 1 }));
        } catch (e) {
          pushItem({ key: `${cm.id}-${cm.createdUnix}-err`, postName: post.content || post.id, fromName: cm.fromName, message: cm.message, actions, status: 'failed', note: describeError(e) });
          setStats((s) => ({ ...s, fail: s.fail + 1 }));
        }
      }
    }
    sinceRef.current = maxSeen;
    storage.set(storage.StorageKey.PAGE_COMMENTS_BOT, { form, sinceUnix: sinceRef.current } satisfies Stored);
  };

  const start = async () => {
    if (runningRef.current) return;
    if (!selectedPage) return showDialog(t('cmtBot.needPage'));
    if (!form.content.trim() && !form.isAutoLike && !form.isHiddenAllComment) return showDialog(t('cmtBot.needAction'));
    stopRef.current = false;
    runningRef.current = true;
    sinceRef.current = Math.floor(sinceAt.getTime() / 1000);
    setWatching(true);
    setStats({ ok: 0, fail: 0 });
    while (!stopRef.current) {
      setScanning(true);
      try {
        await scanOnce(selectedPage);
      } catch (e) {
        pushItem({ key: `scan-err-${Date.now()}`, postName: selectedPage.name, fromName: '', message: '', actions: [], status: 'failed', note: describeError(e) });
      }
      setScanning(false);
      if (stopRef.current) break;
      const end = Date.now() + form.pollSeconds * 1000;
      setNextScanAt(end);
      while (Date.now() < end && !stopRef.current) await bg.sleep(500);
    }
    runningRef.current = false;
    setWatching(false);
    setNextScanAt(null);
    notifyNow(t('cmtBot.bgTitle'), t('cmtBot.stoppedMsg', { ok: stats.ok, fail: stats.fail }));
  };
  const stop = () => {
    stopRef.current = true;
  };

  const bgActive = watching;
  const bgText = scanning ? t('cmtBot.bgScanning') : nextScanAt ? t('cmtBot.bgNext', { s: Math.max(0, Math.round((nextScanAt - now) / 1000)) }) : '';
  useEffect(() => {
    if (bgActive) bg.start(t('cmtBot.bgTitle'), bgText).catch(() => {});
    else bg.stop().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgActive]);
  useEffect(() => {
    if (bgActive) bg.update(t('cmtBot.bgTitle'), bgText).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgText]);
  useEffect(
    () => () => {
      bg.stop().catch(() => {});
    },
    [],
  );

  return (
    <>
      <Card>
        <SelectorRow
          label={t('cmtBot.pickPage')}
          avatar={selectedPage?.picture}
          text={selectedPage?.name}
          placeholder={t('cmtBot.pickPagePh')}
          onPress={() => !watching && setPagePicker(true)}
        />

        <View style={{ gap: 8 }}>
          <TickBox label={t('cmtBot.autoLike')} value={form.isAutoLike} disabled={watching} onBlocked={() => {}} onChange={(v) => set('isAutoLike', v)} />
          <TickBox label={t('cmtBot.hideAll')} value={form.isHiddenAllComment} disabled={watching} onBlocked={() => {}} onChange={(v) => set('isHiddenAllComment', v)} />
          <TickBox label={t('cmtBot.replyLevelOne')} value={form.isReplyLevelOne} disabled={watching} onBlocked={() => {}} onChange={(v) => set('isReplyLevelOne', v)} />
        </View>

        <Label>{t('cmtBot.content')}</Label>
        <TextInput
          value={form.content}
          onChangeText={(v) => set('content', v)}
          editable={!watching}
          multiline
          placeholder={t('cmtBot.contentPh')}
          placeholderTextColor={c.faint}
          style={{ minHeight: 80, borderRadius: radius.md, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input, color: c.text, fontSize: 14.5, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top', opacity: watching ? 0.6 : 1 }}
        />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ flex: 4 }}>
            <RandomButtons compact disabled={watching} onInsert={(x) => set('content', form.content + x)} />
          </View>
          <Pressable
            disabled={watching}
            onPress={() => set('content', form.content + '{{user_full_name}}')}
            onLongPress={() => showDialog(t('cmtBot.insertNameShort'), t('cmtBot.insertName'))}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: c.accent, backgroundColor: c.accentSoft, opacity: watching ? 0.5 : 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: '800', color: c.accent }}>
              {t('cmtBot.insertNameShort')}
            </Text>
          </Pressable>
        </View>

        <SelectorRow label={t('cmtBot.sinceLabel')} text={fmtDateTime(sinceAt)} placeholder={fmtDateTime(sinceAt)} onPress={() => !watching && setSincePicker(true)} />

        <Row>
          <View style={{ flex: 1 }}>
            <StepField label={t('cmtBot.rateLimitSeconds')} value={form.rateLimitSeconds} min={1} onChange={(v) => set('rateLimitSeconds', v)} disabled={watching || !form.isRateLimited} />
          </View>
          <View style={{ flex: 1 }}>
            <StepField label={t('cmtBot.pollSeconds')} value={form.pollSeconds} min={10} onChange={(v) => set('pollSeconds', v)} disabled={watching} />
          </View>
          <View style={{ flex: 1 }}>
            <StepField label={t('cmtBot.postScanLimit')} value={form.postScanLimit} min={1} onChange={(v) => set('postScanLimit', v)} disabled={watching} />
          </View>
        </Row>
        <TickBox label={t('cmtBot.rateLimit')} value={form.isRateLimited} disabled={watching} onBlocked={() => {}} onChange={(v) => set('isRateLimited', v)} />

        <Pressable
          onPress={watching ? stop : start}
          style={({ pressed }) => [{ backgroundColor: watching ? '#ef4444' : c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', opacity: pressed ? 0.7 : 1 }, shadow(c, 1)]}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
            {watching
              ? `${scanning ? t('cmtBot.scanningBtn') : t('cmtBot.watchingBtn', { s: nextScanAt ? Math.max(0, Math.round((nextScanAt - now) / 1000)) : 0 })} (${t('gp.stop')})`
              : t('cmtBot.startBtn')}
          </Text>
        </Pressable>
      </Card>

      {items.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('cmtBot.results', { ok: stats.ok, fail: stats.fail })}</Label>
            {!watching ? (
              <Pressable onPress={() => setItems([])} hitSlop={8}>
                <Body size={12} color={c.danger} weight="600">
                  {t('common.delete')}
                </Body>
              </Pressable>
            ) : null}
          </Row>
          <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled contentContainerStyle={{ gap: 8 }}>
            {items.map((x) => (
              <View key={x.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                <Ionicons name="chatbubble-ellipses" size={20} color={c.faint} style={{ marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Body weight="600" size={13} numberOfLines={1}>
                    {x.fromName || x.postName}
                  </Body>
                  <Body muted size={11.5} numberOfLines={2}>
                    {x.note ?? x.message}
                  </Body>
                  {x.actions.length ? (
                    <Body muted size={10.5} numberOfLines={1}>
                      {x.actions.join(' · ')}
                    </Body>
                  ) : null}
                </View>
                <Badge text={t(x.status === 'success' ? 'cmtBot.handled' : 'gp.failed')} tone={x.status === 'success' ? 'success' : 'danger'} />
              </View>
            ))}
          </ScrollView>
        </Card>
      ) : null}

      <PickerModal
        visible={pagePicker}
        title={t('cmtBot.pickPage')}
        onClose={() => setPagePicker(false)}
        items={pages}
        keyOf={(p) => p.id}
        labelOf={(p) => p.name}
        avatarOf={(p) => p.picture}
        selectedKeys={form.pageId ? [form.pageId] : []}
        onToggle={(p) => {
          set('pageId', p.id);
          setPagePicker(false);
        }}
      />

      <DateTimePickerModal visible={sincePicker} value={sinceAt} onClose={() => setSincePicker(false)} onConfirm={(d) => { setSinceAt(d); setSincePicker(false); }} />
    </>
  );
}

export default function PageCommentsBotScreen() {
  return (
    <Screen>
      <ToolGate require="package">{() => <Runner />}</ToolGate>
    </Screen>
  );
}
