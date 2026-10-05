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
  for (let index = step; index <= count; index += step) {
    const distance = index - (split ? 0.5 : 0);
    for (const side of ["left", "right"] as const) {
      const positionMeters = center + (side === "left" ? -distance : distance);
      if (positionMeters >= 0 && positionMeters <= widthMeters) labels.push({ key: side + "-" + index, positionMeters, label: String(index), side });
    }
  }
  return labels.sort((a, b) => a.positionMeters - b.positionMeters);
};
