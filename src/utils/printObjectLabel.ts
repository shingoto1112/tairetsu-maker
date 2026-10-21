/** All lengths are layout millimetres, BEFORE the page is fitted to A4. */
export const PRINT_OBJECT_LABEL_MIN_MM = 1.8;
export type LabelMeasure = (text: string, size: number) => { width: number; height: number };
export type PrintObjectLabelInput = {
  text: string; width: number; height: number; radius?: number;
  paddingX: number; paddingY: number; maxSize: number; minSize?: number;
};
export type PrintObjectLabelLayout = {
  size: number; overflow: boolean;
  lines: { text: string; x: number; y: number; width: number; height: number; boxOffsetY?: number }[];
};

/** Keep identifiers, the last numbered word, and bracketed suffixes intact.
 * Prefer native Japanese word boundaries when available; graphemes are the
 * fallback for a single unsegmented word. Never split a grapheme cluster. */
export function printObjectLabelCandidates(text: string): string[][] {
  type GraphemeSegmenter = new(locale: string, options: { granularity: "grapheme" }) => { segment(t: string): Iterable<{ segment: string }> };
  const Graphemes = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
  // Missing Segmenter: keep the entire name indivisible, rather than splitting
  // emoji/combining sequences. The ordinary image writer remains available.
  if (!Graphemes) return [[text]];
  const chars = [...new Graphemes("ja", { granularity: "grapheme" }).segment(text)].map(s => s.segment), boundaries: number[] = [];
  let depth = 0;
  const open = /^[（(［\[｛{「『【〈《]$/u, close = /^[）)］\]｝}」』】〉》]$/u;
  const number = /^[0-9０-９①-⑳㉑-㊿❶-❿]$/u;
  for (let i = 1; i < chars.length; i++) {
    const a = chars[i - 1], b = chars[i];
    if (open.test(a)) depth++;
    if (close.test(a)) depth = Math.max(0, depth - 1);
    if (depth || close.test(b) || open.test(a)) continue;
    if (/^[\p{Script=Latin}\p{N}_-]+$/u.test(a) && /^[\p{Script=Latin}\p{N}_-]+$/u.test(b)) continue;
    // Attach a number/bracket suffix to the preceding word, including 箱1/大旗①.
    if (number.test(b)) continue;
    if (open.test(b)) continue;
    boundaries.push(i);
  }
  type WordSegmenter = new(locale: string, options: { granularity: "word" }) => { segment(t: string): Iterable<{ index: number }> };
  const Segmenter = (Intl as unknown as { Segmenter?: WordSegmenter }).Segmenter;
  const words = Segmenter ? new Set([...new Segmenter("ja", { granularity: "word" }).segment(text)].map(s => s.index)) : undefined;
  let offset = 0;
  const offsets = chars.map(ch => { const start = offset; offset += ch.length; return start; });
  const wordBreaks = boundaries.filter(i => words?.has(offsets[i]));
  return [[text], ...(wordBreaks.length ? wordBreaks : boundaries).map(i => [chars.slice(0, i).join(""), chars.slice(i).join("")])];
}

/** The CSS circle is a capsule for unequal sides (border-radius:999px).
 * A rectangle is inside a convex rounded rectangle iff all four corners are. */
export function printObjectLabelFits(input: PrintObjectLabelInput, layout: PrintObjectLabelLayout): boolean {
  const hw = input.width / 2 - input.paddingX, hh = input.height / 2 - input.paddingY;
  if (hw <= 0 || hh <= 0) return !input.text;
  const outerRadius = Math.min(input.radius ?? 0, input.width / 2, input.height / 2);
  const radius = Math.max(0, outerRadius - Math.min(input.paddingX, input.paddingY));
  return layout.lines.every(line => [-1, 1].every(sx => [-1, 1].every(sy => {
    const x = Math.abs(line.x + sx * line.width / 2), y = Math.abs(line.y + sy * line.height / 2);
    if (x > hw + 1e-8 || y > hh + 1e-8) return false;
    const dx = Math.max(0, x - input.width / 2 + outerRadius), dy = Math.max(0, y - input.height / 2 + outerRadius);
    return dx * dx + dy * dy <= radius * radius + 1e-8;
  })));
}

export function getPrintObjectLabelLayout(input: PrintObjectLabelInput, measure: LabelMeasure,
  candidates = printObjectLabelCandidates(input.text)): PrintObjectLabelLayout {
  const min = input.minSize ?? PRINT_OBJECT_LABEL_MIN_MM, max = Math.max(min, input.maxSize);
  const at = (texts: string[], size: number): PrintObjectLabelLayout => ({ size, overflow: false,
    lines: texts.map((text, i) => ({ text, x: 0, y: (i - (texts.length - 1) / 2) * size * 1.15, ...measure(text, size) })) });
  let best: PrintObjectLabelLayout | undefined;
  for (const texts of candidates) {
    if (!printObjectLabelFits(input, at(texts, min))) continue;
    let lo = min, hi = max;
    if (printObjectLabelFits(input, at(texts, max))) lo = max;
    else for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (printObjectLabelFits(input, at(texts, mid))) lo = mid; else hi = mid;
    }
    const size = lo === max ? max : Math.max(min, Math.floor(lo * 1000 + 1e-7) / 1000), result = at(texts, size);
    if (!best || size > best.size + .0005 || (Math.abs(size - best.size) < .0005 && texts.length < best.lines.length)) best = result;
  }
  // Full text, on one centred line: no arbitrary extra wrapping in overflow mode.
  return best ?? { ...at(candidates[0], min), overflow: true };
}
