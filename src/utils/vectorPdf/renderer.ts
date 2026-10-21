import { jsPDF } from "jspdf";
import { fitPdfImage, a4PageSize } from "../pdfPageLayout";
import { cachedFontBytes, checkAbort, fetchFontBytes, fontFileName, FONT_FAMILY, fontWeight, parsedFont, registerFonts, requiredFontWeights, unsupportedCharacters, type FontBytesReader, type FontWeight } from "./fonts";
import { CSS_PX_MM, visibleTextLines, type Drawing, type Rect, type ScenePage } from "./model";
import { planTextRuns, type FontCoverage } from "./textRuns";
import { createGraphemeImageCache, type GlyphRasterizer } from "./graphemeImages";
import type { PrintOrientation } from "../printLayout";
import { sourceTrueType, validateSubset } from "./trueType";
import { tidyPdfContent } from "./contentTidy";
import { packObjectStreams } from "./objectStreams";
import { DEVICE_BOLD_STROKE_EM, DEVICE_FONT_RESOURCE, deviceTjArray, loadDeviceGlyphTable, planDeviceRuns, type DeviceGlyphTable } from "./deviceFont";
import { attachDeviceFont } from "./deviceFontPdf";

export async function prepareTextDrawings(source: jsPDF | FontCoverage, pages: ScenePage[], options: { signal?: AbortSignal; rasterize?: GlyphRasterizer; orientation?: PrintOrientation } = {}) {
  const cache = createGraphemeImageCache(options.rasterize);
  let visited = 0;
  async function prepare(nodes: Drawing[], scale: number): Promise<Drawing[]> {
    const result: Drawing[] = [];
    for (const node of nodes) {
      checkAbort(options.signal);
      if (++visited % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (node.kind === "group") result.push({ ...node, children: await prepare(node.children, scale) });
      else if (node.kind !== "text" || !node.text) result.push(node);
      else {
        const runs = planTextRuns(source, node);
        if (!runs.some(r => r.raster)) { result.push(node); continue; }
        const placements = node.measureMixed?.();
        if (!placements || placements.map(p => p.text).join("") !== node.text)
          throw new Error("代替文字のDOM配置を安全に計測できません。");
        let offset = 0;
        const positions = placements.map(p => { const start = offset; offset += p.text.length; return { ...p, start }; });
        for (const run of runs) {
          const first = positions.find(p => p.start === run.start);
          if (!first || !Number.isFinite(first.x + first.baseline + first.advance)) throw new Error("代替文字の配置が不正です。");
          if (run.raster) {
            result.push(cache.image(run.text, node, scale, first.x, first.baseline, options.signal));
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          } else result.push({ ...node, text: run.text, x: first.x, y: first.baseline, align: "left", baselineOffset: 0, measureMixed: undefined });
        }
      }
    }
    return result;
  }
  const finalScale = (page: ScenePage) => {
    const width = Math.ceil(page.width / CSS_PX_MM - 1e-7) * CSS_PX_MM;
    const height = Math.ceil(page.height / CSS_PX_MM - 1e-7) * CSS_PX_MM;
    const a4 = a4PageSize(options.orientation ?? "landscape"), fit = fitPdfImage(width, height, a4.width, a4.height);
    return fit.width / width * 25.4 / 72;
  };
  // First pass: register every image-drawn grapheme with its page scale, so one bitmap per
  // grapheme/style serves all pages (previously one per distinct page scale).
  const plan = (nodes: Drawing[], scale: number) => {
    for (const node of nodes) {
      if (node.kind === "group") plan(node.children, scale);
      else if (node.kind === "text" && node.text)
        for (const run of planTextRuns(source, node)) if (run.raster) cache.plan(run.text, node, scale);
    }
  };
  for (const page of pages) plan(page.drawings, finalScale(page));
  const prepared: ScenePage[] = [];
  for (const page of pages) prepared.push({ ...page, drawings: await prepare(page.drawings, finalScale(page)) });
  return { pages: prepared, metrics: cache.metrics };
}

function path(pdf: jsPDF, r: Rect, style: "F" | "S" | null) {
  const radius = r.radius ?? 0;
  // A rounded square whose radius reaches half its side IS a circle. roundedRect emits the same four
  // Béziers plus four zero-length lines; circle() omits them (members are most of the drawing).
  // Capsules (unequal sides) keep roundedRect so their shape is unchanged.
  if (radius > 0 && Math.abs(r.width - r.height) < 1e-9 && radius >= r.width / 2)
    pdf.circle(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, style);
  else if (radius > 0) pdf.roundedRect(r.x, r.y, r.width, r.height, radius, radius, style);
  else pdf.rect(r.x, r.y, r.width, r.height, style);
}

/** PDF viewers may widen thin strokes to one device pixel. Filled outlines keep
 * the CSS width when a long parade is shrunk onto one A4 page. */
/** Sets fill/stroke alpha only when it differs from the node's current state. Every node is drawn
 * inside its own q/Q and no group ever changes alpha, so each node starts fully opaque; writing
 * "opacity 1" again (most fills and lines) is redundant. Inside shared forms no state is written. */
type AlphaSetter = (state: { opacity?: number; "stroke-opacity"?: number }) => void;
function alphaSetter(pdf: jsPDF, inForm: boolean): AlphaSetter {
  let fill = 1, stroke = 1;
  return state => {
    if (inForm) return;
    const nextFill = state.opacity ?? fill, nextStroke = state["stroke-opacity"] ?? stroke;
    if (nextFill === fill && nextStroke === stroke) return;
    pdf.setGState(pdf.GState(state)); fill = nextFill; stroke = nextStroke;
  };
}

function filledLine(pdf: jsPDF, d: Extract<Drawing, { kind: "line" }>, setAlpha: AlphaSetter) {
  const dx = d.x2 - d.x1, dy = d.y2 - d.y1, length = Math.hypot(dx, dy);
  if (!length) return;
  const ux = dx / length, uy = dy / length, half = d.width / 2;
  const segment = (start: number, end: number) => {
    const cap = d.square ? half : 0;
    const x = d.x1 + ux * (start - cap), y = d.y1 + uy * (start - cap);
    const ex = d.x1 + ux * (end + cap), ey = d.y1 + uy * (end + cap);
    pdf.path([{ op: "m", c: [x - uy * half, y + ux * half] },
      { op: "l", c: [ex - uy * half, ey + ux * half] },
      { op: "l", c: [ex + uy * half, ey - ux * half] },
      { op: "l", c: [x + uy * half, y - ux * half] }, { op: "h", c: [] }]).fill();
  };
  pdf.setFillColor(d.color); setAlpha({ opacity: d.opacity ?? 1 });
  if (!d.dash?.length) segment(0, length);
  else {
    const cycle = d.dash.reduce((n, v) => n + v, 0);
    if (!(cycle > 0) || length / cycle > 100_000) throw new Error("注釈の破線が安全描画量を超えています。");
    for (let start = 0; start < length; start += cycle) {
      let offset = start;
      for (let i = 0; i < d.dash.length && offset < length; i++) {
        if (i % 2 === 0) segment(offset, Math.min(offset + d.dash[i], length));
        offset += d.dash[i];
      }
    }
  }
}

/** Groups drawn more than once with identical content are written once as a PDF Form XObject.
 * Only opaque shapes/lines qualify: the form then needs no resources of its own (jsPDF 4.2.1 does not
 * write /Resources for forms) and inherits colour state from the caller exactly like inline drawing. */
export type SharedDrawings = { counts: Map<string, number>; defined: Set<string> };
type Group = Extract<Drawing, { kind: "group" }>;
const shareable = (d: Group) => !!d.reuse && d.x === 0 && d.y === 0 && d.rotation === 0 && !d.clip && d.children.every(c =>
  (c.kind === "line" && (c.opacity ?? 1) === 1) || (c.kind === "shape" && (c.opacity ?? 1) === 1 && (c.strokeOpacity ?? 1) === 1));
const sharedKey = (d: Group, fillStrokes: boolean) => JSON.stringify([fillStrokes, d.children]);
type Shape = Extract<Drawing, { kind: "shape" }>;
/** Fill-only circles (members, assignment chips) share one path per radius; colour/opacity stay at the call.
 * A form costs an object plus q/Do/Q per use; measured break-even is ~200 uses of one radius
 * (1 scene × 30 members grew 9.0→9.2KB, 8 scenes × 32 shrank). Below that, draw paths inline. */
export const CIRCLE_FORM_MIN_USES = 200;
const circleKey = (d: Shape) => d.fill && !d.stroke && (d.radius ?? 0) > 0 && Math.abs(d.width - d.height) < 1e-9 && (d.radius ?? 0) >= d.width / 2
  ? `circle:${(d.width / 2).toFixed(5)}` : undefined;
export function countSharedDrawings(pages: ScenePage[], fillStrokes: boolean): SharedDrawings {
  const counts = new Map<string, number>();
  const count = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const scan = (nodes: Drawing[]) => { for (const n of nodes) {
    if (n.kind === "group") { if (shareable(n)) count(sharedKey(n, fillStrokes)); scan(n.children); }
    else if (n.kind === "shape") { const key = circleKey(n); if (key) count(key); }
  } };
  for (const page of pages) scan(page.drawings);
  return { counts, defined: new Set() };
}
/** Form BBox clips: include half line widths, square caps and a 1mm safety margin. */
function drawingBounds(nodes: Drawing[]) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const add = (x: number, y: number, pad: number) => {
    left = Math.min(left, x - pad); top = Math.min(top, y - pad); right = Math.max(right, x + pad); bottom = Math.max(bottom, y + pad);
  };
  for (const n of nodes) {
    if (n.kind === "line") { const pad = n.width * (n.square ? 1 : .5); add(n.x1, n.y1, pad); add(n.x2, n.y2, pad); }
    else if (n.kind === "shape") { const pad = (n.lineWidth ?? CSS_PX_MM) / 2; add(n.x, n.y, pad); add(n.x + n.width, n.y + n.height, pad); }
  }
  return { x: left - 1, y: top - 1, width: right - left + 2, height: bottom - top + 2 };
}

