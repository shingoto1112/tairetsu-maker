import type { ParadeSettings } from "../types";
import { createId } from "../utils/ids";
import { normalizeParadeHorizontalMeasureMode } from "../utils/parade";

export const createProjectId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return createId("project");
};

export const positiveNumber = (
  value: number | undefined,
  fallback: number,
  min: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, value)
    : Math.max(min, fallback);

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const createDefaultParadeSettings = (
  settings: Partial<ParadeSettings> = {},
): ParadeSettings => ({
  totalDistance: positiveNumber(settings.totalDistance, 100, 1),
  width: positiveNumber(settings.width, 20, 1),
  cellSizeMeters: positiveNumber(settings.cellSizeMeters, 1, 0.1),
  direction: "up",
  rulerPosition:
    settings.rulerPosition === "left" ||
    settings.rulerPosition === "right" ||
    settings.rulerPosition === "none"
      ? settings.rulerPosition
      : "both",
  horizontalMeasureMode: normalizeParadeHorizontalMeasureMode(
    (settings as { horizontalMeasureMode?: unknown }).horizontalMeasureMode,
  ),
  backwardDistanceMeters: positiveNumber(
    settings.backwardDistanceMeters,
    0,
    0,
  ),
  emphasizeEvery5m: settings.emphasizeEvery5m ?? true,
  emphasizeEvery10m: settings.emphasizeEvery10m ?? true,
});

export const groupColorPalette = [
  "#0f766e",
  "#2563eb",
  "#c2410c",
  "#7c3aed",
  "#db2777",
  "#16a34a",
];
