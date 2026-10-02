import type { FormationFrame, Project } from "../types";
import { getSnapshotForFrame, sortFrames } from "./interpolation";

/** Resolve against the complete timeline before narrowing the export scope. Never changes saved frames. */
export const resolveExportFrames = (project: Project): FormationFrame[] =>
  sortFrames(project.frames).map((frame) => ({
    ...frame,
    ...getSnapshotForFrame(project, frame.id),
  }));
