import { describe, expect, it } from "vitest";
import {
  chooseRosterPdfLayout, createRosterExportSnapshot, paginateRosterPages, rosterPageSize,
  rosterPngPixelRatio, splitRosterColumns, ROSTER_MAX_PIXELS,
} from "./rosterExportLayout";

const snapshot = () => createRosterExportSnapshot("演目", "members",
  Array.from({ length: 6 }, (_, index) => ({ id: `${index}`, name: `名前${index}` })),
  Array.from({ length: 7 }, (_, index) => ({ id: `g${index}`, name: `組${index}`, memberIds: index === 0 ? ["2", "0", "5"] : [] })),
  new Date("2026-10-01T12:00:00Z"),
);

describe("rosterExportLayout", () => {
  it("takes an independent snapshot with matching row numbers and no add rows", () => {
    const items = [{ id: "a", name: "以前" }];
    const data = createRosterExportSnapshot("", "members", items, []);
    items[0].name = "以後";
    expect(data.title).toBe("隊列メーカー");
    expect(data.columns[0].items).toEqual([{ id: "a", name: "以前", no: 1 }]);
  });

  it("splits columns horizontally without losing empty groups or ungrouped", () => {
    const data = snapshot();
    const portrait = splitRosterColumns(data.columns, rosterPageSize("portrait").width);
    const landscape = splitRosterColumns(data.columns, rosterPageSize("landscape").width);
    expect(portrait.map((batch) => batch.length)).toEqual([3, 3, 2]);
    expect(landscape.map((batch) => batch.length)).toEqual([4, 4]);
    expect(portrait.flat()).toEqual(data.columns);
    expect(() => splitRosterColumns(data.columns, 100)).toThrow();
  });

  it("uses measured wrapping heights, repeats columns, numbers all pages, and retains No.", () => {
    const data = snapshot();
    const batches = splitRosterColumns(data.columns, 740);
    const pages = paginateRosterPages([
      { columns: batches[0], headerHeight: 40, rowHeights: [30, 70, 30] },
      { columns: batches[1], headerHeight: 40, rowHeights: [] },
      { columns: batches[2], headerHeight: 40, rowHeights: [30, 30, 30] },
    ], 192); // 100px available after header, padding, footer
    expect(pages.map((page) => [page.rowStart, page.rowEnd])).toEqual([[0, 2], [2, 3], [0, 0], [0, 3]]);
    expect(pages.map((page) => `${page.pageNumber} / ${page.totalPages}`)).toEqual(["1 / 4", "2 / 4", "3 / 4", "4 / 4"]);
    expect(pages[1].columns[0].items.slice(pages[1].rowStart, pages[1].rowEnd)).toEqual([{ id: "5", name: "名前5", no: 3 }]);
    expect(pages[0].columns).toBe(pages[1].columns);
  });

  it("creates one page for an empty roster and no fake rows", () => {
    const data = createRosterExportSnapshot("空", "members", [], []);
    const pages = paginateRosterPages([{ columns: data.columns, headerHeight: 80, rowHeights: [] }], 1000);
    expect(pages).toEqual([{ columns: data.columns, rowStart: 0, rowEnd: 0, pageNumber: 1, totalPages: 1 }]);
    expect(data.totalCount).toBe(0);
  });

  it("rejects an oversized header or row instead of clipping content", () => {
    const columns = snapshot().columns;
    expect(() => paginateRosterPages([{ columns, headerHeight: 500, rowHeights: [] }], 200)).toThrow();
    expect(() => paginateRosterPages([{ columns, headerHeight: 40, rowHeights: [101] }], 192)).toThrow();
  });

  it("chooses the fewer-page orientation and portrait on ties", () => {
    const pages = paginateRosterPages([{ columns: snapshot().columns, headerHeight: 40, rowHeights: [30] }], 200);
    expect(chooseRosterPdfLayout([
      { orientation: "portrait", pages: [...pages, ...pages] }, { orientation: "landscape", pages },
    ]).orientation).toBe("landscape");
    expect(chooseRosterPdfLayout([
      { orientation: "landscape", pages }, { orientation: "portrait", pages },
    ]).orientation).toBe("portrait");
  });

  it("keeps 2x normally, lowers resolution within the budget, and refuses oversized PNG", () => {
    expect(rosterPngPixelRatio(1000, 1000)).toBe(2);
    const ratio = rosterPngPixelRatio(3000, 2000);
    expect(ratio).toBeGreaterThanOrEqual(1);
    expect(ratio).toBeLessThan(2);
    expect(3000 * 2000 * ratio ** 2).toBeLessThanOrEqual(ROSTER_MAX_PIXELS);
    expect(() => rosterPngPixelRatio(5000, 4000)).toThrow("PDFで書き出してください");
    expect(() => rosterPngPixelRatio(17000, 50)).toThrow("PDFで書き出してください");
    expect(() => rosterPngPixelRatio(0, 10)).toThrow();
  });
});
