import type { Position, StageConfig } from "../types";
import { roundMeters } from "./coordinates";
import { memberGroupAxisBounds } from "./positionGrid";

/** Relative movement has no grid snapping or per-member correction. */
export const moveMembersRelative = (
  positions: Record<string, Position>,
  memberIds: string[],
  requested: Position,
  stage: Pick<StageConfig, "widthMeters" | "depthMeters">,
) => {
  const ids = [...new Set(memberIds)].filter(id => positions[id]);
  const blocked = { x: false, y: false };
  const delta: Position = { x: 0, y: 0 };
  if (ids.length === 0) return { positions, delta, blocked };

  for (const axis of ["x", "y"] as const) {
    // A zero request must leave this axis (including legacy out-of-bounds data) untouched.
    if (requested[axis] === 0) continue;
    const extent = axis === "x" ? stage.widthMeters : stage.depthMeters;
    const [min, max] = memberGroupAxisBounds(0, ids.map(id => positions[id][axis]), extent);
    blocked[axis] = min > max;
    if (!blocked[axis]) delta[axis] = Math.min(max, Math.max(min, requested[axis]));
  }
  if (delta.x === 0 && delta.y === 0) return { positions, delta, blocked };

  // Keep stored coordinates tidy (mm) as the per-member moves did; a moved axis is fully in range.
  const settle = (value: number, step: number, extent: number) =>
    step === 0 ? value : Math.min(extent, Math.max(0, roundMeters(value + step)));
  const next = { ...positions };
  for (const id of ids) {
    const current = positions[id];
    next[id] = { x: settle(current.x, delta.x, stage.widthMeters), y: settle(current.y, delta.y, stage.depthMeters) };
  }
  return { positions: next, delta, blocked };
};
