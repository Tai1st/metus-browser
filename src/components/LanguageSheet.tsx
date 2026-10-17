import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SheetShell } from '@/components/Sheet';
import { radius, useColors } from '@/components/ui';
import { LANGUAGES, useI18n, type Lang } from '@/lib/i18n';

/**
 * Bottom sheet chọn ngôn ngữ (dùng cho cả màn khởi động và mục Tài khoản).
 * Chọn ngôn ngữ rồi bấm "Lưu" mới áp dụng. `dismissable=false` dùng ở lần mở
 * app đầu tiên để bắt buộc chọn trước khi dùng.
 */
export function LanguageSheet({
  visible,
  onClose,
  dismissable = true,
}: {
  visible: boolean;
  onClose: () => void;
  dismissable?: boolean;
}) {
  const c = useColors();
  const { lang, setLang, t } = useI18n();
  const [picked, setPicked] = useState<Lang>(lang);

  useEffect(() => {
    if (visible) setPicked(lang);
  }, [visible, lang]);

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      onSave={() => {
        setLang(picked);
        onClose();
      }}
      saveLabel={t('common.save')}
      icon="globe-outline"
      title={t('language.title')}
      subtitle={t('language.subtitle')}
      dismissable={dismissable}>
      {LANGUAGES.map((l) => {
        const active = picked === l.code;
        return (
          <Pressable
            key={l.code}
            onPress={() => setPicked(l.code)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              padding: 14,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: active ? c.accent : c.border,
              backgroundColor: active ? c.accentSoft : c.card,
            }}>
            <Text style={{ fontSize: 30 }}>{l.flag}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 18 }}>{l.native}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{l.label}</Text>
            </View>
            {active ? (
              <Ionicons name="checkmark-circle" size={26} color={c.accent} />
            ) : (
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.faint }} />
            )}
          </Pressable>
        );
      })}
    </SheetShell>
  );
}
