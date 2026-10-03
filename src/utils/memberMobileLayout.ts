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
};
export type MemberMobilePlan = {
  width: number; height: number; fontSize: number; columns: number; tiers: number;
  headerHeight: number; titleFontSize: number; numberWidth: number; splits: number; blocks: MemberBlock[];
  belowMinimum: boolean;
};
export const memberLineHeight = (font: number) => Math.ceil(font * 1.25);
export const memberHeadingFont = (font: number) => Math.max(1, Math.round(font * .875));
// Japanese closing punctuation can hang beyond a CSS line box. Keep one em of
// trailing space in both measurement and output, without removing characters.
export const memberTextWidth = (available: number, font: number) => available - font;

const candidate = (
  snapshot: RosterExportSnapshot, measure: TextMeasure, width: number, columns: number,
  tiers: number, fontSize: number, preserveGroups: boolean,
): MemberMobilePlan | null => {
  const padding = MEMBER_MOBILE_PADDING, gap = MEMBER_MOBILE_GAP;
  const colWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const line = memberLineHeight(fontSize);
  const headingFont = memberHeadingFont(fontSize);
  const digits = String(Math.max(1, ...snapshot.columns.map(g => g.items.length))).length;
  const numberWidth = Math.ceil(digits * fontSize * 0.75 + 12);
  const nameWidth = memberTextWidth(colWidth - numberWidth, fontSize);
  if (nameWidth < fontSize * 3) return null;
  // Seven/eight columns must still offer enough name space at the 24px floor,
  // even when an explicitly chosen small-text export uses a smaller font.
  if (columns > 6) {
    const readableWidth = memberTextWidth(colWidth - Math.ceil(digits * 24 * .75 + 12), 24);
    if (readableWidth < 24 * 3 || snapshot.columns.some(g => g.items.some(e => measure(e.name, readableWidth, 24, memberLineHeight(24)) > memberLineHeight(24) * 2))) return null;
  }
  // A long project title must stay complete inside the 140–180px heading area.
  // Fit its font independently so it cannot force smaller member names.
  let titleFontSize = Math.max(fontSize, Math.round(fontSize * 1.25));
  const titleHeight = () => measure(snapshot.title, memberTextWidth(width - padding * 2, titleFontSize), titleFontSize, memberLineHeight(titleFontSize), true);
  while (titleFontSize > 1 && titleHeight() + line * 2 + 22 > 180) titleFontSize--;
  const headerHeight = Math.max(150, titleHeight() + line * 2 + 22);
  if (headerHeight > 180) return null;
  const footerHeight = 42;
  const bodyHeight = MEMBER_MOBILE_HEIGHT - padding * 2 - headerHeight - footerHeight;
  const slotHeight = (bodyHeight - gap * (tiers - 1)) / tiers;
  if (slotHeight < line * 2) return null;
  const blocks: MemberBlock[] = [];
  let slot = 0, used = 0, splits = 0;
  const append = (block: Omit<MemberBlock, "x" | "y" | "width">) => {
    if (slot >= columns * tiers) return false;
    blocks.push({ ...block, x: padding + (slot % columns) * (colWidth + gap),
      y: padding + headerHeight + Math.floor(slot / columns) * (slotHeight + gap) + used, width: colWidth });
    used += block.height; return true;
  };
  for (const group of snapshot.columns.filter(g => g.items.length || g.groupId !== null)) {
    let index = 0, continuation = false;
    const heights = group.items.map(e => measure(e.name, nameWidth, fontSize, line) + 9);
    const heading = () => `${group.label}${continuation ? "（続き）" : ""}（${group.items.length}人）`;
    const headingHeight = () => measure(heading(), memberTextWidth(colWidth - 20, headingFont), headingFont, memberLineHeight(headingFont), true) + 20;
    const total = headingHeight() + heights.reduce((a,b) => a+b, 0) + 12;
    if (used && preserveGroups && total <= slotHeight && total > slotHeight - used) { slot++; used = 0; }
    do {
      const h = headingHeight();
      const firstHeight = heights[index] ?? line + 9;
      if (h + firstHeight > slotHeight) return null;
      if (used + h + firstHeight > slotHeight) { slot++; used = 0; }
      if (!append({ height: h, heading: { text: heading(), groupId: group.id, color: group.color, continuation } })) return null;
      if (!group.items.length) {
        if (!append({ height: firstHeight })) return null;
        break;
      }
      while (index < group.items.length && used + heights[index] <= slotHeight) {
        if (!append({ height: heights[index], entry: group.items[index] })) return null;
        index++;
      }
      if (index < group.items.length) { slot++; used = 0; continuation = true; splits++; }
    } while (index < group.items.length);
    used += 12;
  }
  return { width, height: MEMBER_MOBILE_HEIGHT, fontSize, columns, tiers, headerHeight, titleFontSize, numberWidth, splits, blocks, belowMinimum: fontSize < 24 };
};

/** Every candidate is measured at its actual column width and font, with no truncation. */
export function* memberMobileCandidates(snapshot: RosterExportSnapshot, measure: TextMeasure, font: number) {
    for (const width of [1152, 1536]) for (let columns = 1; columns <= (width === 1152 ? 2 : 8); columns++) {
      for (const tiers of [1, 2]) for (const preserve of [true, false]) {
        yield candidate(snapshot, measure, width, columns, tiers, font, preserve);
      }
    }
}
export const bestMemberMobileCandidate = (candidates: MemberMobilePlan[]) => {
    // Maximum text first, then fewer group breaks and tiers. Compact canvas wins
    // only when it offers the same readability and uninterrupted group order.
    candidates.sort((a,b) => a.splits-b.splits || a.tiers-b.tiers || a.columns-b.columns || a.width-b.width);
    return candidates[0] ?? null;
};
export const planMemberMobile = (snapshot: RosterExportSnapshot, measure: TextMeasure, allowSmall = false): MemberMobilePlan | null => {
  for (let font = 32; font >= (allowSmall ? 1 : 24); font--) {
    const result = bestMemberMobileCandidate([...memberMobileCandidates(snapshot, measure, font)].filter((p): p is MemberMobilePlan => p !== null));
    if (result) return result;
  }
  return null;
};
