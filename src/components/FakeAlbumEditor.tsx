import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState, type RefObject } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Body, Label, radius, shadow, useColors } from '@/components/ui';

/**
 * Editor "Đăng bài 1 ô (album giả)" — port từ metus-few post-a-card.
 * Ghép nhiều ảnh theo bố cục thành 1 ảnh trông như album Facebook (kèm "+9",
 * nút play giả, icon loa…). metus-few vẽ bằng canvas trình duyệt; ở đây dựng
 * bằng View/Image rồi chụp lại bằng react-native-view-shot.
 */
export type AlbumLayout =
  | 'RegularImage'
  | 'FakeVideoButton'
  | 'Top3Bottom2'
  | 'Left1Right3'
  | 'Left2Right2'
  | 'Left1Right1'
  | 'Top2Bottom3'
  | 'Top1Bottom3';

type Rect = [x: number, y: number, w: number, h: number]; // tỉ lệ 0..1 theo khung

interface LayoutSpec {
  label: string;
  /** Tỉ lệ khung ghép (rộng / cao). */
  ratio: number;
  /** Kích thước ảnh xuất (px) — giống canvas metus-few. */
  outWidth: number;
  rects: Rect[];
  /** Ô có lớp "+9". */
  plusNine?: number;
  /** Ô bo góc + icon loa (bố cục 1-1). */
  rounded?: boolean;
  speaker?: number;
  /** Nút play giả ở giữa. */
  playButton?: boolean;
}

const T = 1 / 3;
const LX = 0.025; // Left1Right1: lề ngang (theo chiều rộng)
const LY = 0.015; // lề dọc (0.01 * 1080/720)
const HALF = (1 - LX * 2 - 0.01) / 2;

export const ALBUM_LAYOUTS: Record<AlbumLayout, LayoutSpec> = {
  RegularImage: { label: 'Ảnh thường', ratio: 1, outWidth: 720, rects: [[0, 0, 1, 1]] },
  FakeVideoButton: { label: 'Nút play giả', ratio: 1, outWidth: 720, rects: [[0, 0, 1, 1]], playButton: true },
  Top3Bottom2: {
    label: '3 trên · 2 dưới', ratio: 1, outWidth: 720, plusNine: 4,
    rects: [[0, 0, T, T], [T, 0, T, T], [2 * T, 0, T, T], [0, T, 0.5, 2 * T], [0.5, T, 0.5, 2 * T]],
  },
  Left1Right3: {
    label: '1 trái · 3 phải', ratio: 1, outWidth: 720, plusNine: 3,
    rects: [[0, 0, 2 * T, 1], [2 * T, 0, T, T], [2 * T, T, T, T], [2 * T, 2 * T, T, T]],
  },
  Left2Right2: {
    label: '2 × 2', ratio: 1, outWidth: 720, plusNine: 3,
    rects: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  },
  Left1Right1: {
    label: '1 · 1 (có loa)', ratio: 1.5, outWidth: 1080, rounded: true, speaker: 1,
    rects: [[LX, LY, HALF, 1 - LY * 2], [LX + HALF + 0.01, LY, HALF, 1 - LY * 2]],
  },
  Top2Bottom3: {
    label: '2 trên · 3 dưới', ratio: 1, outWidth: 720, plusNine: 4,
    rects: [[0, 0, 0.5, 2 * T], [0.5, 0, 0.5, 2 * T], [0, 2 * T, T, T], [T, 2 * T, T, T], [2 * T, 2 * T, T, T]],
  },
  Top1Bottom3: {
    label: '1 trên · 3 dưới', ratio: 1, outWidth: 720, plusNine: 3,
    rects: [[0, 0, 1, 2 * T], [0, 2 * T, T, T], [T, 2 * T, T, T], [2 * T, 2 * T, T, T]],
  },
};

export const ALBUM_LAYOUT_ORDER: AlbumLayout[] = [
  'RegularImage', 'FakeVideoButton', 'Top3Bottom2', 'Left1Right3', 'Left2Right2', 'Left1Right1', 'Top2Bottom3', 'Top1Bottom3',
];

