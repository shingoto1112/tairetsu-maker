import { createGridTicksInRange, horizontalGridOriginMeters } from "./horizontalGrid";
import type { HorizontalGuideMode, ParadeHorizontalMeasureMode } from "../types";
export type HorizontalCountingMode = "meters" | "centerSplit";
export type HorizontalRulerLabel = { key: string; positionMeters: number; label: string; side: "left" | "right" };
export const toHorizontalCountingMode = (mode: HorizontalGuideMode | ParadeHorizontalMeasureMode | undefined): HorizontalCountingMode => mode === "centerSplit" ? "centerSplit" : "meters";
export const toParadeHorizontalMeasureMode = (mode: HorizontalCountingMode): ParadeHorizontalMeasureMode => mode === "centerSplit" ? "centerSplit" : "normalMeter";
export const horizontalCountingOptions = [
  { value: "meters", title: "センターから1m刻み", description: "センターにも立てる並び。センターから1mごとに 1, 2, 3" },
  { value: "centerSplit", title: "センターから0.5mずらし", description: "センターをはさんで立つ並び。最初の1はセンターから0.5m、以後1mごと" },
] as const;
/** Full-width internal coordinates. Callers apply reflection, scale and cropping.
 * Split mode retains the legacy floor(center + .001) edge inclusion rule.
 * Thinning selects identical ordinals on both sides, independent of the left edge. */
export const createHorizontalRulerLabels = (widthMeters: number, mode: HorizontalCountingMode): HorizontalRulerLabel[] => {
  if (!Number.isFinite(widthMeters) || widthMeters <= 0) return [];
  const center = widthMeters / 2;
  const split = mode === "centerSplit";
  const count = Math.floor(center + (split ? 0.001 : 0));
  const step = widthMeters <= 16 ? 1 : Math.ceil(widthMeters / 12);
  const labels: HorizontalRulerLabel[] = [];
  for (const positionMeters of createGridTicksInRange(0, widthMeters, 1, horizontalGridOriginMeters(widthMeters, mode))) {
    const distance = Math.abs(positionMeters - center);
    if (distance < 1e-9) continue;
    const index = Math.round(distance + (split ? 0.5 : 0));
    if (index < 1 || index > count || index % step !== 0) continue;
    const side = positionMeters < center ? "left" : "right";
    labels.push({ key: side + "-" + index, positionMeters, label: String(index), side });
  }
  return labels.sort((a, b) => a.positionMeters - b.positionMeters);
};
