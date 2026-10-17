import { Ionicons } from '@expo/vector-icons';
import { Metus } from '@metus/http';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';

import { Badge, Body, Button, Card, EmptyState, ErrorText, Field, Label, Row, Screen, Title, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useFbAccounts, type FbAccountRow } from '@/lib/fb/accounts';
import { showDialog } from '@/components/Dialog';

function AccountCard({ a, isCurrent }: { a: FbAccountRow; isCurrent: boolean }) {
  const t = useT();
  const { select, remove } = useFbAccounts();
  const [busy, setBusy] = useState(false);

  const copyCookie = () =>
    showDialog(
      t('connect.copyCookieTitle'),
      t('connect.copyCookieMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.copy'),
          onPress: async () => {
            await Clipboard.setStringAsync(await Metus.accounts.exportCookieString(a.id));
            showDialog(t('connect.cookieCopied'));
          },
        },
      ],
    );

  const confirmRemove = () =>
    showDialog(t('connect.removeTitle'), t('connect.removeMsg', { name: a.name, id: a.id }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove(a.id) },
    ]);

  return (
    <Card>
      <Row>
        {a.picture ? <Image source={{ uri: a.picture }} style={{ width: 40, height: 40, borderRadius: 20 }} /> : null}
        <View style={{ flex: 1 }}>
          <Body>{a.name}</Body>
          <Body muted>UID {a.id}</Body>
        </View>
        {isCurrent ? <Badge text={t('connect.inUse')} tone="success" /> : null}
        {!a.hasSession ? <Badge text={t('connect.expired')} tone="danger" /> : null}
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        {!isCurrent ? (
          <Button
            compact
            title={t('connect.useThis')}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              await select(a.id).finally(() => setBusy(false));
            }}
          />
        ) : null}
        <Button compact variant="secondary" title={t('connect.openFb')} onPress={() => router.push({ pathname: '/fb-login', params: { mode: 'open', id: a.id } })} />
        <Button compact variant="secondary" title={t('connect.copyCookie')} onPress={copyCookie} />
        <Button compact variant="danger" title={t('common.delete')} onPress={confirmRemove} />
      </Row>
    </Card>
  );
}

export default function AccountsScreen() {
  const c = useColors();
  const t = useT();
  const { accounts, current, importCookie, sessionError } = useFbAccounts();
  const [cookie, setCookie] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const doImport = async () => {
    setError('');
    setImporting(true);
    try {
      await importCookie(cookie.trim());
      setCookie('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen>
      {/* Banner Kết nối Facebook */}
      <Card style={{ backgroundColor: c.accent, borderColor: c.accent }}>
        <Row gap={14}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="logo-facebook" size={34} color="#1877F2" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Body color="#fff" weight="700" size={17}>{t('connect.bannerTitle')}</Body>
            <Body color="rgba(255,255,255,0.92)" size={13}>{t('connect.bannerDesc')}</Body>
          </View>
        </Row>
        <Button title={t('connect.connectNow')} variant="secondary" icon="arrow-forward" onPress={() => router.push({ pathname: '/fb-login', params: { mode: 'new' } })} full />
      </Card>

      <Title size="md">{t('connect.savedAccounts', { n: accounts.length })}</Title>
      {sessionError ? <ErrorText>{sessionError}</ErrorText> : null}
      {accounts.length === 0 ? <EmptyState icon="people-outline" title={t('connect.noAccounts')} subtitle={t('connect.noAccountsHint')} /> : null}
      {accounts.map((a) => (
        <AccountCard key={a.id} a={a} isCurrent={a.id === current?.id} />
      ))}

      <Card>
        <Label>{t('connect.importByCookie')}</Label>
        <Body muted>{t('connect.cookieDesc')}</Body>
        <Field multiline value={cookie} onChangeText={setCookie} placeholder="c_user=...; xs=...; fr=..." />
        <ErrorText>{error}</ErrorText>
        <Button title={t('connect.importCookieBtn')} variant="secondary" onPress={doImport} loading={importing} disabled={!cookie.includes('c_user=')} />
      </Card>
    </Screen>
  );
}
