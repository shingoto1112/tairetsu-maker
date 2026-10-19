import type { AlignmentAction, ObjectState, Position, StageConfig } from "../types";
import { constrainObjectPosition } from "./coordinates";
import { objectPositionBounds, type ObjectGeometry } from "./objectGeometry";
import { snapPositionInBounds } from "./positionGrid";

/** Tools additionally admit exact edges. Members keep snapPositionInBounds unchanged. */
export const snapObjectAxis = (value: number, step: number, origin: number, min: number, max: number) => {
  if (value <= min) return min;
  if (value >= max) return max;
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(origin)) return value;
  const grid = snapPositionInBounds(value, step, origin, min, max);
  const first = Math.ceil((min - origin) / step - 1e-9), last = Math.floor((max - origin) / step + 1e-9);
  const candidates = Number.isSafeInteger(first) && Number.isSafeInteger(last) && first <= last ? [grid, min, max] : [min, max];
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest);
};

/** Stage drag uses the center; parade drag uses the stored top-left. Paste supplies its historical step. */
export const snapObjectPosition = (position: Position, geometry: ObjectGeometry, stage: StageConfig,
  step: number, origin: Position, anchor: "center" | "topLeft"): Position => {
  const b = objectPositionBounds(geometry, stage);
  const offsetX = anchor === "center" ? geometry.widthMeters / 2 : 0;
  const offsetY = anchor === "center" ? geometry.heightMeters / 2 : 0;
  return constrainObjectPosition({
    x: snapObjectAxis(position.x + offsetX, step, origin.x, b.minX + offsetX, b.maxX + offsetX) - offsetX,
    y: snapObjectAxis(position.y + offsetY, step, origin.y, b.minY + offsetY, b.maxY + offsetY) - offsetY,
  }, geometry, stage);
};

/** Rotation-only and size-only patches retain their existing behavior. Never discard a compound patch. */
export const constrainObjectMovePatch = (state: ObjectState, patch: Partial<ObjectState>, stage: StageConfig): Partial<ObjectState> => {
  if (patch.x === undefined && patch.y === undefined) return patch;
  const next = { ...state, ...patch, x: patch.x ?? state.x, y: patch.y ?? state.y,
    widthMeters: patch.widthMeters ?? state.widthMeters, heightMeters: patch.heightMeters ?? state.heightMeters,
    rotation: patch.rotation ?? state.rotation };
  return { ...patch, ...constrainObjectPosition(next, next, stage) };
};

export const alignedObjectPosition = (state: ObjectState, action: AlignmentAction, stage: StageConfig): Position => {
  const b = objectPositionBounds(state, stage);
  const next = { x: state.x, y: state.y };
  if (action === "objectLeft") next.x = b.minX;
  if (action === "objectRight") next.x = b.maxX;
  if (action === "objectTop") next.y = b.minY;
  if (action === "objectBottom") next.y = b.maxY;
  if (action === "objectCenterX" || action === "objectStageCenter") next.x = (stage.widthMeters - state.widthMeters) / 2;
  if (action === "objectCenterY" || action === "objectStageCenter") next.y = (stage.depthMeters - state.heightMeters) / 2;
  return constrainObjectPosition(next, state, stage);
};
