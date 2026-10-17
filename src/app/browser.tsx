import { useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Button, Field, Row, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

function normalize(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

/**
 * Trình duyệt đơn giản. Trang web ở đây KHÔNG có quyền gọi Metus native
 * HTTP (không có onMessage / injectedJavaScript).
 */
export default function BrowserScreen() {
  const c = useColors();
  const t = useT();
  const ref = useRef<WebView>(null);
  const [url, setUrl] = useState('https://www.facebook.com/');
  const [input, setInput] = useState(url);
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 8, gap: 8, borderBottomWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
        <Field
          value={input}
          onChangeText={setInput}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => setUrl(normalize(input))}
          selectTextOnFocus
        />
        <Row>
          <Button compact variant="secondary" title="‹" disabled={!nav.canGoBack} onPress={() => ref.current?.goBack()} />
          <Button compact variant="secondary" title="›" disabled={!nav.canGoForward} onPress={() => ref.current?.goForward()} />
          <Button compact variant="secondary" title={t('browser.reload')} onPress={() => ref.current?.reload()} />
        </Row>
      </View>
      <WebView
        ref={ref}
        source={{ uri: url }}
        onNavigationStateChange={(s) => {
          setNav({ canGoBack: s.canGoBack, canGoForward: s.canGoForward });
          if (!s.loading) setInput(s.url);
        }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowFileAccess={false}
        style={{ flex: 1 }}
      />
    </View>
  );
}