/** Viewer-font mode state for one document attempt. Advances are BIZ UDPGothic's (thousandths of an em),
 * baselines follow jsPDF's rounding of the same font's hhea metrics. */
type DeviceText = { table: DeviceGlyphTable; advance: (weight: FontWeight) => (code: number) => number;
  baseline: (weight: FontWeight) => number; codes: Set<number> };
/** Draws one text line at exactly the embedded layout: ASCII/Latin runs with the embedded BIZ subset,
 * kana/kanji/full-width runs with the viewer font, each glyph placed inside its BIZ advance. */
function drawDeviceText(pdf: jsPDF, d: Extract<Drawing, { kind: "text" }>, device: DeviceText) {
  const weight = fontWeight(d.weight), advance = device.advance(weight);
  const runs = planDeviceRuns(device.table, d.text, advance);
  const total = runs.reduce((n, r) => n + r.advance, 0) / 1000 * d.size;
  const anchor = d.align === "left" ? 0 : d.align === "right" ? total : total / 2;
  const left = d.x - anchor, y = d.y + (d.baselineOffset ?? device.baseline(weight) * d.size);
  // jsPDF's own encoder: the same operands its embedded text gets for this colour (hex or CSS rgb()).
  const encode = (pdf as unknown as { __private__: { encodeColorString(o: { ch1: string; pdfColorType: "text" | "draw"; precision: 3 }): string } }).__private__.encodeColorString;
  const fill = encode({ ch1: d.color, pdfColorType: "text", precision: 3 }), stroke = encode({ ch1: d.color, pdfColorType: "draw", precision: 3 });
  for (const run of runs) {
    const x = left + run.start / 1000 * d.size;
    if (!run.device) {
      pdf.setFont(FONT_FAMILY, weight);
      pdf.setFontSize(d.size * 72 / 25.4);
      pdf.setTextColor(d.color);
      pdf.text(run.text, x, y);
      continue;
    }
    const { lead, operand } = deviceTjArray(device.table, run.text, advance);
    for (const ch of run.text) device.codes.add(ch.charCodeAt(0));
    // Viewers do not choose a bold face by name: bold is fill + a thin outline of the same colour.
    const bold = weight === "bold";
    (pdf.internal as unknown as { write: (content: string) => void }).write(["q", fill, ...(bold ? [stroke, `${d.size * DEVICE_BOLD_STROKE_EM} w`, "1 j"] : []),
      "BT", `/${DEVICE_FONT_RESOURCE} ${d.size} Tf`, ...(bold ? ["2 Tr"] : []),
      `1 0 0 -1 ${x - lead / 1000 * d.size} ${y} Tm`, `${operand} TJ`, "ET", "Q"].join("\n"));
  }
}

