import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { CATEGORY_KEY, TAG_KEY, findGridTool, useToolText } from '@/components/ToolList';
import { Badge, Body, Button, Card, IconCircle, Row, Screen, Title, radius, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function ToolDetailScreen() {
  const c = useColors();
  const t = useT();
  const toolText = useToolText();
  const { title, key } = useLocalSearchParams<{ title?: string; key?: string }>();
  const tool = key ? findGridTool(key) : undefined;
  const text = tool ? toolText(tool) : undefined;
  const name = text?.title ?? title ?? t('comingSoon.fallbackName');

  const features = [t('comingSoon.feat1'), t('comingSoon.feat2'), t('comingSoon.feat3'), t('comingSoon.feat4')];

  return (
    <Screen>
      {/* Tiêu đề công cụ */}
      <Card>
        <Row gap={14}>
          <View style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={tool?.icon ?? 'construct'} size={28} color={c.accent} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Body weight="700" size={17}>{name}</Body>
            <Body muted size={13} numberOfLines={2}>{text?.desc ?? t('comingSoon.fallbackDesc')}</Body>
          </View>
        </Row>
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          {tool ? <Badge text={t(TAG_KEY[tool.tag])} tone="info" /> : null}
          {tool ? <Badge text={t(CATEGORY_KEY[tool.category])} tone="accent" /> : null}
          <Badge text={t('tools.soon')} tone="muted" />
        </Row>
        <Button title={t('comingSoon.open')} icon="open-outline" disabled onPress={() => {}} full />
      </Card>

      {/* Tính năng nổi bật */}
      <Title size="md">{t('comingSoon.features')}</Title>
      <Card>
        <View style={{ gap: 10 }}>
          {features.map((f) => (
            <Row key={f} gap={10}>
              <Ionicons name="checkmark-circle" size={18} color={c.accent} />
              <Body size={14} color={c.text}>{f}</Body>
            </Row>
          ))}
        </View>
      </Card>

      <Card>
        <Row gap={8}>
          <IconCircle name="hammer" tone="muted" size={18} />
          <View style={{ flex: 1 }}>
            <Body weight="700">{t('comingSoon.inDev')}</Body>
            <Body muted size={13}>{t('comingSoon.inDevDesc')}</Body>
          </View>
        </Row>
      </Card>

      <Button title={t('comingSoon.other')} variant="secondary" icon="apps" onPress={() => router.replace('/tools')} full />
    </Screen>
  );
}
