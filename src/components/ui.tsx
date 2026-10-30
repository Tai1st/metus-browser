import { Ionicons } from '@expo/vector-icons';
import MaskedView from '@react-native-masked-view/masked-view';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const palette = {
  light: {
    bg: '#f6f7f9',
    card: '#ffffff',
    border: '#e8ebef',
    text: '#0b1220',
    muted: '#6b7280',
    faint: '#9aa3af',
    input: '#f3f4f6',
    inputBorder: '#e2e5ea',
    accent: '#22c55e',
    accentSoft: '#dcfce7',
    accentDeep: '#16a34a',
    danger: '#ef4444',
    dangerSoft: '#fee2e2',
    success: '#10b981',
    successSoft: '#dcfce7',
    info: '#3b82f6',
    chip: '#f1f3f5',
    onAccent: '#ffffff',
    shadow: '#0b1220',
    heroText: '#ffffff',
  },
  dark: {
    bg: '#0a0e17',
    card: '#131a27',
    border: '#1f2937',
    text: '#f1f5f9',
    muted: '#94a3b8',
    faint: '#64748b',
    input: '#1a2231',
    inputBorder: '#273246',
    accent: '#22c55e',
    accentSoft: '#0f2a1a',
    accentDeep: '#16a34a',
    danger: '#f87171',
    dangerSoft: '#3b1d1d',
    success: '#34d399',
    successSoft: '#10281f',
    info: '#60a5fa',
    chip: '#1b2434',
    onAccent: '#1a1206',
    shadow: '#000000',
    heroText: '#ffffff',
  },
};

export type Palette = typeof palette.light;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };

export function useColors(): Palette {
  return useTheme().scheme === 'dark' ? palette.dark : palette.light;
}

export function shadow(c: Palette, level: 1 | 2 = 1): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: c.shadow,
      shadowOpacity: level === 2 ? 0.14 : 0.08,
      shadowRadius: level === 2 ? 18 : 10,
      shadowOffset: { width: 0, height: level === 2 ? 8 : 4 },
    },
    android: { elevation: level === 2 ? 5 : 2 },
    default: {},
  })!;
}

export function Screen({ children, scroll = true, pad = true }: { children: ReactNode; scroll?: boolean; pad?: boolean }) {
  const c = useColors();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[pad && styles.screen, { paddingBottom: 110 }]}
      keyboardShouldPersistTaps="handled"
      // Tự cuộn để ô nhập đang gõ không bị bàn phím che — không cần
      // KeyboardAvoidingView/thư viện ngoài (RN 0.71+ hỗ trợ cả iOS lẫn Android).
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[pad && styles.screen, { flex: 1 }]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom', 'left', 'right']}>
      {content}
    </SafeAreaView>
  );
}

/** Nền "gradient" bằng lớp phủ thuần JS (không cần native module). */
export function Hero({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View style={[styles.hero, { backgroundColor: c.accentDeep }, shadow(c, 2), style]}>
      <View style={[styles.heroBlob, { backgroundColor: c.accent, opacity: 0.55 }]} />
      <View style={[styles.heroBlob2, { backgroundColor: '#ffffff', opacity: 0.1 }]} />
      <View style={{ gap: 6 }}>{children}</View>
    </View>
  );
}

