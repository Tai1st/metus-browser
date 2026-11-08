// Vẽ "Tạo logo Fanpage" — port từ metus-few features/tools/logo (renderers/PrinRenderer.ts
// + AlexRenderer.ts). Dùng Skia (SkCanvas) thay Canvas2D của web — các lệnh vẽ gần như
// 1:1 (drawCircle/drawRect/drawImageRect/clipPath/drawText/drawArc). Không port tính năng
// xuất GIF viền cầu vồng xoay (gif.js không có bản RN tương đương) — viền cầu vồng vẫn vẽ
// được nhưng luôn ở góc cố định (angle=0), chỉ xuất PNG tĩnh.
import { BlurStyle, ClipOp, Skia, type SkCanvas, type SkFont, type SkImage, type SkTypeface } from '@shopify/react-native-skia';

export type BorderStyle = 'white' | 'solid' | 'rainbow';
export type LogoTemplate = 'alex' | 'prin';

export const CANVAS_W = 1200;
export const CANVAS_H = 500;

export interface LogoFonts {
  prinTitle: SkFont | null;
  prinSubtitle: SkFont | null;
  alexTitleTypeface: SkTypeface | null;
  alexSubtitleTypeface: SkTypeface | null;
}

export interface LogoDrawParams {
  template: LogoTemplate;
  title: string;
  subtitle: string;
  isVerified: boolean;
  subtitleBg: boolean;
  borderStyle: BorderStyle;
  avatarImage: SkImage | null;
  /** Icon camera gốc (i.ibb.co/3yXrnNBs), asset PNG nền trong suốt. */
  cameraImage: SkImage | null;
  /** true = nền trong suốt (xuất file); false = nền trắng (xem trước trong app, giống mode 'preview' của bản gốc). */
  transparent: boolean;
}

// Icon tích xanh gốc (wikipedia Twitter_Verified_Badge.svg) — dùng đúng SVG gốc qua
// Skia.SVG.MakeFromString, không vẽ tay. Dấu check là phần khoét trong path (không fill
// riêng), hiện ra nền phía sau — giống đúng hành vi bản gốc trên web.
const VERIFIED_SVG_SRC =
  '<svg viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" fill="#1d9bf0"></path></svg>';
let verifiedSvg: ReturnType<typeof Skia.SVG.MakeFromString> | null = null;
function getVerifiedSvg() {
  if (!verifiedSvg) verifiedSvg = Skia.SVG.MakeFromString(VERIFIED_SVG_SRC);
  return verifiedSvg;
}

function drawVerifiedBadge(canvas: SkCanvas, cx: number, cy: number, size: number) {
  const svg = getVerifiedSvg();
  if (!svg) return;
  canvas.save();
  canvas.translate(cx - size / 2, cy - size / 2);
  canvas.drawSvg(svg, size, size);
  canvas.restore();
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Baseline Y để textBaseline='middle' của Canvas2D (căn giữa dòng chữ theo trục đứng ở centerY). */
function middleBaseline(font: SkFont, centerY: number): number {
  const { ascent, descent } = font.getMetrics();
  return centerY - (ascent + descent) / 2;
}
/** Baseline Y để textBaseline='top' của Canvas2D (mép trên chữ ở topY). */
function topBaseline(font: SkFont, topY: number): number {
  return topY - font.getMetrics().ascent;
}

function drawImageFill(canvas: SkCanvas, img: SkImage, x: number, y: number, w: number, h: number) {
  const src = Skia.XYWHRect(0, 0, img.width(), img.height());
  const dest = Skia.XYWHRect(x, y, w, h);
  canvas.drawImageRect(img, src, dest, Skia.Paint());
}

function drawRainbowWheel(canvas: SkCanvas, cx: number, cy: number, r: number) {
  const segs = 180;
  const oval = Skia.XYWHRect(cx - r, cy - r, r * 2, r * 2);
  for (let i = 0; i < segs; i++) {
    const hue = (i / segs) * 360;
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(hslToHex(hue, 100, 50)));
    canvas.drawArc(oval, (i / segs) * 360, 360 / segs + 0.5, true, paint);
  }
}

