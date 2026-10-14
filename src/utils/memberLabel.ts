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
