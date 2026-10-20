import { jsPDF } from "jspdf";
import { fitPdfImage, a4PageSize } from "../pdfPageLayout";
import { checkAbort, FONT_FAMILY, fontWeight, parsedFont, registerFonts, requiredFontWeights, unsupportedCharacters, type FontBytesReader } from "./fonts";
import { CSS_PX_MM, visibleTextLines, type Drawing, type Rect, type ScenePage } from "./model";
import { planTextRuns } from "./textRuns";
import { createGraphemeImageCache, type GlyphRasterizer } from "./graphemeImages";

export async function prepareTextDrawings(pdf: jsPDF, pages: ScenePage[], options: { signal?: AbortSignal; rasterize?: GlyphRasterizer } = {}) {
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
        const runs = planTextRuns(pdf, node);
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
  const prepared: ScenePage[] = [];
  for (const page of pages) {
    const width = Math.ceil(page.width / CSS_PX_MM - 1e-7) * CSS_PX_MM;
    const height = Math.ceil(page.height / CSS_PX_MM - 1e-7) * CSS_PX_MM;
    const a4 = a4PageSize("landscape"), fit = fitPdfImage(width, height, a4.width, a4.height);
    prepared.push({ ...page, drawings: await prepare(page.drawings, fit.width / width * 25.4 / 72) });
  }
  return { pages: prepared, metrics: cache.metrics };
}

function path(pdf: jsPDF, r: Rect, style: "F" | "S" | null) {
  const radius = r.radius ?? 0;
  if (radius > 0) pdf.roundedRect(r.x, r.y, r.width, r.height, radius, radius, style);
  else pdf.rect(r.x, r.y, r.width, r.height, style);
}

function draw(pdf: jsPDF, nodes: Drawing[], signal?: AbortSignal) {
  for (const d of nodes) {
    checkAbort(signal);
    pdf.saveGraphicsState();
    try {
      if (d.kind === "group") {
        const rad = d.rotation * Math.PI / 180;
        pdf.setCurrentTransformationMatrix(pdf.Matrix(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), d.x, d.y));
        if (d.clip) { path(pdf, d.clip, null); pdf.clip(); pdf.discardPath(); }
        draw(pdf, d.children, signal);
      } else if (d.kind === "image") {
        pdf.addImage(d.dataUrl, "PNG", d.x, d.y, d.width, d.height, d.cacheKey);
      } else if (d.kind === "text") {
        if (!d.text) continue;
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
        pdf.setDrawColor(d.color); pdf.setLineWidth(d.width);
        pdf.setLineCap(d.square ? "square" : "butt");
        pdf.setLineDashPattern(d.dash ?? [], 0);
        pdf.setGState(pdf.GState({ "stroke-opacity": d.opacity ?? 1, opacity: 1 }));
        pdf.line(d.x1, d.y1, d.x2, d.y2);
      } else {
        if (d.fill) {
          pdf.setGState(pdf.GState({ opacity: d.opacity ?? 1, "stroke-opacity": 1 }));
          pdf.setFillColor(d.fill); path(pdf, d, "F");
        }
        if (d.stroke) {
          pdf.setGState(pdf.GState({ opacity: 1, "stroke-opacity": d.strokeOpacity ?? 1 }));
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
export async function renderScenePages(pages: ScenePage[], options: { readFontBytes?: FontBytesReader; signal?: AbortSignal; title?: string;
  onProgress?: (message: string) => void; rasterize?: GlyphRasterizer } = {}) {
  checkAbort(options.signal);
  if (!pages.length) throw new Error("PDFのページがありません。");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true, floatPrecision: 5 });
  const sourceLines = pages.flatMap(p => visibleTextLines(p.drawings));
  options.onProgress?.("共通フォントを準備中");
  const fonts = await registerFonts(pdf, options.readFontBytes, options.signal, requiredFontWeights(sourceLines));
  const start = performance.now();
  const prepared = await prepareTextDrawings(pdf, pages, options);
  pages = prepared.pages;
  // Only actual vector runs reach font subsets, ToUnicode and post-draw validation.
  const lines = pages.flatMap(p => visibleTextLines(p.drawings));
  const missing = unsupportedCharacters(pdf, lines);
  if (missing.length) throw new UnsupportedPdfCharacters(missing);
  pdf.setProperties({ title: options.title ?? "隊列メーカー 隊列表", creator: "隊列メーカー" });
  for (const [i, page] of pages.entries()) {
    options.onProgress?.(`${i + 1} / ${pages.length}ページを作成中`);
    checkAbort(options.signal);
    if (i) pdf.addPage("a4", "landscape");
    const a4 = a4PageSize("landscape");
    // Legacy image export rounds DOM scroll size upwards to CSS pixels before fitting.
    const width = Math.ceil(page.width / CSS_PX_MM - 1e-7) * CSS_PX_MM;
    const height = Math.ceil(page.height / CSS_PX_MM - 1e-7) * CSS_PX_MM;
    const fit = fitPdfImage(width, height, a4.width, a4.height);
    const scale = fit.width / width * 25.4 / 72;
    pdf.advancedAPI(() => {
      pdf.saveGraphicsState();
      pdf.setCurrentTransformationMatrix(pdf.Matrix(scale, 0, 0, scale, fit.x * 25.4 / 72, fit.y * 25.4 / 72));
      draw(pdf, page.drawings, options.signal);
      pdf.restoreGraphicsState();
    });
    // Permit browser cancellation between pages and before serialization.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  checkAbort(options.signal);
  const bytes = pdf.output("arraybuffer");
  checkAbort(options.signal);
  const raw = new TextDecoder("latin1").decode(bytes);
  const usedWeights = [...new Set(lines.filter(l => l.text).map(l => fontWeight(l.weight)))];
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
  for (const line of lines) for (const ch of line.text) {
    const font = parsedFont(pdf, fontWeight(line.weight)), code = ch.charCodeAt(0), glyph = font.characterToGlyph(code);
    if (!glyph || font.toUnicode[glyph] !== code) throw new Error("PDFに文字を完全に埋め込めませんでした。");
  }
  return { blob: new Blob([bytes], { type: "application/pdf" }), metrics: { ...fonts,
    generationMs: performance.now() - start, embeddedFonts, pages: pages.length, bytes: bytes.byteLength,
    graphemeImages: prepared.metrics },
    vectorText: pages.map(p => visibleTextLines(p.drawings).map(l => l.text)) };
}
