import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/Logo';
import { Body, Button, Card, ErrorText, Field, Title, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function LoginScreen() {
  const c = useColors();
  const t = useT();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
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
        </Card>

        <View style={{ alignItems: 'center', marginTop: 20 }}>
          <Body muted size={12}>{t('login.footer')}</Body>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
