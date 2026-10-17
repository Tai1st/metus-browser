import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Body, Button, Card, Label, Row, useColors } from '@/components/ui';
import { Api, type MetusUser } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useFbAccounts } from '@/lib/fb/accounts';
import { checkPlan, type PlanRequirement } from '@/lib/plan';

/**
 * User Metus (kèm gói), lấy mới mỗi lần màn tool được focus (để vừa mua gói xong
 * quay lại là mở khóa ngay). Lỗi mạng thì dùng user đã lưu lúc đăng nhập.
 */
function usePlanUser() {
  const { user } = useAuth();
  const [me, setMe] = useState<MetusUser | null>(null);
  const [checking, setChecking] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Api.me()
        .then((u) => alive && setMe(u))
        .catch(() => {})
        .finally(() => alive && setChecking(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  return { user: me ?? user, checking: checking && !me };
}

/**
 * Khung chung cho mọi tool, cùng thứ tự kiểm tra với ToolCard của metus-few:
 * 1. đã kết nối tài khoản FB chưa → 2. gói (theo `require`) → 3. phiên FB (dtsg).
 */
export function ToolGate({
  require = 'package',
  children,
}: {
  /** Mức gói yêu cầu (requireLogin/requirePackage của metus-few). */
  require?: PlanRequirement;
  children: (dtsg: string, fbId: string, user: MetusUser | null) => ReactNode;
}) {
  const t = useT();
  const c = useColors();
  const { current, session, sessionLoading, sessionError, reloadSession } = useFbAccounts();
  const { user, checking } = usePlanUser();

  if (!current) {
    return (
      <Card>
        <Label>{t('gate.noAccount')}</Label>
        <Body muted>{t('gate.noAccountDesc')}</Body>
        <Button title={t('gate.manage')} onPress={() => router.push('/' as Href)} />
      </Card>
    );
  }
  if (require !== 'none' && checking) {
    return (
      <Card>
        <Row gap={10}>
          <ActivityIndicator color={c.accent} />
          <Body muted>{t('tool.loadingPlan')}</Body>
        </Row>
      </Card>
    );
  }
  const block = checkPlan(user, require);
  if (block) {
    return (
      <Card>
        <Label>{t('gate.planRequired')}</Label>
        <Body muted>{t(`tool.${block}`)}</Body>
        <Button title={t('gate.viewPlans')} icon="ribbon" onPress={() => router.push('/plan' as Href)} />
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
  return <>{children(session.dtsg, current.id, user)}</>;
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
