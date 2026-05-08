export type MemberLabelVariant = "one" | "two" | "three" | "four" | "default";

const countCharacters = (value: string): number => Array.from(value).length;

const roundToPrecision = (value: number, precision: number): number => {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
};

export const splitMemberLabel = (name: string): string[] => {
  const trimmed = name.trim();
  if (!trimmed) {
    return [""];
  }

  const characters = Array.from(trimmed);
  if (characters.length <= 3) {
    return [trimmed];
  }

  if (characters.length === 4) {
    return [
      characters.slice(0, 2).join(""),
      characters.slice(2, 4).join(""),
    ];
  }

  const midpoint = Math.ceil(characters.length / 2);
  return [
    characters.slice(0, midpoint).join(""),
    characters.slice(midpoint).join(""),
  ].filter(Boolean);
};

export const getMemberLabelVariant = (
  labelLines: string[],
): MemberLabelVariant => {
  const lineCount = labelLines.length;
  const totalCharacters = countCharacters(labelLines.join(""));
  if (lineCount === 1 && totalCharacters === 1) return "one";
  if (lineCount === 1 && totalCharacters === 2) return "two";
  if (lineCount === 1 && totalCharacters === 3) return "three";
  if (
    lineCount === 2 &&
    totalCharacters === 4 &&
    labelLines.every((line) => countCharacters(line) === 2)
  ) {
    return "four";
  }
  return "default";
};

export const getMemberLabelClassName = (
  blockName: string,
  labelLines: string[],
): string => {
  const variant = getMemberLabelVariant(labelLines);
  return variant === "default" ? "" : `${blockName}--label-${variant}`;
};

export const getMemberLabelFontSize = (
  diameter: number,
  labelLines: string[],
  options?: {
    min?: number;
    precision?: number;
  },
): number => {
  const min = options?.min ?? 8;
  const precision = options?.precision ?? 1;
  const safeDiameter = Math.max(min * 2, diameter);
  const longestLine = Math.max(
    1,
    ...labelLines.map((line) => countCharacters(line)),
  );
  const lineCount = Math.max(1, labelLines.length);
  const variant = getMemberLabelVariant(labelLines);

  const variantFactors: Record<MemberLabelVariant, number | null> = {
    one: 0.3,
    two: 0.3,
    three: 0.3,
    four: 0.3,
    default: null,
  };
  const variantFactor = variantFactors[variant];

  if (variantFactor !== null) {
    return roundToPrecision(Math.max(min, safeDiameter * variantFactor), precision);
  }

  const widthBased = (safeDiameter * 0.9) / Math.max(1.8, longestLine * 0.74);
  const heightBased = (safeDiameter * 0.82) / lineCount;
  const maxReadable = safeDiameter * (lineCount === 1 ? 0.56 : 0.46);
  return roundToPrecision(
    Math.max(min, Math.min(maxReadable, widthBased, heightBased)),
    precision,
  );
};
