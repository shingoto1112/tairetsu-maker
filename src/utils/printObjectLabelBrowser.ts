import { getPrintObjectLabelLayout, printObjectLabelCandidates, printObjectLabelFits, type PrintObjectLabelInput, type PrintObjectLabelLayout } from "./printObjectLabel";

const MM_PER_PX = 25.4 / 96;
export type PrintObjectLabelStyle = { family: string; weight: string };

/** One cache/probe per drawing or export, never shared across font lifetimes.
 * Canvas advances prune all size/break candidates. Only finalists visit the DOM. */
export function createPrintObjectLabelMeasurer() {
  const widths = new Map<string, number>(), layouts = new Map<string, PrintObjectLabelLayout>();
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  return (input: PrintObjectLabelInput, style: PrintObjectLabelStyle): PrintObjectLabelLayout => {
    const key = JSON.stringify([input, style]);
    const cached = layouts.get(key);
    if (cached) return cached;
    if (!ctx) return getPrintObjectLabelLayout(input, (text, size) => ({ width: Array.from(text).length * size, height: size * 1.3 }));
    const host = document.createElement("span");
    Object.assign(host.style, { position: "fixed", left: "0", top: "0", visibility: "hidden", display: "block",
      whiteSpace: "pre", fontFamily: style.family, fontWeight: style.weight, lineHeight: "1.15", fontSize: "100px" });
    host.textContent = input.text;
    document.body.append(host);
    try {
      const range = document.createRange(); range.selectNodeContents(host);
      const heightEm = input.text ? range.getBoundingClientRect().height / 100 : 1.15;
      const advance = (text: string) => {
        const k = `${style.family}/${style.weight}/${text}`;
        let width = widths.get(k);
        if (width === undefined) {
          ctx.font = `${style.weight} 100px ${style.family}`;
          width = ctx.measureText(text).width / 100; widths.set(k, width);
        }
        return width;
      };
      const min = input.minSize ?? 1.8, max = Math.max(min, input.maxSize);
      const probes = new Map<string, { width: number; height: number; boxOffsetY: number }>();
      const at = (texts: string[], size: number): PrintObjectLabelLayout => ({ size, overflow: false, lines: texts.map((text, i) => {
        const probeKey = JSON.stringify([text, size]);
        let metrics = probes.get(probeKey);
        if (!metrics) {
          host.style.fontSize = `${size}mm`; host.textContent = text; range.selectNodeContents(host);
          const r = range.getBoundingClientRect(), block = host.getBoundingClientRect();
          metrics = { width: r.width * MM_PER_PX, height: r.height * MM_PER_PX,
            boxOffsetY: (r.y + r.height / 2 - block.y - block.height / 2) * MM_PER_PX };
          probes.set(probeKey, metrics);
        }
        return { text, x: 0, y: (i - (texts.length - 1) / 2) * size * 1.15, ...metrics };
      }) });
      // Rank using reusable advances, and discard candidates whose optimistic
      // bound cannot beat the best DOM-confirmed size. A two-pixel height and
      // .02mm width allowance cover CSS metric rounding in that bound only.
      // No grid of sizes × breaks is ever inserted into the DOM.
      const candidates = printObjectLabelCandidates(input.text).map(texts => ({ texts,
        estimate: getPrintObjectLabelLayout(input, (text, size) => ({ width: advance(text) * size, height: heightEm * size }), [texts]),
        upper: getPrintObjectLabelLayout(input, (text, size) => ({ width: Math.max(0, advance(text) * size - .02),
          height: Math.max(0, heightEm * size - 2 * MM_PER_PX) }), [texts]),
      })).sort((a, b) => b.estimate.size - a.estimate.size || a.texts.length - b.texts.length);
      let best: PrintObjectLabelLayout | undefined;
      for (const candidate of candidates) {
        if (candidate.upper.overflow || (best && candidate.upper.size < best.size - .001) ||
          (best?.size === max && (best.lines.length === 1 || candidate.texts.length > 1))) continue;
        if (!printObjectLabelFits(input, at(candidate.texts, min))) continue;
        let lo = min, hi = max;
        if (printObjectLabelFits(input, at(candidate.texts, max))) lo = max;
        else for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (printObjectLabelFits(input, at(candidate.texts, mid))) lo = mid; else hi = mid;
        }
        const size = lo === max ? max : Math.max(min, Math.floor(lo * 1000) / 1000);
        const result = at(candidate.texts, size);
        if (!best || size > best.size + .0005 || (Math.abs(size - best.size) < .0005 && result.lines.length < best.lines.length)) best = result;
      }
      const result = best ?? { ...at([input.text], min), overflow: true };
      layouts.set(key, result); return result;
    } finally { host.remove(); }
  };
}

export function labelInput(element: HTMLElement): { input: PrintObjectLabelInput; style: PrintObjectLabelStyle } {
  const object = element.parentElement!, css = getComputedStyle(object);
  const assignment = object.classList.contains("print-assignment-sheet__object");
  const width = assignment ? parseFloat(css.width) * MM_PER_PX : parseFloat(element.dataset.labelWidth!);
  const height = assignment ? parseFloat(css.height) * MM_PER_PX : parseFloat(element.dataset.labelHeight!);
  return { input: { text: element.dataset.labelText ?? "", width, height,
    radius: object.classList.contains("shape-circle") ? Math.min(width, height) / 2 : 0,
    paddingX: (parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft)) * MM_PER_PX,
    paddingY: (parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop)) * MM_PER_PX,
    maxSize: parseFloat(css.fontSize) * MM_PER_PX }, style: { family: css.fontFamily, weight: css.fontWeight } };
}

/** CSS border+padding can impose a minimum box larger than a tiny saved prop.
 * Anchor the label on the saved shape centre, without changing the old box or
 * rotation origin. The centre delta is in page axes, so undo the object rotation. */
export function printObjectLabelAnchor(element: HTMLElement) {
  if (element.parentElement!.classList.contains("print-assignment-sheet__object")) return { left: "50%", top: "50%" };
  const { input } = labelInput(element), css = getComputedStyle(element.parentElement!);
  const dx = (input.width - parseFloat(css.width) * MM_PER_PX) / 2;
  const dy = (input.height - parseFloat(css.height) * MM_PER_PX) / 2;
  const inverse = new DOMMatrix(css.transform).inverse();
  return { left: `calc(50% + ${inverse.a * dx + inverse.c * dy}mm)`,
    top: `calc(50% + ${inverse.b * dx + inverse.d * dy}mm)` };
}

/** Also used on detached React export clones, after the final font is known. */
export function applyPrintObjectLabels(root: HTMLElement) {
  const measure = createPrintObjectLabelMeasurer();
  for (const element of root.querySelectorAll<HTMLElement>("[data-print-object-label]")) {
    const { input, style } = labelInput(element), layout = measure(input, style);
    Object.assign(element.style, printObjectLabelAnchor(element));
    const rows = layout.lines.map(line => {
      const row = document.createElement("span"); row.className = "print-object-label__line"; row.textContent = line.text;
      Object.assign(row.style, { fontSize: `${layout.size}mm`, left: `${line.x}mm`, top: `${line.y - (line.boxOffsetY ?? 0)}mm` });
      return row;
    });
    element.dataset.labelOverflow = String(layout.overflow);
    element.replaceChildren(...rows);
  }
}