function renderPrin(canvas: SkCanvas, fonts: LogoFonts, p: LogoDrawParams) {
  canvas.clear(Skia.Color('#00000000'));
  // Luôn vẽ nền trong suốt (không fill trắng) — lớp phủ xám khi xem trước chỉ
  // là 1 View bọc ngoài ở UI, không "bake" vào ảnh, để khớp với ảnh PNG xuất ra.
  const titleFont = fonts.prinTitle;
  const subtitleFont = fonts.prinSubtitle;
  if (!titleFont || !subtitleFont) return;

  const cy = CANVAS_H / 2;
  const avatarSize = 180;
  const gap = 20;
  const padX = 30;
  const padY = 15;
  const titleSz = 48;

  const wtxt = titleFont.measureText(p.title || ' ').width;
  const rectW = wtxt + padX * 2;
  const rectH = titleSz + padY * 2;
  const totalW = avatarSize + gap + rectW;
  const sx = (CANVAS_W - totalW) / 2;
  const ax = sx;
  const rx = ax + avatarSize + gap;
  const ry = cy - 60;
  const acx = ax + avatarSize / 2;
  const borderThickness = 8;
  const ar = (avatarSize + borderThickness) / 2;

  // Viền
  if (p.borderStyle === 'rainbow') {
    drawRainbowWheel(canvas, acx, cy, ar);
  } else {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(p.borderStyle === 'solid' ? '#00f0ff' : '#ffffff'));
    if (!p.transparent) paint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 7, true));
    canvas.drawCircle(acx, cy, ar, paint);
  }

  // Avatar (clip tròn)
  canvas.save();
  const circlePath = Skia.Path.Make();
  circlePath.addCircle(acx, cy, avatarSize / 2);
  canvas.clipPath(circlePath, ClipOp.Intersect, true);
  if (p.avatarImage) {
    drawImageFill(canvas, p.avatarImage, ax, cy - avatarSize / 2, avatarSize, avatarSize);
  } else {
    const ph = Skia.Paint();
    ph.setColor(Skia.Color('#dddddd'));
    canvas.drawRect(Skia.XYWHRect(ax, cy - avatarSize / 2, avatarSize, avatarSize), ph);
  }
  canvas.restore();

  // Khung chữ (rounded rect)
  const pillPaint = Skia.Paint();
  pillPaint.setColor(Skia.Color('#221F1F'));
  if (!p.transparent) pillPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, true));
  const rrect = Skia.RRectXY(Skia.XYWHRect(rx, ry, rectW, rectH), 40, 40);
  canvas.drawRRect(rrect, pillPaint);

  const textPaint = Skia.Paint();
  textPaint.setAntiAlias(true);
  textPaint.setColor(Skia.Color('#ffffff'));
  canvas.drawText(p.title, rx + padX, middleBaseline(titleFont, ry + rectH / 2), textPaint, titleFont);

  // Phụ đề nằm ngoài khung (không có nền tối đỡ) — thêm đổ bóng để dễ đọc.
  const subtitleShadow = Skia.Paint();
  subtitleShadow.setAntiAlias(true);
  subtitleShadow.setColor(Skia.Color('rgba(0,0,0,0.5)'));
  const subBaseline = middleBaseline(subtitleFont, ry + rectH + 40);
  canvas.drawText(p.subtitle, rx + 10 + 1.5, subBaseline + 1.5, subtitleShadow, subtitleFont);
  canvas.drawText(p.subtitle, rx + 10, subBaseline, textPaint, subtitleFont);
}

