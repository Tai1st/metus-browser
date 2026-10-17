import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { showDialog } from '@/components/Dialog';
import { Logo } from '@/components/Logo';
import { Body, Button, Card, ErrorText, Field, Title, useColors } from '@/components/ui';
import { Api, describeError } from '@/lib/api';
import { useT } from '@/lib/i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Đăng ký tài khoản Metus — port từ features/register của metus-few. */
export default function RegisterScreen() {
  const c = useColors();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const backToLogin = (prefill?: string) => router.replace({ pathname: '/login', params: prefill ? { email: prefill } : {} });

  const submit = async () => {
    setError('');
    const mail = email.trim();
    // Cùng luật với registerSchema (Yup) của metus-few
    if (!mail) return setError(t('register.emailRequired'));
    if (!EMAIL_RE.test(mail)) return setError(t('register.emailInvalid'));
    if (!password) return setError(t('register.passwordRequired'));
    if (password.length < 6) return setError(t('register.passwordMin'));
    if (confirm !== password) return setError(t('register.passwordMismatch'));
    setLoading(true);
    try {
      await Api.register(mail, password);
      showDialog(t('register.success'), undefined, [{ text: t('login.submit'), onPress: () => backToLogin(mail) }]);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 28, gap: 14 }}>
            <Logo size={80} />
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Title size="xl">{t('register.title')}</Title>
              <Body muted>{t('login.tagline')}</Body>
            </View>
          </View>

          <Card>
            <Field label={t('login.email')} icon="mail-outline" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} textContentType="emailAddress" placeholder="you@metus.vn" />
            <Field
              label={t('login.password')}
              icon="lock-closed-outline"
              secureTextEntry={!show}
              value={password}
              onChangeText={setPassword}
              textContentType="newPassword"
              placeholder="••••••••"
              rightIcon={show ? 'eye-off-outline' : 'eye-outline'}
              onRightIconPress={() => setShow((s) => !s)}
            />
            <Field
              label={t('register.confirmPassword')}
              icon="lock-closed-outline"
              secureTextEntry={!showConfirm}
              value={confirm}
              onChangeText={setConfirm}
              textContentType="newPassword"
              placeholder="••••••••"
              onSubmitEditing={submit}
              rightIcon={showConfirm ? 'eye-off-outline' : 'eye-outline'}
              onRightIconPress={() => setShowConfirm((s) => !s)}
            />
            <ErrorText>{error}</ErrorText>
            <Button title={t('register.submit')} icon="person-add-outline" onPress={submit} loading={loading} full />
          </Card>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 20, gap: 4 }}>
            <Body muted size={13}>{t('register.haveAccount')}</Body>
            <Pressable onPress={() => backToLogin()} hitSlop={8}>
              <Body size={13} weight="700" color={c.accent}>{t('register.loginHere')}</Body>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
