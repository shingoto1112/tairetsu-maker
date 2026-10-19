import { snapObjectPosition } from "./objectMovement";
import type { ObjectGeometry } from "./objectGeometry";
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

/** Paste keeps the historical center/cell stage lattice and top-left/0.25m parade lattice. */
export const snapPastedObjectPosition = (center: Position, geometry: ObjectGeometry, stage: StageConfig, parade?: ParadeSettings): Position =>
  snapObjectPosition({ x: center.x - geometry.widthMeters / 2, y: center.y - geometry.heightMeters / 2 }, geometry, stage,
    parade ? 0.25 : stage.showGrid ? stage.gridSizeMeters : NaN,
    { x: horizontalGridOriginMeters(stage.widthMeters, parade ? parade.horizontalMeasureMode : stage.horizontalGuideMode),
      y: parade ? parade.totalDistance : stageVerticalGridOriginMeters(stage.depthMeters, stage) }, parade ? "topLeft" : "center");
