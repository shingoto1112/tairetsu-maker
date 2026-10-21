/** Viewer-font ("device") text: kana, kanji and full-width symbols are written with a NON-embedded
 * Adobe-Japan1 CID font (/Encoding /UniJIS-UTF16-H) so the receiving device draws them with its own
 * Japanese gothic (iPhone/iPad: Hiragino, Android: Noto Sans CJK, PC: Yu/MS Gothic). Everything else
 * (ASCII, Latin, ambiguous punctuation) stays in the embedded BIZ UDPGothic subset, and characters the
 * BIZ font cannot draw stay grapheme images, exactly as before.
 *
 * Layout is unchanged: substitute fonts draw these glyphs one em (or half an em) wide, while the layout
 * uses BIZ UDPGothic's proportional advances. Each glyph's em box is therefore placed INSIDE its BIZ
 * advance with TJ adjustments: centred by default, right-aligned for opening brackets (their ink sits in
 * the right half of a full-width glyph) and left-aligned for closing brackets and 、。，．.
 * Measured on Chrome/PDFium, Edge (Acrobat engine), Android Drive and iPhone/iPad (2026-10-21). */
import type { DEVICE_GLYPH_COUNTS } from "./deviceGlyphs.generated";

/** Resource name of the viewer font in every page's /Font dictionary (jsPDF uses F1, F2, …). */
export const DEVICE_FONT_RESOURCE = "DJ0";
/** Pseudo-bold: fill + stroke (Tr 2) with this line width per em. Viewers do not pick a bold face by name. */
export const DEVICE_BOLD_STROKE_EM = 0.03;

export type DeviceGlyphTable = { wide: Uint32Array; symbol: Uint32Array; half: Uint32Array; counts: typeof DEVICE_GLYPH_COUNTS };
/** Range lists are "gap.length" pairs in base 36; decoded to [start, end, start, end, …]. */
export function decodeRanges(encoded: string): Uint32Array {
  const parts = encoded ? encoded.split(",") : [], out = new Uint32Array(parts.length * 2);
  let previous = 0;
  parts.forEach((part, i) => {
    const [gap, length] = part.split(".").map(s => parseInt(s, 36));
    const start = previous + gap, end = start + length;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end > 0xffff || (i && start <= previous))
      throw new Error("端末字体の文字表が壊れています。");
    out[i * 2] = start; out[i * 2 + 1] = end; previous = end;
  });
  return out;
}
let loading: Promise<DeviceGlyphTable> | undefined;
/** Loaded on demand (PDF export only). A failed load is retryable. */
export function loadDeviceGlyphTable(): Promise<DeviceGlyphTable> {
  loading ??= import("./deviceGlyphs.generated").then(m => {
    const table = { wide: decodeRanges(m.DEVICE_WIDE), symbol: decodeRanges(m.DEVICE_SYMBOL), half: decodeRanges(m.DEVICE_HALF), counts: m.DEVICE_GLYPH_COUNTS };
    const total = (r: Uint32Array) => { let n = 0; for (let i = 0; i < r.length; i += 2) n += r[i + 1] - r[i] + 1; return n; };
    if (total(table.wide) !== table.counts.wide || total(table.symbol) !== table.counts.symbol || total(table.half) !== table.counts.half)
      throw new Error("端末字体の文字表の件数が一致しません。");
    return table;
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}
const contains = (ranges: Uint32Array, code: number) => {
  let lo = 0, hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (code < ranges[mid * 2]) hi = mid - 1; else if (code > ranges[mid * 2 + 1]) lo = mid + 1; else return true;
  }
  return false;
};

const OPENING = new Set([..."「『（【〔〈《｛［〘〖〝｟"].map(c => c.charCodeAt(0)));
const CLOSING = new Set([..."」』）】〕〉》｝］〙〗〟｠、。，．"].map(c => c.charCodeAt(0)));
/** em: the substitute glyph's width (1000 = one em). align: where its em box sits in the BIZ advance. */
export type DeviceGlyph = { em: 1000 | 500; align: "start" | "center" | "end" };
/** advance: the BIZ UDPGothic advance of this character in thousandths of an em (same weight). */
export function deviceGlyph(table: DeviceGlyphTable, code: number, advance: number): DeviceGlyph | undefined {
  if (!Number.isFinite(advance) || advance <= 0) return undefined;
  if (contains(table.wide, code)) return { em: 1000, align: OPENING.has(code) ? "end" : CLOSING.has(code) ? "start" : "center" };
  // East Asian "ambiguous" symbols: some fonts draw them narrower. Only when BIZ itself uses a full em,
  // so no placement correction depends on the substitute glyph's width.
  if (contains(table.symbol, code)) return Math.abs(advance - 1000) < 0.5 ? { em: 1000, align: "center" } : undefined;
  if (contains(table.half, code)) return { em: 500, align: "center" };
  return undefined;
}

export type DeviceRun = { text: string; device: boolean; start: number; advance: number };
/** Splits one vector text line into consecutive device / embedded runs. start/advance in thousandths of an em. */
export function planDeviceRuns(table: DeviceGlyphTable, text: string, advanceOf: (code: number) => number): DeviceRun[] {
  const runs: DeviceRun[] = [];
  let position = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!, advance = advanceOf(code);
    if (code > 0xffff || !(advance >= 0)) throw new Error("端末字体の文字列に未対応の文字があります。");
    const device = !!deviceGlyph(table, code, advance), last = runs[runs.length - 1];
    if (last && last.device === device) { last.text += ch; last.advance += advance; }
    else runs.push({ text: ch, device, start: position, advance });
    position += advance;
  }
  return runs;
}

const hex = (code: number) => code.toString(16).toUpperCase().padStart(4, "0");
const tenth = (n: number) => { const text = (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ""); return text === "-0" ? "0" : text; };
/** TJ operand that places each substitute glyph's em box inside its BIZ advance.
 * lead: how far (thousandths of an em) the first em box starts LEFT of the run's start.
 * Adjustments are rounded to 0.1/1000 em against the exact cumulative position (no drift). */
export function deviceTjArray(table: DeviceGlyphTable, text: string, advanceOf: (code: number) => number) {
  let lead = 0, exact = 0, written = 0, hexRun = "";
  const items: string[] = [];
  let pendingAfter = 0;
  [...text].forEach((ch, i) => {
    const code = ch.codePointAt(0)!, advance = advanceOf(code), glyph = deviceGlyph(table, code, advance);
    if (!glyph || code > 0xffff) throw new Error("端末字体で描けない文字が混ざっています。");
    const extra = glyph.em - advance;
    const before = glyph.align === "end" ? extra : glyph.align === "start" ? 0 : extra / 2;
    if (i === 0) lead = before;
    else {
      // TJ numbers are subtracted from the pen position: positive moves left.
      exact += pendingAfter + before;
      const step = Number(tenth(exact - written));
      if (step !== 0) { items.push(`<${hexRun}>`, tenth(step)); written += step; hexRun = ""; }
    }
    hexRun += hex(code);
    pendingAfter = extra - before;
  });
  items.push(`<${hexRun}>`);
  return { lead, operand: `[${items.join(" ")}]` };
}
