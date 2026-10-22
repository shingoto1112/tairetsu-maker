import type { Project } from "../types";
import { getSnapshotForFrame } from "./interpolation";

export type ObjectAssignmentResult = {
  project: Project;
  addedMemberIds: string[];
  alreadyAssignedCount: number;
  error?: string;
};

/** Compile against the recipe's live Project, including remote assignments. */
export const applyMembersToObject = (
  project: Project, sceneId: string, objectId: string, memberIds: string[],
): ObjectAssignmentResult => {
  const unchanged = { project, addedMemberIds: [], alreadyAssignedCount: 0 };
  const frame = project.frames.find((item) => item.id === sceneId);
  const object = project.stageObjects.find((item) => item.id === objectId);
  const ids = [...new Set(memberIds)];
  if (!frame || !object || ids.some((id) => !project.members.some((member) => member.id === id)))
    return { ...unchanged, error: "割り当てるシーン・道具・メンバーが見つかりません。選び直してください。" };
  if (getSnapshotForFrame(project, sceneId).objectStates[objectId]?.visible === false)
    return { ...unchanged, error: "このシーンで表示中の道具だけに割当できます。" };
  const assigned = frame.objectAssignments?.[objectId] ?? [];
  const addedMemberIds = ids.filter((id) => !assigned.includes(id));
  const alreadyAssignedCount = ids.length - addedMemberIds.length;
  if (!addedMemberIds.length) return { ...unchanged, alreadyAssignedCount };
  return {
    addedMemberIds, alreadyAssignedCount,
    project: { ...project, frames: project.frames.map((item) => item !== frame ? item : {
      ...frame,
      objectAssignments: { ...frame.objectAssignments, [objectId]: [...assigned, ...addedMemberIds] },
      memberVisibility: { ...frame.memberVisibility, ...Object.fromEntries(addedMemberIds.map((id) => [id, false])) },
    }) },
  };
};

/** Projection creates new arrays; acknowledgement must compare values. */
export const membersAssignmentApplied = (
  project: Project, sceneId: string, objectId: string, addedMemberIds: string[],
): boolean => {
  const frame = project.frames.find((item) => item.id === sceneId);
  return addedMemberIds.length > 0 && addedMemberIds.every((id) =>
    frame?.objectAssignments?.[objectId]?.includes(id) && frame.memberVisibility?.[id] === false);
};

export const membersAssignmentNotice = (objectName: string, count: number, alreadyAssignedCount: number, singleMemberName?: string): string =>
  count === 0 ? "選択した人は全員、この道具の担当です。"
    // One person keeps the long-standing wording (also used by the roster's tap-to-assign list).
    : count === 1 && alreadyAssignedCount === 0 && singleMemberName ? `${singleMemberName} を ${objectName} に割り当てました。`
    : `${count}人を${objectName}に割り当てました。${alreadyAssignedCount > 0 ? `${alreadyAssignedCount}人は割当済みです。` : ""}`;
