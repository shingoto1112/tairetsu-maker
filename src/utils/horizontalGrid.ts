import type { Position } from "../types";
import type { HorizontalCountingMode } from "./horizontalRuler";

const EPSILON = 1e-9;
const validStep = (step: number, origin: number) => Number.isFinite(step) && step > 0 && Number.isFinite(origin);
const clean = (value: number) => Number(value.toFixed(9));

/** Internal full-width coordinates; reflect or crop only after calculation. */
export const horizontalGridOriginMeters = (width: number, mode: HorizontalCountingMode | "normalMeter" | undefined): number =>
  Number.isFinite(width) && width > 0 ? width / 2 + (mode === "centerSplit" ? 0.5 : 0) : NaN;

export const createGridTicksInRange = (min: number, max: number, step: number, origin = 0): number[] => {
  if (!validStep(step, origin) || !Number.isFinite(min) || !Number.isFinite(max) || min > max) return [];
  const first = Math.ceil((min - origin) / step - EPSILON);
  const last = Math.floor((max - origin) / step + EPSILON);
  // Invalid/unrepresentable indices must not create an unbounded allocation.
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 100000) return [];
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => clean(origin + (first + i) * step));
};

export const snapHorizontalPosition = (x: number, step: number, origin: number): number =>
  Number.isFinite(x) && validStep(step, origin) ? clean(origin + Math.round((x - origin) / step) * step) : x;

export const snapHorizontalPositionInBounds = (x: number, step: number, origin: number, min: number, max: number): number => {
  if (!Number.isFinite(x) || !Number.isFinite(min) || !Number.isFinite(max) || min > max) return x;
  const bounded = Math.min(max, Math.max(min, x));
  if (!validStep(step, origin)) return bounded;
  const first = Math.ceil((min - origin) / step - EPSILON);
  const last = Math.floor((max - origin) / step + EPSILON);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last) return bounded;
  const index = Math.min(last, Math.max(first, Math.round((x - origin) / step)));
  return clean(origin + index * step);
};

export type HorizontalGridLine = { positionMeters: number; kind: "counting" | "fine" };
/** Border > center > counting > fine. Center and border are drawn by the caller. */
export const createHorizontalGridLines = (width: number, mode: HorizontalCountingMode, step: number, centerVisible = true): HorizontalGridLine[] => {
  const origin = horizontalGridOriginMeters(width, mode);
  if (!validStep(step, origin)) return [];
  const counting = createGridTicksInRange(0, width, 1, origin).filter(x => Math.abs(x - width / 2) > EPSILON);
  const lines = new Map<number, HorizontalGridLine>();
  for (const [ticks, kind] of [[createGridTicksInRange(0, width, step, origin), "fine"], [counting, "counting"]] as const) {
    for (const x of ticks) {
      if (x <= EPSILON || x >= width - EPSILON || (centerVisible && Math.abs(x - width / 2) <= EPSILON)) continue;
      lines.set(x, { positionMeters: x, kind });
    }
  }
  return [...lines.values()].sort((a, b) => a.positionMeters - b.positionMeters);
};

/** Snap the primary member in the intersection of all members' movement bounds. */
export const snapMemberGroupHorizontal = (requestedX: number, primaryX: number, positions: Position[], width: number, step: number, origin: number): number => {
  const minDelta = Math.max(...positions.map(p => -p.x));
  const maxDelta = Math.min(...positions.map(p => width - p.x));
  return snapHorizontalPositionInBounds(requestedX, step, origin, primaryX + minDelta, primaryX + maxDelta);
};
