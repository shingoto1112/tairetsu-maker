import { checkAbort, FONT_FAMILY } from "./fonts";
import { CSS_PX_MM, UnsupportedVectorLayout, type Drawing, type TextLine } from "./model";

export const GRAPHEME_IMAGE_LIMITS = { side: 1024, pixels: 4_000_000, types: 256, dpi: 384 } as const;
export type GlyphBitmap = { dataUrl: string; width: number; height: number; left: number; top: number; pixels: number };
export type GlyphRasterizer = (text: string, line: TextLine, pixelsPerMm: number) => GlyphBitmap;
export const glyphImageKey = (text: string, line: TextLine, resolution: number) =>
  JSON.stringify([text, FONT_FAMILY, line.weight, line.size, line.color, resolution]);
/** Same grapheme and style, independent of the page it is drawn on. */
const glyphStyleKey = (text: string, line: TextLine) => JSON.stringify([text, FONT_FAMILY, line.weight, line.size, line.color]);
/** Pixels per layout millimetre needed on a page whose final A4 fit is `finalScale`. */
const rasterUnit = (finalScale: number) => Math.ceil(finalScale * GRAPHEME_IMAGE_LIMITS.dpi / 25.4 * 4) / 4;

/** Canvas metrics describe ink/overhang only. DOM owns advance and alignment. */
export const rasterizeGrapheme: GlyphRasterizer = (text, line, unit) => {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new UnsupportedVectorLayout("代替文字画像のCanvasを作成できません。");
  const font = `${line.weight} ${line.size / CSS_PX_MM}px "${FONT_FAMILY}"`;
  ctx.font = font; ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text), pad = Math.max(.2, line.size * .12);
  const left = -m.actualBoundingBoxLeft * CSS_PX_MM - pad, top = -m.actualBoundingBoxAscent * CSS_PX_MM - pad;
  const width = Math.ceil((m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * CSS_PX_MM * unit + pad * 2 * unit);
  const height = Math.ceil((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * CSS_PX_MM * unit + pad * 2 * unit);
  if (!(width > 0 && height > 0 && Number.isFinite(left + top + width + height)) ||
    Math.max(width, height) > GRAPHEME_IMAGE_LIMITS.side || width * height > GRAPHEME_IMAGE_LIMITS.pixels)
    throw new UnsupportedVectorLayout("代替文字画像が寸法上限を超えました。");
  canvas.width = width; canvas.height = height;
  try {
    const paint = (value: string) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
      ctx.scale(unit * CSS_PX_MM, unit * CSS_PX_MM);
      ctx.font = font; ctx.textBaseline = "alphabetic"; ctx.fillStyle = line.color;
      ctx.fillText(value, -left / CSS_PX_MM, -top / CSS_PX_MM);
      return ctx.getImageData(0, 0, width, height).data;
    };
    const ink = paint(text);
    if (!ink.some((value, i) => i % 4 === 3 && value)) throw new UnsupportedVectorLayout("代替文字画像が空です。");
    // Best-effort tofu detection. Browser APIs expose no portable glyph-coverage
    // query for system fallback fonts; compare both common missing-glyph sentinels.
    for (const missing of ["\u{10ffff}", "\ufffd"]) {
      const tofu = paint(missing);
      if (ink.every((value, i) => value === tofu[i])) throw new UnsupportedVectorLayout("端末フォントでも文字を表示できません。");
    }
    paint(text);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,")) throw new UnsupportedVectorLayout("代替文字PNGの作成に失敗しました。");
    return { dataUrl, left, top, width: width / unit, height: height / unit, pixels: width * height };
  } finally { canvas.width = 0; canvas.height = 0; }
};

export function createGraphemeImageCache(rasterize: GlyphRasterizer = rasterizeGrapheme) {
  const cache = new Map<string, GlyphBitmap & { alias: string }>();
  // Pages are fitted to A4 with different scales (parade crops especially). Without a plan the
  // same emoji was rasterised once per page scale; planned uses share the largest resolution.
  const planned = new Map<string, number>();
  const metrics = { imageTypes: 0, imageUses: 0, cacheHits: 0, pixels: 0 };
  return { metrics,
    /** Record a future use so every page reuses one bitmap at the highest resolution it needs. */
    plan(text: string, line: TextLine, finalScale: number) {
      const key = glyphStyleKey(text, line);
      planned.set(key, Math.max(planned.get(key) ?? 0, rasterUnit(finalScale)));
    },
    image(text: string, line: TextLine, finalScale: number, x: number, baseline: number, signal?: AbortSignal): Drawing {
      checkAbort(signal);
      const unit = planned.get(glyphStyleKey(text, line)) ?? rasterUnit(finalScale);
      const key = glyphImageKey(text, line, unit);
      let bitmap = cache.get(key);
      if (bitmap) metrics.cacheHits++;
      else {
        if (cache.size >= GRAPHEME_IMAGE_LIMITS.types) throw new UnsupportedVectorLayout("代替文字画像の種類数上限を超えました。");
        const made = rasterize(text, line, unit);
        checkAbort(signal);
        if (!(made.pixels > 0 && made.width > 0 && made.height > 0) || !Number.isFinite(made.left + made.top + made.pixels + made.width + made.height) ||
          Math.max(made.width * unit, made.height * unit) > GRAPHEME_IMAGE_LIMITS.side || metrics.pixels + made.pixels > GRAPHEME_IMAGE_LIMITS.pixels)
          throw new UnsupportedVectorLayout("代替文字画像の総画素数上限を超えました。");
        bitmap = { ...made, alias: `vector-grapheme-${cache.size + 1}` }; cache.set(key, bitmap);
        metrics.pixels += made.pixels; metrics.imageTypes = cache.size;
      }
      metrics.imageUses++;
      return { kind: "image", dataUrl: bitmap.dataUrl, cacheKey: bitmap.alias,
        x: x + bitmap.left, y: baseline + bitmap.top, width: bitmap.width, height: bitmap.height };
    } };
}
