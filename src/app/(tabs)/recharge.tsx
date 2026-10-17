import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, View } from 'react-native';

import { Badge, Body, Button, Card, Field, Label, Row, Screen, Title, radius, useColors } from '@/components/ui';
import { Api, describeError, type BankInfoSetting, type CardRate, type CardValue, type MetusUser } from '@/lib/api';
import { defaultRechargeMethod, useCurrency, useI18n, useT, type TranslateFn } from '@/lib/i18n';

type Method = 'bank' | 'card' | 'usdt' | 'paypal';

const PAYPAL_EMAIL = 'kienladykillah@gmail.com';
const USDT_TRC20 = 'TRh5LXFpXm6GfnX6QmLqA4vhUNRqScgu7S';
const USDT_BEP20 = '0xd8a5cd099cd56271a01ae41b3b3e53adb1b44ed8';
const TELEGRAM = 'https://t.me/metusvn';

const METHODS: { key: Method; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'bank', icon: 'business' },
  { key: 'card', icon: 'phone-portrait' },
  { key: 'usdt', icon: 'logo-usd' },
  { key: 'paypal', icon: 'logo-paypal' },
];

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/** Hàm sao chép kèm thông báo đã dịch. */
function useCopy() {
  const t = useT();
  return async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert(t('common.copied'));
    } catch {
      Alert.alert(t('common.copyFail'), t('common.copyFailMsg'));
    }
  };
}

/** Hàng hiển thị thông tin có nút sao chép. */
function CopyRow({ label, value, highlight }: { label: string; value?: string; highlight?: string }) {
  const c = useColors();
  const copy = useCopy();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Body muted size={13}>{label}</Body>
      <Row gap={8}>
        <Body weight="700" size={14} color={highlight}>{value ?? '—'}</Body>
        {value ? (
          <Pressable onPress={() => copy(value)} hitSlop={8}>
            <Ionicons name="copy-outline" size={16} color={c.accent} />
          </Pressable>
        ) : null}
      </Row>
    </Row>
  );
}

/** Hộp lưu ý màu vàng. */
function NoteBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Card style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a' }}>
      <Row gap={8}>
        <Ionicons name="alert-circle" size={18} color="#d97706" />
        <Body weight="700" size={13} color="#b45309">{title}</Body>
      </Row>
      <View style={{ gap: 6 }}>
        {lines.map((l, i) => (
          <Row key={i} gap={6} style={{ alignItems: 'flex-start' }}>
            <Body color="#d97706" size={13}>•</Body>
            <Body size={12.5} color="#92400e">{l}</Body>
          </Row>
        ))}
      </View>
    </Card>
  );
}

