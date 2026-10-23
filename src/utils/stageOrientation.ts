import type { StageConfig, ViewerPerspective } from "../types";

/** Rotate positions by 180° so the audience (0m) edge follows the named view.
 * Legacy lateral fronts use the bottom origin. Parade coordinates never rotate.
 */
export const isStageViewRotated180 = (
  stage: Partial<Pick<StageConfig, "frontDirection" | "audienceSide">>,
  perspective: ViewerPerspective = "audience",
  isParade = false,
): boolean => !isParade && ((perspective === "performer") !==
  ((stage.frontDirection ?? stage.audienceSide ?? "bottom") === "top"));
