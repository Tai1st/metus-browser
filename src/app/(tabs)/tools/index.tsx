import { useState } from 'react';

import { ToolGrid, TOOL_TAGS, TAG_KEY, type ToolTag } from '@/components/ToolList';
import { Field, Screen, Segmented } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function ToolsScreen() {
  const t = useT();
  const [tag, setTag] = useState<ToolTag>('Tất cả');
  const [query, setQuery] = useState('');

  return (
    <Screen>
      <Field icon="search" placeholder={t('tools.search')} value={query} onChangeText={setQuery} />
      <Segmented value={tag} options={TOOL_TAGS} onChange={setTag} labelFor={(o) => t(TAG_KEY[o])} />
      <ToolGrid tag={tag} query={query} />
    </Screen>
  );
}
