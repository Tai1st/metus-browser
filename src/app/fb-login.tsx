import { Metus } from '@metus/http';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { Body, Button, ErrorText, Row, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useFbAccounts } from '@/lib/fb/accounts';

const LOGIN_URL = 'https://www.facebook.com/login/';

/**
 * Màn đăng nhập Facebook bằng WebView (thay LOGIN_NEW_ACC của extension).
 * WebView là nội dung web không tin cậy: KHÔNG truyền onMessage /
 * injectedJavaScript, nên trang không có cầu nối nào vào native.
 */
export default function FbLoginScreen() {
  const c = useColors();
  const t = useT();
  const { mode, id } = useLocalSearchParams<{ mode?: 'new' | 'open'; id?: string }>();
  const { importFromWebView } = useFbAccounts();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        // "new": xóa cookie WebView để đăng nhập tài khoản mới hoàn toàn.
        // "open": GIỮ NGUYÊN phiên đang đăng nhập trong WebView (không xóa,
        // không ghi đè bằng cookie jar có thể đã hết hạn) rồi mở facebook.com;
        // khi vào được trang chủ sẽ tự nhập lại cookie mới cho đúng tài khoản.
        if (mode !== 'open') await Metus.accounts.clearWebView();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setReady(true);
    })();
  }, [mode, id]);

  const [savedOnce, setSavedOnce] = useState(false);

  const save = async (auto: boolean) => {
    if (saving) return;
    // Tự động: chỉ lưu 1 lần/lần tới home. Thủ công: luôn cho lưu lại.
    if (auto && savedRef.current) return;
    setSaving(true);
    setError('');
    try {
      await importFromWebView();
      savedRef.current = true;
      setSavedOnce(true);
      // "new": đăng nhập xong thì quay lại. "open": làm mới phiên, ở lại cho duyệt tiếp.
      if (mode !== 'open') router.back();
    } catch (e) {
      // Lỗi auto (vd chưa thật sự đăng nhập) thì im lặng, để người dùng tự bấm Lưu.
      if (!auto) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Khi tới trang chủ Facebook (đã đăng nhập) -> thử nhập lại cookie tự động.
  // Áp dụng cho CẢ "Mở Facebook" để đăng nhập lại tài khoản hết phiên.
  const onNav = (s: WebViewNavigation) => {
    if (s.loading) return;
    const u = s.url;
    if (/facebook\.com\/?(\?|$)|facebook\.com\/home\.php/.test(u)) save(true);
  };

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <WebView
        source={{ uri: mode === 'open' ? 'https://www.facebook.com/' : LOGIN_URL }}
        onNavigationStateChange={onNav}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        style={{ flex: 1 }}
      />
      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
        <Body muted>{savedOnce ? t('fbLogin.updated') : t('fbLogin.hint')}</Body>
        <ErrorText>{error}</ErrorText>
        <Row>
          <View style={{ flex: 1 }}>
            <Button title={mode === 'open' ? t('common.close') : t('common.cancel')} variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={mode === 'open' ? t('fbLogin.update') : t('fbLogin.save')} onPress={() => save(false)} loading={saving} />
          </View>
        </Row>
      </View>
    </View>
  );
}
