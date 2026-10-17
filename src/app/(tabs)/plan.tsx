import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';

import { Badge, Body, Button, Card, EmptyState, Label, Row, Screen, useColors } from '@/components/ui';
import { Api, describeError, type PlanItem } from '@/lib/api';
import { useCurrency, useI18n } from '@/lib/i18n';

function PlanCard({ p, onBuy }: { p: PlanItem; onBuy: (p: PlanItem) => void }) {
  const c = useColors();
  const { t } = useI18n();
  const cur = useCurrency();

  const discount = p.percentDiscount ?? 0;
  const finalPrice = p.price * (1 - discount / 100);
  const unlimited = p.daysUse < 0 || p.price <= 0;
  const highlight = discount > 0;

  const features = [
    { on: p.price > 0, text: t('plan.feature.multiplePages') },
    { on: p.price > 0, text: t('plan.feature.schedulePost') },
    { on: p.price > 0, text: t('plan.feature.coverImage') },
    { on: true, text: t('plan.feature.carousel') },
    { on: true, text: t('plan.feature.cardButtons') },
    { on: true, text: (p.maxDevices ?? 1) < 0 ? t('plan.feature.maxDevicesUnlimited') : t('plan.feature.maxDevices', { count: p.maxDevices ?? 1 }) },
    { on: true, text: t('plan.feature.unlimitedBrowsers') },
    { on: !!p.support, text: t('plan.feature.support') },
  ];

  return (
    <Card style={highlight ? { borderColor: c.accent, borderWidth: 2 } : undefined}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Label>{p.name}</Label>
        {discount > 0 ? <Badge text={`-${discount}%`} tone="danger" /> : null}
      </Row>

      {discount > 0 ? (
        <Text style={{ textDecorationLine: 'line-through', color: c.faint, fontSize: 13, fontWeight: '600' }}>{cur.format(p.price)}</Text>
      ) : null}
      <Row gap={6} style={{ alignItems: 'flex-end' }}>
        <Body weight="700" size={24} color={c.text}>{cur.format(finalPrice)}</Body>
        <Body muted size={13}>/ {unlimited ? t('plan.unlimited') : t('plan.days', { count: p.daysUse })}</Body>
      </Row>
      <Body muted size={12}>{p.daysUse < 0 ? t('plan.testLabel') : t('plan.basicLabel')}</Body>

      <View style={{ gap: 7, marginTop: 6 }}>
        {features.map((f, i) => (
          <Row key={i} gap={8}>
            <Ionicons name={f.on ? 'checkmark-circle' : 'close-circle'} size={16} color={f.on ? c.accent : c.faint} />
            <Body size={13.5} color={f.on ? c.text : c.faint}>{f.text}</Body>
          </Row>
        ))}
      </View>

      <Button title={t('plan.buy')} variant={highlight ? 'primary' : 'secondary'} onPress={() => onBuy(p)} full />
    </Card>
  );
}

export default function PlanScreen() {
  const c = useColors();
  const { t } = useI18n();
  const [plans, setPlans] = useState<PlanItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    Api.getPlans()
      .then(setPlans)
      .catch((e) => setErr(describeError(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const buy = (p: PlanItem) => {
    Alert.alert(t('plan.confirmTitle', { name: p.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('plan.buy'),
        onPress: async () => {
          try {
            const res = await Api.buyPlan(p._id);
            const status = res?.status ?? res?.order?.status;
            if (status === 'PENDING') {
              Alert.alert(t('plan.pendingTitle'), t('plan.pendingMsg'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('plan.goRecharge'), onPress: () => router.push('/recharge') },
              ]);
            } else {
              Alert.alert(t('plan.buySuccess'), t('plan.buySuccessMsg'));
              load();
            }
          } catch (e) {
            Alert.alert(t('plan.buyFailTitle'), describeError(e));
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      {loading ? (
        <Card><Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>{t('plan.loading')}</Body></Row></Card>
      ) : err ? (
        <Card>
          <Body color={c.danger}>{err}</Body>
          <Button title={t('gate.retry')} variant="secondary" onPress={load} full />
        </Card>
      ) : !plans || plans.length === 0 ? (
        <EmptyState icon="pricetags-outline" title={t('plan.empty')} />
      ) : (
        plans.map((p) => <PlanCard key={p._id} p={p} onBuy={buy} />)
      )}

      {plans && plans.length > 0 ? <Body muted size={12} color={c.faint}>{t('plan.footer')}</Body> : null}
    </Screen>
  );
}
