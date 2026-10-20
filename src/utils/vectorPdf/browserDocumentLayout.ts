import { cachedFontBytes, checkAbort, fetchFontBytes, FONT_FAMILY, fontFileName, type FontWeight } from "./fonts";
import { CSS_PX_MM, UnsupportedVectorLayout, type Drawing, type Rect, type TextLine } from "./model";
import type { AssignmentLayout } from "./assignmentModel";
import type { AssignmentPrintEntry } from "../printLayout";
import { measureMixedGraphemes, slicePlacements } from "./browserMixedText";
import { layoutGraphemes } from "./textRuns";
import type { GraphemePlacement } from "./model";

const browserFaces = new Map<FontWeight, FontFace>();
const baselines = new Map<string, { line: number; range: number }>();
/** CSS rounds font ascent/descent to layout pixels. Preserve its actual inline
 * baseline, especially for large names, rather than approximate with TTF metrics. */
export function measureBaseline(style: CSSStyleDeclaration) {
  const key = `${style.fontFamily}/${style.fontWeight}/${style.fontSize}`;
  const cached = baselines.get(key);
  if (cached) return cached;
  const host = document.createElement("span"), probe = document.createElement("span");
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", visibility: "hidden", display: "block",
    fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontSize: style.fontSize, lineHeight: "1", whiteSpace: "nowrap" });
  host.textContent = "国";
  Object.assign(probe.style, { display: "inline-block", width: "0", height: "0", verticalAlign: "baseline" });
  host.append(probe); document.body.append(host);
  try {
    const range = document.createRange(); range.selectNodeContents(host.firstChild!);
    const r = range.getBoundingClientRect(), h = host.getBoundingClientRect(), baseline = probe.getBoundingClientRect().y;
    const result = { line: (baseline - h.y - h.height / 2) * CSS_PX_MM,
      range: (baseline - r.y - r.height / 2) * CSS_PX_MM };
    baselines.set(key, result); return result;
  } finally { host.remove(); }
}
/** A4's draw styles (700/800/900) all map to Bold. Regular is not requested. */
export async function ensureBrowserFonts(weights: readonly FontWeight[], signal?: AbortSignal) {
  for (const weight of weights) {
    checkAbort(signal);
    if (browserFaces.has(weight)) continue;
    const { bytes } = await cachedFontBytes(fetchFontBytes, fontFileName(weight), signal);
    const face = new FontFace(FONT_FAMILY, bytes.slice().buffer, { weight: weight === "bold" ? "700 1000" : "100 600" });
    await face.load();
    checkAbort(signal);
    document.fonts.add(face); browserFaces.set(weight, face);
  }
}

export function relativeRect(el: Element, root: Element): Rect {
  const r = el.getBoundingClientRect(), b = root.getBoundingClientRect();
  return { x: (r.x - b.x) * CSS_PX_MM, y: (r.y - b.y) * CSS_PX_MM,
    width: r.width * CSS_PX_MM, height: r.height * CSS_PX_MM };
}

/** Read native line wrapping, including implicit line breaks in direct text nodes.
 * No HTML rasterization and no independent word wrapping implementation. */
export function measureTextLines(el: HTMLElement, root: HTMLElement, clip?: Rect): TextLine[] {
  const origin = root.getBoundingClientRect();
  const style = getComputedStyle(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const groups: { text: string; x: number; y: number; width: number; start: number; end: number }[] = [];
  let node: Node | null;
  let total = 0;
  while ((node = walker.nextNode())) {
    const value = node.textContent ?? "";
    let offset = 0;
    for (const ch of layoutGraphemes(value)) {
      const start = total + offset;
      const range = document.createRange(); range.setStart(node, offset); offset += ch.length; range.setEnd(node, offset);
      const r = range.getBoundingClientRect();
      const x = (r.x - origin.x) * CSS_PX_MM, y = (r.y + r.height / 2 - origin.y) * CSS_PX_MM;
      const width = r.width * CSS_PX_MM, hh = r.height * CSS_PX_MM / 2;
      if (clip && (x + width <= clip.x || x >= clip.x + clip.width || y + hh <= clip.y || y - hh >= clip.y + clip.height)) continue;
      const last = groups[groups.length - 1];
      if (last && last.end === start && Math.abs(last.y - y) < .01 && Math.abs(last.x + last.width - x) < .05) { last.text += ch; last.width += width; last.end = total + offset; }
      else groups.push({ text: ch, x, y, width, start, end: total + offset });
    }
    total += value.length;
  }
  const rgb = style.color.match(/^rgb\((\d+),?\s+(\d+),?\s+(\d+)\)$/);
  if (!rgb) throw new UnsupportedVectorLayout(`文字色の形式が未対応です: ${style.color}`);
  const color = "#" + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, "0")).join("");
  let mixed: GraphemePlacement[] | undefined;
  return groups.map(g => ({ kind: "text", text: g.text, x: g.x + g.width / 2, y: g.y, size: parseFloat(style.fontSize) * CSS_PX_MM,
    weight: Number(style.fontWeight), color, baselineOffset: measureBaseline(style).range,
    measureMixed: () => slicePlacements(mixed ??= measureMixedGraphemes(el, root), g.start, g.end) }));
}

