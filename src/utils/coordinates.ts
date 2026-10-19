import { Position, StageConfig, ViewerPerspective } from "../types";
import { boundObjectPosition, type ObjectGeometry } from "./objectGeometry";

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const roundMeters = (value: number): number =>
  Number(value.toFixed(3));

export const snapToGrid = (
  value: number,
  gridSizeMeters: number,
  enabled: boolean,
): number => {
  if (!enabled || gridSizeMeters <= 0) {
    return roundMeters(value);
  }
  return roundMeters(Math.round(value / gridSizeMeters) * gridSizeMeters);
};

export const constrainMemberPosition = (
  position: Position,
  stage: StageConfig,
): Position => ({
  x: roundMeters(clamp(position.x, 0, stage.widthMeters)),
  y: roundMeters(clamp(position.y, 0, stage.depthMeters)),
});

export const constrainObjectPosition = (
  position: Position,
  geometry: ObjectGeometry,
  stage: StageConfig,
): Position => {
  const bounded = boundObjectPosition(position, geometry, stage);
  return { x: roundMeters(bounded.x), y: roundMeters(bounded.y) };
};

export const getObjectCenter = (
  position: Position,
  widthMeters: number,
  heightMeters: number,
): Position => ({
  x: roundMeters(position.x + widthMeters / 2),
  y: roundMeters(position.y + heightMeters / 2),
});

export const objectTopLeftFromCenter = (
  center: Position,
  widthMeters: number,
  heightMeters: number,
): Position => ({
  x: roundMeters(center.x - widthMeters / 2),
  y: roundMeters(center.y - heightMeters / 2),
});

export const constrainObjectCenterPosition = (
  center: Position,
  geometry: ObjectGeometry,
  stage: StageConfig,
): Position => {
  const position = constrainObjectPosition({ x: center.x - geometry.widthMeters / 2,
    y: center.y - geometry.heightMeters / 2 }, geometry, stage);
  return getObjectCenter(position, geometry.widthMeters, geometry.heightMeters);
};

export const clientPointToMeters = (
  clientX: number,
  clientY: number,
  stageElement: HTMLElement,
  stage: StageConfig,
  viewerPerspective: ViewerPerspective = "audience",
): Position => {
  const rect = stageElement.getBoundingClientRect();
  const displayPoint = {
    x: ((clientX - rect.left) / rect.width) * stage.widthMeters,
    y: ((clientY - rect.top) / rect.height) * stage.depthMeters,
  };
  return displayPointToStagePoint(displayPoint, stage, viewerPerspective);
};

export const displayPointToStagePoint = (
  position: Position,
  stage: StageConfig,
  viewerPerspective: ViewerPerspective,
): Position =>
  viewerPerspective === "performer"
    ? {
        x: stage.widthMeters - position.x,
        y: stage.depthMeters - position.y,
      }
    : position;

export const stagePointToDisplayPoint = (
  position: Position,
  stage: StageConfig,
  viewerPerspective: ViewerPerspective,
): Position =>
  viewerPerspective === "performer"
    ? {
        x: stage.widthMeters - position.x,
        y: stage.depthMeters - position.y,
      }
    : position;
