import type { ParadeSettings, Position, StageConfig } from "../types";
import { horizontalGridOriginMeters } from "./horizontalGrid";
import { snapPositionInBounds } from "./positionGrid";
import { stageVerticalGridOriginMeters } from "./verticalGrid";
import { roundMeters } from "./coordinates";

/** Gesture entry only: never use to normalize stored coordinates. */
export const snapPastedMemberPosition = (point: Position, stage: StageConfig, parade?: ParadeSettings): Position => {
  const step = parade ? parade.cellSizeMeters : stage.showGrid ? stage.gridSizeMeters : NaN;
  const result = {
    x: snapPositionInBounds(point.x, step, horizontalGridOriginMeters(stage.widthMeters, parade ? parade.horizontalMeasureMode : stage.horizontalGuideMode), 0, stage.widthMeters),
    y: snapPositionInBounds(point.y, step, parade ? parade.totalDistance : stageVerticalGridOriginMeters(stage.depthMeters, stage), 0, stage.depthMeters),
  };
  // Retain the stage's historical Grid OFF millimeter rounding, without a lattice snap.
  return !parade && !stage.showGrid ? { x: roundMeters(result.x), y: roundMeters(result.y) } : result;
};

/** Parade tools snap their top-left (same as dragging); stage tools retain center/cell paste semantics. */
export const snapPastedObjectPosition = (center: Position, width: number, height: number, stage: StageConfig, parade?: ParadeSettings): Position => {
  const originX = horizontalGridOriginMeters(stage.widthMeters, parade ? parade.horizontalMeasureMode : stage.horizontalGuideMode);
  if (parade) return {
    x: snapPositionInBounds(center.x - width / 2, 0.25, originX, 0, Math.max(0, stage.widthMeters - width)),
    y: snapPositionInBounds(center.y - height / 2, 0.25, parade.totalDistance, 0, Math.max(0, stage.depthMeters - height)),
  };
  const step = stage.showGrid ? stage.gridSizeMeters : NaN;
  const requested = stage.showGrid ? center : { x: roundMeters(center.x), y: roundMeters(center.y) };
  return {
    x: snapPositionInBounds(requested.x, step, originX, Math.min(stage.widthMeters, width / 2), Math.max(width / 2, stage.widthMeters - width / 2)) - width / 2,
    y: snapPositionInBounds(requested.y, step, stageVerticalGridOriginMeters(stage.depthMeters, stage), Math.min(stage.depthMeters, height / 2), Math.max(height / 2, stage.depthMeters - height / 2)) - height / 2,
  };
};
