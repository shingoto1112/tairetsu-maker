import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { RosterExportSheet } from "../components/RosterExportSheet";
import { elementToPngBlob } from "./exportImage";
import { elementToPngPage, waitForExportFonts } from "./exportRaster";
import type { PdfOrientation } from "./pdfExport";
import {
  chooseRosterPdfLayout, paginateRosterPages, rosterPageSize, rosterPngPixelRatio,
  splitRosterColumns, ROSTER_COLUMN_WIDTH, ROSTER_NUMBER_WIDTH,
  ROSTER_SHEET_PADDING,
  type RosterBatchMeasurement, type RosterExportSnapshot, type RosterPage, type RosterPdfLayout,
} from "./rosterExportLayout";

const withExportHost = async <T,>(
  callback: (render: (node: ReactNode) => HTMLElement) => Promise<T>,
): Promise<T> => {
  const host = document.createElement("div");
  host.dataset.rosterExportHost = "true";
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none" });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    return await callback((node) => {
      flushSync(() => root.render(node));
      const sheet = host.firstElementChild;
      if (!(sheet instanceof HTMLElement)) throw new Error("名簿の書き出しレイアウトを作成できませんでした。");
      return sheet;
    });
  } finally {
    try { root.unmount(); }
    finally { host.remove(); }
  }
};

const measureLayout = async (
  snapshot: RosterExportSnapshot,
  orientation: PdfOrientation,
  check: () => void = () => {},
  waitFonts: () => Promise<unknown> = () => document.fonts?.ready ?? Promise.resolve(),
): Promise<RosterPdfLayout> => {
  const size = rosterPageSize(orientation);
  const measurements: RosterBatchMeasurement[] = [];
  for (const columns of splitRosterColumns(snapshot.columns, size.width)) {
    const rowCount = Math.max(0, ...columns.map((column) => column.items.length));
    // Only the header and a single row are mounted during measurement.
    const measurement = await withExportHost(async (render) => {
      const page: RosterPage = { columns, rowStart: 0, rowEnd: 0, pageNumber: 1, totalPages: 1 };
      let element = render(<RosterExportSheet snapshot={snapshot} page={page} width={size.width} />);
      await waitFonts(); check();
      const heading = element.querySelector<HTMLElement>("[data-roster-export-heading]")!;
      const columnHeading = element.querySelector<HTMLElement>("[data-roster-export-columns]")!;
      // Heading's margin and a 2px rounding/border allowance are kept on every page.
      const headerHeight = Math.ceil(heading.getBoundingClientRect().height + columnHeading.getBoundingClientRect().height + 14);
      const rowHeights: number[] = [];
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        check();
        element = render(<RosterExportSheet snapshot={snapshot}
          page={{ ...page, rowStart: rowIndex, rowEnd: rowIndex + 1 }} width={size.width} />);
        const row = element.querySelector<HTMLElement>("[data-roster-export-row]")!;
        rowHeights.push(Math.ceil(row.getBoundingClientRect().height));
        // Allow the busy indicator to paint while measuring a large roster.
        if ((rowIndex + 1) % 64 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      return { columns, headerHeight, rowHeights };
    });
    measurements.push(measurement);
  }
  return { orientation, pages: paginateRosterPages(measurements, size.height) };
};

export const generateRosterExport = async (
  snapshot: RosterExportSnapshot,
  kind: "png",
  options?: { signal: AbortSignal; onProgress: (message: string) => void; paginatedImages?: boolean },
): Promise<{ blob: Blob; reducedResolution: boolean; preview?: Blob; pageCount?: number; images?: Blob[] }> => {
  const check = () => { if (options?.signal.aborted) throw new DOMException("書き出しを取り消しました。", "AbortError"); };
  const waitFonts = () => options ? waitForExportFonts(options.signal) : document.fonts?.ready ?? Promise.resolve();
  check();
  if (!options?.paginatedImages) {
    const width = Math.max(740, ROSTER_SHEET_PADDING * 2 + ROSTER_NUMBER_WIDTH + snapshot.columns.length * ROSTER_COLUMN_WIDTH);
    const page: RosterPage = {
      columns: snapshot.columns, rowStart: 0,
      rowEnd: Math.max(0, ...snapshot.columns.map((column) => column.items.length)),
      pageNumber: 1, totalPages: 1,
    };
    return withExportHost(async (render) => {
      const element = render(<RosterExportSheet snapshot={snapshot} page={page} width={width} />);
      await document.fonts?.ready;
      const pixelRatio = rosterPngPixelRatio(Math.ceil(element.scrollWidth), Math.ceil(element.scrollHeight));
      const blob = await elementToPngBlob(element, { pixelRatio });
      return { blob, reducedResolution: pixelRatio < 2 };
    });
  }

  // Compare both orientations at the same body font size; prefer portrait on ties.
  const candidates: RosterPdfLayout[] = [];
  let layoutError: unknown;
  for (const orientation of ["portrait", "landscape"] as const) {
    try { candidates.push(await measureLayout(snapshot, orientation, check, waitFonts)); }
    catch (error) { check(); layoutError = error; }
  }
  if (candidates.length === 0 && layoutError) throw layoutError;
  const layout = chooseRosterPdfLayout(candidates);
  const size = rosterPageSize(layout.orientation);
  const images: Blob[] = [];
  let preview: Blob | undefined;
  // Each page is independently mounted, captured, and removed before the next.
  for (const page of layout.pages) {
    check(); options?.onProgress(`${page.pageNumber}/${layout.pages.length}ページを作成中…`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); check();
    const image = await withExportHost(async (render) => {
      const element = render(<RosterExportSheet snapshot={snapshot} page={page} {...size} />);
      await waitFonts(); check();
      if (element.scrollHeight > size.height || element.scrollWidth > size.width) {
        throw new Error("名簿のページが用紙に収まりません。名前やグループ名を短くしてから書き出してください。");
      }
      return elementToPngPage(element);
    });
    check();
    if (options) {
      const blob = await (await fetch(image.dataUrl)).blob();
      if (!blob.size) throw new Error("画像を作成できませんでした。");
      preview ??= blob;
      images.push(blob);
    }
  }
  check();
  const blob = images[0];
  check();
  return { blob, reducedResolution: false, preview, images, pageCount: layout.pages.length };
};
