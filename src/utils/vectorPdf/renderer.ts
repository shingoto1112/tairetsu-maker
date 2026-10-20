import { jsPDF } from "jspdf";
import { fitPdfImage, a4PageSize } from "../pdfPageLayout";
import { checkAbort, FONT_FAMILY, fontWeight, parsedFont, registerFonts, unsupportedCharacters, type FontBytesReader } from "./fonts";
import { CSS_PX_MM, visibleTextLines, type Drawing, type Rect, type ScenePage } from "./model";

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
      } else if (d.kind === "text") {
        if (!d.text) continue;
        const weight = fontWeight(d.weight), font = parsedFont(pdf, weight);
        pdf.setFont(FONT_FAMILY, weight);
        // jsPDF sizes are points even inside a millimetre-coordinate document.
        pdf.setFontSize(d.size * 72 / 25.4);
        pdf.setTextColor(d.color);
        const baselineOffset = (font.ascender + font.decender) / 2000 * d.size;
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
          pdf.setGState(pdf.GState({ opacity: 1, "stroke-opacity": 1 }));
          pdf.setDrawColor(d.stroke); pdf.setLineWidth(d.lineWidth ?? CSS_PX_MM); path(pdf, d, "S");
        }
      }
    } finally { pdf.restoreGraphicsState(); }
  }
}

export class UnsupportedPdfCharacters extends Error {
  constructor(public readonly characters: string[]) { super(`共通フォントで安全に描けない文字: ${characters.join(" ")}`); }
}

/** Prototype-only: repeated independent scene pages, NOT the future multi-scene paginator. */
export async function renderScenePages(pages: ScenePage[], options: { readFontBytes?: FontBytesReader; signal?: AbortSignal; title?: string } = {}) {
  checkAbort(options.signal);
  if (!pages.length) throw new Error("PDFのページがありません。");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true, floatPrecision: 5 });
  const fonts = await registerFonts(pdf, options.readFontBytes, options.signal);
  const lines = pages.flatMap(p => visibleTextLines(p.drawings));
  const missing = unsupportedCharacters(pdf, lines);
  if (missing.length) throw new UnsupportedPdfCharacters(missing);
  const start = performance.now();
  pdf.setProperties({ title: options.title ?? "隊列メーカー ベクターPDF試作", creator: "隊列メーカー" });
  for (const [i, page] of pages.entries()) {
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
    (raw.match(/\/ToUnicode /g)?.length ?? 0) !== usedWeights.length || !raw.includes("/CIDFontType2"))
    throw new Error("PDFのフォント埋込・Unicode情報の検証に失敗しました。");
  for (const line of lines) for (const ch of line.text) {
    const font = parsedFont(pdf, fontWeight(line.weight)), code = ch.charCodeAt(0), glyph = font.characterToGlyph(code);
    if (!glyph || font.toUnicode[glyph] !== code) throw new Error("PDFに文字を完全に埋め込めませんでした。");
  }
  return { blob: new Blob([bytes], { type: "application/pdf" }), metrics: { ...fonts,
    generationMs: performance.now() - start, embeddedFonts, pages: pages.length, bytes: bytes.byteLength } };
}