export function Card({ children, style, onPress, padded = true }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; padded?: boolean }) {
  const c = useColors();
  const base = [styles.card, padded && { padding: 16 }, { backgroundColor: c.card, borderColor: c.border }, shadow(c, 1), style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export function IconCircle({ name, tone = 'accent', size = 20 }: { name: IconName; tone?: 'accent' | 'muted' | 'success' | 'danger' | 'info'; size?: number }) {
  const c = useColors();
  const map = {
    accent: [c.accentSoft, c.accent],
    muted: [c.chip, c.muted],
    success: [c.successSoft, c.success],
    danger: [c.dangerSoft, c.danger],
    info: [c.chip, c.info],
  } as const;
  const [bg, fg] = map[tone];
  const d = size + 20;
  return (
    <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={size} color={fg} />
    </View>
  );
}

export function Title({ children, size = 'lg' }: { children: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  const c = useColors();
  const fs = size === 'xl' ? 26 : size === 'md' ? 17 : 21;
  return <Text style={{ color: c.text, fontWeight: '800', fontSize: fs, letterSpacing: -0.4 }}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={{ color: c.faint, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>{children}</Text>;
}

export function Body({ children, muted, mono, selectable, size = 14, weight = '400', numberOfLines, color }: {
  children: ReactNode; muted?: boolean; mono?: boolean; selectable?: boolean; size?: number; weight?: '400' | '500' | '600' | '700'; numberOfLines?: number; color?: string;
}) {
  const c = useColors();
  return (
    <Text selectable={selectable} numberOfLines={numberOfLines} style={{ color: color ?? (muted ? c.muted : c.text), fontSize: size, fontWeight: weight, fontFamily: mono ? (Platform.OS === 'ios' ? 'Menlo' : 'monospace') : undefined, lineHeight: size * 1.4 }}>
      {children}
    </Text>
  );
}

// Text tô gradient (ví dụ xanh dương → xanh lá) — mask chữ bằng một dải màu nội suy,
// vì RN không hỗ trợ gradient trên Text và dự án chưa cài expo-linear-gradient.
export function GradientText({ children, size = 14, weight = '700', from = '#2563eb', to = '#16a34a', style }: {
  children: string; size?: number; weight?: '400' | '500' | '600' | '700'; from?: string; to?: string; style?: ViewStyle;
}) {
  const steps = 20;
  const hexToRgb = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  // Trên Android, MaskedView không tự co kích thước theo maskElement khi cha không
  // ép chiều rộng cố định (ví dụ nằm trong View chỉ có alignItems:'center') — chữ bị
  // mất vì dải gradient co về 0. Đo trước bằng 1 Text ẩn, rồi gán width/height tường
  // minh cho MaskedView + dải màu.
  const height = size * 1.3;
  const [width, setWidth] = useState(0);
  return (
    <View style={style}>
      <Text
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ fontSize: size, fontWeight: weight, position: 'absolute', opacity: 0 }}
      >
        {children}
      </Text>
      {width > 0 ? (
        <MaskedView
          style={{ width, height }}
          maskElement={<Text style={{ fontSize: size, fontWeight: weight }}>{children}</Text>}
        >
          <View style={{ flexDirection: 'row', width, height }}>
            {Array.from({ length: steps }).map((_, i) => {
              const t = i / (steps - 1);
              const r = Math.round(r1 + (r2 - r1) * t);
              const g = Math.round(g1 + (g2 - g1) * t);
              const b = Math.round(b1 + (b2 - b1) * t);
              return <View key={i} style={{ flex: 1, backgroundColor: `rgb(${r},${g},${b})` }} />;
            })}
          </View>
        </MaskedView>
      ) : null}
    </View>
  );
}

export function Field(props: TextInputProps & { label?: string; icon?: IconName; rightIcon?: IconName; onRightIconPress?: () => void }) {
  const c = useColors();
  const { label, icon, rightIcon, onRightIconPress, style, ...rest } = props;
  return (
    <View style={{ gap: 7 }}>
      {label ? <Label>{label}</Label> : null}
      <View style={[styles.inputWrap, { backgroundColor: c.input, borderColor: c.inputBorder }, rest.multiline && { alignItems: 'flex-start' }]}>
        {icon ? <Ionicons name={icon} size={18} color={c.faint} style={{ marginTop: rest.multiline ? 2 : 0 }} /> : null}
        <TextInput
          placeholderTextColor={c.faint}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
          style={[styles.input, { color: c.text }, rest.multiline && { minHeight: 110, textAlignVertical: 'top' }, style]}
        />
        {rightIcon ? (
          <Pressable onPress={onRightIconPress} hitSlop={10} style={{ paddingLeft: 6 }}>
            <Ionicons name={rightIcon} size={19} color={c.faint} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, compact, icon, full }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean; compact?: boolean; icon?: IconName; full?: boolean;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.accent : variant === 'danger' ? c.danger : variant === 'ghost' ? 'transparent' : c.chip;
  const fg = variant === 'primary' ? c.onAccent : variant === 'danger' ? '#fff' : variant === 'ghost' ? c.accent : c.text;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        full && { alignSelf: 'stretch' },
        variant === 'ghost' && { borderWidth: 1, borderColor: c.border },
        variant === 'primary' && shadow(c, 1),
        { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.88 : 1 },
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        // alignSelf:'stretch' — nếu không ép full chiều rộng, trên Android vùng
        // bắt chạm thực tế đôi khi co về đúng kích thước nội dung (chỉ chữ) thay
        // vì toàn bộ nút, dù layout hiển thị vẫn đúng (lệch giữa accessibility
        // bounds và vùng responder thật).
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'stretch' }}>
          {icon ? <Ionicons name={icon} size={compact ? 15 : 17} color={fg} /> : null}
          <Text style={{ color: fg, fontWeight: '700', fontSize: compact ? 13 : 15 }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Badge({ text, tone = 'muted', dot }: { text: string; tone?: 'muted' | 'success' | 'danger' | 'accent' | 'info'; dot?: boolean }) {
  const c = useColors();
  const fg = tone === 'success' ? c.success : tone === 'danger' ? c.danger : tone === 'accent' ? c.accent : tone === 'info' ? c.info : c.muted;
  const bg = tone === 'success' ? c.successSoft : tone === 'danger' ? c.dangerSoft : tone === 'accent' ? c.accentSoft : c.chip;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} /> : null}
      <Text style={{ color: fg, fontSize: 11, fontWeight: '800' }}>{text}</Text>
    </View>
  );
}

export function Row({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: c.border, marginVertical: 2 }} />;
}

export function Segmented<T extends string>({ value, options, onChange, colorFor, labelFor }: { value: T; options: readonly T[]; onChange: (v: T) => void; colorFor?: (v: T) => string | undefined; labelFor?: (v: T) => string }) {
  const c = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => {
        const active = o === value;
        const tint = colorFor?.(o) ?? c.accent;
        return (
          <Pressable key={o} onPress={() => onChange(o)} style={[styles.segment, { backgroundColor: active ? tint : c.chip }]}>
            <Text style={{ color: active ? '#fff' : c.text, fontWeight: '700', fontSize: 12.5 }}>{labelFor ? labelFor(o) : o}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function NumberField({ label, value, onChange, min = 0, max = 100000, icon }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; icon?: IconName }) {
  return (
    <Field
      label={label}
      icon={icon}
      keyboardType="number-pad"
      value={String(value)}
      onChangeText={(t) => {
        const n = parseInt(t.replace(/\D/g, '') || '0', 10);
        onChange(Math.min(max, Math.max(min, n)));
      }}
    />
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const c = useColors();
  if (!children) return null;
  return (
    <Row gap={6} style={{ backgroundColor: c.dangerSoft, padding: 10, borderRadius: radius.sm }}>
      <Ionicons name="alert-circle" size={16} color={c.danger} />
      <Text style={{ color: c.danger, fontSize: 13, flex: 1 }}>{children}</Text>
    </Row>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: IconName; title: string; subtitle?: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 28 }}>
      <IconCircle name={icon} tone="muted" size={26} />
      <Body weight="700">{title}</Body>
      {subtitle ? <Body muted size={13}>{subtitle}</Body> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 14 },
  hero: { borderRadius: radius.lg, padding: 20, overflow: 'hidden' },
  heroBlob: { position: 'absolute', top: -40, right: -30, width: 160, height: 160, borderRadius: 80 },
  heroBlob2: { position: 'absolute', bottom: -50, left: -20, width: 140, height: 140, borderRadius: 70 },
  card: { borderWidth: 1, borderRadius: radius.md, gap: 10 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12 },
  input: { flex: 1, paddingVertical: 11, fontSize: 14.5 },
  button: { borderRadius: radius.sm, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonCompact: { paddingVertical: 9, paddingHorizontal: 13 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'flex-start' },
  segment: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
});
