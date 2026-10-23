import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';

import { AuthProvider, useAuth } from '@/lib/auth';
import { configureNetwork } from '@/lib/config';
import { FbAccountsProvider } from '@/lib/fb/accounts';
import { DialogHost } from '@/components/Dialog';
import { AdsSessionProvider } from '@/lib/fb/adsSession';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { hydrateStorage } from '@/lib/storage';
import { ThemeProvider as AppThemeProvider, useTheme } from '@/lib/theme';
import { checkForUpdateSilently } from '@/lib/updateCheck';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { isLoggedIn } = useAuth();
  const { chosen, t } = useI18n();
  const updateCheckedRef = useRef(false);

  // Kiểm tra bản cập nhật mới mỗi lần mở app (sau khi đã đăng nhập, vì setting
  // cần token) — im lặng nếu không có bản mới, chỉ phiền người dùng khi cần.
  useEffect(() => {
    if (!isLoggedIn || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    checkForUpdateSilently(t);
  }, [isLoggedIn, t]);

  return (
    <Stack screenOptions={{ headerTitleStyle: { fontWeight: '800' }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
      {/* Chọn ngôn ngữ trước khi dùng app (lần mở đầu tiên). */}
      <Stack.Protected guard={!chosen}>
        <Stack.Screen name="language" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={chosen}>
        <Stack.Protected guard={isLoggedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="fb-login" options={{ title: t('stack.fbLogin') }} />
          <Stack.Screen name="api-client" options={{ title: t('stack.apiClient') }} />
          <Stack.Screen name="browser" options={{ title: t('stack.browser') }} />
        </Stack.Protected>
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    configureNetwork();
    hydrateStorage()
      .catch(() => {})
      .finally(() => {
        setReady(true);
        SplashScreen.hideAsync();
      });
  }, []);

  if (!ready) return null;

  return (
    <AppThemeProvider>
      <ThemedRoot />
    </AppThemeProvider>
  );
}

function ThemedRoot() {
  const { scheme } = useTheme();
  return (
    <NavThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <I18nProvider>
        <AuthProvider>
          <FbAccountsProvider>
            <AdsSessionProvider>
              <RootStack />
              <DialogHost />
            </AdsSessionProvider>
          </FbAccountsProvider>
        </AuthProvider>
      </I18nProvider>
    </NavThemeProvider>
  );
}
