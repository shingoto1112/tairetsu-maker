import type { FormationFrame, Project } from "../types";
import { positiveNumber } from "../project/defaults";
import { getSafeParadeCanvasDistance } from "./parade";

export const getEffectiveStageSize = (
  project: Project,
  frame: FormationFrame | undefined,
): Pick<Project["stage"], "widthMeters" | "depthMeters"> => {
  if (project.mode === "parade") {
    const totalDistance = positiveNumber(
      project.paradeSettings?.totalDistance,
      project.stage.depthMeters,
      1,
    );
    return {
      widthMeters: positiveNumber(
        project.paradeSettings?.width,
        project.stage.widthMeters,
        1,
      ),
      depthMeters: getSafeParadeCanvasDistance(
        totalDistance,
        project.paradeSettings?.backwardDistanceMeters,
      ),
    };
  }
  if (project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true) {
    return {
      widthMeters: project.stage.widthMeters,
      depthMeters: project.stage.depthMeters,
    };
  }
  return {
    widthMeters: positiveNumber(
      frame?.stageWidthMeters,
      project.stage.widthMeters,
      1,
    ),
    depthMeters: positiveNumber(
      frame?.stageDepthMeters,
      project.stage.depthMeters,
      1,
    ),
  };
};

