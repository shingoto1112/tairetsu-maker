import type { RosterExportSnapshot } from "./rosterExportSnapshot";

export const MOBILE_WIDTH = 540;
export const MOBILE_MAX_HEIGHT = 960;
export const MOBILE_PADDING = 24;
export const MOBILE_INNER_WIDTH = MOBILE_WIDTH - MOBILE_PADDING * 2;
export type TextMeasure = (text: string, width: number, fontSize: number, lineHeight: number, bold?: boolean) => number;
export type MobileHeading = { key: string; text: string; color?: string; kind: "group" };
export type MobileRow = { cells: { text: string; no?: number }[]; muted?: boolean };
export type MobileBlock = { heading?: MobileHeading; row?: MobileRow; height: number };
export type MobileSection = { headings: MobileHeading[]; rows: MobileRow[] };
export type MobilePage = { blocks: MobileBlock[]; height: number; pageNumber: number; totalPages: number; headerHeight: number };

export const rowHeight = (row: MobileRow, measure: TextMeasure) => {
  const width = (MOBILE_INNER_WIDTH - (row.cells.length - 1) * 16) / row.cells.length;
  return Math.max(34, ...row.cells.map((cell) => measure(cell.text, width - (cell.no === undefined ? 0 : 44), 24, 34))) + 16;
};
export const headingHeight = (heading: MobileHeading, measure: TextMeasure) =>
  measure(heading.text, MOBILE_INNER_WIDTH - 24, 28, 38, true) + 20;

/** Uses actual wrapped heights at the two-column name width, never character counts. */
export const rosterMobileSections = (snapshot: RosterExportSnapshot, measure: TextMeasure): MobileSection[] =>
  snapshot.columns.filter((group) => group.items.length || group.groupId !== null).map((group) => {
    const longCount = group.items.filter((item) => measure(item.name, 194, 24, 34) > 68).length;
    const columns = longCount > 0 && longCount / group.items.length >= 0.3 ? 1 : 2;
    const rows: MobileRow[] = [];
    for (let index = 0; index < group.items.length; index += columns) {
      rows.push({ cells: group.items.slice(index, index + columns).map((item) => ({ text: item.name, no: item.no })) });
    }
    if (!rows.length) rows.push({ cells: [{ text: "登録なし" }], muted: true });
    return { headings: [{ key: `group:${group.id}`, text: `${group.label}（${group.items.length}人）`, color: group.color, kind: "group" }], rows };
  });

// Split only oversize rows, including a single exceptionally long name. Keep every character.
const splitRow = (row: MobileRow, maximum: number, measure: TextMeasure): MobileRow[] => {
  if (rowHeight(row, measure) <= maximum) return [row];
  const width = (MOBILE_INNER_WIDTH - (row.cells.length - 1) * 16) / row.cells.length;
  const remaining = row.cells.map((cell) => Array.from(cell.text));
  const result: MobileRow[] = [];
  while (remaining.some((text) => text.length)) {
    const cells = row.cells.map((cell, index) => {
      const text = remaining[index];
      if (!text.length) return { ...cell, text: "" };
      let low = 1, high = text.length, count = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (measure(text.slice(0, mid).join(""), width - (cell.no === undefined ? 0 : 44), 24, 34) + 16 <= maximum) { count = mid; low = mid + 1; }
        else high = mid - 1;
      }
      if (!count) throw new Error("見出しが長く、本文をページに収められません。");
      return { ...cell, text: text.splice(0, count).join("") };
    });
    result.push({ ...row, cells });
  }
  return result;
};

export const planMobilePages = (
  sections: readonly MobileSection[], measure: TextMeasure,
  headerHeight: (first: boolean) => number,
): MobilePage[] => {
  const pages: MobilePage[] = [];
  let page: MobilePage;
  let used = 0;
  let context: string[] = [];
  const seenHeadings = new Set<string>();
  const newPage = () => {
    page = { blocks: [], height: MOBILE_MAX_HEIGHT, pageNumber: pages.length + 1, totalPages: 0, headerHeight: headerHeight(pages.length === 0) };
    if (!Number.isFinite(page.headerHeight) || page.headerHeight + MOBILE_PADDING * 2 >= MOBILE_MAX_HEIGHT) throw new Error("隊列表名が長く、ページに収められません。");
    pages.push(page); used = MOBILE_PADDING * 2 + page.headerHeight; context = [];
  };
  newPage();
  for (const section of sections) {
    const continuationHeadings = section.headings.map((heading) => ({ ...heading, text: `${heading.text}（続き）` }));
    const allHeadingHeight = continuationHeadings.reduce((sum, heading) => sum + headingHeight(heading, measure), 0);
    const maximumRow = MOBILE_MAX_HEIGHT - MOBILE_PADDING * 2 - Math.max(headerHeight(false), headerHeight(true)) - allHeadingHeight;
    if (maximumRow < 50) throw new Error("見出しが長く、本文をページに収められません。");
    const rows = section.rows.flatMap((row) => splitRow(row, maximumRow, measure));
    for (const row of rows) {
      const needed = () => section.headings.filter((heading, index) => context[index] !== heading.key)
        .map((heading) => seenHeadings.has(heading.key) ? { ...heading, text: `${heading.text}（続き）` } : heading);
      let headings = needed();
      const height = rowHeight(row, measure);
      if (used + headings.reduce((sum, heading) => sum + headingHeight(heading, measure), 0) + height > MOBILE_MAX_HEIGHT) {
        if (!page!.blocks.length) throw new Error("内容をページに収められません。");
        newPage(); headings = needed();
      }
      for (const heading of headings) {
        const h = headingHeight(heading, measure);
        page!.blocks.push({ heading, height: h }); used += h;
        seenHeadings.add(heading.key);
      }
      page!.blocks.push({ row, height }); used += height;
      context = section.headings.map((heading) => heading.key);
    }
  }
  // Only the last page shrinks; intermediate pages stay 540 x 960.
  page!.height = Math.ceil(used);
  return pages.map((item) => ({ ...item, totalPages: pages.length }));
};
