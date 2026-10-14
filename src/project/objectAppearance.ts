import type { FormationFrame, ObjectGroup, Project, StageObject, StageObjectDraft, StageObjectShape } from "../types";
import { clamp } from "../utils/coordinates";
import { getSafeParadeCanvasDistance } from "../utils/parade";
import { positiveNumber } from "./defaults";

/** UI vocabulary only. Never use this conversion when reading/saving a Project. */
export type ObjectShapeChoice = "rectangle" | "circle";
export const objectShapeChoice = (shape: StageObjectShape): ObjectShapeChoice => shape === "circle" ? "circle" : "rectangle";
/** New rectangle curtain presets keep the existing striped CSS; old non-rectangle values keep their appearance. */
export const objectRenderShape = (object: Pick<StageObject, "type" | "shape">): StageObjectShape =>
  object.type === "curtain" && object.shape === "rectangle" ? "curtain" : object.shape;
export type ObjectSize = Pick<StageObject, "widthMeters" | "heightMeters">;
/** Omitted axes are resolved from the latest Project, including remote edits. */
export type ObjectAppearancePatch = Partial<ObjectSize> & { shape?: ObjectShapeChoice };
export const sameObjectSize = (a: ObjectSize, b: ObjectSize): boolean =>
  Math.abs(a.widthMeters - b.widthMeters) <= 1e-6 && Math.abs(a.heightMeters - b.heightMeters) <= 1e-6;
const sameSavedSize = (a: ObjectSize, b: ObjectSize): boolean => a.widthMeters === b.widthMeters && a.heightMeters === b.heightMeters;

/** Count saved states, including hidden ones. Ties return registration even if it is not a mode. */
export function objectBaseSize(project: Pick<Project, "frames">, object: StageObject): ObjectSize {
  const counts: { size: ObjectSize; count: number }[] = [];
  for (const frame of project.frames) {
    const state = frame.objectStates[object.id];
    if (!state) continue;
    const found = counts.find(entry => sameSavedSize(entry.size, state));
    if (found) found.count++;
    else counts.push({ size: state, count: 1 });
  }
  const max = Math.max(0, ...counts.map(entry => entry.count));
  const winners = counts.filter(entry => entry.count === max);
  const source = winners.length === 1 ? winners[0].size : object;
  return { widthMeters: source.widthMeters, heightMeters: source.heightMeters };
}

export function objectSizeLimits(project: Project): ObjectSize {
  return project.mode === "parade" ? {
    widthMeters: positiveNumber(project.paradeSettings?.width, project.stage.widthMeters, 1),
    heightMeters: positiveNumber(project.paradeSettings?.totalDistance, project.stage.depthMeters, 1),
  } : { widthMeters: project.stage.widthMeters, heightMeters: project.stage.depthMeters };
}

export function objectSceneBounds(project: Project, frame: FormationFrame): ObjectSize {
  if (project.mode === "parade") {
    const limits = objectSizeLimits(project);
    return { ...limits, heightMeters: getSafeParadeCanvasDistance(limits.heightMeters, project.paradeSettings?.backwardDistanceMeters) };
  }
  if (project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true) return objectSizeLimits(project);
  return {
    widthMeters: positiveNumber(frame.stageWidthMeters, project.stage.widthMeters, 1),
    heightMeters: positiveNumber(frame.stageDepthMeters, project.stage.depthMeters, 1),
  };
}

