import type { StageConfig, ViewerPerspective } from "../types";

/** Full effective scene depth, before reflection or cropping; lateral fronts retain bottom behavior. */
export const stageVerticalGridOriginMeters = (
  depth: number,
  stage: Pick<StageConfig, "frontDirection" | "audienceSide">,
  override?: "top" | "bottom",
): number => (override ?? stage.frontDirection ?? stage.audienceSide ?? "bottom") === "top" ? 0 : depth;

/** The horizontal centre-count row sits beside the 0m line as displayed (the audience edge).
 * The performer view mirrors the stage vertically; parades keep the row on top. */
export const horizontalRulerSide = (
  stage: Pick<StageConfig, "frontDirection" | "audienceSide">,
  perspective: ViewerPerspective = "audience",
  isParade = false,
): "top" | "bottom" => {
  if (isParade) return "top";
  const zeroAtTop = stageVerticalGridOriginMeters(1, stage) === 0;
  return zeroAtTop === (perspective !== "performer") ? "top" : "bottom";
};
