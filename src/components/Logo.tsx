import { Platform, Text, View } from 'react-native';

import { shadow, useColors } from '@/components/ui';

/** Logo Metus: ô vuông bo tròn màu xanh với chữ "M" trắng. */
export function Logo({ size = 32 }: { size?: number }) {
  const c = useColors();
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
        shadow(c, 1),
      ]}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.58, ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}) }}>M</Text>
    </View>
  );
}

/** Tiêu đề thương hiệu cho header: logo + chữ "Metus". */
export function BrandTitle() {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Logo size={30} />
      <Text style={{ color: c.text, fontWeight: '800', fontSize: 20, letterSpacing: -0.3 }}>Metus</Text>
    </View>
  );
}
