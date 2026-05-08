import type { ParadeHorizontalMeasureMode } from "../types";

export const normalizeParadeHorizontalMeasureMode = (
  value: unknown,
): ParadeHorizontalMeasureMode =>
  value === "normalMeter" || value === "normal" ? "normalMeter" : "centerSplit";

export const roundParadeMeters = (value: number): number =>
  Math.round(value * 1000) / 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const getSafeParadeTotalDistance = (
  totalDistance: number | undefined,
): number =>
  Number.isFinite(totalDistance) && (totalDistance ?? 0) > 0
    ? (totalDistance as number)
    : 100;

export const getSafeParadeBackwardDistance = (
  backwardDistance: number | undefined,
): number =>
  Number.isFinite(backwardDistance) && (backwardDistance ?? 0) > 0
    ? (backwardDistance as number)
    : 0;

export const getSafeParadeCanvasDistance = (
  totalDistance: number | undefined,
  backwardDistance: number | undefined,
): number =>
  getSafeParadeTotalDistance(totalDistance) +
  getSafeParadeBackwardDistance(backwardDistance);

export const internalYToParadeDistance = (
  internalY: number | undefined,
  totalDistance: number | undefined,
  backwardDistance?: number | undefined,
): number | undefined => {
  if (internalY === undefined || !Number.isFinite(internalY)) {
    return undefined;
  }
  const safeTotalDistance = getSafeParadeTotalDistance(totalDistance);
  const safeBackwardDistance = getSafeParadeBackwardDistance(backwardDistance);
  return roundParadeMeters(
    clamp(
      safeTotalDistance - internalY,
      -safeBackwardDistance,
      safeTotalDistance,
    ),
  );
};

export const paradeDistanceToInternalY = (
  distance: number,
  totalDistance: number | undefined,
  backwardDistance?: number | undefined,
): number => {
  const safeTotalDistance = getSafeParadeTotalDistance(totalDistance);
  const safeBackwardDistance = getSafeParadeBackwardDistance(backwardDistance);
  const clampedDistance = clamp(
    distance,
    -safeBackwardDistance,
    safeTotalDistance,
  );
  return roundParadeMeters(safeTotalDistance - clampedDistance);
};

export const clampParadeObjectTopY = (
  internalY: number,
  heightMeters: number | undefined,
  totalDistance: number | undefined,
  backwardDistance?: number | undefined,
): number => {
  const safeTotalDistance = getSafeParadeTotalDistance(totalDistance);
  const safeCanvasDistance = getSafeParadeCanvasDistance(
    safeTotalDistance,
    backwardDistance,
  );
  const safeHeight =
    Number.isFinite(heightMeters) && (heightMeters ?? 0) > 0
      ? (heightMeters as number)
      : 0;
  return roundParadeMeters(
    clamp(internalY, 0, Math.max(0, safeCanvasDistance - safeHeight)),
  );
};

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
