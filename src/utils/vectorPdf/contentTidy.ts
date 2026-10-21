/** Per-operator number precision for jsPDF page content, applied just before serialisation.
 * jsPDF writes every number with one precision (floatPrecision 5) plus artefacts such as
 * "1." and font sizes like "4.049999999999999". Content is in layout millimetres and the A4 fit
 * only shrinks it, so:
 * - path geometry (m l c v y re): 3 decimals — 0.001mm; keeps thin filled outlines within 1%
 * - text positions (Tm/Td translation) and dashes: 2 decimals — 0.01mm ≈ 0.03pt before the fit
 * - line widths (w) and font sizes (Tf): 3 decimals
 * - matrices (cm, Tm's 2×2 part): 5 decimals — they carry the page fit scale and rotations
 * - colours and everything else: unchanged
 * Text operands (hex/literal strings) are never touched. Single-line text never uses T* or ',
 * so the leading (TL) jsPDF emits for every text object is dropped. */
const fixed = (value: string, digits: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  let text = n.toFixed(digits);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
};
const NUMBER = /-?\d+\.\d*/g;
const PATH = new Set(["m", "l", "c", "v", "y", "re"]);

export function tidyContentLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (/[<(]/.test(trimmed)) return line; // text strings: never rewrite bytes inside them
  const op = trimmed.slice(trimmed.lastIndexOf(" ") + 1);
  if (op === "TL") return null;
  if (op === "cm") return line.replace(NUMBER, m => fixed(m, 5));
  if (op === "Tm") {
    let index = 0;
    return line.replace(/-?\d+(?:\.\d*)?/g, m => fixed(m, index++ < 4 ? 5 : 2));
  }
  if (op === "w" || op === "Tf") return line.replace(NUMBER, m => fixed(m, 3));
  if (PATH.has(op)) return line.replace(NUMBER, m => fixed(m, 3));
  if (op === "Td" || op === "TD" || op === "d") return line.replace(NUMBER, m => fixed(m, 2));
  return line;
}

/** Rewrites jsPDF's page arrays in place (each entry may hold several "\n"-joined lines). */
export function tidyPdfContent(pages: unknown[]) {
  for (const page of pages) {
    if (!Array.isArray(page)) continue;
    const out: string[] = [];
    for (const entry of page) {
      if (typeof entry !== "string") { out.push(entry); continue; }
      const lines = entry.split("\n").map(tidyContentLine).filter((l): l is string => l !== null);
      if (lines.length) out.push(lines.join("\n"));
    }
    page.length = 0; page.push(...out);
  }
}
