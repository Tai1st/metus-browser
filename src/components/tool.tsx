import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Body, Button, Card, Label, Row, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useFbAccounts } from '@/lib/fb/accounts';

/**
 * Khung chung cho mọi tool: chặn chạy khi chưa có phiên FB hợp lệ (giống cách
 * metus-few chặn qua ModalCheckExtension + dtsg).
 */
export function ToolGate({ children }: { children: (dtsg: string, fbId: string) => ReactNode }) {
  const t = useT();
  const { current, session, sessionLoading, sessionError, reloadSession } = useFbAccounts();

  if (!current) {
    return (
      <Card>
        <Label>{t('gate.noAccount')}</Label>
        <Body muted>{t('gate.noAccountDesc')}</Body>
        <Button title={t('gate.manage')} onPress={() => router.push('/' as Href)} />
      </Card>
    );
  }
  if (sessionLoading) {
    return (
      <Card>
        <Body muted>{t('gate.loadingSession', { name: current.name })}</Body>
      </Card>
    );
  }
  if (!session?.dtsg) {
    return (
      <Card>
        <Label>{t('gate.expired')}</Label>
        <Body muted>{sessionError ?? t('gate.noDtsg')}</Body>
        <Row>
          <View style={{ flex: 1 }}>
            <Button title={t('gate.retry')} variant="secondary" onPress={() => reloadSession()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t('gate.reLogin')} onPress={() => router.push('/' as Href)} />
          </View>
        </Row>
      </Card>
    );
  }
  return <>{children(session.dtsg, current.id)}</>;
}

export function ResultList<T>({ items, keyOf, render }: { items: T[]; keyOf: (t: T, i: number) => string; render: (t: T) => ReactNode }) {
  const c = useColors();
  if (items.length === 0) return null;
  return (
    <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
      {items.map((it, i) => (
        <View key={keyOf(it, i)} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 10, backgroundColor: c.card }}>
          {render(it)}
        </View>
      ))}
    </ScrollView>
  );
}

export function statusColor(s: string | undefined, c: ReturnType<typeof useColors>): string {
  return s === 'done' ? c.success : s === 'error' ? c.danger : s === 'loading' ? c.accent : c.muted;
}
