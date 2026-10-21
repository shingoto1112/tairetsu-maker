import { graphemes } from "./vectorPdf/textRuns";
import { selectRosterTableColumns } from "./rosterColumns";
import type { RosterExportSnapshot } from "./rosterExportSnapshot";
import { a4PageSize } from "./pdfPageLayout";
import { CSS_PX_MM } from "./vectorPdf/model";

export const ROSTER_PDF = { fontPt: 11, minColumn: 30, maxColumn: 50, paddingX: 2,
  paddingY: 1.5, line: 5.5, number: 12, inset: .5, thin: .18, thick: .7,
  maxCharacters: 200_000, maxEntries: 10_000, maxColumns: 256, maxPages: 100,
  maxRasterPixels: 40_000_000 } as const;
export type RosterPdfColumn = RosterExportSnapshot["columns"][number] & {
  width: number; header: string[]; names: string[][];
};
export type RosterPdfPage = { columns: RosterPdfColumn[]; start: number; end: number; headerHeight: number; heights: number[] };
export type RosterPdfPlan = { orientation: "portrait" | "landscape"; pages: RosterPdfPage[] };

/** First decide the semantic two-line split; width wrapping happens separately. */
export function splitRosterPdfName(name: string): string[] {
  const chars = graphemes(name);
  if (chars.length <= 6) return [name];
  const first = chars.findIndex(c => !/^\s+$/u.test(c));
  let last = chars.length - 1;
  while (last >= 0 && /^\s+$/u.test(chars[last])) last--;
  let space: { start: number; end: number; distance: number } | undefined;
  for (let i = 0; i < chars.length; i++) if (/^\s+$/u.test(chars[i])) {
    const start = i;
    while (i + 1 < chars.length && /^\s+$/u.test(chars[i + 1])) i++;
    const end = i + 1;
    if (first >= 0 && start > first && end <= last) {
      const distance = Math.abs(start - (chars.length - end));
      if (!space || distance < space.distance || (distance === space.distance && start > space.start)) space = { start, end, distance };
    }
  }
  return space ? [chars.slice(0, space.start).join("").trimEnd(), chars.slice(space.end).join("").trimStart()]
    : [chars.slice(0, Math.ceil(chars.length / 2)).join(""), chars.slice(Math.ceil(chars.length / 2)).join("")];
}

export function wrapRosterPdfLine(value: string, width: number, measure: (text: string) => number): string[] {
  if (measure(value) <= width + .01) return [value];
  const chars = graphemes(value), lines: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let low = start + 1, high = chars.length, best = start;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (measure(chars.slice(start, middle).join("")) <= width + .01) { best = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (best === start) throw new Error("名簿の1文字が列幅に収まりません。名前を確認してください。");
    lines.push(chars.slice(start, best).join("")); start = best;
    if (lines.length > 51) throw new Error("名簿の1行または見出しがA4の高さを超えます。縮小・分割・省略はせず作成を中止しました。Excelで書き出すか、名前・見出しを短くしてください。");
  }
  return lines.length ? lines : [""];
}

export function rosterPdfColumns(snapshot: RosterExportSnapshot) {
  const columns = selectRosterTableColumns(snapshot.columns);
  let characters = 0, entries = 0;
  if (columns.length > ROSTER_PDF.maxColumns) throw new Error("名簿PDFは256列までです。グループを減らしてください。");
  for (const column of columns) {
    characters += column.label.length + 2; entries += column.items.length;
    for (const item of column.items) characters += item.name.length;
    if (characters > ROSTER_PDF.maxCharacters || entries > ROSTER_PDF.maxEntries)
      throw new Error("名簿PDFの上限（文字量20万・メンバー1万人）を超えています。Excelで書き出すか、名簿を分けてください。");
  }
  // Validate support even for an entirely empty roster.
  graphemes("");
  return columns;
}

/** Fixed paper interior, rounded exactly like the raster export / shared renderer. */
export function rosterPdfInterior(orientation: RosterPdfPlan["orientation"]) {
  const a4 = a4PageSize(orientation);
  return { width: Math.floor((a4.width - 40) * 4 / 3) * CSS_PX_MM,
    height: Math.floor((a4.height - 40) * 4 / 3) * CSS_PX_MM };
}

export function planRosterPdf(columns: RosterPdfColumn[], orientation: RosterPdfPlan["orientation"]): RosterPdfPlan {
  const size = rosterPdfInterior(orientation), pages: RosterPdfPage[] = [];
  const batches: RosterPdfColumn[][] = [];
  let batch: RosterPdfColumn[] = [], width = ROSTER_PDF.number + ROSTER_PDF.inset * 2;
  for (const column of columns) {
    if (column.width + ROSTER_PDF.number + ROSTER_PDF.inset * 2 > size.width)
      throw new Error("名簿の1行の名前がA4の用紙幅に収まりません。縮小・省略はせず作成を中止しました。Excelで書き出してください。");
    if (width + column.width > size.width && batch.length) { batches.push(batch); batch = []; width = ROSTER_PDF.number + ROSTER_PDF.inset * 2; }
    batch.push(column); width += column.width;
  }
  if (batch.length) batches.push(batch);
  for (const columns of batches) {
    const headerHeight = Math.max(1, ...columns.map(c => c.header.length)) * ROSTER_PDF.line + ROSTER_PDF.paddingY * 2;
    const available = size.height - headerHeight - ROSTER_PDF.inset * 2;
    if (available < 0) throw new Error("名簿の見出しが長いためA4の高さを超えます。見出しを短くしてください。");
    const heights = Array.from({ length: Math.max(0, ...columns.map(c => c.names.length)) }, (_, i) =>
      Math.max(1, ...columns.map(c => c.names[i]?.length ?? 0)) * ROSTER_PDF.line + ROSTER_PDF.paddingY * 2);
    let start = 0, used = 0;
    for (const [i, height] of heights.entries()) {
      if (height > available) throw new Error("名簿の1行が見出しを含めてA4の高さを超えます。縮小・分割・省略はせず作成を中止しました。名前を短くするかExcelで書き出してください。");
      if (used + height > available + .0001) { pages.push({ columns, start, end: i, headerHeight, heights }); start = i; used = 0; }
      used += height;
    }
    pages.push({ columns, start, end: heights.length, headerHeight, heights });
  }
  return { orientation, pages };
}

export function chooseRosterTablePlan(columns: RosterPdfColumn[]): RosterPdfPlan {
  const plans: RosterPdfPlan[] = []; let error: unknown;
  for (const orientation of ["portrait", "landscape"] as const) {
    try { plans.push(planRosterPdf(columns, orientation)); } catch (e) { error = e; }
  }
  if (!plans.length) throw error;
  plans.sort((a, b) => a.pages.length - b.pages.length || (a.orientation === "portrait" ? -1 : 1));
  if (plans[0].pages.length > ROSTER_PDF.maxPages) throw new Error("名簿PDFの上限（100ページ）を超えます。Excelで書き出すか、名簿を分けてください。");
  return plans[0];
}
