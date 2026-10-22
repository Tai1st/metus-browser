import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { LanguageSheet } from '@/components/LanguageSheet';
import { ThemeSheet } from '@/components/ThemeSheet';
import { Badge, Body, Button, Card, Divider, IconCircle, Label, Row, Screen, useColors } from '@/components/ui';
import { Api, type MetusUser } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { planInfo } from '@/lib/plan';
import { LANGUAGES, useCurrency, useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { showDialog } from '@/components/Dialog';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function SettingRow({ icon, title, value, onPress, danger }: { icon: IconName; title: string; value?: string; onPress: () => void; danger?: boolean }) {
  const c = useColors();
  return (
    <Card onPress={onPress}>
      <Row gap={12}>
        <IconCircle name={icon} tone={danger ? 'danger' : 'muted'} />
        <Body weight="600" size={15} color={danger ? c.danger : c.text}>{title}</Body>
        <View style={{ flex: 1 }} />
        {value ? <Body muted size={13}>{value}</Body> : null}
        <Ionicons name="chevron-forward" size={18} color={c.faint} />
      </Row>
    </Card>
  );
}

export default function AccountScreen() {
  const { user, logout } = useAuth();
  const c = useColors();
  const { mode } = useTheme();
  const { lang, t } = useI18n();
  const cur = useCurrency();
  const [me, setMe] = useState<MetusUser | null>(user);
  const [langOpen, setLangOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  useEffect(() => {
    Api.me().then(setMe).catch(() => {});
  }, []);

  const info = me ?? user;
  const plan = planInfo(info);

  const confirmLogout = () =>
    showDialog(t('account.logout'), t('account.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.logout'), style: 'destructive', onPress: logout },
    ]);

  const currentLang = LANGUAGES.find((l) => l.code === lang)?.native ?? lang;
  const currentTheme = t(`theme.${mode === 'system' ? 'optSystem' : mode === 'dark' ? 'optDark' : 'optLight'}`);

  const soon = (title: string) => () => router.push({ pathname: '/tools/coming-soon', params: { title } });
  const go = (href: Href) => () => router.push(href);

  return (
    <Screen>
      {/* Hồ sơ Metus */}
      <Card>
        <Row gap={12}>
          <IconCircle name="person-circle" tone="accent" size={32} />
          <View style={{ flex: 1 }}>
            <Body weight="700" size={17}>{(info?.name as string) || t('account.defaultName')}</Body>
            <Body muted size={13}>{(info?.email as string) ?? '—'}</Body>
          </View>
          <Ionicons name="settings-outline" size={22} color={c.faint} />
        </Row>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Label>{t('account.balance')}</Label>
            <Body weight="700" size={18}>{cur.format((info?.balance as number) ?? 0)}</Body>
          </View>
          <Button title={t('account.recharge')} icon="wallet-outline" compact onPress={go('/recharge')} />
        </Row>
      </Card>

      {/* Gói đang sử dụng */}
      <Label>{t('account.currentPlan')}</Label>
      <Card onPress={go('/plan')} style={{ borderColor: c.accent }}>
        <Row gap={12}>
          <IconCircle name="ribbon" tone="accent" />
          <View style={{ flex: 1 }}>
            <Row gap={6}>
              <Body weight="700">{plan.name ?? t('account.noPlan')}</Body>
              {plan.daysLeft != null ? <Badge text={t('account.daysLeft', { n: plan.daysLeft })} tone={plan.active ? 'success' : 'danger'} /> : null}
            </Row>
            <Body muted size={13}>{plan.until ? t('account.expires', { date: plan.until }) : t('account.upgradeHint')}</Body>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.faint} />
        </Row>
      </Card>

      {/* Cài đặt */}
      <View style={{ height: 4 }} />
      <SettingRow icon="color-palette-outline" title={t('account.theme')} value={currentTheme} onPress={() => setThemeOpen(true)} />
      <SettingRow icon="language-outline" title={t('account.language')} value={currentLang} onPress={() => setLangOpen(true)} />
      <SettingRow icon="receipt-outline" title={t('account.txHistory')} onPress={soon(t('account.txHistory'))} />
      <SettingRow icon="phone-portrait-outline" title={t('account.devices')} value="1/2" onPress={soon(t('account.devices'))} />
      <SettingRow icon="options-outline" title={t('account.appSettings')} onPress={soon(t('account.appSettings'))} />
      <SettingRow icon="help-circle-outline" title={t('account.support')} onPress={soon(t('account.support'))} />
      <SettingRow icon="document-text-outline" title={t('account.terms')} onPress={soon(t('account.terms'))} />
      <SettingRow icon="log-out-outline" title={t('account.logout')} danger onPress={confirmLogout} />

      <Label>Metus · {t('common.version')} {Application.nativeApplicationVersion ?? ''}</Label>

      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
      <ThemeSheet visible={themeOpen} onClose={() => setThemeOpen(false)} />
    </Screen>
  );
}
