import type { jsPDF } from "jspdf";
import type { TextLine } from "./model";

export const FONT_FAMILY = "BIZUDPGothic";
// Bump with the bundled font bytes. BASE_URL also works in Capacitor's bundled dist origin.
export const FONT_VERSION = "20261021";
export type FontWeight = "normal" | "bold";
export type FontBytesReader = (fileName: string, signal?: AbortSignal) => Promise<Uint8Array>;
export const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("書き出しを取り消しました。", "AbortError");
};
export const fetchFontBytes: FontBytesReader = async (name, signal) => {
  const base = import.meta.env.BASE_URL ?? "/";
  const response = await fetch(`${base}fonts/biz-udp-gothic/${name}?v=${FONT_VERSION}`, { signal, cache: "force-cache" });
  if (!response.ok) throw new Error(`共通フォントを読み込めませんでした (${response.status})。`);
  return new Uint8Array(await response.arrayBuffer());
};
export type ParsedFont = { cmap: { unicode: { codeMap: Record<number, number> } };
  ascender: number; decender: number; head: { unitsPerEm: number };
  characterToGlyph: (code: number) => number; toUnicode: Record<number, number>;
  glyIdsUsed: number[]; subset: { encode: (ids: number[], mode: number) => Uint8Array } };
export const parsedFont = (pdf: jsPDF, weight: FontWeight): ParsedFont => {
  pdf.setFont(FONT_FAMILY, weight);
  const font = pdf.getFont();
  const metadata = font.metadata as unknown as ParsedFont;
  if (font.fontName !== FONT_FAMILY || !metadata.cmap?.unicode?.codeMap || !metadata.subset?.encode || !metadata.head?.unitsPerEm)
    throw new Error("PDF共通フォントの解析に失敗しました。");
  return metadata;
};
export async function registerFonts(pdf: jsPDF, read: FontBytesReader = fetchFontBytes, signal?: AbortSignal) {
  checkAbort(signal);
  const start = performance.now();
  const bytes = await Promise.all(["Regular", "Bold"].map(w => read(`BIZUDPGothic-${w}.ttf`, signal)));
  checkAbort(signal);
  const loaded = performance.now();
  for (const [index, weight] of (["normal", "bold"] as const).entries()) {
    checkAbort(signal);
    // A binary string avoids a second base64-sized copy of each 4.6MB font.
    const data = bytes[index];
    let binary = "";
    for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
    const file = `BIZUDPGothic-${weight}.ttf`;
    pdf.addFileToVFS(file, binary);
    pdf.addFont(file, FONT_FAMILY, weight, "Identity-H");
    parsedFont(pdf, weight); // addFont's event bus can log and swallow parser errors.
  }
  checkAbort(signal);
  return { loadMs: loaded - start, parseMs: performance.now() - loaded, sourceBytes: bytes.map(b => b.byteLength) };
}

export const fontWeight = (weight: number): FontWeight => weight >= 700 ? "bold" : "normal";
export function unsupportedCharacters(pdf: jsPDF, lines: TextLine[]): string[] {
  const fonts = { normal: parsedFont(pdf, "normal"), bold: parsedFont(pdf, "bold") };
  const unsupported = new Set<string>();
  for (const line of lines) for (const ch of line.text) {
    const code = ch.codePointAt(0)!;
    // jsPDF is UTF-16-code-unit based, without shaping. cmap coverage alone cannot make
    // supplementary characters, combining marks, or variation sequences safe.
    if (code > 0xffff || /[\p{Mark}\p{Cf}\p{Cs}\p{Cc}]/u.test(ch) ||
      !fonts[fontWeight(line.weight)].cmap.unicode.codeMap[code]) unsupported.add(ch);
  }
  return [...unsupported];
}
