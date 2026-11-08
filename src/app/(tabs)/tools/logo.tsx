import { Ionicons } from '@expo/vector-icons';
import { useFont, useImage } from '@shopify/react-native-skia';
import * as FS from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { showDialog } from '@/components/Dialog';
import { TickBox } from '@/components/groupPost';
import { Body, Card, Label, Row, Screen, Segmented, radius, shadow, useColors } from '@/components/ui';
import { Api, describeError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CANVAS_H, CANVAS_W, renderLogoPngBase64, type BorderStyle, type LogoFonts, type LogoTemplate } from '@/lib/logo/draw';
import { pickMedia } from '@/lib/pickMedia';

/**
 * Tạo logo Fanpage — port từ metus-few features/tools/logo. Vẽ 2 template (Alex/Prin)
 * bằng Skia thay Canvas2D của web. Không port xuất GIF viền cầu vồng xoay (gif.js
 * không có bản RN tương đương) — chỉ xuất PNG tĩnh. Icon tích xanh/camera của bản gốc
 * tải từ URL ngoài (1 là SVG, không decode được bằng ảnh bitmap) — thay bằng icon vẽ
 * trực tiếp để tool không phụ thuộc mạng/host ngoài.
 */

const FONT_ALPINE = require('../../../../assets/fonts/UTM_Alpine_KT.ttf');
const FONT_AVO = require('../../../../assets/fonts/UTM_Avo.ttf');
const FONT_AVO_BOLD_ITALIC = require('../../../../assets/fonts/UTM_Avo_Bold_Italic.ttf');
const FONT_AVO_ITALIC = require('../../../../assets/fonts/UTM_Avo_Italic.ttf');
const DEFAULT_AVATAR = require('../../../../assets/images/logo/print.jpg');
const THUMB_ALEX = require('../../../../assets/images/logo/alex.png');
const THUMB_PRIN = require('../../../../assets/images/logo/prin.png');
const CAMERA_ICON = require('../../../../assets/images/logo/camera-icon.png');

const TEMPLATES: { id: LogoTemplate; name: string; image: number }[] = [
  { id: 'alex', name: 'Alex', image: THUMB_ALEX },
  { id: 'prin', name: 'Prin', image: THUMB_PRIN },
];

