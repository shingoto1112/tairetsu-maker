import type { CSSProperties } from "react";
import type { ParadeSettings, StageConfig } from "../types";
import { createGridTicksInRange, createHorizontalGridLines } from "./horizontalGrid";
import { internalYToParadeDistance } from "./parade";
import type { HorizontalCountingMode } from "./horizontalRuler";

export type VerticalOrigin = "top" | "bottom";
export type GridEmphasis = "none" | "number" | "5" | "10";
export const GRID_LINE_TOKENS = {
  none: { color: "#e2e8f0", width: 1 },
  number: { color: "#94a3b8", width: 1 },
  "5": { color: "#64748b", width: 1.25 },
  "10": { color: "#475569", width: 1.5 },
} as const;
export type EmphasisFlags = { numbers?: boolean; every5?: boolean; every10?: boolean };
const integer = (n: number) => Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-7;
/** Stage center has no number. Negative parade distances and 0 retain distance-line behavior. */
export const horizontalLineNumber = (x: number, width: number, mode: HorizontalCountingMode): number | undefined => {
  const distance = Math.abs(x - width / 2);
  if (distance < 1e-7) return undefined;
  const number = distance + (mode === "centerSplit" ? 0.5 : 0);
  return integer(number) ? Math.round(number) : undefined;
};
export const lineEmphasis = (number: number | undefined, flags: EmphasisFlags): GridEmphasis => {
  if (number === undefined || !integer(number)) return "none";
  if (flags.every10 && integer(number / 10)) return "10";
  if (flags.every5 && integer(number / 5)) return "5";
  return flags.numbers ? "number" : "none";
};
export const horizontalEmphasisFlags = (settings: StageConfig | ParadeSettings): EmphasisFlags => ({
  numbers: settings.emphasizeHorizontalNumbers,
  every5: settings.emphasizeHorizontalEvery5,
  every10: settings.emphasizeHorizontalEvery10,
});
export const verticalEmphasisFlags = (stage: StageConfig, parade?: ParadeSettings): EmphasisFlags => parade ? ({
  numbers: parade.emphasizeVerticalNumbers,
  every5: parade.emphasizeEvery5m ?? true,
  every10: parade.emphasizeEvery10m ?? true,
}) : ({ numbers: stage.emphasizeVerticalNumbers, every5: stage.emphasizeVerticalEvery5m, every10: stage.emphasizeVerticalEvery10m });
export const gridLineStyle = (emphasis: GridEmphasis, vertical: boolean): CSSProperties => ({
  background: GRID_LINE_TOKENS[emphasis].color,
  [vertical ? "width" : "height"]: GRID_LINE_TOKENS[emphasis].width,
});
export type EmphasizedLine = { positionMeters: number; emphasis: GridEmphasis; kind?: "counting" | "fine" };
export const horizontalEmphasizedLines = (width: number, mode: HorizontalCountingMode, step: number,
  settings: StageConfig | ParadeSettings, includeGrid = true, centerVisible = true): EmphasizedLine[] =>
  createHorizontalGridLines(width, mode, step, centerVisible).map(line => ({ ...line,
    emphasis: lineEmphasis(horizontalLineNumber(line.positionMeters, width, mode), horizontalEmphasisFlags(settings)),
  })).filter(line => includeGrid || line.emphasis !== "none");
/** Full scene coordinates before cropping. Export origin overrides the editor's front-based origin. */
export const verticalEmphasizedLines = (depth: number, step: number, stage: StageConfig, parade?: ParadeSettings,
  includeGrid = true, top = 0, bottom = depth, verticalOrigin?: VerticalOrigin): EmphasizedLine[] => {
  const flags = verticalEmphasisFlags(stage, parade);
  const topOrigin = verticalOrigin ? verticalOrigin === "top" : stage.frontDirection === "top";
  const origin = parade ? parade.totalDistance : topOrigin ? 0 : depth;
  const ticks = new Set(createGridTicksInRange(top, bottom, step, parade ? origin : 0));
  // Number positions remain lines even when step is larger or non-integral.
  for (const y of createGridTicksInRange(top, bottom, 1, origin)) ticks.add(y);
  return [...ticks].sort((a,b) => a-b).filter(y => y > 1e-7 && y < depth - 1e-7).map(y => ({
    positionMeters: y,
    emphasis: lineEmphasis(parade ? internalYToParadeDistance(y, parade.totalDistance, parade.backwardDistanceMeters) : topOrigin ? y : depth - y, flags),
  })).filter(line => includeGrid || line.emphasis !== "none");
};

/** Number density changes only the labels, never the emphasis classification. */
export const stageVerticalRulerPositions = (depth: number, frontAtTop: boolean, top = 0, bottom = depth): number[] => {
  const step = depth <= 16 ? 1 : Math.ceil(depth / 12);
  return [...new Set([...(top <= 0 ? [0] : []), ...createGridTicksInRange(Math.max(0, top), Math.min(depth, bottom), step, frontAtTop ? 0 : depth), ...(bottom >= depth ? [depth] : [])])].sort((a,b) => a-b);
};
