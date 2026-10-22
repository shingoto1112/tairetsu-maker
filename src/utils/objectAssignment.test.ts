import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { applyMembersToObject, membersAssignmentApplied, membersAssignmentNotice } from "./objectAssignment";

const fixture = () => {
  const p = createSampleProject();
  p.members.push(...Array.from({ length: 5 }, (_, i) => ({ id: `new${i}`, name: `追加${i}`, color: "#000", visible: i !== 0 })));
  p.frames[0].objectAssignments = { o_chair: ["m_ben"], o_curtain: ["new0"] };
  p.frames[0].memberVisibility = { m_ben: true, m_anna: true };
  return p;
};
describe("bulk object assignment", () => {
  it("deduplicates and appends five, hides only new assignees, preserves all other state", () => {
    const before = fixture(), original = structuredClone(before);
    const ids = Array.from({ length: 5 }, (_, i) => `new${i}`);
    const result = applyMembersToObject(before, before.frames[0].id, "o_chair", ["m_ben", ...ids, "new0"]);
    expect(result.addedMemberIds).toEqual(ids); expect(result.alreadyAssignedCount).toBe(1);
    expect(result.project.frames[0]).toEqual({ ...before.frames[0],
      objectAssignments: { o_chair: ["m_ben", ...ids], o_curtain: ["new0"] },
      memberVisibility: { m_ben: true, m_anna: true, ...Object.fromEntries(ids.map((id) => [id, false])) },
    });
    expect(result.project.members).toBe(before.members);
    expect(result.project.stageObjects).toBe(before.stageObjects);
    expect(result.project.frames[0].positions).toBe(before.frames[0].positions);
    expect(result.project.frames.slice(1)).toEqual(before.frames.slice(1));
    expect(before).toEqual(original);
    // A shared projection has different references, but the applied values acknowledge success.
    expect(membersAssignmentApplied(structuredClone(result.project), before.frames[0].id, "o_chair", ids)).toBe(true);
    result.project.frames[0].memberVisibility!.new4 = true;
    expect(membersAssignmentApplied(result.project, before.frames[0].id, "o_chair", ids)).toBe(false);
  });
  it("returns the same Project on zero additions (including already assigned but shown members)", () => {
    const p = fixture();
    for (const ids of [[], ["m_ben", "m_ben"]]) {
      const result = applyMembersToObject(p, p.frames[0].id, "o_chair", ids);
      expect(result.project).toBe(p); expect(result.addedMemberIds).toEqual([]);
      expect(p.frames[0].memberVisibility!.m_ben).toBe(true);
    }
  });
  it.each(["scene", "object", "member", "hidden", "inherited-hidden"])("rejects an invalid %s using the latest Project", (invalid) => {
    const p = fixture(); const scene = p.frames[0].id;
    if (invalid === "hidden") p.frames[0].objectStates.o_chair.visible = false;
    if (invalid === "inherited-hidden") {
      p.frames[0].objectStates.o_chair.visible = false;
      delete p.frames[1].objectStates.o_chair;
    }
    const result = applyMembersToObject(p, invalid === "scene" ? "missing" : invalid === "inherited-hidden" ? p.frames[1].id : scene,
      invalid === "object" ? "missing" : "o_chair", [invalid === "member" ? "missing" : "new0"]);
    expect(result.project).toBe(p); expect(result.error).toBeTruthy();
  });
  it("reports new, partial and unchanged counts without claiming a save", () => {
    expect(membersAssignmentNotice("旗", 3, 0)).toBe("3人を旗に割り当てました。");
    expect(membersAssignmentNotice("旗", 2, 1)).toBe("2人を旗に割り当てました。1人は割当済みです。");
    expect(membersAssignmentNotice("旗", 0, 3)).toBe("選択した人は全員、この道具の担当です。");
    // A single new person keeps the existing wording (roster tap-to-assign uses it too).
    expect(membersAssignmentNotice("旗", 1, 0, "あお")).toBe("あお を 旗 に割り当てました。");
    expect(membersAssignmentNotice("旗", 1, 1, "あお")).toBe("1人を旗に割り当てました。1人は割当済みです。");
  });
});

it("words the shown-member notice for all versus some of the selection", async () => {
  const { shownMembersAssignmentNotice } = await import("./assignmentCandidates");
  const people = ["あお", "べに", "みどり"].map((name, i) => ({ id: `p${i}`, name, color: "#000" }));
  expect(shownMembersAssignmentNotice(people, 3)).toBe("選択した3人は表示中です。割り当てると、このシーンでは非表示になります。");
  expect(shownMembersAssignmentNotice(people, 2)).toBe("選択した3人のうち2人は表示中です。割り当てると、このシーンでは非表示になります。");
  expect(shownMembersAssignmentNotice(people.slice(0, 1), 1)).toBe("あおさんは表示中です。割り当てると、このシーンでは非表示になります。");
});
