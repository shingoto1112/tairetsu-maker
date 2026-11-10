import { StaticSceneDrawing } from "./SceneDrawing";
import type { StaticSceneDrawingProps } from "./SceneDrawing";
export type { StageDrawingRange } from "./SceneDrawing";

/** Read-only scene at an explicit CSS scale, without A4 layout knowledge. */
export const StaticStagePreview = (props: StaticSceneDrawingProps) => (
  <div className="static-stage-preview"><StaticSceneDrawing {...props} /></div>
);