/** Atomic recipe: reject before returning any changes; never create missing scene states. */
export function applyObjectAppearance(project: Project, objectId: string, patch: ObjectAppearancePatch): Project {
  const object = project.stageObjects.find(item => item.id === objectId);
  if (!object) return project;
  if (patch.shape !== undefined && patch.shape !== "rectangle" && patch.shape !== "circle") throw new Error("形は四角形か円を選んでください。");
  const hasSize = patch.widthMeters !== undefined || patch.heightMeters !== undefined;
  const base = objectBaseSize(project, object);
  const size = { widthMeters: patch.widthMeters ?? base.widthMeters, heightMeters: patch.heightMeters ?? base.heightMeters };
  const limits = objectSizeLimits(project);
  for (const axis of ["widthMeters", "heightMeters"] as const) {
    const value = patch[axis];
    if (value !== undefined && (!Number.isFinite(value) || value < .1 || value > limits[axis] || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6))
      throw new Error(`${axis === "widthMeters" ? "幅" : "高さ"}は0.1〜${limits[axis]}m、小数2桁までで設定してください。`);
  }
  // Re-confirming an unchanged displayed size must not rewrite differing registration.
  const resize = hasSize && !sameObjectSize(base, size);
  const shapeChanged = patch.shape !== undefined && object.shape !== patch.shape;
  if (!resize && !shapeChanged) return project;
  if (resize) for (const frame of project.frames) {
    const state = frame.objectStates[objectId];
    if (!state || !sameObjectSize(state, base)) continue;
    const bounds = objectSceneBounds(project, frame);
    if (size.widthMeters > bounds.widthMeters || size.heightMeters > bounds.heightMeters)
      throw new Error(`「${frame.label}」のステージ（幅${bounds.widthMeters}m・奥行き${bounds.heightMeters}m）に収まらないため、確定できません。`);
  }
  const frames = resize ? project.frames.map(frame => {
    const state = frame.objectStates[objectId];
    if (!state || !sameObjectSize(state, base)) return frame;
    const bounds = objectSceneBounds(project, frame);
    return { ...frame, objectStates: { ...frame.objectStates, [objectId]: { ...state, ...size,
      x: clamp(state.x + (state.widthMeters - size.widthMeters) / 2, 0, bounds.widthMeters - size.widthMeters),
      y: clamp(state.y + (state.heightMeters - size.heightMeters) / 2, 0, bounds.heightMeters - size.heightMeters),
    } } };
  }) : project.frames;
  return { ...project, frames, stageObjects: project.stageObjects.map(item => item.id !== objectId ? item : {
    ...item, ...(shapeChanged ? { shape: patch.shape! } : {}), ...(resize ? size : {}),
  }) };
}

/** One vote per existing ID, saved shape + oldBase pair; first group ID breaks ties. */
export function objectDraftForGroup(project: Project, group: ObjectGroup, draft: StageObjectDraft): StageObjectDraft {
  const counts: { shape: StageObjectShape; size: ObjectSize; count: number }[] = [];
  const seen = new Set<string>();
  const objects = new Map(project.stageObjects.map(object => [object.id, object]));
  for (const id of group.objectIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const object = objects.get(id);
    if (!object) continue;
    const size = objectBaseSize(project, object);
    const found = counts.find(entry => entry.shape === object.shape && sameSavedSize(entry.size, size));
    if (found) found.count++;
    else counts.push({ shape: object.shape, size, count: 1 });
  }
  const winner = counts.reduce<typeof counts[number] | undefined>((best, entry) => !best || entry.count > best.count ? entry : best, undefined);
  return { ...draft, shape: winner?.shape ?? group.defaultShape ?? draft.shape, ...(winner?.size ?? {}) };
}

/** Membership never changes shape/size. Color is an explicit caller decision. */
export function changeObjectMembership(project: Project, objectId: string, groupId: string | null, copyColor = false): Project {
  const object = project.stageObjects.find(item => item.id === objectId);
  const destination = project.objectGroups?.find(group => group.id === groupId);
  if (!object || groupId !== null && !destination) return project;
  const current = project.objectGroups?.filter(group => group.objectIds.includes(objectId)) ?? [];
  const color = copyColor && destination?.color ? destination.color : object.color;
  if ((current[0]?.id ?? null) === groupId && current.length <= 1 && color === object.color) return project;
  return { ...project,
    stageObjects: color === object.color ? project.stageObjects : project.stageObjects.map(item => item.id === objectId ? { ...item, color } : item),
    objectGroups: project.objectGroups?.map(group => {
      const ids = group.objectIds.filter(id => id !== objectId);
      if (group.id === groupId) return { ...group, objectIds: [...ids, objectId] };
      return ids.length === group.objectIds.length ? group : { ...group, objectIds: ids };
    }),
  };
}
