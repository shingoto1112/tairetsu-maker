import type { RosterEntry, RosterExportSnapshot } from "./rosterExportSnapshot";
import type { TextMeasure } from "./mobileExportLayout";

export const MEMBER_MOBILE_FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
export const MEMBER_MOBILE_HEIGHT = 2048;
export const MEMBER_MOBILE_PADDING = 48;
export const MEMBER_MOBILE_GAP = 24;
export type MemberBlock = {
  x: number; y: number; width: number; height: number;
  heading?: { text: string; groupId: string; color?: string; continuation: boolean };
  entry?: RosterEntry;
  textWidth?: number;
};
export type MemberMobilePlan = {
  width: number; height: number; fontSize: number; columns: number; tiers: number;
  headerHeight: number; titleFontSize: number; numberWidth: number; splits: number; blocks: MemberBlock[];
  belowMinimum: boolean;
  wrappedNames: number;
  titleTextWidth: number;
};
export type MemberTextMeasure = TextMeasure & {
  textWidth?: (text: string, font: number) => number;
  fitWidth?: (text: string, available: number, font: number, line: number, bold?: boolean) => number;
};
export const memberLineHeight = (font: number) => Math.ceil(font * 1.25);
export const memberHeadingFont = (font: number) => Math.max(1, Math.round(font * .875));
// A tiny rounding allowance; actual hanging punctuation is checked by the DOM probe.
export const memberTextWidth = (available: number, _font: number) => available - 2;
const fitWidth = (measure: MemberTextMeasure, text: string, available: number, font: number, line: number, bold = false) =>
  measure.fitWidth?.(text, available, font, line, bold) ?? memberTextWidth(available, font);

