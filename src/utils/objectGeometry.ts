import type { ObjectState, Position } from "../types";

export type ObjectGeometry = Pick<ObjectState, "widthMeters" | "heightMeters" | "rotation">;

const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

/** Rotation is about the original rectangle's center; stored x/y stay its unrotated corner.
 * Render paths (warnings, cards, exports, thumbnails) call this, so malformed saved values must not throw:
 * a non-finite angle counts as 0 and a non-finite size as 0. Editing entry points reject non-finite patches. */
export const rotatedObjectHalfExtents = (geometry: ObjectGeometry) => {
  const widthMeters = finiteOr(geometry.widthMeters, 0), heightMeters = finiteOr(geometry.heightMeters, 0);
  const angle = (finiteOr(geometry.rotation, 0) % 360) * Math.PI / 180;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  return { halfWidth: (cos * widthMeters + sin * heightMeters) / 2,
    halfHeight: (sin * widthMeters + cos * heightMeters) / 2 };
};

export const objectPositionBounds = (geometry: ObjectGeometry, stage: { widthMeters: number; depthMeters: number }) => {
  const { halfWidth, halfHeight } = rotatedObjectHalfExtents(geometry);
  const minX = halfWidth - geometry.widthMeters / 2;
  const minY = halfHeight - geometry.heightMeters / 2;
  return { minX, maxX: Math.max(minX, stage.widthMeters - halfWidth - geometry.widthMeters / 2),
    minY, maxY: Math.max(minY, stage.depthMeters - halfHeight - geometry.heightMeters / 2) };
};

/** Unrounded primitive for roster resizing, whose existing center anchor keeps full precision. */
export const boundObjectPosition = (position: Position, geometry: ObjectGeometry,
  stage: { widthMeters: number; depthMeters: number }): Position => {
  // Same as the pre-rotation clamp: non-finite input passes through instead of throwing mid-render.
  if (![position.x, position.y, stage.widthMeters, stage.depthMeters].every(Number.isFinite)) return position;
  const b = objectPositionBounds(geometry, stage);
  return { x: Math.min(b.maxX, Math.max(b.minX, position.x)),
    y: Math.min(b.maxY, Math.max(b.minY, position.y)) };
};

/** Under 1cm is not warned: it covers mm rounding of saved corners and the invisible corner overhang of a
 * slightly hand-rotated tool at the edge (a 3m tool at -0.335° overhangs about 9mm), which the old
 * unrotated check never reported. */
const OUTSIDE_WARNING_TOLERANCE_METERS = 0.01;
export const isObjectOutsideStage = (state: ObjectGeometry & Position, stage: { widthMeters: number; depthMeters: number }) => {
  const { halfWidth, halfHeight } = rotatedObjectHalfExtents(state);
  const cx = state.x + state.widthMeters / 2, cy = state.y + state.heightMeters / 2, t = OUTSIDE_WARNING_TOLERANCE_METERS;
  return cx - halfWidth < -t || cy - halfHeight < -t ||
    cx + halfWidth > stage.widthMeters + t || cy + halfHeight > stage.depthMeters + t;
};
