import { CSS_PX_MM, type GraphemePlacement, type PropTextLayout, type TextLine } from "./model";
import { measureMixedGraphemes, slicePlacements } from "./browserMixedText";
import { layoutGraphemes } from "./textRuns";

/** CSS overflow and fractional-pixel rounding affect legacy A4 fitting. Measure only
 * the existing print page's scroll extent; never derive shape positions/angles from it. */
export const measurePrintPageExtent = (element: HTMLElement) => ({
  width: element.scrollWidth * CSS_PX_MM, height: element.scrollHeight * CSS_PX_MM,
});

/** Only CSS-owned prop wrapping is measured. Shape centres/angles never come from a DOM bbox.
 * Call after the two FontFaces have loaded; the prototype generator owns their lifetime. */
export const measurePropText: PropTextLayout = (value, width, height, correction, clipRadius = 0) => {
  const host = document.createElement("div");
  host.className = "print-object";
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", visibility: "hidden",
    width: `${width}mm`, height: `${height}mm`, fontFamily: '"BIZUDPGothic"' });
  const span = document.createElement("span");
  span.textContent = value;
  host.append(span); document.body.append(host);
  try {
    const centre = host.getBoundingClientRect();
    const source = span.firstChild;
    if (!source) return [];
    const groups: { value: string; x: number; y: number; width: number; height: number; start: number; end: number }[] = [];
    let offset = 0;
    for (const ch of layoutGraphemes(value)) {
      const start = offset;
      const range = document.createRange();
      range.setStart(source, offset); offset += ch.length; range.setEnd(source, offset);
      const r = range.getBoundingClientRect();
      const x = (r.x + r.width / 2 - centre.x - centre.width / 2) * CSS_PX_MM;
      const y = (r.y + r.height / 2 - centre.y - centre.height / 2) * CSS_PX_MM;
      const rad = correction * Math.PI / 180;
      const rx = x * Math.cos(rad) - y * Math.sin(rad), ry = x * Math.sin(rad) + y * Math.cos(rad);
      // Exclude fully clipped glyphs BEFORE cmap checks/subsetting. Keep partially visible
      // ones and their original endpoints/positions; the PDF shape clip handles the edge.
      const hw = r.width * CSS_PX_MM / 2, hh = r.height * CSS_PX_MM / 2;
      if (rx + hw <= -width / 2 || rx - hw >= width / 2 || ry + hh <= -height / 2 || ry - hh >= height / 2) continue;
      if (clipRadius > 0) {
        const dx = Math.max(0, Math.abs(rx) - hw - (width / 2 - clipRadius));
        const dy = Math.max(0, Math.abs(ry) - hh - (height / 2 - clipRadius));
        if (dx * dx + dy * dy >= clipRadius * clipRadius) continue;
      }
      const previous = groups[groups.length - 1];
      const gx = (r.x - centre.x - centre.width / 2) * CSS_PX_MM;
      if (previous && previous.end === start && Math.abs(previous.y - y) < .01 && Math.abs(previous.x + previous.width - gx) < .05) {
        previous.value += ch; previous.width += r.width * CSS_PX_MM; previous.end = offset;
      } else groups.push({ value: ch, x: gx, y, width: r.width * CSS_PX_MM, height: r.height * CSS_PX_MM, start, end: offset });
    }
    let mixed: GraphemePlacement[] | undefined;
    return groups.map((g): TextLine => ({ kind: "text", text: g.value, x: g.x + g.width / 2, y: g.y,
      color: "#172033", weight: 800, size: 13 * CSS_PX_MM,
      measureMixed: () => {
        document.body.append(host);
        try {
          const r = host.getBoundingClientRect();
          mixed ??= measureMixedGraphemes(span, host);
          return slicePlacements(mixed, g.start, g.end).map(p => ({ ...p,
            x: p.x - r.width * CSS_PX_MM / 2, baseline: p.baseline - r.height * CSS_PX_MM / 2 }));
        } finally { host.remove(); }
      } }));
  } finally { host.remove(); }
};
