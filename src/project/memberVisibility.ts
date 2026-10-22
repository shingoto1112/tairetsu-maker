import type { Project } from "../types";
import { placeNewMembers } from "../utils/memberPlacement";

/** One recipe, using live assignments. Preserve assignment maps and all assignee fields. */
export function setMembersFrameVisibility(project: Project, frameId: string, visible: boolean) {
  const frame = project.frames.find(item => item.id === frameId);
  const assigned = new Set(Object.values(frame?.objectAssignments ?? {}).flat());
  const assignees = project.members.filter(member => assigned.has(member.id));
  const targets = project.members.filter(member => !visible || !assigned.has(member.id));
  const notice = visible && assignees.length
    ? `${targets.length ? `${targets.length}人を表示しました。` : "表示するメンバーはいません。"}道具担当の${assignees.length}人は隊列外のままです。`
    : visible ? "すべてのメンバーを表示しました。" : "すべてのメンバーをこのシーンで非表示にしました。";
  if (!frame) return { project, notice };
  const missing = visible ? targets.filter(member => !frame.positions[member.id]) : [];
  const placement = placeNewMembers(project, frame, missing.length);
  let changed = false;
  const positions = { ...frame.positions };
  missing.forEach((member, index) => { positions[member.id] = placement.positions[index]; changed = true; });
  const memberVisibility = { ...frame.memberVisibility };
  targets.forEach(member => {
    if ((memberVisibility[member.id] ?? true) !== visible) { memberVisibility[member.id] = visible; changed = true; }
  });
  const members = project.members.map(member => {
    if (visible && !assigned.has(member.id) && member.visible === false) {
      changed = true; return { ...member, visible: true };
    }
    return member;
  });
  return { project: changed ? { ...project, members, frames: project.frames.map(item => item === frame
    ? { ...frame, positions, memberVisibility } : item) } : project, notice };
}
