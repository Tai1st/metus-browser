import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { radius, shadow, useColors } from '@/components/ui';

/**
 * Hộp thoại dùng chung toàn app, thay cho Alert.alert native.
 * Cùng chữ ký với Alert.alert: showDialog(title, message?, buttons?).
 * Gắn <DialogHost /> một lần ở root layout.
 */
export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
}

interface DialogState {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let setGlobal: ((s: DialogState | null) => void) | null = null;

export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  const state: DialogState = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] };
  if (setGlobal) setGlobal(state);
}

export function DialogHost() {
  const c = useColors();
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    setGlobal = setDialog;
    return () => {
      if (setGlobal === setDialog) setGlobal = null;
    };
  }, []);

  const close = () => setDialog(null);
  const press = (b: DialogButton) => {
    close();
    b.onPress?.();
  };

  const danger = dialog?.buttons.some((b) => b.style === 'destructive');
  const cancelBtn = dialog?.buttons.find((b) => b.style === 'cancel');
  // Huỷ luôn nằm bên trái, hành động chính bên phải.
  const ordered = dialog ? [...dialog.buttons].sort((a, b) => (a.style === 'cancel' ? -1 : b.style === 'cancel' ? 1 : 0)) : [];

  return (
    <Modal visible={!!dialog} transparent animationType="fade" statusBarTranslucent onRequestClose={() => (cancelBtn ? press(cancelBtn) : close())}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
          onPress={() => (cancelBtn ? press(cancelBtn) : undefined)}
        />
        {dialog ? (
          <View style={[{ width: '100%', maxWidth: 380, backgroundColor: c.card, borderRadius: radius.lg, padding: 22, gap: 14, alignItems: 'center' }, shadow(c, 2)]}>
            <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? c.dangerSoft : c.accentSoft }}>
              <Ionicons name={danger ? 'warning' : 'information-circle'} size={30} color={danger ? c.danger : c.accent} />
            </View>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>{dialog.title}</Text>
            {dialog.message ? (
              <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{dialog.message}</Text>
            ) : null}
            <View style={{ flexDirection: ordered.length > 2 ? 'column' : 'row', gap: 10, alignSelf: 'stretch', marginTop: 4 }}>
              {ordered.map((b) => {
                const isCancel = b.style === 'cancel';
                const isDanger = b.style === 'destructive';
                const bg = isCancel ? c.chip : isDanger ? c.danger : c.accent;
                const fg = isCancel ? c.text : '#fff';
                return (
                  <Pressable
                    key={b.text}
                    onPress={() => press(b)}
                    style={({ pressed }) => ({ flex: ordered.length > 2 ? undefined : 1, backgroundColor: bg, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', opacity: pressed ? 0.85 : 1 })}>
                    <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{b.text}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
