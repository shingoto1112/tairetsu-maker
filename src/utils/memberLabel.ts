export type MemberLabelVariant = "one" | "two" | "three" | "four" | "default";

type GraphemeSegmenter = { segment: (value: string) => Iterable<{ segment: string }> };
// ES2020 type libraries do not yet declare Segmenter; older WebViews use code points.
const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter }).Segmenter;
const segmenter = Segmenter ? new Segmenter("ja", { granularity: "grapheme" }) : undefined;
// Drag/zoom repeatedly renders the same names. Bound the cache and never expose its arrays.
const characterCache = new Map<string, string[]>();
export const memberLabelCharacters = (value: string): string[] => {
  const cached = characterCache.get(value);
  if (cached) return [...cached];
  const characters = segmenter ? Array.from(segmenter.segment(value), part => part.segment) : Array.from(value);
  if (characterCache.size >= 512) characterCache.delete(characterCache.keys().next().value!);
  characterCache.set(value, characters);
  return [...characters];
};
const countCharacters = (value: string) => memberLabelCharacters(value).length;
const printableAscii = /^[\x20-\x7e]+$/;

/** Decide text before sizing: zoom never changes the displayed name. No word wrapping. */
export const splitMemberLabel = (name: string): string[] => {
  const trimmed = name.trim();
  if (!trimmed) return [""];
  let characters = memberLabelCharacters(trimmed);
  if (characters.length <= 3) return [trimmed];
  if (characters.length > 6) {
    characters = printableAscii.test(trimmed)
      ? characters.length <= 12 ? characters : [...characters.slice(0, 10), "…"]
      : [...characters.slice(0, 5), "…"];
  }
  const midpoint = Math.ceil(characters.length / 2);
  return [characters.slice(0, midpoint).join(""), characters.slice(midpoint).join("")];
};

export const getMemberLabelVariant = (labelLines: string[]): MemberLabelVariant => {
  const totalCharacters = countCharacters(labelLines.join(""));
  if (labelLines.length === 1 && totalCharacters === 1) return "one";
  if (labelLines.length === 1 && totalCharacters === 2) return "two";
  if (labelLines.length === 1 && totalCharacters === 3) return "three";
  if (labelLines.length === 2 && totalCharacters === 4 && labelLines.every(line => countCharacters(line) === 2)) return "four";
  return "default";
};

export const getMemberLabelClassName = (blockName: string, labelLines: string[]): string => {
  const variant = getMemberLabelVariant(labelLines);
  return `${blockName}--label-${variant === "default" ? "long" : variant}`;
};