function renderAlex(canvas: SkCanvas, fonts: LogoFonts, p: LogoDrawParams) {
  canvas.clear(Skia.Color('#00000000'));
  const titleTypeface = fonts.alexTitleTypeface;
  const subtitleTypeface = fonts.alexSubtitleTypeface;
  if (!titleTypeface || !subtitleTypeface) return;

  const maxAvatarSize = 350;
  let scale = 0.5;
  const avImg = p.avatarImage;
  const ratio = avImg ? avImg.width() / avImg.height() : 1;
  const baseW = ratio > 1 ? maxAvatarSize : maxAvatarSize * ratio;
  const baseH = ratio > 1 ? maxAvatarSize / ratio : maxAvatarSize;
  const gapBase = 20;

  const measureAt = (s: number) => {
    const titleFont = Skia.Font(titleTypeface, 180 * s);
    const titleWidth = titleFont.measureText(p.title || ' ').width;
    const verifiedWidth = p.isVerified ? 100 * s + 10 * s : 0;
    const gap = gapBase * s;
    const drawWidth = baseW * s;
    const drawHeight = baseH * s;
    const totalWidth = drawWidth + gap + titleWidth + verifiedWidth;
    return { titleFont, titleWidth, verifiedWidth, gap, drawWidth, drawHeight, totalWidth };
  };

  let m = measureAt(scale);
  const maxWidth = CANVAS_W * 0.9;
  if (m.totalWidth > maxWidth) {
    scale = maxWidth / m.totalWidth;
    m = measureAt(scale);
  }

  const startX = (CANVAS_W - m.totalWidth) / 2;
  const avatarX = startX;
  const extraGap = 50 * scale;
  const textX = avatarX + m.drawWidth + gapBase * scale + extraGap;
  const avatarY = (CANVAS_H - m.drawHeight) / 2;
  const textY = avatarY + m.drawHeight / 2 - (180 * scale) / 1.3 - 35 * scale;

  if (avImg) drawImageFill(canvas, avImg, avatarX, avatarY, m.drawWidth, m.drawHeight);
  if (p.cameraImage) {
    const cameraSize = 150 * scale;
    drawImageFill(canvas, p.cameraImage, avatarX + m.drawWidth - cameraSize - 5 * scale, avatarY + m.drawHeight - cameraSize * scale - 30, cameraSize, cameraSize);
  }

  // Bóng đổ chữ (giả lập shadow offset của Canvas2D bằng 1 lớp chữ đen mờ vẽ trước).
  const shadowPaint = Skia.Paint();
  shadowPaint.setAntiAlias(true);
  shadowPaint.setColor(Skia.Color('rgba(0,0,0,0.5)'));
  const whitePaint = Skia.Paint();
  whitePaint.setAntiAlias(true);
  whitePaint.setColor(Skia.Color('#ffffff'));

  const titleBaseline = topBaseline(m.titleFont, textY);
  canvas.drawText(p.title, textX + 2 * scale, titleBaseline + 2 * scale, shadowPaint, m.titleFont);
  canvas.drawText(p.title, textX, titleBaseline, whitePaint, m.titleFont);

  if (p.isVerified) {
    const badgeSize = 100 * scale;
    drawVerifiedBadge(canvas, textX + m.titleWidth + 70 * scale + badgeSize / 2, textY + 25 * scale + badgeSize / 2, badgeSize);
  }

  const subtitleFont = Skia.Font(subtitleTypeface, 70 * scale);
  const paddingX = 10 * scale;
  const paddingY = 5 * scale;
  const subtitleX = textX + (m.titleWidth / 5) * scale;
  const subtitleWidth = subtitleFont.measureText(p.subtitle || ' ').width;
  const subtitleHeight = 70 * scale * 1.3;
  // Mép dưới khung phụ đề canh thẳng hàng với mép dưới avatar.
  const subtitleY = avatarY + m.drawHeight - subtitleHeight / 2 - paddingY;
  if (p.subtitleBg) {
    const bgPaint = Skia.Paint();
    bgPaint.setColor(Skia.Color('rgba(0,0,0,0.7)'));
    canvas.drawRect(
      Skia.XYWHRect(subtitleX - paddingX, subtitleY - subtitleHeight / 2 - paddingY, subtitleWidth + paddingX * 2, subtitleHeight + paddingY * 2),
      bgPaint,
    );
  }
  canvas.drawText(p.subtitle, subtitleX + 2 * scale, middleBaseline(subtitleFont, subtitleY) + 2 * scale, shadowPaint, subtitleFont);
  canvas.drawText(p.subtitle, subtitleX, middleBaseline(subtitleFont, subtitleY), whitePaint, subtitleFont);
}

export function renderLogo(canvas: SkCanvas, fonts: LogoFonts, params: LogoDrawParams) {
  if (params.template === 'alex') renderAlex(canvas, fonts, params);
  else renderPrin(canvas, fonts, params);
}

/** Vẽ ra surface offscreen rồi encode PNG base64 (dùng cho cả preview và xuất file). */
export function renderLogoPngBase64(fonts: LogoFonts, params: LogoDrawParams): string | null {
  const surface = Skia.Surface.Make(CANVAS_W, CANVAS_H);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  renderLogo(canvas, fonts, params);
  surface.flush();
  const image = surface.makeImageSnapshot();
  return image.encodeToBase64();
}
