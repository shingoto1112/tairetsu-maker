import type { ParadeHorizontalMeasureMode } from "../types";

export const normalizeParadeHorizontalMeasureMode = (
  value: unknown,
): ParadeHorizontalMeasureMode =>
  value === "normalMeter" || value === "normal" ? "normalMeter" : "centerSplit";

export const roundParadeMeters = (value: number): number =>
  Math.round(value * 1000) / 1000;

export const formatSignedMeterLabel = (value: number): string => {
  const rounded = roundParadeMeters(Math.abs(value) < 0.001 ? 0 : value);
  const text = Number.isInteger(rounded)
    ? `${rounded}`
    : `${Number(rounded.toFixed(2))}`;
  return `${rounded > 0 ? "+" : ""}${text}m`;
};

export const formatCenterSplitLabel = (
  internalX: number,
  widthMeters: number,
): string => {
  const distance = roundParadeMeters(Math.abs(internalX - widthMeters / 2));
  if (distance < 0.001) {
    return "";
  }
  return Number.isInteger(distance)
    ? `${distance}`
    : `${Number(distance.toFixed(2))}`;
};

export const getCenterSplitSideLabel = (
  internalX: number | undefined,
  widthMeters: number,
): string => {
  if (internalX === undefined) {
    return "";
  }
  const offset = roundParadeMeters(internalX - widthMeters / 2);
  const distance = Math.abs(offset);
  if (distance < 0.001) {
    return "中央";
  }
  const side = offset < 0 ? "左" : "右";
  const text = Number.isInteger(distance)
    ? `${distance}`
    : `${Number(distance.toFixed(2))}`;
  return `${side} ${text}m`;
};
