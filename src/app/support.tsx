import { Ionicons } from '@expo/vector-icons';
import { Linking, View } from 'react-native';

import { Body, Card, IconCircle, Label, Row, Screen, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const CHANNELS: { icon: IconName; titleKey: string; descKey: string; url: string }[] = [
  { icon: 'chatbubbles', titleKey: 'support.zalo', descKey: 'support.zaloDesc', url: 'https://zalo.me/0987533112' },
  { icon: 'paper-plane', titleKey: 'support.telegram', descKey: 'support.telegramDesc', url: 'https://t.me/metusvn' },
  { icon: 'logo-facebook', titleKey: 'support.messenger', descKey: 'support.messengerDesc', url: 'https://www.facebook.com/messages/t/100090453707517' },
  { icon: 'people', titleKey: 'support.community', descKey: 'support.communityDesc', url: 'https://www.facebook.com/groups/metusvn' },
  { icon: 'logo-facebook', titleKey: 'support.facebookPage', descKey: 'support.facebookPageDesc', url: 'https://facebook.com/admm2v' },
  { icon: 'logo-youtube', titleKey: 'support.youtube', descKey: 'support.youtubeDesc', url: 'https://www.youtube.com/@Metusvn' },
];

export default function SupportScreen() {
  const t = useT();
  const c = useColors();
  return (
    <Screen>
      <Label>{t('support.subtitle')}</Label>
      {CHANNELS.map((ch) => (
        <Card key={ch.titleKey} onPress={() => Linking.openURL(ch.url)}>
          <Row gap={12}>
            <IconCircle name={ch.icon} tone="accent" />
            <Body weight="600" size={15}>{t(ch.titleKey)}</Body>
          </Row>
          <Body muted size={13}>{t(ch.descKey)}</Body>
        </Card>
      ))}
      <Row gap={10} style={{ alignItems: 'center', paddingHorizontal: 4 }}>
        <Ionicons name="information-circle-outline" size={16} color={c.faint} />
        <View style={{ flex: 1 }}><Body muted size={12}>{t('support.hint')}</Body></View>
      </Row>
    </Screen>
  );
}
