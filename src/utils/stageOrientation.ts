import type { AlignmentAction, StageConfig, ViewerPerspective } from "../types";

/** Rotate positions by 180° so the audience (0m) edge follows the named view.
 * Legacy lateral fronts use the bottom origin. Parade coordinates never rotate.
 */
export const isStageViewRotated180 = (
  stage: Partial<Pick<StageConfig, "frontDirection" | "audienceSide">>,
  perspective: ViewerPerspective = "audience",
  isParade = false,
): boolean => !isParade && ((perspective === "performer") !==
  ((stage.frontDirection ?? stage.audienceSide ?? "bottom") === "top"));

/** Convert only named screen edges; geometry utilities continue to use internal directions. */
export const screenAlignmentToInternal = (action: AlignmentAction, rotated180: boolean): AlignmentAction => {
  if (!rotated180) return action;
  switch (action) {
    case "left": return "right";
    case "right": return "left";
    case "top": return "bottom";
    case "bottom": return "top";
    case "objectLeft": return "objectRight";
    case "objectRight": return "objectLeft";
    case "objectTop": return "objectBottom";
    case "objectBottom": return "objectTop";
    default: return action;
  }
};
