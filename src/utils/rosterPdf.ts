import type { RosterExportSnapshot } from "./rosterExportSnapshot";
import type { GenerationOptions } from "./mobileExportTypes";
import { normalizeRosterColor } from "./rosterXlsx";
import { chooseRosterTablePlan, rosterPdfColumns, rosterPdfInterior, splitRosterPdfName, wrapRosterPdfLine,
  ROSTER_PDF as C, type RosterPdfColumn, type RosterPdfPage, type RosterPdfPlan } from "./rosterPdfLayout";
import { ensureBrowserFonts } from "./vectorPdf/browserDocumentLayout";
import { cachedFontBytes, checkAbort, fetchFontBytes, fontFileName, FONT_FAMILY } from "./vectorPdf/fonts";
import { sourceTrueType, validateSubset } from "./vectorPdf/trueType";
import { CSS_PX_MM, type Drawing, type ScenePage, type TextLine, type Rect } from "./vectorPdf/model";
import { rasterizeGrapheme, type GlyphRasterizer } from "./vectorPdf/graphemeImages";
import { measureMixedGraphemes } from "./vectorPdf/browserMixedText";
import { assertIndependentText, planTextRuns, UnsafePdfText } from "./vectorPdf/textRuns";
import { renderScenePages } from "./vectorPdf/renderer";
import { loadHtmlToImage, withExportClone } from "./exportImage";
import { imagePagesToPdfBlob, type ImagePdfPage } from "./pdfExport";

const ink = "#0F172A", fill = "#F1F5F9", grid = "#D5DBE3";
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** FontFace API faces are not visible to html-to-image's stylesheet scanner.
 * Embed explicit, validated font subsets in this job's SVG captures as well. */
export async function rosterPdfFontCss(columns: RosterPdfColumn[], signal?: AbortSignal) {
  const values = ["No.0123456789", ...columns.flatMap(c => [...c.header, ...c.names.flat()])];
  const codes = [...new Set(values.flatMap(text => [...text].map(c => c.codePointAt(0)!).filter(c => c < 0xffff)))];
  const css: string[] = [];
  for (const weight of ["normal", "bold"] as const) {
    const source = (await cachedFontBytes(fetchFontBytes, fontFileName(weight), signal)).bytes;
    const info = sourceTrueType(source), covered = codes.filter(c => info.glyph(c));
    let bytes = source;
    try {
      const { subsetTrueType } = await import("./vectorPdf/hbSubsetBrowser");
      const subset = await subsetTrueType(source, covered, signal); validateSubset(info, subset, covered); bytes = subset;
    } catch { checkAbort(signal); /* Same font, original bytes, if subsetting is unavailable. */ }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    css.push(`@font-face{font-family:${FONT_FAMILY};font-weight:${weight === "bold" ? 700 : 400};src:url(data:font/ttf;base64,${btoa(binary)}) format('truetype')}`);
  }
  return css.join("\n");
}

export async function captureRosterPdfPage(sheet: HTMLElement, fontEmbedCSS: string) {
  const { toCanvas } = await loadHtmlToImage();
  // html-to-image 1.11 floors every computed font size and subtracts .1px.
  // This table has a single explicit size: restore it inside the capture only.
  const css = `${fontEmbedCSS}\n[data-roster-pdf-page],[data-roster-pdf-page] *{font-size:${C.fontPt}pt!important}`;
  return withExportClone(sheet, (clone, size) => toCanvas(clone, { width:size.width, height:size.height,
    backgroundColor:"#ffffff", pixelRatio:2, fontEmbedCSS:css }));
}
const element = (tag = "div", text?: string) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
const position = (e: HTMLElement, x: number, y: number, width?: number, height?: number) =>
  Object.assign(e.style, { position: "absolute", left: `${x}mm`, top: `${y}mm`,
    ...(width === undefined ? {} : { width: `${width}mm` }), ...(height === undefined ? {} : { height: `${height}mm` }) });

