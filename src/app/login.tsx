import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/Logo';
import { Body, Button, Card, ErrorText, Field, Row, Title, radius, useColors } from '@/components/ui';

const GOOGLE_ICON = require('../../assets/images/google.png');
import { describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function LoginScreen() {
  const c = useColors();
  const t = useT();
  const { login, loginWithGoogle } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);
  // Vừa đăng ký xong → điền sẵn email
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!email.trim() || !password) {
      setError(t('login.needBoth'));
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'center', padding: 20 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ alignItems: 'center', marginBottom: 28, gap: 14 }}>
          <Logo size={80} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Title size="xl">Metus</Title>
            <Body muted>{t('login.tagline')}</Body>
          </View>
        </View>

        <Card>
          <Field label={t('login.email')} icon="mail-outline" keyboardType="email-address" value={email} onChangeText={setEmail} textContentType="emailAddress" placeholder="you@metus.vn" />
          <Field
            label={t('login.password')}
            icon="lock-closed-outline"
            secureTextEntry={!show}
            value={password}
            onChangeText={setPassword}
            textContentType="password"
            placeholder="••••••••"
            onSubmitEditing={submit}
            rightIcon={show ? 'eye-off-outline' : 'eye-outline'}
            onRightIconPress={() => setShow((s) => !s)}
          />
          <ErrorText>{error}</ErrorText>
          <Button title={t('login.submit')} icon="arrow-forward" onPress={submit} loading={loading} full />
          <Row gap={10}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
            <Body muted size={12}>{t('login.or')}</Body>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </Row>
          <Pressable
            onPress={google}
            disabled={googleLoading}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: radius.md, paddingVertical: 13, opacity: googleLoading ? 0.6 : 1 }}>
            {googleLoading ? <ActivityIndicator color={c.accent} /> : <Image source={GOOGLE_ICON} style={{ width: 18, height: 18 }} />}
            <Body weight="700" size={14.5}>{t('login.google')}</Body>
          </Pressable>
        </Card>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 20, gap: 4 }}>
          <Body muted size={13}>{t('login.noAccount')}</Body>
          <Pressable onPress={() => router.push('/register' as Href)} hitSlop={8}>
            <Body size={13} weight="700" color={c.accent}>{t('login.registerNow')}</Body>
          </Pressable>
        </View>
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <Body muted size={12}>{t('login.footer')}</Body>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
