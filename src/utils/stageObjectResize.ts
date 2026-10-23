import type { ObjectState, Position, StageConfig, ViewerPerspective } from "../types";
import { roundMeters, snapToGrid } from "./coordinates";
import { isStageViewRotated180 } from "./stageOrientation";

/** The visible bottom-right handle follows the pointer along the prop's own axes.
 * Anchor the opposite visible corner, then return the original storage geometry.
 */
export const resizeStageObject = (
  state: ObjectState, internalDelta: Position, stage: StageConfig, perspective: ViewerPerspective,
): Pick<ObjectState, "x" | "y" | "widthMeters" | "heightMeters"> => {
  const direction = isStageViewRotated180(stage, perspective) ? -1 : 1;
  const angle = state.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = internalDelta.x * direction, dy = internalDelta.y * direction;
  const widthMeters = Math.max(0.1, snapToGrid(state.widthMeters + dx * cos + dy * sin, stage.gridSizeMeters, stage.showGrid));
  const heightMeters = Math.max(0.1, snapToGrid(state.heightMeters - dx * sin + dy * cos, stage.gridSizeMeters, stage.showGrid));
  const dw = widthMeters - state.widthMeters, dh = heightMeters - state.heightMeters;
  return {
    x: roundMeters(state.x - dw / 2 + direction * (dw * cos - dh * sin) / 2),
    y: roundMeters(state.y - dh / 2 + direction * (dw * sin + dh * cos) / 2),
    widthMeters, heightMeters,
  };
};
