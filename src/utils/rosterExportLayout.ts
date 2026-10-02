import type { PdfOrientation } from "./pdfExport";
import type { RosterExportSnapshot } from "./rosterExportSnapshot";

// Keep the existing utility API for export callers and tests.
export { createRosterExportSnapshot, rosterTitle, type RosterEntry, type RosterExportSnapshot } from "./rosterExportSnapshot";

// CSS pixels at 96dpi. The existing PDF encoder adds 20pt margins on each side.
// 14 2/3px body text consequently stays approximately 11pt on either A4 orientation.
export const ROSTER_COLUMN_WIDTH = 210;
export const ROSTER_NUMBER_WIDTH = 36;
export const ROSTER_SHEET_PADDING = 12;
export const ROSTER_FOOTER_HEIGHT = 28;
export const rosterPageSize = (orientation: PdfOrientation) => ({
  width: Math.floor(((orientation === "portrait" ? 595.28 : 841.89) - 40) * 4 / 3),
  height: Math.floor(((orientation === "portrait" ? 841.89 : 595.28) - 40) * 4 / 3),
});

export const splitRosterColumns = (
  columns: RosterExportSnapshot["columns"],
  pageWidth: number,
): RosterExportSnapshot["columns"][] => {
  const capacity = Math.floor((pageWidth - ROSTER_SHEET_PADDING * 2 - ROSTER_NUMBER_WIDTH) / ROSTER_COLUMN_WIDTH);
  if (capacity < 1) throw new Error("名簿の列を用紙幅に収められません。");
  const batches: RosterExportSnapshot["columns"][] = [];
  for (let index = 0; index < columns.length; index += capacity) {
    batches.push(columns.slice(index, index + capacity));
  }
  return batches;
};

export type RosterPage = {
  columns: RosterExportSnapshot["columns"];
  rowStart: number;
  rowEnd: number;
  pageNumber: number;
  totalPages: number;
};
export type RosterBatchMeasurement = {
  columns: RosterExportSnapshot["columns"];
  headerHeight: number;
  rowHeights: number[];
};

/** Measurements include wrapping; never renumber rows on a continuation page. */
export const paginateRosterPages = (
  batches: readonly RosterBatchMeasurement[],
  pageHeight: number,
): RosterPage[] => {
  const pages: RosterPage[] = [];
  for (const batch of batches) {
    const available = pageHeight - ROSTER_SHEET_PADDING * 2 - ROSTER_FOOTER_HEIGHT - batch.headerHeight;
    if (available < 0) throw new Error("名簿の見出しが長いためPDFの用紙に収まりません。");
    let start = 0;
    let used = 0;
    batch.rowHeights.forEach((height, index) => {
      if (!Number.isFinite(height) || height <= 0 || height > available) {
        throw new Error("名簿の名前が長いためPDFの1ページに収まりません。名前を短くしてから書き出してください。");
      }
      if (used + height > available) {
        pages.push({ columns: batch.columns, rowStart: start, rowEnd: index, pageNumber: 0, totalPages: 0 });
        start = index;
        used = 0;
      }
      used += height;
    });
    pages.push({ columns: batch.columns, rowStart: start, rowEnd: batch.rowHeights.length, pageNumber: 0, totalPages: 0 });
  }
  return pages.map((page, index) => ({ ...page, pageNumber: index + 1, totalPages: pages.length }));
};

export type RosterPdfLayout = {
  orientation: PdfOrientation;
  pages: RosterPage[];
};
export const chooseRosterPdfLayout = (candidates: readonly RosterPdfLayout[]): RosterPdfLayout => {
  const result = [...candidates].sort((a, b) =>
    a.pages.length - b.pages.length || (a.orientation === "portrait" ? -1 : 1),
  )[0];
  if (!result) throw new Error("名簿をPDFの用紙に収められません。");
  return result;
};

// 16M RGBA pixels already require ~64MB, before DOM/encoder copies.
// An edge limit also avoids html-to-image's automatic canvas downscaling.
export const ROSTER_MAX_PIXELS = 16_000_000;
export const ROSTER_MAX_EDGE = 16_384;
export const rosterPngPixelRatio = (width: number, height: number): number => {
  if (!Number.isFinite(width * height) || width <= 0 || height <= 0) {
    throw new Error("名簿の画像サイズを取得できませんでした。");
  }
  const ratio = Math.min(2, Math.sqrt(ROSTER_MAX_PIXELS / (width * height)), ROSTER_MAX_EDGE / width, ROSTER_MAX_EDGE / height);
  if (ratio < 1) throw new Error("名簿が大きいため画像にできません。PDFで書き出してください。");
  return Math.floor(ratio * 100) / 100;
};
