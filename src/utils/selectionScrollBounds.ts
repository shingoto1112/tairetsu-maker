import type { Project, StageConfig, StageSnapshot, ViewerPerspective } from "../types";

export type SelectionScrollBounds = { x: number; y: number; widthMeters: number; heightMeters: number; minimumScroll?: boolean };

/** Canvas coordinates are already measured from the parade canvas top, including the distance origin. */
export const selectionScrollBounds = (
  project: Project, snapshot: StageSnapshot, type: "member" | "object", id: string,
  stage: StageConfig, perspective: ViewerPerspective,
  assignments: Record<string, string[]> = {},
): SelectionScrollBounds | null => {
  let bounds: SelectionScrollBounds;
  if (type === "member") {
    const member = project.members.find((item) => item.id === id);
    const position = snapshot.positions[id];
    const assigned = Object.values(assignments).some((ids) => ids.includes(id));
    if (!member || member.visible === false || snapshot.memberVisibility[id] === false || assigned || !position) return null;
    const diameter = stage.memberDiameterMeters ?? 0.5;
    bounds = { x: position.x - diameter / 2, y: position.y - diameter / 2, widthMeters: diameter, heightMeters: diameter };
  } else {
    const state = snapshot.objectStates[id];
    if (!state?.visible) return null;
    const rotation = state.rotation * Math.PI / 180;
    const width = Math.abs(Math.cos(rotation)) * state.widthMeters + Math.abs(Math.sin(rotation)) * state.heightMeters;
    const height = Math.abs(Math.sin(rotation)) * state.widthMeters + Math.abs(Math.cos(rotation)) * state.heightMeters;
    bounds = { x: state.x + (state.widthMeters - width) / 2, y: state.y + (state.heightMeters - height) / 2, widthMeters: width, heightMeters: height };
  }
  if (project.mode !== "parade" && perspective === "performer") {
    bounds = { ...bounds, x: stage.widthMeters - bounds.x - bounds.widthMeters, y: stage.depthMeters - bounds.y - bounds.heightMeters };
  }
  return { ...bounds, minimumScroll: true };
};
