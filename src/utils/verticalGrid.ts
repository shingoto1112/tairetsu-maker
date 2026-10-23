import type { StageConfig, ViewerPerspective } from "../types";

/** Full effective scene depth, before reflection or cropping; lateral fronts retain bottom behavior. */
export const stageVerticalGridOriginMeters = (
  depth: number,
  stage: Pick<StageConfig, "frontDirection" | "audienceSide">,
  override?: "top" | "bottom",
): number => (override ?? stage.frontDirection ?? stage.audienceSide ?? "bottom") === "top" ? 0 : depth;

/** The horizontal centre-count row sits beside the 0m line as displayed (the audience edge).
 * Performer views put 0m on top for every legacy front; parades keep the row on top. */
export const horizontalRulerSide = (
  _stage: Pick<StageConfig, "frontDirection" | "audienceSide">,
  perspective: ViewerPerspective = "audience",
  isParade = false,
): "top" | "bottom" => {
  if (isParade) return "top";
  return perspective === "performer" ? "top" : "bottom";
};