function Runner() {
  const c = useColors();
  const t = useT();

  const [title, setTitle] = useState('Metus');
  const [subtitle, setSubtitle] = useState('Metus.vn');
  const [template, setTemplate] = useState<LogoTemplate>('prin');
  const [isVerified, setIsVerified] = useState(true);
  const [subtitleBg, setSubtitleBg] = useState(true);
  const [borderStyle, setBorderStyle] = useState<BorderStyle>('white');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const prinTitleFont = useFont(FONT_ALPINE, 48);
  const prinSubtitleFont = useFont(FONT_AVO, 28);
  const alexTitleBaseFont = useFont(FONT_AVO_BOLD_ITALIC, 48);
  const alexSubtitleBaseFont = useFont(FONT_AVO_ITALIC, 28);
  const avatarImage = useImage(avatarUri ? { uri: avatarUri } : DEFAULT_AVATAR);
  const cameraImage = useImage(CAMERA_ICON);

  const fonts: LogoFonts = useMemo(
    () => ({
      prinTitle: prinTitleFont,
      prinSubtitle: prinSubtitleFont,
      alexTitleTypeface: alexTitleBaseFont?.getTypeface() ?? null,
      alexSubtitleTypeface: alexSubtitleBaseFont?.getTypeface() ?? null,
    }),
    [prinTitleFont, prinSubtitleFont, alexTitleBaseFont, alexSubtitleBaseFont],
  );

  const previewBase64 = useMemo(() => {
    try {
      return renderLogoPngBase64(fonts, { template, title, subtitle, isVerified, subtitleBg, borderStyle, avatarImage, cameraImage, transparent: false });
    } catch {
      return null;
    }
  }, [fonts, avatarImage, cameraImage, template, title, subtitle, isVerified, subtitleBg, borderStyle]);

  const pickAvatar = async () => {
    const [a] = await pickMedia('image');
    if (a) setAvatarUri(a.uri);
  };

  const doExport = async () => {
    setExporting(true);
    try {
      await Api.createLogo({ title, subTitle: subtitle, logoType: borderStyle }).catch(() => {});
      const b64 = renderLogoPngBase64(fonts, { template, title, subtitle, isVerified, subtitleBg, borderStyle, avatarImage, cameraImage, transparent: true });
      if (!b64) return showDialog(t('logo.renderErr'));
      const SAF = FS.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) return;
      const uri = await SAF.createFileAsync(perm.directoryUri, `metus-logo-${Date.now()}.png`, 'image/png');
      await FS.writeAsStringAsync(uri, b64, { encoding: FS.EncodingType.Base64 });
      showDialog(t('gp.exported'));
    } catch (e) {
      showDialog(t('gp.exportErr'), describeError(e));
    } finally {
      setExporting(false);
    }
  };

  const confirmDownload = () => {
    showDialog(t('logo.confirmTitle'), t('logo.confirmMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('logo.downloadBtn'), onPress: doExport },
    ]);
  };

  return (
    <>
      <Card>
        <Label>{t('logo.templateLabel')}</Label>
        <Row>
          {TEMPLATES.map((tpl) => (
            <Pressable
              key={tpl.id}
              onPress={() => setTemplate(tpl.id)}
              style={{ flex: 1, borderRadius: radius.md, borderWidth: 2, borderColor: template === tpl.id ? c.accent : c.border, overflow: 'hidden' }}>
              <Image source={tpl.image} style={{ width: '100%', height: 70 }} contentFit="cover" />
              <Text style={{ textAlign: 'center', fontSize: 12, fontWeight: '700', color: template === tpl.id ? c.accent : c.muted, paddingVertical: 4 }}>{tpl.name}</Text>
            </Pressable>
          ))}
        </Row>

        <Label>{t('logo.titleLabel')}</Label>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('logo.titlePh')}
          placeholderTextColor={c.faint}
          style={{ borderRadius: radius.md, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input, color: c.text, fontSize: 14.5, paddingHorizontal: 14, paddingVertical: 10 }}
        />
        <Label>{t('logo.subtitleLabel')}</Label>
        <TextInput
          value={subtitle}
          onChangeText={setSubtitle}
          placeholder={t('logo.subtitlePh')}
          placeholderTextColor={c.faint}
          style={{ borderRadius: radius.md, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.input, color: c.text, fontSize: 14.5, paddingHorizontal: 14, paddingVertical: 10 }}
        />

        <Pressable onPress={pickAvatar} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.accentSoft }}>
          <Ionicons name="image-outline" size={16} color={c.accent} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: c.accent }}>{t('logo.pickAvatar')}</Text>
        </Pressable>

        {template === 'alex' ? (
          <View style={{ gap: 8 }}>
            <TickBox label={t('logo.isVerified')} value={isVerified} onBlocked={() => {}} onChange={setIsVerified} />
            <TickBox label={t('logo.subtitleBg')} value={subtitleBg} onBlocked={() => {}} onChange={setSubtitleBg} />
          </View>
        ) : (
          <>
            <Label>{t('logo.borderStyle')}</Label>
            <Segmented
              value={borderStyle}
              options={['white', 'solid', 'rainbow'] as const}
              onChange={setBorderStyle}
              labelFor={(v) => t(v === 'white' ? 'logo.border.white' : v === 'solid' ? 'logo.border.solid' : 'logo.border.rainbow')}
            />
          </>
        )}
      </Card>

      <Card>
        <Label>{t('logo.previewLabel')}</Label>
        <View style={{ width: '100%', aspectRatio: CANVAS_W / CANVAS_H, borderRadius: radius.md, overflow: 'hidden', backgroundColor: 'rgba(120,120,120,0.1)', borderWidth: 1, borderColor: c.border }}>
          {previewBase64 ? <Image source={{ uri: `data:image/png;base64,${previewBase64}` }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : null}
        </View>
        <Pressable
          disabled={exporting}
          onPress={confirmDownload}
          style={({ pressed }) => [{ backgroundColor: c.accent, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', opacity: pressed || exporting ? 0.7 : 1 }, shadow(c, 1)]}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{exporting ? t('logo.exporting') : t('logo.downloadBtn')}</Text>
        </Pressable>
      </Card>
    </>
  );
}

export default function LogoScreen() {
  return (
    <Screen>
      <Runner />
    </Screen>
  );
}