/** Job-local caches only. At most 48 DOM width probes live at a time. */
export async function measureRosterPdf(snapshot: RosterExportSnapshot, options: GenerationOptions): Promise<RosterPdfColumn[]> {
  const columns = rosterPdfColumns(snapshot); checkAbort(options.signal);
  await ensureBrowserFonts(["normal", "bold"], options.signal);
  const info = sourceTrueType((await cachedFontBytes(fetchFontBytes, fontFileName("normal"), options.signal)).bytes);
  const host = element(); host.dataset.rosterPdfMeasure = "true";
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", fontFamily: FONT_FAMILY,
    fontSize: `${C.fontPt}pt`, fontKerning: "none", fontVariantLigatures: "none", whiteSpace: "pre", lineHeight: `${C.line}mm` });
  host.setAttribute("aria-hidden", "true"); document.body.append(host);
  const widths = new Map<string, number>();
  const key = (text: string, bold: boolean) => `${bold ? 1 : 0}:${text}`;
  const probe = (text: string, bold: boolean) => { const e = element("span", text); e.style.display = "inline-block"; e.style.fontWeight = bold ? "700" : "400"; host.append(e); return e; };
  const measure = (text: string, bold = false) => {
    const k = key(text, bold), cached = widths.get(k); if (cached !== undefined) return cached;
    const e = probe(text, bold), width = e.getBoundingClientRect().width * CSS_PX_MM; e.remove(); widths.set(k, width); return width;
  };
  try {
    const jobs = [...new Set(columns.flatMap(c => c.items.flatMap(item => splitRosterPdfName(item.name))))];
    for (let i = 0; i < jobs.length; i += 48) {
      checkAbort(options.signal);
      const batch = jobs.slice(i, i + 48).map(text => ({ text, e: probe(text, false) }));
      for (const { text, e } of batch) widths.set(key(text, false), e.getBoundingClientRect().width * CSS_PX_MM);
      host.replaceChildren(); options.onProgress("名簿の文字幅を測定中…"); await pause();
    }
    const result: RosterPdfColumn[] = [];
    let count = 0;
    for (const column of columns) {
      checkAbort(options.signal);
      const parts = column.items.map(item => splitRosterPdfName(item.name));
      // Advance is a cross-check/estimate; actual DOM advances own the final width.
      const estimate = (text: string) => [...text].reduce((n, ch) => n + info.advance(ch.charCodeAt(0)) / info.unitsPerEm * C.fontPt * 25.4 / 72, 0);
      const preferred = parts.flat().reduce((max, text) => Math.max(max, measure(text)), C.minColumn - C.paddingX * 2);
      const shortWidth = parts.filter(lines => lines.length === 1).reduce((max, lines) => Math.max(max, measure(lines[0])), 0);
      // 30–50mm is the normal range. Unusually wide <=6-grapheme names must
      // still stay on one line; let A4's actual width, rather than 50mm, decide.
      const width = Math.max(Math.min(C.maxColumn, Math.max(C.minColumn, preferred + C.paddingX * 2 + .1)), shortWidth + C.paddingX * 2 + .1);
      const available = width - C.paddingX * 2;
      const names: string[][] = [];
      for (const [i, lines] of parts.entries()) {
        const name = column.items[i].name;
        const measured = measure(name);
        const advance = estimate(name);
        if (!Number.isFinite(measured + advance)) throw new Error("名簿の文字幅を計測できませんでした。");
        if ([...name].every(ch => ch.codePointAt(0)! < 0xffff && !/[\p{Mark}\p{Cf}\p{Cc}]/u.test(ch) && info.glyph(ch.charCodeAt(0))) &&
          Math.abs(measured - advance) > .15 + advance * .01)
          throw new Error("名簿のフォントと文字幅が一致しません。再度作成してください。");
        names.push(lines.flatMap(line => wrapRosterPdfLine(line, available, text => measure(text))));
        if (++count % 48 === 0) { await pause(); checkAbort(options.signal); }
      }
      result.push({ ...column, width, names, header: wrapRosterPdfLine(`■ ${column.label}`, available, text => measure(text, true)) });
    }
    return result;
  } finally { host.remove(); widths.clear(); }
}

