import type { StageConfig } from "../types";

/** Full effective scene depth, before reflection or cropping; lateral fronts retain bottom behavior. */
export const stageVerticalGridOriginMeters = (
  depth: number,
  stage: Pick<StageConfig, "frontDirection" | "audienceSide">,
  override?: "top" | "bottom",
): number => (override ?? stage.frontDirection ?? stage.audienceSide ?? "bottom") === "top" ? 0 : depth;