const candidate = (
  snapshot: RosterExportSnapshot, measure: MemberTextMeasure, width: number, columns: number,
  tiers: number, fontSize: number, preserveGroups: boolean,
): MemberMobilePlan | null => {
  const padding = MEMBER_MOBILE_PADDING, gap = MEMBER_MOBILE_GAP;
  const colWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const line = memberLineHeight(fontSize);
  const headingFont = memberHeadingFont(fontSize);
  const numbers = snapshot.columns.flatMap(g => g.items.map(e => `${e.no}.`));
  const numberWidth = Math.ceil(Math.max(0, ...numbers.map(n => measure.textWidth?.(n, fontSize * .75) ?? n.length * fontSize * .45)) + 12);
  const nameWidth = memberTextWidth(colWidth - numberWidth, fontSize);
  if (nameWidth < fontSize * 3) return null;
  // Seven/eight columns must still offer enough name space at the 24px floor,
  // even when an explicitly chosen small-text export uses a smaller font.
  if (columns > 6) {
    const readableNumberWidth = Math.ceil(Math.max(0, ...numbers.map(n => measure.textWidth?.(n, 18) ?? n.length * 24 * .45)) + 12);
    const readableWidth = memberTextWidth(colWidth - readableNumberWidth, 24);
    if (readableWidth < 24 * 3 || snapshot.columns.some(g => g.items.some(e => measure(e.name, readableWidth, 24, memberLineHeight(24)) > memberLineHeight(24) * 2))) return null;
  }
  // A long project title must stay complete inside the 140–180px heading area.
  // Fit its font independently so it cannot force smaller member names.
  let titleFontSize = Math.max(fontSize, Math.round(fontSize * 1.25));
  const titleWidth = () => fitWidth(measure, snapshot.title, width - padding * 2, titleFontSize, memberLineHeight(titleFontSize), true);
  const titleHeight = () => measure(snapshot.title, titleWidth(), titleFontSize, memberLineHeight(titleFontSize), true);
  while (titleFontSize > 1 && titleHeight() + line * 2 + 22 > 180) titleFontSize--;
  const headerHeight = Math.max(150, titleHeight() + line * 2 + 22);
  if (headerHeight > 180) return null;
  const footerHeight = 42;
  const bodyHeight = MEMBER_MOBILE_HEIGHT - padding * 2 - headerHeight - footerHeight;
  const slotHeight = (bodyHeight - gap * (tiers - 1)) / tiers;
  if (slotHeight < line * 2) return null;
  const blocks: MemberBlock[] = [];
  let slot = 0, used = 0, splits = 0, wrappedNames = 0;
  const append = (block: Omit<MemberBlock, "x" | "y" | "width">) => {
    if (slot >= columns * tiers) return false;
    blocks.push({ ...block, x: padding + (slot % columns) * (colWidth + gap),
      y: padding + headerHeight + Math.floor(slot / columns) * (slotHeight + gap) + used, width: colWidth });
    used += block.height; return true;
  };
  for (const group of snapshot.columns.filter(g => g.items.length || g.groupId !== null)) {
    let index = 0, continuation = false;
    const widths = group.items.map(e => fitWidth(measure, e.name, colWidth - numberWidth, fontSize, line));
    const heights = group.items.map((e, index) => {
      const height = measure(e.name, widths[index], fontSize, line);
      if (height > line) wrappedNames++;
      return height + 9;
    });
    const heading = () => `${group.label}${continuation ? "（続き）" : ""}（${group.items.length}人）`;
    const headingWidth = () => fitWidth(measure, heading(), colWidth - 20, headingFont, memberLineHeight(headingFont), true);
    const headingHeight = () => measure(heading(), headingWidth(), headingFont, memberLineHeight(headingFont), true) + 20;
    const total = headingHeight() + heights.reduce((a,b) => a+b, 0) + 12;
    if (used && preserveGroups && total <= slotHeight && total > slotHeight - used) { slot++; used = 0; }
    do {
      const h = headingHeight();
      const firstHeight = heights[index] ?? line + 9;
      if (h + firstHeight > slotHeight) return null;
      if (used + h + firstHeight > slotHeight) { slot++; used = 0; }
      if (!append({ height: h, textWidth: headingWidth(), heading: { text: heading(), groupId: group.id, color: group.color, continuation } })) return null;
      if (!group.items.length) {
        if (!append({ height: firstHeight })) return null;
        break;
      }
      while (index < group.items.length && used + heights[index] <= slotHeight) {
        if (!append({ height: heights[index], textWidth: widths[index], entry: group.items[index] })) return null;
        index++;
      }
      if (index < group.items.length) { slot++; used = 0; continuation = true; splits++; }
    } while (index < group.items.length);
    used += 12;
  }
  return { width, height: MEMBER_MOBILE_HEIGHT, fontSize, columns, tiers, headerHeight, titleFontSize, titleTextWidth: titleWidth(), numberWidth, splits, wrappedNames, blocks, belowMinimum: fontSize < 24 };
};

/** Every candidate is measured at its actual column width and font, with no truncation. */
export function* memberMobileCandidates(snapshot: RosterExportSnapshot, measure: MemberTextMeasure, font: number) {
    for (const width of [1152, 1536]) for (let columns = 1; columns <= (width === 1152 ? 2 : 8); columns++) {
      for (const tiers of [1, 2]) for (const preserve of [true, false]) {
        yield candidate(snapshot, measure, width, columns, tiers, font, preserve);
      }
    }
}
export const bestMemberMobileCandidate = (candidates: MemberMobilePlan[]) => {
    // Above the 28px readability target, avoid wrapped names before enlarging text.
    candidates.sort((a,b) => a.wrappedNames-b.wrappedNames || b.fontSize-a.fontSize || a.splits-b.splits || a.tiers-b.tiers || a.columns-b.columns || a.width-b.width);
    return candidates[0] ?? null;
};
export const planMemberMobile = (snapshot: RosterExportSnapshot, measure: MemberTextMeasure, allowSmall = false): MemberMobilePlan | null => {
  const readable: MemberMobilePlan[] = [];
  for (let font = 32; font >= (allowSmall ? 1 : 24); font--) {
    const result = bestMemberMobileCandidate([...memberMobileCandidates(snapshot, measure, font)].filter((p): p is MemberMobilePlan => p !== null));
    if (font >= 28) {
      if (result) readable.push(result);
      if (result?.wrappedNames === 0) return result;
      if (font === 28 && readable.length) return bestMemberMobileCandidate(readable);
    } else if (result) return result;
  }
  return null;
};
