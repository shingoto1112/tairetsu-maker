import type { Project } from "../types";
import { getSafeParadeBackwardDistance } from "./parade";

export const FORMATION_SIDE = 36;
export const FORMATION_RULER_FONT_PX = 10;
export const FORMATION_RULER_GAP_PX = 4;

/** Reserve both ruler bands inside the page, including a sign and every digit.
 * The mobile ruler uses monospace; one full em per character is conservative. */
export const formationRulerSide = (project: Project): number => {
  const global = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
  const limits = project.mode === "parade"
    ? [project.paradeSettings?.totalDistance ?? project.stage.depthMeters,
      -getSafeParadeBackwardDistance(project.paradeSettings?.backwardDistanceMeters)]
    : [project.stage.depthMeters, ...project.frames.map((frame) =>
      global ? project.stage.depthMeters : frame.stageDepthMeters ?? project.stage.depthMeters)];
  const characters = Math.max(...limits.map((value) => `${Math.trunc(value)}m`.length));
  return Math.max(FORMATION_SIDE, characters * FORMATION_RULER_FONT_PX + FORMATION_RULER_GAP_PX * 2);
};

/** Absolute integer stage coordinates; viewport padding never changes the origin. */
export const stageViewportMeterTicks = (top: number, bottom: number, depth: number): number[] => {
  const start = Math.max(0, Math.ceil(top - 1e-6));
  const end = Math.floor(Math.min(bottom, depth) + 1e-6);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
};
