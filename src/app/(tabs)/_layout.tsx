import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandTitle } from '@/components/Logo';
import { shadow, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

function HeaderIcon({ name }: { name: React.ComponentProps<typeof Ionicons>['name'] }) {
  const c = useColors();
  return (
    <Pressable hitSlop={10} style={{ paddingHorizontal: 14 }}>
      <Ionicons name={name} size={22} color={c.text} />
    </Pressable>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabRoute { key: string; name: string }
interface TabBarProps {
  state: { routes: TabRoute[]; index: number };
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

const ICONS: Record<string, IconName> = {
  index: 'logo-facebook',
  recharge: 'wallet',
  tools: 'construct',
  plan: 'cart',
  account: 'person',
};

const LABEL_KEYS: Record<string, string> = {
  index: 'nav.connect',
  recharge: 'nav.recharge',
  tools: 'nav.tools',
  plan: 'nav.plan',
  account: 'nav.account',
};

const ORDER = ['index', 'recharge', 'tools', 'plan', 'account'];
const CENTER = 'tools';
const FB_BLUE = '#1877F2';

function MetusTabBar({ state, navigation }: TabBarProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();

  const routes = ORDER.map((name) => state.routes.find((r) => r.name === name)).filter(Boolean) as TabRoute[];
  const activeName = state.routes[state.index]?.name;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: c.card, borderColor: c.border }, shadow(c, 2)]}>
        {routes.map((route) => {
          const focused = route.name === activeName;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          if (route.name === CENTER) {
            return (
              <Pressable key={route.key} onPress={onPress} style={styles.item}>
                <View style={[styles.center, { backgroundColor: c.accent, borderColor: c.card }, shadow(c, 2)]}>
                  <Ionicons name={ICONS[route.name]} size={26} color="#fff" />
                </View>
                <Text style={[styles.label, { color: focused ? c.accent : c.text, marginTop: 2 }]}>{t(LABEL_KEYS[route.name])}</Text>
              </Pressable>
            );
          }

          // Tab "Kết nối" dùng logo Facebook màu xanh thương hiệu (giữ màu khi active/inactive).
          const isFb = route.name === 'index';
          const iconColor = isFb ? FB_BLUE : focused ? c.accent : c.faint;
          const iconName = isFb ? ICONS[route.name] : focused ? ICONS[route.name] : (`${ICONS[route.name]}-outline` as IconName);
          const labelColor = focused ? c.accent : c.faint;

          return (
            <Pressable key={route.key} onPress={onPress} style={styles.item}>
              <Ionicons name={iconName} size={23} color={iconColor} />
              <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>{t(LABEL_KEYS[route.name])}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs
      tabBar={(props) => <MetusTabBar {...props} />}
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: c.bg },
        headerTitle: () => <BrandTitle />,
        headerTitleAlign: 'left',
        headerTintColor: c.text,
      }}>
      <Tabs.Screen name="index" options={{ headerRight: () => <HeaderIcon name="notifications-outline" /> }} />
      <Tabs.Screen name="recharge" options={{ headerRight: () => <HeaderIcon name="time-outline" /> }} />
      <Tabs.Screen name="tools" options={{ headerShown: false }} />
      <Tabs.Screen name="plan" options={{ headerRight: () => <HeaderIcon name="notifications-outline" /> }} />
      <Tabs.Screen name="account" options={{ headerRight: () => <HeaderIcon name="settings-outline" /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, backgroundColor: 'transparent' },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: 28,
    paddingVertical: 10,
    paddingHorizontal: 6,
    height: 68,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3, height: '100%' },
  label: { fontSize: 11, fontWeight: '700' },
  center: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    marginTop: -28,
  },
  centerM: { color: '#fff', fontSize: 28, fontWeight: '800', ...(Platform.OS === 'ios' ? {} : { includeFontPadding: false }) },
});
