import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SheetShell } from '@/components/Sheet';
import { radius, useColors } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useTheme, type ThemeMode } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
type PreviewKind = 'light' | 'dark' | 'auto';

const OPTIONS: { mode: ThemeMode; icon: IconName; iconBg: string; iconFg: string; title: string; desc: string; preview: PreviewKind }[] = [
  { mode: 'light', icon: 'sunny', iconBg: '#fde68a', iconFg: '#d97706', title: 'theme.optLight', desc: 'theme.optLightDesc', preview: 'light' },
  { mode: 'dark', icon: 'moon', iconBg: '#1e293b', iconFg: '#c7d2fe', title: 'theme.optDark', desc: 'theme.optDarkDesc', preview: 'dark' },
  { mode: 'system', icon: 'contrast', iconBg: '#bfdbfe', iconFg: '#2563eb', title: 'theme.optSystem', desc: 'theme.optSystemDesc', preview: 'auto' },
];

/** Mô phỏng nhỏ giao diện sáng/tối trong thẻ lựa chọn. */
function MiniMock({ dark }: { dark: boolean }) {
  const bg = dark ? '#0a0e17' : '#ffffff';
  const card = dark ? '#1b2434' : '#eef1f5';
  const txt = dark ? '#e2e8f0' : '#0b1220';
  return (
    <View style={{ flex: 1, backgroundColor: bg, padding: 7, gap: 5, justifyContent: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#22c55e' }} />
        <Text style={{ fontSize: 8, fontWeight: '800', color: txt }}>Metus</Text>
      </View>
      <View style={{ height: 9, borderRadius: 3, backgroundColor: '#22c55e', width: '70%' }} />
      <View style={{ height: 6, borderRadius: 3, backgroundColor: card }} />
      <View style={{ height: 6, borderRadius: 3, backgroundColor: card, width: '80%' }} />
    </View>
  );
}

function ThemePreview({ kind }: { kind: PreviewKind }) {
  const frame = { width: 96, height: 64, borderRadius: 10, overflow: 'hidden' as const, borderWidth: 1, borderColor: 'rgba(128,128,128,0.25)' };
  if (kind === 'auto') {
    return (
      <View style={[frame, { flexDirection: 'row' }]}>
        <View style={{ flex: 1, overflow: 'hidden' }}><MiniMock dark={false} /></View>
        <View style={{ flex: 1, overflow: 'hidden' }}><MiniMock dark /></View>
      </View>
    );
  }
  return (
    <View style={frame}>
      <MiniMock dark={kind === 'dark'} />
    </View>
  );
}

/** Bottom sheet chọn giao diện (Sáng / Tối / Tự động). */
export function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { mode, setMode } = useTheme();
  const { t } = useI18n();
  const [picked, setPicked] = useState<ThemeMode>(mode);

  useEffect(() => {
    if (visible) setPicked(mode);
  }, [visible, mode]);

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      onSave={() => {
        setMode(picked);
        onClose();
      }}
      saveLabel={t('common.save')}
      icon="color-palette-outline"
      title={t('theme.title')}
      subtitle={t('theme.subtitle')}>
      {OPTIONS.map((o) => {
        const active = picked === o.mode;
        return (
          <Pressable
            key={o.mode}
            onPress={() => setPicked(o.mode)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 14,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: active ? c.accent : c.border,
              backgroundColor: active ? c.accentSoft : c.card,
            }}>
            <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: o.iconBg, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={o.icon} size={24} color={o.iconFg} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>{t(o.title)}</Text>
              <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>{t(o.desc)}</Text>
            </View>
            <ThemePreview kind={o.preview} />
            {active ? (
              <Ionicons name="checkmark-circle" size={24} color={c.accent} />
            ) : (
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.faint }} />
            )}
          </Pressable>
        );
      })}
    </SheetShell>
  );
}