/** One fixed-size paper interior, used by preview, raster fallback and vector measurement. */
export function drawRosterPdfPage(page: RosterPdfPage, orientation: RosterPdfPlan["orientation"]): HTMLElement {
  const size = rosterPdfInterior(orientation), sheet = element(); sheet.dataset.rosterPdfPage = "true";
  Object.assign(sheet.style, { position: "relative", width: `${size.width}mm`, height: `${size.height}mm`, background: "#fff",
    color: ink, fontFamily: FONT_FAMILY, fontSize: `${C.fontPt}pt`, fontKerning: "none", fontVariantLigatures: "none",
    boxSizing: "border-box", overflow: "hidden", lineHeight: `${C.line}mm`, textAlign: "center" });
  const shapes: Drawing[] = [], lines: Drawing[] = [];
  const ys = [C.inset + page.headerHeight];
  for (let i = page.start; i < page.end; i++) ys.push(ys[ys.length - 1] + page.heights[i]);
  const xs: number[] = [C.inset, C.inset + C.number];
  for (const c of page.columns) xs.push(xs[xs.length - 1] + c.width);
  const background = (x: number, y: number, w: number, h: number) => {
    const e = element(); position(e, x, y, w, h); e.style.background = fill; sheet.append(e);
    shapes.push({ kind: "shape", x, y, width: w, height: h, fill });
  };
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, width: number) => lines.push({ kind: "line", x1, y1, x2, y2, color, width });
  const textCell = (textLines: string[], x: number, y: number, width: number, height: number, bold: boolean, color?: string, id?: string) => {
    const box = element(); position(box, x, y, width, height); box.dataset.rosterPdfCell = "true";
    if (id) box.dataset.memberId = id;
    sheet.append(box);
    for (const [i, text] of textLines.entries()) {
      const row = element(); position(row, 0, (height - textLines.length * C.line) / 2 + i * C.line, width, C.line);
      Object.assign(row.style, { whiteSpace: "pre", fontWeight: bold ? "700" : "400" });
      if (color && i === 0 && text.startsWith("■ ")) {
        const mark = element("span", "■ "); mark.style.color = color; mark.dataset.pdfRun = "true"; row.append(mark);
        const label = element("span", text.slice(2)); label.dataset.pdfRun = "true"; row.append(label);
      } else { const run = element("span", text); run.dataset.pdfRun = "true"; row.append(run); }
      const baseline = element("span"); baseline.dataset.pdfBaseline = "true";
      baseline.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;padding:0;margin:0;border:0";
      row.append(baseline); box.append(row);
    }
  };
  const headerBottom = ys[0];
  background(xs[0], C.inset, xs[xs.length - 1] - xs[0], page.headerHeight);
  background(xs[0], headerBottom, C.number, ys[ys.length - 1] - headerBottom);
  textCell(["No."], xs[0], C.inset, C.number, page.headerHeight, true);
  for (const [i, c] of page.columns.entries()) textCell(c.header, xs[i + 1], C.inset, c.width, page.headerHeight, true, `#${normalizeRosterColor(c.color).slice(2)}`);
  for (let r = page.start; r < page.end; r++) textCell([String(r + 1)], xs[0], ys[r - page.start], C.number, page.heights[r], true);
  // Column-major text order is retained in the PDF content stream.
  for (const [i, c] of page.columns.entries()) for (let r = page.start; r < Math.min(page.end, c.items.length); r++)
    textCell(c.names[r], xs[i + 1], ys[r - page.start], c.width, page.heights[r], false, undefined, c.items[r].id);
  line(xs[0], C.inset, xs[xs.length - 1], C.inset, grid, C.thin);
  line(xs[0], headerBottom, xs[1], headerBottom, grid, C.thin);
  for (const [i, c] of page.columns.entries()) line(xs[i + 1], headerBottom, xs[i + 2], headerBottom, `#${normalizeRosterColor(c.color).slice(2)}`, C.thick);
  const ends = [ys[ys.length - 1], ...page.columns.map(c => ys[Math.max(0, Math.min(page.end, c.items.length) - page.start)])];
  for (let i = 0; i < xs.length; i++) line(xs[i], C.inset, xs[i], Math.max(ends[i - 1] ?? C.inset, ends[i] ?? C.inset), ink, C.thin);
  for (let r = page.start; r < page.end; r++) {
    const y = ys[r - page.start + 1]; line(xs[0], y, xs[1], y, grid, C.thin);
    for (const [i, c] of page.columns.entries()) if (r < c.items.length) line(xs[i + 1], y, xs[i + 2], y, grid, C.thin);
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
  for (const d of lines) if (d.kind === "line") {
    const l = document.createElementNS(svg.namespaceURI, "line");
    for (const [key, value] of Object.entries({ x1:d.x1, x2:d.x2, y1:d.y1, y2:d.y2, stroke:d.color, "stroke-width":d.width })) l.setAttribute(key, String(value));
    svg.append(l);
  }
  sheet.append(svg);
  // Geometry is private to this short-lived page; never attach names to a global cache.
  geometry.set(sheet, [...shapes, ...lines]);
  return sheet;
}
const geometry = new WeakMap<HTMLElement, Drawing[]>();
const cellBounds = new WeakMap<TextLine, Rect>();

