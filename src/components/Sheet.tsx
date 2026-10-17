import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, useColors } from '@/components/ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Khung bottom sheet dùng chung: thanh kéo, header (icon + tiêu đề + phụ đề),
 * phần nội dung cuộn, và nút "Lưu" xanh ở dưới. `dismissable=false` để bắt buộc
 * chọn (lần mở app đầu tiên).
 */
export function SheetShell({
  visible,
  onClose,
  onSave,
  saveLabel,
  icon,
  title,
  subtitle,
  dismissable = true,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
  icon: IconName;
  title: string;
  subtitle?: string;
  dismissable?: boolean;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={dismissable ? onClose : () => {}}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
          onPress={dismissable ? onClose : undefined}
        />
        <View
          style={{
            backgroundColor: c.bg,
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            paddingBottom: Math.max(insets.bottom, 16) + 6,
            maxHeight: '88%',
          }}>
          {/* Thanh kéo */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
            <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: c.border }} />
          </View>

          {/* Header: icon + tiêu đề + phụ đề */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14 }}>
            <View style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={icon} size={28} color={c.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '800', fontSize: 23, letterSpacing: -0.4 }}>{title}</Text>
              {subtitle ? <Text style={{ color: c.muted, fontSize: 13.5, marginTop: 2 }}>{subtitle}</Text> : null}
            </View>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10, gap: 12 }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>

          {/* Nút Lưu (xanh thương hiệu) */}
          <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
            <Pressable
              onPress={onSave}
              style={({ pressed }) => ({
                backgroundColor: c.accent,
                borderRadius: radius.pill,
                paddingVertical: 17,
                alignItems: 'center',
                opacity: pressed ? 0.88 : 1,
              })}>
              <Text style={{ color: c.onAccent, fontWeight: '800', fontSize: 16 }}>{saveLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
