import {
  FormationFrame,
  Member,
  MemberGroup,
  StageSnapshot,
} from "../types";

const DEFAULT_MEMBER_COLOR = "#14b8a6";
const DEFAULT_LABEL_COLOR = "#0f172a";
const INVERTED_LABEL_COLOR = "#ffffff";

const parseColorToRgb = (
  color: string,
): { red: number; green: number; blue: number } | null => {
  const trimmed = color.trim();
  const hexMatch = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const raw = hexMatch[1];
    const normalized =
      raw.length === 3
        ? raw
            .split("")
            .map((character) => character + character)
            .join("")
        : raw;
    return {
      red: Number.parseInt(normalized.slice(0, 2), 16),
      green: Number.parseInt(normalized.slice(2, 4), 16),
      blue: Number.parseInt(normalized.slice(4, 6), 16),
    };
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i,
  );
  if (!rgbMatch) {
    return null;
  }

  return {
    red: Math.min(255, Math.max(0, Number(rgbMatch[1]))),
    green: Math.min(255, Math.max(0, Number(rgbMatch[2]))),
    blue: Math.min(255, Math.max(0, Number(rgbMatch[3]))),
  };
};

const toLinearRgb = (value: number): number => {
  const normalized = value / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

export const getMemberGroupColor = (
  memberId: string,
  groups: MemberGroup[] = [],
): string | undefined =>
  groups.find((group) => group.memberIds.includes(memberId))?.color;

export const getMemberDisplayColor = (
  member: Member,
  options: {
    frame?: FormationFrame | null;
    groups?: MemberGroup[];
    snapshot?: StageSnapshot | null;
  } = {},
): string => {
  const overrideColor =
    options.frame?.memberAppearanceOverrides?.[member.id]?.color ??
    options.snapshot?.memberAppearanceOverrides?.[member.id]?.color;
  return (
    overrideColor ??
    getMemberGroupColor(member.id, options.groups) ??
    member.color ??
    DEFAULT_MEMBER_COLOR
  );
};

export const getReadableMemberLabelColor = (backgroundColor: string): string => {
  const rgb = parseColorToRgb(backgroundColor);
  if (!rgb) {
    return DEFAULT_LABEL_COLOR;
  }

  const luminance =
    0.2126 * toLinearRgb(rgb.red) +
    0.7152 * toLinearRgb(rgb.green) +
    0.0722 * toLinearRgb(rgb.blue);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);

  return contrastWithBlack >= 4.5 || contrastWithBlack >= contrastWithWhite
    ? DEFAULT_LABEL_COLOR
    : INVERTED_LABEL_COLOR;
};