/** Range boxes measure advances, while combining marks may have taller ink.
 * Refuse overflowing glyph ink instead of clipping or rasterizing the document. */
const rasterizeRosterGrapheme: GlyphRasterizer = (text, line, unit) => {
  const bitmap = rasterizeGrapheme(text, line, unit), cell = cellBounds.get(line);
  if (cell) for (const p of line.measureMixed?.() ?? []) if (p.text === text) {
    if (p.x + bitmap.left < cell.x || p.x + bitmap.left + bitmap.width > cell.x + cell.width ||
      p.baseline + bitmap.top < cell.y || p.baseline + bitmap.top + bitmap.height > cell.y + cell.height)
      throw new Error("名簿PDFの文字画像がセルに収まりません。省略せず作成を中止しました。名前を確認してください。");
  }
  return bitmap;
};

export function validateRosterPdfCells(sheet: HTMLElement) {
  for (const run of sheet.querySelectorAll<HTMLElement>("[data-pdf-run]")) {
    if (!run.textContent) continue;
    const range = document.createRange(); range.selectNodeContents(run); const r = range.getBoundingClientRect();
    const cell = run.closest<HTMLElement>("[data-roster-pdf-cell]")!.getBoundingClientRect();
    if (r.left < cell.left - .1 || r.right > cell.right + .1 || r.top < cell.top - .1 || r.bottom > cell.bottom + .1)
      throw new Error("名簿PDFの文字がセルに収まりません。作成を中止しました。");
  }
}

export function measureRosterPdfPage(sheet: HTMLElement, id: string, coverage: Parameters<typeof planTextRuns>[0]): ScenePage {
  const origin = sheet.getBoundingClientRect(), drawings = [...geometry.get(sheet)!];
  for (const run of sheet.querySelectorAll<HTMLElement>("[data-pdf-run]")) {
    const range = document.createRange(); range.selectNodeContents(run); const r = range.getBoundingClientRect();
    const baseline = run.parentElement!.querySelector<HTMLElement>("[data-pdf-baseline]")!.getBoundingClientRect().y;
    const style = getComputedStyle(run), text = run.textContent ?? "";
    if (!text) continue;
    const cell = run.closest<HTMLElement>("[data-roster-pdf-cell]")!.getBoundingClientRect();
    if (r.left < cell.left - .1 || r.right > cell.right + .1 || r.top < cell.top - .1 || r.bottom > cell.bottom + .1)
      throw new Error("名簿PDFの文字がセルに収まりません。作成を中止しました。");
    const d: TextLine = { kind:"text", text, x:(r.x-origin.x)*CSS_PX_MM, y:(baseline-origin.y)*CSS_PX_MM,
      size:C.fontPt*25.4/72, weight:Number(style.fontWeight), color:style.color, align:"left", baselineOffset:0 };
    cellBounds.set(d, { x:(cell.x-origin.x)*CSS_PX_MM, y:(cell.y-origin.y)*CSS_PX_MM,
      width:cell.width*CSS_PX_MM, height:cell.height*CSS_PX_MM });
    if (planTextRuns(coverage, d).some(r => r.raster)) {
      const placements = measureMixedGraphemes(run, sheet); d.measureMixed = () => placements;
    }
    drawings.push(d);
  }
  return { frameId:id, width:parseFloat(sheet.style.width), height:parseFloat(sheet.style.height), drawings };
}

