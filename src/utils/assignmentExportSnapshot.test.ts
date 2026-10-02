import { describe, expect, it } from "vitest";
import { createAssignmentExportSnapshot } from "./assignmentExportSnapshot";
import type { ExportSource } from "./mobileExportTypes";

const source = (): ExportSource => {
  const objects = ["visible", "hidden", "empty"].map((id) => ({ id, name: id, color: "blue", type: "prop" as const, shape: "rectangle" as const, widthMeters: 1, heightMeters: 1, defaultX: 0, defaultY: 0, defaultRotation: 0, visible: true, locked: false, zIndex: 1 }));
  const frame = { id: "s1", label: "前半", timeSec: 65, positions: {}, objectStates: { hidden: { objectId: "hidden", x: 0, y: 0, widthMeters: 1, heightMeters: 1, rotation: 0, visible: false, zIndex: 1 } }, objectAssignments: { visible: ["a", "a", "missing", "b"], hidden: ["c"] } };
  return { projectTitle: "演目", objects, objectGroups: [{ id: "tools", name: "道具", objectIds: objects.map((object) => object.id), color: "blue" }],
    members: ["a", "b", "c"].map((id) => ({ id, name: id === "c" ? "別名" : "同名", color: "red" })), memberGroups: [{ id: "red", name: "赤組", memberIds: ["a"] }, { id: "white", name: "白組", memberIds: ["b", "c"] }],
    frames: [frame, { ...frame, id: "s2", label: "後半", timeSec: 125, objectStates: {}, objectAssignments: { visible: ["a"] } }], currentFrame: frame, objectStates: frame.objectStates };
};

describe("assignment export snapshot", () => {
  it("uses current scope, visible tools, valid unique IDs and distinguishes duplicate names in the output", () => {
    const snapshot = createAssignmentExportSnapshot(source(), "current");
    expect(snapshot.scenes).toHaveLength(1); expect(snapshot.scopeLabel).toBe("前半");
    expect(snapshot.scenes[0].time).toBe("1:05");
    const tools = snapshot.scenes[0].groups[0].tools;
    expect(tools.map((tool) => tool.name)).toEqual(["visible", "empty"]);
    expect(tools[0].assignees).toEqual(["同名（赤組）", "同名（白組）"]);
    expect(tools[1].assignees).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('"id":');
  });
  it("includes all scenes and inherits missing visibility from preceding frames", () => {
    const snapshot = createAssignmentExportSnapshot(source(), "all");
    expect(snapshot.scenes).toHaveLength(2); expect(snapshot.scopeLabel).toBe("全シーン");
    expect(snapshot.scenes[1].groups[0].tools.map((tool) => tool.name)).toEqual(["visible", "empty"]);
    expect(snapshot.scenes[1].groups[0].tools[0].assignees).toEqual(["同名（赤組）"]);
  });
  it("does not append groups for a duplicate member name absent from the selected output", () => {
    const input = source(); input.currentFrame = input.frames[1];
    const snapshot = createAssignmentExportSnapshot(input, "current");
    expect(snapshot.scenes[0].groups[0].tools[0].assignees).toEqual(["同名"]);
    input.members[0].name = "編集後";
    expect(snapshot.scenes[0].groups[0].tools[0].assignees).toEqual(["同名"]);
  });
  it("requires a selected scene for current scope", () => {
    const input = source(); input.currentFrame = null;
    expect(() => createAssignmentExportSnapshot(input, "current")).toThrow("シーンを選択");
  });
});
