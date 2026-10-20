import type { jsPDF } from "jspdf";
import { fontWeight, parsedFont } from "./fonts";
import type { TextLine } from "./model";

export class UnsafePdfText extends Error {}
type SegmenterType = { new(locale: string, options: { granularity: "grapheme" }):
  { segment(text: string): Iterable<{ segment: string }> } };
const segmenter = () => (Intl as unknown as { Segmenter?: SegmenterType }).Segmenter;
export function graphemes(text: string): string[] {
  const Segmenter = segmenter();
  if (!Segmenter) throw new UnsafePdfText("グラフェムの安全な分割にIntl.Segmenterが必要です。");
  return [...new Segmenter("ja", { granularity: "grapheme" }).segment(text)].map(s => s.segment);
}
export function layoutGraphemes(text: string): string[] {
  if (segmenter()) return graphemes(text);
  if ([...text].some(ch => ch.codePointAt(0)! > 0xffff || /[\p{Mark}\p{Cf}]/u.test(ch)))
    throw new UnsafePdfText("結合列の配置にIntl.Segmenterが必要です。");
  return Array.from(text); // independent BMP only; never split a ZWJ/variation sequence
}
// Deliberately conservative. These scripts have independent glyphs; Arabic, Indic,
// bidi controls, isolated joiners and other shaping-dependent text use the legacy PDF.
export function assertIndependentText(text: string) {
  for (const ch of text) {
    // Precomposed syllables and compatibility jamo have independent glyphs.
    // Conjoining jamo (including extended blocks) need composition and remain
    // outside this allowlist even when Segmenter groups them into one cluster.
    const independentHangul = /[\uac00-\ud7a3\u3130-\u318f]/u.test(ch);
    if (/[\p{Cc}\p{Cs}]/u.test(ch) ||
      (/\p{Cf}/u.test(ch) && ch !== "\u200d") ||
      (!independentHangul && !/[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]/u.test(ch)))
      throw new UnsafePdfText("文脈依存文字・制御文字は文書全体を画像PDFにします。");
  }
}
export type TextRun = { text: string; raster: boolean; start: number; end: number };
export function planTextRuns(pdf: jsPDF, line: TextLine): TextRun[] {
  assertIndependentText(line.text);
  const font = parsedFont(pdf, fontWeight(line.weight));
  const unsafe = (value: string) => [...value].some(ch => ch.codePointAt(0)! > 0xffff ||
    /[\p{Mark}\p{Cf}]/u.test(ch) || !font.cmap.unicode.codeMap[ch.charCodeAt(0)]);
  if (!unsafe(line.text)) return [{ text: line.text, raster: false, start: 0, end: line.text.length }];
  const runs: TextRun[] = [];
  let offset = 0;
  for (const text of graphemes(line.text)) {
    // A joiner is only safe as part of a real pictographic ZWJ cluster. Never
    // turn arbitrary formatting controls or isolated combining marks into images.
    if ((text.includes("\u200d") && !/^\p{Extended_Pictographic}(?:\p{Mark}|\p{Emoji_Modifier})*(?:\u200d\p{Extended_Pictographic}(?:\p{Mark}|\p{Emoji_Modifier})*)+$/u.test(text)) ||
      /^[\p{Mark}\p{Cf}]/u.test(text)) throw new UnsafePdfText("独立描画できない結合列です。");
    const raster = unsafe(text), last = runs[runs.length - 1];
    if (!raster && last && !last.raster) { last.text += text; last.end += text.length; }
    else runs.push({ text, raster, start: offset, end: offset + text.length });
    offset += text.length;
  }
  return runs;
}
