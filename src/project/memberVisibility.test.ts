import { expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { setMembersFrameVisibility } from "./memberVisibility";

it.each(["stage", "parade"] as const)("fills only missing non-assignee %s positions with separate circles", mode => {
  const p = createSampleProject(); p.mode = mode;
  const f = p.frames[0]; f.positions = { m_anna: { x: 6, y: 4 } };
  f.objectAssignments = { o_chair: ["m_anna", "m_anna", "ghost"], o_curtain: ["m_anna"] };
  f.memberVisibility = { m_anna: false, m_ben: false }; p.members[0].visible = false; p.members[1].visible = false;
  const before = structuredClone(p), result = setMembersFrameVisibility(p, f.id, true), after = result.project;
  expect(result.notice).toBe("2人を表示しました。道具担当の1人は隊列外のままです。");
  expect(after.frames[0].objectAssignments).toBe(f.objectAssignments);
  expect(after.members[0]).toBe(p.members[0]); expect(after.frames[0].memberVisibility!.m_anna).toBe(false);
  expect(after.frames[0].positions.m_anna).toBe(f.positions.m_anna);
  expect(after.members[1].visible).toBe(true);
  const positions = Object.values(after.frames[0].positions);
  positions.forEach((a, i) => positions.slice(i + 1).forEach(b => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(.5)));
  expect(after.frames.slice(1)).toEqual(p.frames.slice(1)); expect(p).toEqual(before);
  expect(setMembersFrameVisibility(after, f.id, true).project).toBe(after);
});
it("leaves missing assignee coordinates, global visibility and scene visibility untouched", () => {
  const p = createSampleProject(), f = p.frames[0];
  f.positions = {}; f.objectAssignments = { o_chair: p.members.map(m => m.id) };
  const result = setMembersFrameVisibility(p, f.id, true);
  expect(result.project).toBe(p); expect(result.notice).toBe("表示するメンバーはいません。道具担当の3人は隊列外のままです。");
});
it("preserves existing overlaps and hide-all semantics, returning the same Project on repeated hide", () => {
  const p = createSampleProject(), f = p.frames[0];
  f.positions.m_ben = f.positions.m_anna; f.objectAssignments = { o_chair: ["m_anna"] };
  const hidden = setMembersFrameVisibility(p, f.id, false).project;
  expect(hidden.frames[0].positions).toEqual(f.positions); expect(hidden.frames[0].objectAssignments).toBe(f.objectAssignments);
  expect(hidden.members).toEqual(p.members); expect(Object.values(hidden.frames[0].memberVisibility!)).toEqual([false, false, false]);
  expect(setMembersFrameVisibility(hidden, f.id, false).project).toBe(hidden);
  expect(setMembersFrameVisibility(hidden, "missing-scene", true).project).toBe(hidden);
});