/** Conservative advances for the existing bold UI font, without DOM measurement. */
export const estimateMemberLabelWidthEm = (line: string): number => memberLabelCharacters(line).reduce((width, ch) =>
  width + (/^[WMwm@%&#]$/.test(ch) ? 1 : /^[\x20-\x7e]$/.test(ch) ? 0.6 : 1.02), 0);

// Paired with the long-label CSS. Ink reaches beyond the CSS line box.
export const MEMBER_LONG_LABEL_LINE_HEIGHT = 0.84;
export const MEMBER_LABEL_INK_HEIGHT_EM = 0.92;

type LabelSizeOptions = {
  min?: number;
  precision?: number;
  boost?: number;
  border?: number;
  inset?: number;
  borderOverlap?: number;
};

/** Largest size whose outer ink corners lie inside the circle's available chord. */
export const memberLabelFitLimit = (diameter: number, labelLines: string[], options?: LabelSizeOptions): number => {
  const radius = Math.max(0, diameter / 2 - Math.max(0,
    (options?.border ?? 2) + (options?.inset ?? 0.4) - (options?.borderOverlap ?? 1.4)));
  const outerInkYEm = ((Math.max(1, labelLines.length) - 1) * MEMBER_LONG_LABEL_LINE_HEIGHT + MEMBER_LABEL_INK_HEIGHT_EM) / 2;
  const halfWidthEm = Math.max(0.5, ...labelLines.map(estimateMemberLabelWidthEm)) / 2;
  return radius / Math.hypot(halfWidthEm, outerInkYEm);
};

export const getMemberLabelFontSize = (diameter: number, labelLines: string[], options?: LabelSizeOptions): number => {
  const min = options?.min ?? 8;
  const precision = options?.precision ?? 1;
  const boost = options?.boost ?? 0;
  const scale = 10 ** precision;
  if (getMemberLabelVariant(labelLines) !== "default") {
    // Exact existing short-name sizing, including the historical print boost.
    return Math.round(Math.max(min, Math.max(min * 2, diameter) * 0.3) * scale) / scale + boost;
  }
  const limit = Math.min(diameter * 0.3, memberLabelFitLimit(diameter, labelLines, options));
  const desired = diameter * 0.3 + boost;
  // Round down after boost and all caps; rounding up could cross the circle.
  // At extreme zoom the readable floor wins, without changing/clipping the text.
  return Math.max(min, Math.floor(Math.min(desired, limit) * scale + 1e-9) / scale);
};

/** Matches the print CSS, including the four-character gap and three-character shift. */
export const exportMemberLabelLineHeightEm = (lines: string[]): number => {
  const variant = getMemberLabelVariant(lines);
  return variant === "default" ? .84 : variant === "four" ? .90 : .88;
};

/** Ink, not advance: kana's outer side bearings do not paint the circle.
 * BIZ UDP Gothic Bold あ/い have ~.074em outer bearings. .085em is the optical
 * estimate (the outline corners are empty); other full-width glyphs and voiced
 * kana (whose marks occupy the upper corners) get no rebate.
 * Count graphemes so marks/ZWJ sequences never acquire extra advances. */
export const estimateExportMemberLabelInkWidthEm = (line: string): number => {
  const chars = memberLabelCharacters(line.normalize("NFC"));
  const kana = (ch: string) => /^[\u3041-\u3096\u30a1-\u30fa]$/u.test(ch) && !/\p{Mark}/u.test(ch.normalize("NFD"));
  // Bundled Bold advances: i=.320, l=.360, I=.440, b/d/p/q=.730,
  // uppercase Q=.900. A generic .6em ASCII estimate undercounts those glyphs.
  const advance = (ch: string) => ch === "i" ? .35 : ch === "l" ? .38 : ch === "I" ? .46
    : /^[!|.,:;'`]$/.test(ch) ? .4
    : /^\s$/u.test(ch) ? .35
    : /^[WMwm@%&#]$/.test(ch) ? 1
    : /^[A-Z]$/.test(ch) ? .9
    : /^[0-9]$/.test(ch) ? .8
    : /^[a-z]$/.test(ch) ? .75
    : /^[\x20-\x7e]$/.test(ch) ? 1
    : /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(ch) ? 1.15
    : kana(ch) ? 1 : 1.02;
  return Math.max(0, chars.reduce((sum, ch) => sum + advance(ch), 0)
    - (chars.length && kana(chars[0]) ? .085 : 0)
    - (chars.length && kana(chars[chars.length - 1]) ? .085 : 0));
};

/** Each row is checked at its own outer ink y against the circle's chord.
 * No readable floor or diameter percentage can override export containment. */
export const exportMemberLabelFitLimit = (diameter: number, lines: string[]): number => {
  const variant = getMemberLabelVariant(lines);
  const leading = exportMemberLabelLineHeightEm(lines);
  const shift = variant === "three" ? -.04 : 0;
  // Small CSS line boxes round their baselines to layout pixels. Latin/kana
  // multi-line ink needs a taller envelope than the editor's .92em assumption.
  // Three-kana rows retain their measured optical envelope (e.g. あおい).
  const inkHeight = (line: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(line) ? 1.3
    : variant === "three" && /^[\u3041-\u3096\u30a1-\u30fa]+$/u.test(line.normalize("NFC")) && !/\p{Mark}/u.test(line.normalize("NFD")) ? .92
    : /[\x21-\x7e\u3041-\u3096\u30a1-\u30fa]/u.test(line) || variant === "four" ? 1.2 : .92;
  const extent = Math.max(0, ...lines.map((line, i) => line.trim() ? Math.hypot(
    estimateExportMemberLabelInkWidthEm(line) / 2,
    Math.abs((i - (lines.length - 1) / 2) * leading + shift) + inkHeight(line) / 2,
  ) : 0));
  if (!extent) return Infinity;
  const radius = Math.max(0, diameter) / 2;
  // Below the old print floor (<6.8 CSS px), layout quantization matters.
  // Reserve half a CSS pixel (~.1323mm) for baseline rounding, not a diameter
  // percentage. This also covers sub-1px text in the 1mm stress case.
  // This is a rounding allowance, never a minimum font size or post-fit boost.
  const clearance = radius / extent < 1.8 ? .5 * (25.4 / 96) : 0;
  return Math.max(0, radius - clearance) / extent;
};

/** Keep an already fitting candidate byte-for-byte; only reductions round down. */
export const fitExportMemberLabelFontSize = (diameter: number, lines: string[], candidate: number, precision = 2): number => {
  const limit = exportMemberLabelFitLimit(diameter, lines);
  return candidate <= limit ? candidate : Math.floor(limit * 10 ** precision) / 10 ** precision;
};