function draw(pdf: jsPDF, nodes: Drawing[], signal?: AbortSignal, fillStrokes = false, shared?: SharedDrawings, inForm = false, device?: DeviceText) {
  for (const d of nodes) {
    checkAbort(signal);
    pdf.saveGraphicsState();
    const setAlpha = alphaSetter(pdf, inForm);
    try {
      if (d.kind === "group") {
        const key = shared && !inForm && shareable(d) ? sharedKey(d, fillStrokes) : undefined;
        if (key && (shared!.counts.get(key) ?? 0) >= 2) {
          if (!shared!.defined.has(key)) {
            const b = drawingBounds(d.children);
            pdf.beginFormObject(b.x, b.y, b.width, b.height, pdf.Matrix(1, 0, 0, 1, 0, 0));
            draw(pdf, d.children, signal, fillStrokes, undefined, true);
            // While a form is open, jsPDF's page array IS the form's content: tidy it the same way.
            tidyPdfContent((pdf.internal as unknown as { pages: unknown[] }).pages);
            pdf.endFormObject(key);
            shared!.defined.add(key);
          }
          pdf.doFormObject(key, pdf.Matrix(1, 0, 0, 1, 0, 0));
          continue;
        }
        const rad = d.rotation * Math.PI / 180;
        pdf.setCurrentTransformationMatrix(pdf.Matrix(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), d.x, d.y));
        if (d.clip) { path(pdf, d.clip, null); pdf.clip(); pdf.discardPath(); }
        draw(pdf, d.children, signal, fillStrokes, shared, inForm, device);
      } else if (d.kind === "image") {
        pdf.addImage(d.dataUrl, "PNG", d.x, d.y, d.width, d.height, d.cacheKey);
      } else if (d.kind === "text") {
        if (!d.text) continue;
        if (device) { drawDeviceText(pdf, d, device); continue; }
        const weight = fontWeight(d.weight), font = parsedFont(pdf, weight);
        pdf.setFont(FONT_FAMILY, weight);
        // jsPDF sizes are points even inside a millimetre-coordinate document.
        pdf.setFontSize(d.size * 72 / 25.4);
        pdf.setTextColor(d.color);
        const baselineOffset = d.baselineOffset ?? (font.ascender + font.decender) / 2000 * d.size;
        // jsPDF 4.2.1's built-in alignment divides the advance by scaleFactor again
        // in advanced mode. Compute the anchor in model millimetres ourselves.
        const advance = pdf.getStringUnitWidth(d.text, { doKerning: false }) * d.size;
        const anchor = d.align === "left" ? 0 : d.align === "right" ? advance : advance / 2;
        pdf.text(d.text, d.x - anchor, d.y + baselineOffset);
      } else if (d.kind === "line") {
        if (fillStrokes) { filledLine(pdf, d, setAlpha); continue; }
        pdf.setDrawColor(d.color); pdf.setLineWidth(d.width);
        pdf.setLineCap(d.square ? "square" : "butt");
        pdf.setLineDashPattern(d.dash ?? [], 0);
        setAlpha({ "stroke-opacity": d.opacity ?? 1, opacity: 1 });
        pdf.line(d.x1, d.y1, d.x2, d.y2);
      } else {
        if (d.fill) {
          setAlpha({ opacity: d.opacity ?? 1, "stroke-opacity": 1 });
          pdf.setFillColor(d.fill);
          const key = shared && !inForm ? circleKey(d) : undefined;
          if (key && (shared!.counts.get(key) ?? 0) >= CIRCLE_FORM_MIN_USES) {
            const r = d.width / 2;
            if (!shared!.defined.has(key)) {
              pdf.beginFormObject(-r - .5, -r - .5, 2 * r + 1, 2 * r + 1, pdf.Matrix(1, 0, 0, 1, 0, 0));
              pdf.circle(0, 0, r, "F"); // no colour inside: the caller's fill colour and opacity apply
              tidyPdfContent((pdf.internal as unknown as { pages: unknown[] }).pages);
              pdf.endFormObject(key);
              shared!.defined.add(key);
            }
            pdf.doFormObject(key, pdf.Matrix(1, 0, 0, 1, d.x + r, d.y + r));
          } else path(pdf, d, "F");
        }
        if (d.stroke) {
          if (fillStrokes) {
            setAlpha({ opacity: d.strokeOpacity ?? 1 }); pdf.setFillColor(d.stroke);
            const half = (d.lineWidth ?? CSS_PX_MM) / 2;
            path(pdf, { ...d, x: d.x - half, y: d.y - half, width: d.width + half * 2, height: d.height + half * 2,
              radius: d.radius ? d.radius + half : 0 }, null);
            if (d.width > half * 2 && d.height > half * 2) path(pdf, { ...d, x: d.x + half, y: d.y + half,
              width: d.width - half * 2, height: d.height - half * 2, radius: Math.max(0, (d.radius ?? 0) - half) }, null);
            pdf.fillEvenOdd(); continue;
          }
          setAlpha({ opacity: 1, "stroke-opacity": d.strokeOpacity ?? 1 });
          pdf.setDrawColor(d.stroke); pdf.setLineWidth(d.lineWidth ?? CSS_PX_MM); path(pdf, d, "S");
        }
      }
    } finally { pdf.restoreGraphicsState(); }
  }
}

