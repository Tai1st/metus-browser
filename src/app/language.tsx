import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageSheet } from '@/components/LanguageSheet';
import { Logo } from '@/components/Logo';
import { Body, Title, useColors } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export default function LanguageScreen() {
  const c = useColors();
  const { t } = useI18n();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Nền thương hiệu phía sau bottom sheet chọn ngôn ngữ. */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <Logo size={88} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Title size="xl">Metus</Title>
          <Body muted>{t('login.tagline')}</Body>
        </View>
      </View>

      {/* Bắt buộc chọn ngôn ngữ trước khi dùng app (không cho tắt). */}
      <LanguageSheet visible onClose={() => {}} dismissable={false} />
    </SafeAreaView>
  );
}
