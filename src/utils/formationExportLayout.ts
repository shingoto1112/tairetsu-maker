import { rotatedObjectHalfExtents } from "./objectGeometry";
import type { FormationFrame, Project } from "../types";
import { createDefaultObjectState } from "./interpolation";
import { getSafeParadeCanvasDistance } from "./parade";

export const FORMATION_TOP = 38;
export const FORMATION_BOTTOM = 16;

// Shared bounds used by the roster assignment preview, scene thumbnails and home cards.
export const formationSize = (project: Project, frame: FormationFrame) => {
  const global = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
  return project.mode === "parade"
    ? { width: Math.max(1, project.paradeSettings?.width ?? project.stage.widthMeters),
      depth: getSafeParadeCanvasDistance(project.paradeSettings?.totalDistance ?? project.stage.depthMeters, project.paradeSettings?.backwardDistanceMeters) }
    : { width: Math.max(1, global ? project.stage.widthMeters : frame.stageWidthMeters ?? project.stage.widthMeters),
      depth: Math.max(0.01, global ? project.stage.depthMeters : frame.stageDepthMeters ?? project.stage.depthMeters) };
};

export const rotatedObjectBounds = (state: { x: number; y: number; widthMeters: number; heightMeters: number; rotation: number }) => {
  const { halfWidth, halfHeight } = rotatedObjectHalfExtents(state);
  const x = state.x + state.widthMeters / 2, y = state.y + state.heightMeters / 2;
  return { left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight };
};

export const formationVerticalRange = (project: Project, frame: FormationFrame) => {
  const size = formationSize(project, frame);
  const radius = Math.max(0.01, project.stage.memberDiameterMeters ?? 0.5) / 2;
  if (project.mode !== "parade") return { top: -radius, bottom: size.depth + radius };
  const assigned = new Set(Object.values(frame.objectAssignments ?? {}).flat());
  let top = Infinity, bottom = -Infinity;
  for (const member of project.members) {
    const position = frame.positions[member.id];
    if (!position || member.visible === false || frame.memberVisibility?.[member.id] === false || assigned.has(member.id)) continue;
    top = Math.min(top, position.y - radius); bottom = Math.max(bottom, position.y + radius);
  }
  for (const object of project.stageObjects) {
    const state = frame.objectStates?.[object.id] ?? createDefaultObjectState(object);
    if ((state.visible ?? object.visible) === false) continue;
    const bounds = rotatedObjectBounds(state);
    top = Math.min(top, bounds.top); bottom = Math.max(bottom, bounds.bottom);
  }
  if (!Number.isFinite(top)) return { top: 0, bottom: Math.min(10, size.depth) };
  const step = Math.max(0.01, project.paradeSettings?.cellSizeMeters ?? project.stage.gridSizeMeters);
  // Preserve rotated bounds even if a prop extends beyond the route edge.
  return { top: Math.min(top, Math.max(0, Math.floor((top - 2) / step) * step)),
    bottom: Math.max(bottom, Math.min(size.depth, Math.ceil((bottom + 2) / step) * step)) };
};