const PLAY_BTN = require('../../assets/images/playbtn.png');

/** Chụp khung ghép thành file jpg (đúng kích thước như canvas metus-few). */
export async function captureAlbum(ref: RefObject<View | null>, layout: AlbumLayout): Promise<string> {
  const spec = ALBUM_LAYOUTS[layout];
  return captureRef(ref, {
    format: 'jpg',
    quality: 0.92,
    result: 'tmpfile',
    width: spec.outWidth,
    height: Math.round(spec.outWidth / spec.ratio),
  });
}

/** Thứ tự trong lưới chọn bố cục (giống metus-few: 4 cột × 2 hàng). */
const PICKER_ORDER: AlbumLayout[] = [
  'Top3Bottom2', 'Left1Right3', 'Left2Right2', 'Left1Right1', 'Top2Bottom3', 'Top1Bottom3', 'FakeVideoButton', 'RegularImage',
];
const THUMB_CELL = '#BDBDBD';
const THUMB_ACTIVE = '#f97316';
const pct = (n: number) => `${n * 100}%` as const;

/** Hình thu nhỏ của bố cục (ô vuông, các ô xám cách nhau bằng khe trắng). */
function LayoutThumb({ layout, active, onPress }: { layout: AlbumLayout; active: boolean; onPress: () => void }) {
  const spec = ALBUM_LAYOUTS[layout];
  return (
    <Pressable onPress={onPress} style={{ width: '23.5%', aspectRatio: 1, padding: 3, borderWidth: 3, borderColor: active ? THUMB_ACTIVE : 'transparent', borderRadius: 4 }}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        {spec.rects.map(([x, y, w, h], i) => (
          <View key={i} style={{ position: 'absolute', left: pct(x), top: pct(y), width: pct(w), height: pct(h), padding: 1 }}>
            <View style={{ flex: 1, backgroundColor: THUMB_CELL, borderRadius: spec.rounded ? 4 : 0, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
              {spec.speaker === i ? (
                <View style={{ margin: 3, width: 14, height: 14, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="volume-mute" size={9} color="#fff" />
                </View>
              ) : null}
            </View>
          </View>
        ))}
        {spec.playButton ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: '30%', aspectRatio: 1, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="play" size={14} color="#fff" style={{ marginLeft: 2 }} />
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Chọn bố cục album (section riêng, nằm trên thư viện media). */
export function AlbumLayoutPicker({ layout, onChange }: { layout: AlbumLayout; onChange: (l: AlbumLayout) => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Label>Bố cục</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
        {PICKER_ORDER.map((l) => (
          <LayoutThumb key={l} layout={l} active={l === layout} onPress={() => onChange(l)} />
        ))}
      </View>
    </View>
  );
}

export function FakeAlbumEditor({
  layout, images, selectedSlot, onSelectSlot, onPickSlot, onRemoveSlot, captureViewRef, displayLink,
}: {
  layout: AlbumLayout;
  displayLink?: string;
  images: (string | null)[];
  selectedSlot: number;
  onSelectSlot: (i: number) => void;
  onPickSlot: (i: number) => void;
  onRemoveSlot: (i: number) => void;
  captureViewRef: RefObject<View | null>;
}) {
  const c = useColors();
  const spec = ALBUM_LAYOUTS[layout];
  const [boxW, setBoxW] = useState(0);
  const boxH = boxW / spec.ratio;
  const scale = boxW / spec.outWidth; // để cỡ chữ "+9", nút play khớp ảnh xuất
  // Ảnh vừa chọn cần 1 khoảng ngắn để giải mã — không theo dõi thì ô hiện
  // trắng trơn trông như lỗi. Theo dõi theo uri (không phải index) để không
  // "kẹt" trạng thái cũ khi đổi ảnh.
  const [pending, setPending] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});

  return (
    <View style={{ gap: 12 }}>
      {/* Khung thẻ có border (giống đăng 1 ô): ảnh ghép + footer link hiển thị */}
      <View style={[{ borderWidth: 1, borderColor: c.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.card }, shadow(c, 1)]}>
      {/* Khung ghép — đây là View được chụp thành ảnh đăng */}
      <View onLayout={(e) => setBoxW(e.nativeEvent.layout.width)} style={{ width: '100%' }}>
        {boxW > 0 ? (
          <View ref={captureViewRef} collapsable={false} style={{ width: boxW, height: boxH, backgroundColor: '#fff', overflow: 'hidden' }}>
            {spec.rects.map(([x, y, w, h], i) => {
              const uri = images[i];
              const selected = i === selectedSlot;
              const cellW = w * boxW;
              const cellH = h * boxH;
              return (
                <Pressable
                  key={i}
                  onPress={() => (uri ? onSelectSlot(i) : onPickSlot(i))}
                  onLongPress={() => uri && onRemoveSlot(i)}
                  style={{ position: 'absolute', left: x * boxW, top: y * boxH, width: cellW, height: cellH, borderRadius: spec.rounded ? boxW * 0.03 : 0, overflow: 'hidden' }}>
                  {uri ? (
                    <>
                      <Image
                        source={{ uri }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        onLoadStart={() => setPending((p) => ({ ...p, [uri]: true }))}
                        onLoad={() => {
                          setPending((p) => { const { [uri]: _drop, ...rest } = p; return rest; });
                          setFailed((f) => { const { [uri]: _drop, ...rest } = f; return rest; });
                        }}
                        onError={() => {
                          setPending((p) => { const { [uri]: _drop, ...rest } = p; return rest; });
                          setFailed((f) => ({ ...f, [uri]: true }));
                        }}
                      />
                      {pending[uri] && !failed[uri] ? (
                        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' }}>
                          <ActivityIndicator color={c.accent} />
                        </View>
                      ) : null}
                      {failed[uri] ? (
                        <Pressable
                          onPress={() => setFailed((f) => { const { [uri]: _drop, ...rest } = f; return rest; })}
                          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <Ionicons name="refresh-circle" size={Math.max(18, Math.min(cellW, cellH) * 0.18)} color={c.danger} />
                          <Text style={{ color: c.danger, fontSize: 10, fontWeight: '700' }}>Lỗi tải ảnh · bấm để thử lại</Text>
                        </Pressable>
                      ) : null}
                    </>
                  ) : (
                    <View style={{ flex: 1, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#fff' }}>
                      <Ionicons name="add-circle" size={Math.max(20, Math.min(cellW, cellH) * 0.22)} color={c.accent} />
                      <Text style={{ color: c.accent, fontSize: 11, fontWeight: '700', marginTop: 2 }}>Ảnh {i + 1}</Text>
                    </View>
                  )}
                  {spec.plusNine === i && uri ? (
                    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 60 * scale }}>+9</Text>
                    </View>
                  ) : null}
                  {spec.speaker === i && uri ? (
                    <View style={{ position: 'absolute', right: Math.min(cellW, cellH) * 0.03, bottom: Math.min(cellW, cellH) * 0.03, width: Math.min(cellW, cellH) * 0.16, height: Math.min(cellW, cellH) * 0.16, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="volume-mute" size={Math.min(cellW, cellH) * 0.09} color="#fff" />
                    </View>
                  ) : null}
                  {selected && uri ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 3, borderColor: c.accent }} /> : null}
                </Pressable>
              );
            })}
            {spec.playButton && images[0] ? (
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <Image source={PLAY_BTN} style={{ width: boxW * 0.19, height: boxW * 0.19 }} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {displayLink ? (
        <View style={{ padding: 12, borderTopWidth: 1, borderColor: c.border }}>
          <Body muted size={12} numberOfLines={1}>{displayLink}</Body>
        </View>
      ) : null}
      </View>
      <Body muted size={12}>Bấm ô trống để chọn ảnh · bấm ảnh để chọn ô (gán từ thư viện) · giữ lâu để xóa.</Body>
    </View>
  );
}