export async function generateRosterPdf(snapshot: RosterExportSnapshot, options: GenerationOptions) {
  const columns = await measureRosterPdf(snapshot, options), plan = chooseRosterTablePlan(columns);
  let raster = false;
  // Only known text-classification failures select document rasterization. Limits,
  // measurement failures and renderer failures must not start a heavier fallback.
  for (const c of columns) for (const text of [c.label, ...c.items.map(i => i.name)]) {
    try { assertIndependentText(text); planTextRuns(() => true, {kind:"text",text,x:0,y:0,size:1,weight:400,color:ink}); }
    catch (error) { if (!(error instanceof UnsafePdfText)) throw error; raster = true; }
  }
  const size = rosterPdfInterior(plan.orientation);
  const pagePixels = Math.ceil(size.width / CSS_PX_MM) * Math.ceil(size.height / CSS_PX_MM) * 4;
  if ((raster ? plan.pages.length : 1) * pagePixels > C.maxRasterPixels)
    throw new Error("名簿PDFの画像画素数上限（4,000万画素）を超えます。Excelで書き出すか、名簿を分けてください。");
  const fonts = new Map(await Promise.all((["normal", "bold"] as const).map(async weight =>
    [weight, sourceTrueType((await cachedFontBytes(fetchFontBytes, fontFileName(weight), options.signal)).bytes)] as const)));
  const fontCss = await rosterPdfFontCss(columns, options.signal);
  const host = element(); host.dataset.rosterPdfHost = "true"; host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;pointer-events:none"; document.body.append(host);
  const pages: ScenePage[] = [], images: ImagePdfPage[] = [];
  let preview: Blob | undefined;
  try {
    for (const [i, page] of plan.pages.entries()) {
      checkAbort(options.signal); options.onProgress(`${i + 1}/${plan.pages.length}ページを準備中…`); await pause(); checkAbort(options.signal);
      const sheet = drawRosterPdfPage(page, plan.orientation); host.replaceChildren(sheet);
      validateRosterPdfCells(sheet);
      if (!raster) pages.push(measureRosterPdfPage(sheet, String(i), (weight, code) => !!fonts.get(weight)!.glyph(code)));
      if (i === 0 || raster) {
        const canvas = await captureRosterPdfPage(sheet, fontCss);
        try {
          checkAbort(options.signal);
          if (i === 0) preview = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("名簿のプレビューを作成できません。")), "image/png"));
          if (raster) images.push({ dataUrl:canvas.toDataURL("image/png"), width:canvas.width, height:canvas.height, format:"PNG" });
        } finally { canvas.width = canvas.height = 0; }
      }
      host.replaceChildren();
    }
    checkAbort(options.signal);
    if (raster) return { blob:await imagePagesToPdfBlob(images, {orientation:plan.orientation, title:"メンバー名簿", signal:options.signal}), preview:preview!, pageCount:plan.pages.length, orientation:plan.orientation, mode:"raster" as const };
    const result = await renderScenePages(pages, { orientation:plan.orientation, title:"メンバー名簿", signal:options.signal,
      onProgress:options.onProgress, fillStrokes:false, clipPage:true, rasterize:rasterizeRosterGrapheme, objectStreams:true });
    checkAbort(options.signal);
    return { blob:result.blob, preview:preview!, pageCount:plan.pages.length, orientation:plan.orientation, mode:"vector" as const, metrics:result.metrics };
  } finally { host.remove(); }
}
