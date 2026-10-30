import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { Pressable } from 'react-native';

import { BrandTitle } from '@/components/Logo';
import { useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

// Stack lồng trong tab Công cụ: các màn tool mở ra vẫn giữ thanh tab ở dưới.
export default function ToolsStackLayout() {
  const c = useColors();
  const t = useT();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '800' },
        headerTitleAlign: 'center',
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen
        name="index"
        options={{
          headerTitle: () => <BrandTitle />,
          headerTitleAlign: 'left',
          headerRight: () => (
            <Pressable hitSlop={10} style={{ paddingHorizontal: 14 }}>
              <Ionicons name="grid-outline" size={22} color={c.text} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="coming-soon" options={{ title: t('stack.comingSoon') }} />
      <Stack.Screen name="auto-join-fb-group" options={{ title: t('stack.autoJoin') }} />
      <Stack.Screen name="auto-post-fb-group" options={{ title: t('stack.autoPost') }} />
      <Stack.Screen name="group-extractor-by-uid" options={{ title: t('stack.groupExtractor') }} />
      <Stack.Screen name="fb-video-carousel" options={{ title: t('stack.videoCarousel') }} />
      <Stack.Screen name="fb-one-card-video-carousel" options={{ title: t('stack.oneCardVideo') }} />
      <Stack.Screen name="fb-one-card-picture-carousel" options={{ title: t('stack.oneCardPicture') }} />
      <Stack.Screen name="post-a-card" options={{ title: t('stack.fakeAlbum') }} />
      <Stack.Screen name="auto-comment-fb-group" options={{ title: t('stack.autoComment') }} />
      <Stack.Screen name="up-to-reelsv2" options={{ title: t('stack.reels') }} />
      <Stack.Screen name="up-to-stories" options={{ title: t('stack.stories') }} />
      <Stack.Screen name="swipe-up-video" options={{ title: t('stack.swipeUp') }} />
      <Stack.Screen name="page-post-analysis" options={{ title: t('stack.pagePostAnalyze') }} />
      <Stack.Screen name="group-post-analysis" options={{ title: t('stack.groupPostAnalyze') }} />
      <Stack.Screen name="group-pending-post-remover" options={{ title: t('stack.groupPendingPostRemover') }} />
      <Stack.Screen name="profile-post" options={{ title: t('stack.profilePost') }} />
    </Stack>
  );
}