// ---- Ngân hàng (ACB + VietQR) ----
function BankPanel({ bankCode, t }: { bankCode?: string; t: TranslateFn }) {
  const c = useColors();
  const [info, setInfo] = useState<BankInfoSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    Api.getSetting<BankInfoSetting>('BANK_INFO')
      .then(setInfo)
      .catch((e) => setErr(describeError(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card><Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>{t('recharge.bank.loading')}</Body></Row></Card>;
  if (err || !info) return <Card><Body color={c.danger}>{err || t('recharge.bank.err')}</Body></Card>;

  const qr = `https://img.vietqr.io/image/ACB-${info.accountNumber}-print.jpg?addInfo=${encodeURIComponent(bankCode ?? '')}&accountName=${encodeURIComponent(info.accountName)}&accountNo=${info.accountNumber}`;

  return (
    <>
      <Card>
        <Body weight="700" size={15}>{t('recharge.bank.way1Title')}</Body>
        <Body muted size={13}>{t('recharge.bank.way1Desc')}</Body>
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Image source={{ uri: qr }} style={{ width: '100%', aspectRatio: 486 / 320, borderRadius: radius.md }} resizeMode="contain" />
        </View>
      </Card>

      <Card>
        <Body weight="700" size={15}>{t('recharge.bank.way2Title')}</Body>
        <Body muted size={13}>{t('recharge.bank.way2Desc')}</Body>
        <View style={{ height: 6 }} />
        <CopyRow label={t('recharge.bank.owner')} value={info.accountName} />
        <CopyRow label={t('recharge.bank.number')} value={info.accountNumber} highlight={c.accent} />
        <CopyRow label={t('recharge.bank.content')} value={bankCode} highlight={c.danger} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Body muted size={13}>{t('recharge.bank.bankLabel')}</Body>
          <Body weight="700" size={14}>{t('recharge.bank.bankName')}</Body>
        </Row>
      </Card>

      <NoteBox title={t('recharge.noteTitle')} lines={[t('recharge.bank.note1'), t('recharge.bank.note2')]} />
    </>
  );
}

// ---- Thẻ cào ----
function CardPanel({ t }: { t: TranslateFn }) {
  const c = useColors();
  const cur = useCurrency();
  const [rate, setRate] = useState<CardRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [cardType, setCardType] = useState('');
  const [picked, setPicked] = useState<CardValue | null>(null);
  const [seri, setSeri] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Api.getCardRate()
      .then((r) => {
        setRate(r);
        const first = Object.keys(r)[0];
        if (first) {
          setCardType(first);
          setPicked(r[first]?.[0] ?? null);
        } else {
          setErr(t('recharge.card.maintenance'));
        }
      })
      .catch((e) => setErr(describeError(e)))
      .finally(() => setLoading(false));
  }, []);

  const values = rate && cardType ? rate[cardType] ?? [] : [];
  const receive = (v: CardValue) => v.value - (v.value * v.fees) / 100;

  const submit = async () => {
    if (!cardType || !picked) return Alert.alert(t('recharge.card.pickBoth'));
    if (!seri.trim()) return Alert.alert(t('recharge.card.enterSeri'));
    if (!pin.trim()) return Alert.alert(t('recharge.card.enterPin'));
    setSubmitting(true);
    try {
      const msg = await Api.rechargePhoneCard({ cardType, cardValue: picked.value, seri: seri.trim(), pin: pin.trim() });
      Alert.alert(t('recharge.card.resultTitle'), typeof msg === 'string' ? msg : t('recharge.card.sent'));
      setSeri('');
      setPin('');
    } catch (e) {
      Alert.alert(t('recharge.card.failTitle'), describeError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Card><Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>{t('recharge.card.loading')}</Body></Row></Card>;
  if (err || !rate) return <Card><Body color={c.danger}>{err || t('recharge.card.err')}</Body></Card>;

  return (
    <>
      <Card>
        <Label>{t('recharge.card.type')}</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {Object.keys(rate).map((tp) => {
            const active = tp === cardType;
            return (
              <Pressable
                key={tp}
                onPress={() => {
                  setCardType(tp);
                  setPicked(rate[tp]?.[0] ?? null);
                }}
                style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: active ? c.accent : c.chip }}>
                <Body weight="700" size={13} color={active ? c.onAccent : c.text}>{tp}</Body>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={{ height: 6 }} />
        <Label>{t('recharge.card.denom')}</Label>
        <View style={{ gap: 8 }}>
          {values.map((v) => {
            const active = picked?.value === v.value;
            return (
              <Pressable
                key={v.value}
                onPress={() => setPicked(v)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 13,
                  borderRadius: radius.sm,
                  borderWidth: 1.5,
                  borderColor: active ? c.accent : c.border,
                  backgroundColor: active ? c.accentSoft : c.card,
                }}>
                <Body weight="700" size={15} color={active ? c.accent : c.text}>{vnd(v.value)}</Body>
                <Body size={13} color={c.muted}>{t('recharge.card.receive', { amount: cur.format(receive(v)) })}</Body>
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 6 }} />
        <Field label={t('recharge.card.seri')} value={seri} onChangeText={setSeri} placeholder={t('recharge.card.seriPlaceholder')} keyboardType="number-pad" />
        <Field label={t('recharge.card.pin')} value={pin} onChangeText={setPin} placeholder={t('recharge.card.pinPlaceholder')} keyboardType="number-pad" />
        <Button title={t('recharge.card.submit')} icon="card" onPress={submit} loading={submitting} full />
      </Card>

      <NoteBox
        title={t('recharge.noteTitle')}
        lines={[t('recharge.card.note1'), t('recharge.card.note2'), t('recharge.card.note3'), t('recharge.card.note4')]}
      />
    </>
  );
}

// ---- USDT ----
function CryptoAddress({ network, address }: { network: string; address: string }) {
  const c = useColors();
  const copy = useCopy();
  return (
    <Card>
      <Body weight="700" size={14}>{network}</Body>
      <Row style={{ justifyContent: 'space-between', backgroundColor: c.input, borderRadius: radius.sm, padding: 10 }}>
        <Body mono size={12} numberOfLines={1} color={c.text}>{address}</Body>
        <Pressable onPress={() => copy(address)} hitSlop={8}>
          <Ionicons name="copy-outline" size={18} color={c.accent} />
        </Pressable>
      </Row>
    </Card>
  );
}

function UsdtPanel({ t }: { t: TranslateFn }) {
  return (
    <>
      <Title size="md">{t('recharge.usdt.title')}</Title>
      <CryptoAddress network={t('recharge.usdt.tron')} address={USDT_TRC20} />
      <CryptoAddress network={t('recharge.usdt.bep20')} address={USDT_BEP20} />
      <Button title={t('recharge.usdt.support')} icon="paper-plane" onPress={() => Linking.openURL(TELEGRAM)} full />
      <NoteBox title={t('recharge.noteTitle')} lines={[t('recharge.usdt.note1'), t('recharge.usdt.note2'), t('recharge.usdt.note3')]} />
    </>
  );
}

// ---- PayPal ----
function PaypalPanel({ t }: { t: TranslateFn }) {
  const c = useColors();
  const copy = useCopy();
  return (
    <>
      <Title size="md">{t('recharge.paypal.title')}</Title>
      <Card>
        <Body muted size={13}>{t('recharge.paypal.emailLabel')}</Body>
        <Row style={{ justifyContent: 'space-between', backgroundColor: c.input, borderRadius: radius.sm, padding: 10 }}>
          <Body weight="700" size={13} numberOfLines={1}>{PAYPAL_EMAIL}</Body>
          <Pressable onPress={() => copy(PAYPAL_EMAIL)} hitSlop={8}>
            <Ionicons name="copy-outline" size={18} color={c.accent} />
          </Pressable>
        </Row>
      </Card>
      <Button title={t('recharge.paypal.sendProof')} icon="paper-plane" onPress={() => Linking.openURL(TELEGRAM)} full />
      <NoteBox title={t('recharge.noteTitle')} lines={[t('recharge.paypal.note1'), t('recharge.paypal.note2'), t('recharge.paypal.note3')]} />
    </>
  );
}

export default function RechargeScreen() {
  const c = useColors();
  const { lang, t } = useI18n();
  const cur = useCurrency();
  const [method, setMethod] = useState<Method>(() => defaultRechargeMethod(lang));
  const [me, setMe] = useState<MetusUser | null>(null);

  useEffect(() => {
    Api.me().then(setMe).catch(() => {});
  }, []);

  // Focus phương thức mặc định theo ngôn ngữ (vi → Bank, khác → USDT), như metus-few.
  useEffect(() => {
    setMethod(defaultRechargeMethod(lang));
  }, [lang]);

  return (
    <Screen>
      {/* Số dư */}
      <Card style={{ backgroundColor: c.accent, borderColor: c.accent }}>
        <Row gap={12}>
          <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="wallet" size={24} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Body color="rgba(255,255,255,0.85)" size={12} weight="700">{t('recharge.balance')}</Body>
            <Body color="#fff" weight="700" size={26}>{cur.format((me?.balance as number) ?? 0)}</Body>
          </View>
          {me?.bankCode ? <Badge text={t('recharge.codeBadge', { code: me.bankCode as string })} tone="success" /> : null}
        </Row>
      </Card>

      {/* Phương thức thanh toán */}
      <Title size="md">{t('recharge.paymentMethod')}</Title>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        {METHODS.map((m) => {
          const active = method === m.key;
          return (
            <Pressable
              key={m.key}
              onPress={() => setMethod(m.key)}
              style={{
                flexGrow: 1,
                flexBasis: '47%',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: active ? c.accent : c.border,
                backgroundColor: active ? c.accentSoft : c.card,
              }}>
              <Ionicons name={m.icon} size={18} color={active ? c.accent : c.faint} />
              <Body weight="700" size={13.5} color={active ? c.accent : c.text}>{t(`recharge.method.${m.key}`)}</Body>
            </Pressable>
          );
        })}
      </Row>

      {method === 'bank' ? <BankPanel bankCode={me?.bankCode as string | undefined} t={t} /> : null}
      {method === 'card' ? <CardPanel t={t} /> : null}
      {method === 'usdt' ? <UsdtPanel t={t} /> : null}
      {method === 'paypal' ? <PaypalPanel t={t} /> : null}
    </Screen>
  );
}