export class UnsupportedPdfCharacters extends Error {
  constructor(public readonly characters: string[]) { super(`共通フォントで安全に描けない文字: ${characters.join(" ")}`); }
}

/** A4 pages already composed by the shared PrintPreview pagination/layout. */
export type FontSubsetter = (source: Uint8Array, codes: readonly number[], signal?: AbortSignal) => Promise<Uint8Array>;
export async function renderScenePages(pages: ScenePage[], options: { readFontBytes?: FontBytesReader; signal?: AbortSignal; title?: string;
  onProgress?: (message: string) => void; rasterize?: GlyphRasterizer;
  /** Original-font reference path for regression/size measurements. */
  orientation?: PrintOrientation; fillStrokes?: boolean; clipPage?: boolean;
  /** "device": kana/kanji/full-width text uses the viewer's Japanese font (not embedded); retried with
   * "subset" and then "original" on any failure. Default "subset" (everything embedded). */
  fontMode?: "device" | "subset" | "original"; subsetFont?: FontSubsetter;
  /** Pack object dictionaries into PDF 1.5 object streams after all checks passed (export paths). */
  objectStreams?: boolean } = {}) {
  checkAbort(options.signal);
  if (!pages.length) throw new Error("PDFのページがありません。");
  const totalStart = performance.now();
  const sourceLines = pages.flatMap(p => visibleTextLines(p.drawings));
  options.onProgress?.("共通フォントを準備中");
  const read = options.readFontBytes ?? fetchFontBytes;
  const sources = new Map(await Promise.all(requiredFontWeights(sourceLines).map(async weight => {
    const loaded = await cachedFontBytes(read, fontFileName(weight), options.signal);
    return [weight, { ...loaded, info: sourceTrueType(loaded.bytes) }] as const;
  })));
  const sourceLoadMs = performance.now() - totalStart;
  const start = performance.now();
  // Freeze vector/raster decisions using ORIGINAL coverage BEFORE collecting text.
  const prepared = await prepareTextDrawings((weight, code) => !!sources.get(weight)?.info.glyph(code), pages, options);
  pages = prepared.pages;
  const lines = pages.flatMap(p => visibleTextLines(p.drawings));
  const advanceOf = (weight: FontWeight) => {
    const info = sources.get(weight)!.info;
    return (code: number) => info.advance(code) * 1000 / info.unitsPerEm;
  };
  // jsPDF's own baseline metric for the same font: hhea ascender/descender rounded to 1/1000 em.
  const baselineOf = (weight: FontWeight) => {
    const info = sources.get(weight)!.info;
    return (Math.round(info.ascender * 1000 / info.unitsPerEm) + Math.round(info.descender * 1000 / info.unitsPerEm)) / 2000;
  };
  let subsetMs = 0;
  let deviceTable: DeviceGlyphTable | undefined;
  const attempts: ("device" | "subset" | "original")[] = [];
  async function attempt(mode: "device" | "subset" | "original") {
    attempts.push(mode);
    checkAbort(options.signal);
    const device: DeviceText | undefined = mode === "device"
      ? { table: deviceTable ??= await loadDeviceGlyphTable(), advance: advanceOf, baseline: baselineOf, codes: new Set() } : undefined;
    checkAbort(options.signal);
    // Text drawn with the EMBEDDED font in this mode (device mode: only the runs the viewer font cannot take).
    const embeddedLines = !device ? lines : lines.flatMap(line => {
      const text = planDeviceRuns(device.table, line.text, advanceOf(fontWeight(line.weight))).filter(r => !r.device).map(r => r.text).join("");
      return text ? [{ ...line, text }] : [];
    });
    const weights = requiredFontWeights(embeddedLines);
    const codes = new Map(weights.map(weight => [weight, [...new Set(embeddedLines.filter(l => fontWeight(l.weight) === weight)
      .flatMap(l => [...l.text].map(ch => ch.charCodeAt(0))))].sort((a, b) => a - b)]));
    // A failed addFont/draw/output attempt is NEVER reused.
    const pdf = new jsPDF({ orientation: options.orientation ?? "landscape", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true, floatPrecision: 5 });
    const fontBytes = new Map<FontWeight, Uint8Array>();
    for (const weight of weights) {
      checkAbort(options.signal);
      const source = sources.get(weight)!;
      if (mode === "original") fontBytes.set(weight, source.bytes);
      else {
        const subsetStart = performance.now();
        const subset = options.subsetFont ?? (await import("./hbSubsetBrowser")).subsetTrueType;
        const bytes = await subset(source.bytes, codes.get(weight)!, options.signal);
        checkAbort(options.signal);
        validateSubset(source.info, bytes, codes.get(weight)!);
        subsetMs += performance.now() - subsetStart;
        fontBytes.set(weight, bytes);
      }
    }
    const fonts = await registerFonts(pdf, async name => fontBytes.get(name.includes("Bold") ? "bold" : "normal")!, options.signal, weights);
    const missing = unsupportedCharacters(pdf, embeddedLines);
    if (missing.length) throw new UnsupportedPdfCharacters(missing);
    pdf.setProperties({ title: options.title ?? "隊列メーカー 隊列表", creator: "隊列メーカー" });
    // Per attempt: a rebuilt document (original-font retry) must define its own shared drawings.
    const shared = countSharedDrawings(pages, !!options.fillStrokes);
    for (const [i, page] of pages.entries()) {
      options.onProgress?.(`${i + 1} / ${pages.length}ページを作成中`);
      checkAbort(options.signal);
      if (i) pdf.addPage("a4", options.orientation ?? "landscape");
      const a4 = a4PageSize(options.orientation ?? "landscape");
      // Legacy image export rounds DOM scroll size upwards to CSS pixels before fitting.
      const width = Math.ceil(page.width / CSS_PX_MM - 1e-7) * CSS_PX_MM;
      const height = Math.ceil(page.height / CSS_PX_MM - 1e-7) * CSS_PX_MM;
      const fit = fitPdfImage(width, height, a4.width, a4.height);
      const scale = fit.width / width * 25.4 / 72;
      pdf.advancedAPI(() => {
        pdf.saveGraphicsState();
        pdf.setCurrentTransformationMatrix(pdf.Matrix(scale, 0, 0, scale, fit.x * 25.4 / 72, fit.y * 25.4 / 72));
        if (options.clipPage) { pdf.rect(0, 0, width, height, null); pdf.clip(); pdf.discardPath(); }
        draw(pdf, page.drawings, options.signal, options.fillStrokes, shared, false, device);
        pdf.restoreGraphicsState();
      });
      // Permit browser cancellation between pages and before serialization.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    checkAbort(options.signal);
    // Per-operator precision (geometry 0.001mm, text 0.01mm, matrices unchanged) before Flate.
    tidyPdfContent((pdf.internal as unknown as { pages: unknown[] }).pages);
    const bytes = pdf.output("arraybuffer");
    checkAbort(options.signal);
    const raw = new TextDecoder("latin1").decode(bytes);
    const usedWeights = weights;
    // A Blob alone is insufficient: verify each used font survived jsPDF's swallowed events,
    // has a real embedded font stream and Unicode map, and every drawn glyph was mapped.
    const embeddedFonts = [...raw.matchAll(/\/FontFile2 (\d+) 0 R/g)].map(match => {
      const object = raw.match(new RegExp(`(?:^|\\n)${match[1]} 0 obj\\s*<<([\\s\\S]*?)>>`));
      const length = Number(object?.[1].match(/\/Length\s+(\d+)/)?.[1]);
      const uncompressed = Number(object?.[1].match(/\/Length1\s+(\d+)/)?.[1]);
      if (!(length > 0 && uncompressed > 0)) throw new Error("埋込フォントのストリームが不正です。");
      return { compressedBytes: length, uncompressedBytes: uncompressed };
    });
    if (!raw.startsWith("%PDF-") || !raw.includes("%%EOF") || embeddedFonts.length !== usedWeights.length ||
      (raw.match(/\/ToUnicode /g)?.length ?? 0) !== usedWeights.length || (usedWeights.length > 0 && !raw.includes("/CIDFontType2")))
      throw new Error("PDFのフォント埋込・Unicode情報の検証に失敗しました。");
    for (const line of embeddedLines) for (const ch of line.text) {
      const font = parsedFont(pdf, fontWeight(line.weight)), code = ch.charCodeAt(0), glyph = font.characterToGlyph(code);
      if (!glyph || font.toUnicode[glyph] !== code) throw new Error("PDFに文字を完全に埋め込めませんでした。");
    }
    let finalBytes: Uint8Array, packed = false;
    if (device?.codes.size) {
      // Mandatory: the content already uses the viewer font. attachDeviceFont verifies its own output and
      // throws instead of returning the incomplete input; this attempt then fails and embedded fonts are used.
      finalBytes = await attachDeviceFont(bytes, { codes: device.codes, pageCount: pages.length, objectStreams: !!options.objectStreams, signal: options.signal });
      packed = !!options.objectStreams;
    } else {
      // Checks above ran on the plain jsPDF output; packing only rewrites dictionaries/xref and is
      // verified again inside packObjectStreams (falls back to the checked bytes on any doubt).
      const result = options.objectStreams ? await packObjectStreams(bytes, pages.length, options.signal) : null;
      finalBytes = result ?? new Uint8Array(bytes); packed = !!result;
    }
    return { blob: new Blob([finalBytes], { type: "application/pdf" }), metrics: { ...fonts, loadMs: sourceLoadMs, objectStreams: packed, unpackedBytes: bytes.byteLength,
      deviceFont: !!device?.codes.size, deviceCharacters: device?.codes.size ?? 0,
      sourceBytes: weights.map(w => sources.get(w)!.bytes.byteLength),
      fetchedBytes: [...sources.values()].reduce((n, s) => n + s.fetchedBytes, 0),
      fontInputBytes: weights.map(w => fontBytes.get(w)!.byteLength), characterCounts: weights.map(w => codes.get(w)!.length),
      generationMs: performance.now() - start, embeddedFonts, pages: pages.length, bytes: finalBytes.byteLength,
      graphemeImages: prepared.metrics },
      vectorText: pages.map(p => visibleTextLines(p.drawings).map(l => l.text)) };
  }
  // Each failed attempt is rebuilt from scratch with the next, more conservative font mode.
  const modes = options.fontMode === "original" ? ["original"] as const
    : options.fontMode === "device" ? ["device", "subset", "original"] as const : ["subset", "original"] as const;
  const reasons: string[] = [];
  let result: Awaited<ReturnType<typeof attempt>> | undefined;
  for (const [i, mode] of modes.entries()) {
    try { result = await attempt(mode); break; }
    catch (error) {
      checkAbort(options.signal);
      if ((error && typeof error === "object" && "name" in error && error.name === "AbortError") || i === modes.length - 1) throw error;
      reasons.push(error instanceof Error ? error.message : String(error));
      options.onProgress?.(mode === "device" ? "フォントを入れてPDFを再作成中" : "元の共通フォントでPDFを再作成中");
    }
  }
  checkAbort(options.signal);
  return { ...result!, metrics: { ...result!.metrics, subsetMs, fontAttempts: attempts, retryReason: reasons.length ? reasons.join(" / ") : undefined,
    totalMs: performance.now() - totalStart } };
}
