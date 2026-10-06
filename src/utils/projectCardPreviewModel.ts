import type { Project, StageObjectShape } from "../types";
import { formationVerticalRange } from "./formationExportLayout";
import { horizontalGridOriginMeters } from "./horizontalGrid";
import { createDefaultObjectState, getSnapshotForFrame, sortFrames } from "./interpolation";
import { getMemberDisplayColor } from "./memberAppearance";
import { getSafeParadeCanvasDistance, normalizeParadeHorizontalMeasureMode } from "./parade";

export type ProjectCardPreviewPoint = Readonly<{ x: number; y: number; color: string }>;
export type ProjectCardPreviewObject = Readonly<{
  x: number; y: number; width: number; height: number; rotation: number;
  color: string; shape: StageObjectShape; opacity: number;
}>;

/** Detached drawing values only: no Project, frame, member, audio or CRDT references. */
export type ProjectCardPreviewModel = Readonly<{
  width: number; top: number; height: number;
  gridStep: number; gridOriginX: number;
  radius: number; pointStrokeWidth: number;
  points: readonly ProjectCardPreviewPoint[];
  objects: readonly ProjectCardPreviewObject[];
}>;

// SVG paint values must never resolve an external URL or a CSS variable containing one.
const safeColor = (value: string, fallback: string): string => {
  const color = value.trim();
  return color.length <= 96 && (
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ||
    /^[a-z]+$/i.test(color) ||
    /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/i.test(color)
  ) ? color : fallback;
};

/** First scene in stable time order; coordinates are copied, never re-snapped. */
export function createProjectCardPreviewModel(project: Project): ProjectCardPreviewModel | null {
  const frame = sortFrames(project.frames)[0];
  if (!frame) return null;
  const snapshot = getSnapshotForFrame(project, frame.id);
  const parade = project.mode === "parade";
  const global = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
  const width = Math.max(1, parade ? project.paradeSettings?.width ?? 20
    : global ? project.stage.widthMeters : frame.stageWidthMeters ?? project.stage.widthMeters);
  const depth = Math.max(1, parade ? getSafeParadeCanvasDistance(
    project.paradeSettings?.totalDistance ?? 100, project.paradeSettings?.backwardDistanceMeters ?? 0,
  ) : global ? project.stage.depthMeters : frame.stageDepthMeters ?? project.stage.depthMeters);
  const range = parade ? formationVerticalRange(project, { ...frame, ...snapshot }) : { top: 0, bottom: depth };
  const height = Math.max(1, range.bottom - range.top);
  if (![width, range.top, height].every(Number.isFinite)) return null;

  const step = parade ? project.paradeSettings?.cellSizeMeters ?? 1 : project.stage.gridSizeMeters;
  // Thin by an integer multiple, keeping the original horizontal lattice origin.
  const validStep = Number.isFinite(step) && step > 0 ? step : 1;
  const gridStep = validStep * Math.max(1, Math.ceil(0.5 / validStep));
  const mode = parade ? normalizeParadeHorizontalMeasureMode(project.paradeSettings?.horizontalMeasureMode)
    : project.stage.horizontalGuideMode ?? "meters";
  const scale = parade ? Math.max(1, width / 12) : 1;
  const dense = project.members.length >= 120;
  const points: ProjectCardPreviewPoint[] = [];
  for (const member of project.members) {
    if (member.visible === false || snapshot.memberVisibility[member.id] === false) continue;
    const position = snapshot.positions[member.id];
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    points.push({ x: position.x, y: position.y,
      color: safeColor(getMemberDisplayColor(member, { groups: project.memberGroups ?? [], snapshot }), "#14b8a6") });
  }
  const objects: ProjectCardPreviewObject[] = [];
  for (const object of project.stageObjects) {
    const state = snapshot.objectStates[object.id] ?? createDefaultObjectState(object);
    if (state.visible === false || ![state.x, state.y, state.widthMeters, state.heightMeters, state.rotation].every(Number.isFinite)) continue;
    objects.push({ x: state.x, y: state.y, width: Math.max(0.08, state.widthMeters),
      height: Math.max(0.08, state.heightMeters), rotation: state.rotation,
      color: safeColor(object.color, "#64748b"), shape: object.shape,
      opacity: object.type === "curtain" ? 0.42 : 0.32 });
  }
  return { width, top: range.top, height, gridStep, gridOriginX: horizontalGridOriginMeters(width, mode),
    radius: (dense ? 0.075 : 0.11) * scale, pointStrokeWidth: (dense ? 0.025 : 0.04) * scale,
    points, objects };
}