const shadows = new Map<string, string>();
/** Only the soft shadow is bitmap. Circle, inset ring and names remain vectors.
 * Reused across all members/pages; no stage or text is present in this tiny PNG. */
function memberShadow(rect: Rect): Extract<Drawing, { kind: "image" }> {
  const padding = 9, key = rect.width.toFixed(4), dpi = 192, unit = dpi / 25.4;
  let dataUrl = shadows.get(key);
  if (!dataUrl) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((rect.width + padding * 2) * unit);
    canvas.height = Math.ceil((rect.height + padding * 2) * unit);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UnsupportedVectorLayout("割当欄の影を描画できません。");
    ctx.scale(unit, unit);
    ctx.shadowColor = "rgba(15,23,42,.16)"; ctx.shadowBlur = 2.8 * unit; ctx.shadowOffsetY = 1.2 * unit;
    ctx.fillStyle = "#000000";
    ctx.beginPath(); ctx.arc(padding + rect.width / 2, padding + rect.height / 2, rect.width / 2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(padding + rect.width / 2, padding + rect.height / 2, rect.width / 2, 0, Math.PI * 2); ctx.fill();
    dataUrl = canvas.toDataURL("image/png"); shadows.set(key, dataUrl);
    canvas.width = 0; canvas.height = 0;
  }
  return { kind: "image", x: rect.x - padding, y: rect.y - padding, width: Math.ceil((rect.width + padding * 2) * unit) / unit,
    height: Math.ceil((rect.height + padding * 2) * unit) / unit, dataUrl, cacheKey: `assignment-shadow-${key}` };
}

export function measureAssignmentLayout(scene: HTMLElement, entries: AssignmentPrintEntry[]): AssignmentLayout {
  const panel = scene.querySelector<HTMLElement>(".print-assignment-sheet");
  if (!panel) throw new UnsupportedVectorLayout("道具割当欄が見つかりません。");
  const gridMm = parseFloat(getComputedStyle(panel).backgroundSize) * CSS_PX_MM;
  if (!(gridMm > 0)) throw new UnsupportedVectorLayout("割当欄の格子寸法が不正です。");
  const empty = panel.querySelector<HTMLElement>(".print-assignment-sheet__empty");
  return { panel: relativeRect(panel, scene), gridMm, emptyText: empty ? measureTextLines(empty, scene) : [],
    entries: [...panel.querySelectorAll<HTMLElement>(".print-assignment-sheet__card")].map((card, i) => {
      if (!entries[i]) throw new UnsupportedVectorLayout("割当カード数が一致しません。");
      const object = card.querySelector<HTMLElement>(".print-assignment-sheet__object")!;
      const r = relativeRect(object, scene);
      return { objectId: entries[i].object.id, object: r, name: measureTextLines(object, scene, r),
        members: [...card.querySelectorAll<HTMLElement>(".print-assignment-sheet__member")].map((member, j) => {
          if (!entries[i].assignedMembers[j]) throw new UnsupportedVectorLayout("割当メンバー数が一致しません。");
          const rect = relativeRect(member, scene);
          return { memberId: entries[i].assignedMembers[j].id, rect, shadow: memberShadow(rect),
            lines: [...member.querySelectorAll<HTMLElement>(".print-member__label-line")].flatMap(line => measureTextLines(line, scene)) };
        }) };
    }) };
}
