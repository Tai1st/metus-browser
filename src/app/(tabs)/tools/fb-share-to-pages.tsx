import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { PickerModal, SelectorRow } from '@/components/AdPostTool';
import { showDialog } from '@/components/Dialog';
import { TickBox } from '@/components/groupPost';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useAdsSession } from '@/lib/fb/adsSession';
import { hideSharedPost, resolveShareLink, shareToPage } from '@/lib/fb/ShareToPages';
import { useT } from '@/lib/i18n';

/**
 * Chia sẻ lên nhiều Fanpage — port từ metus-few features/tools/page/fb-share-to-pages.
 * Không dùng nút "Share" gốc của Facebook — chỉ tạo 1 bài LINK mới trên mỗi Page,
 * trỏ về link gốc (Graph API /feed công khai, dùng access_token của Page, không
 * cần GraphQL nội bộ). Tính năng "Hẹn giờ" trong bản gốc bị comment-out/giả lập
 * (chỉ setTimeout 300ms, không gọi server thật) — không port vì là tính năng chết.
 */

type Status = 'pending' | 'success' | 'failed';
interface LogItem {
  key: string;
  pageId: string;
  pageName: string;
  pagePicture?: string;
  status: Status;
  postId?: string;
  note?: string;
}

function Runner({ fbId }: { fbId: string }) {
  const c = useColors();
  const t = useT();
  const { ads } = useAdsSession();
  const pages = ads?.pages ?? [];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pagePicker, setPagePicker] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [delaySec, setDelaySec] = useState(1);
  const [hideAfterShare, setHideAfterShare] = useState(false);
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<LogItem[]>([]);

  const selectedPages = pages.filter((p) => selectedIds.includes(p.id));
  const isValidUrl = /^https?:\/\/.+/.test(shareLink.trim());

  const start = async () => {
    if (!selectedPages.length) return showDialog(t('shareToPages.needPages'));
    if (!isValidUrl) return showDialog(t('shareToPages.needLink'));
    setRunning(true);
    setItems(selectedPages.map((p) => ({ key: p.id, pageId: p.id, pageName: p.name, pagePicture: p.picture, status: 'pending' })));

    await new Promise((r) => setTimeout(r, delaySec * 1000));

    const resolvedLink = await resolveShareLink(shareLink.trim());
    for (const page of selectedPages) {
      try {
        const postId = await shareToPage(page.id, page.access_token, resolvedLink, primaryText);
        setItems((prev) => prev.map((x) => (x.pageId === page.id ? { ...x, status: 'success', postId } : x)));
        if (hideAfterShare) {
          await hideSharedPost(postId, page.access_token).catch((e) =>
            setItems((prev) => prev.map((x) => (x.pageId === page.id ? { ...x, note: t('shareToPages.hideErr', { err: describeError(e) }) } : x))),
          );
        }
      } catch (e) {
        setItems((prev) => prev.map((x) => (x.pageId === page.id ? { ...x, status: 'failed', note: describeError(e) } : x)));
      }
    }
    setRunning(false);
  };

  return (
    <>
      <Card>
        <SelectorRow
          label={t('shareToPages.pages')}
          avatar={selectedPages.length === 1 ? selectedPages[0].picture : undefined}
          text={selectedPages.length ? t('shareToPages.pagesSelectedN', { n: selectedPages.length }) : undefined}
          placeholder={t('shareToPages.pickPages')}
          onPress={() => !running && setPagePicker(true)}
        />
        <NumberField label={t('shareToPages.delayLabel')} value={delaySec} onChange={setDelaySec} min={0} max={300} />
        {running ? (
          <Row style={{ justifyContent: 'center' }} gap={8}>
            <ActivityIndicator color={c.accent} />
            <Body size={13}>{t('shareToPages.running')}</Body>
          </Row>
        ) : (
          <Button title={t('shareToPages.startBtn')} onPress={start} disabled={!selectedPages.length || !isValidUrl} />
        )}
      </Card>

      <Card>
        <Label>{t('shareToPages.linkLabel')}</Label>
        <Field value={shareLink} onChangeText={setShareLink} editable={!running} placeholder="https://www.facebook.com/share/p/1CXCB8iFXT/" autoCapitalize="none" />
        <Label>{t('shareToPages.primaryTextLabel')}</Label>
        <Field value={primaryText} onChangeText={setPrimaryText} editable={!running} multiline placeholder={t('shareToPages.primaryTextPh')} />
        <TickBox label={t('shareToPages.hideAfterShare')} value={hideAfterShare} disabled={running} onBlocked={() => {}} onChange={setHideAfterShare} />
      </Card>

      {items.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{t('shareToPages.resultsN', { n: items.length })}</Label>
            {!running ? (
              <Pressable onPress={() => setItems([])} hitSlop={8}>
                <Body size={12} color={c.danger} weight="600">{t('common.delete')}</Body>
              </Pressable>
            ) : null}
          </Row>
          <ResultList
            items={items}
            keyOf={(x) => x.key}
            render={(x) => (
              <Pressable onPress={() => x.postId && Linking.openURL(`https://facebook.com/${x.postId}`)} disabled={x.status !== 'success'}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: '600' }} numberOfLines={1}>{x.pageName}</Text>
                    {x.note ? <Body muted size={11} numberOfLines={2}>{x.note}</Body> : null}
                  </View>
                  {x.status === 'pending' ? <ActivityIndicator color={c.accent} /> : (
                    <Badge text={t(x.status === 'success' ? 'shareToPages.shared' : 'gp.failed')} tone={x.status === 'success' ? 'success' : 'danger'} />
                  )}
                </Row>
              </Pressable>
            )}
          />
        </Card>
      ) : null}

      <PickerModal
        visible={pagePicker}
        title={t('shareToPages.pages')}
        onClose={() => setPagePicker(false)}
        items={pages}
        keyOf={(p) => p.id}
        labelOf={(p) => p.name}
        avatarOf={(p) => p.picture}
        selectedKeys={selectedIds}
        multi
        onToggle={(p) => setSelectedIds((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
      />
    </>
  );
}

export default function FbShareToPagesScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(_dtsg, fbId) => <Runner fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
