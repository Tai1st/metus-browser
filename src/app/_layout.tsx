import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { AuthProvider, useAuth } from '@/lib/auth';
import { configureNetwork } from '@/lib/config';
import { FbAccountsProvider } from '@/lib/fb/accounts';
import { AdsSessionProvider } from '@/lib/fb/adsSession';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { hydrateStorage } from '@/lib/storage';
import { ThemeProvider as AppThemeProvider, useTheme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { isLoggedIn } = useAuth();
  const { chosen, t } = useI18n();
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
          <Stack.Screen name="tools/coming-soon" options={{ title: t('stack.comingSoon') }} />
          <Stack.Screen name="tools/auto-join-fb-group" options={{ title: t('stack.autoJoin') }} />
          <Stack.Screen name="tools/auto-post-fb-group" options={{ title: t('stack.autoPost') }} />
          <Stack.Screen name="tools/group-extractor-by-uid" options={{ title: t('stack.groupExtractor') }} />
          <Stack.Screen name="tools/fb-video-carousel" options={{ title: t('stack.videoCarousel') }} />
        </Stack.Protected>
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
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
            </AdsSessionProvider>
          </FbAccountsProvider>
        </AuthProvider>
      </I18nProvider>
    </NavThemeProvider>
  );
}
