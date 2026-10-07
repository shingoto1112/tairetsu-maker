import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { Project, StageObjectShape } from "../types";
import { applyObjectAppearance, changeObjectMembership, objectBaseSize, objectDraftForGroup, objectRenderShape, objectSceneBounds, objectShapeChoice, objectSizeLimits } from "./objectAppearance";

function fixture(): Project {
  const p = createSampleProject();
  p.stageObjects = [{ ...p.stageObjects[1], widthMeters: 1.23, heightMeters: .8 }];
  const object = p.stageObjects[0];
  p.frames = Array.from({ length: 4 }, (_, index) => ({ ...p.frames[0], id: `s${index}`, label: `場面${index}`, objectAssignments: { [object.id]: ["m_anna"] },
    objectStates: { [object.id]: { ...p.frames[0].objectStates[object.id], x: 5.1234, y: 3.2345, widthMeters: index === 2 ? 2 : 1.23, heightMeters: .8, rotation: 37 } } }));
  delete p.frames[3].objectStates[object.id];
  p.objectGroups = [{ id: "g", name: "旗", objectIds: [object.id], color: "#ff0000", defaultShape: "circle" },
    { id: "empty", name: "空", objectIds: [], defaultShape: "line" }];
  return p;
}
describe("道具単位の形・普段の大きさ", () => {
  it("counts only saved states, including hidden states; ties and missing states use registration", () => {
    const p = fixture(), object = p.stageObjects[0];
    object.widthMeters = 4;
    p.frames[0].objectStates[object.id].visible = false;
    expect(objectBaseSize(p, object)).toEqual({ widthMeters: 1.23, heightMeters: .8 });
    delete p.frames[1].objectStates[object.id];
    expect(objectBaseSize(p, object).widthMeters).toBe(4);
    p.frames.forEach(f => { f.objectStates = {}; });
    expect(objectBaseSize(p, object).widthMeters).toBe(4);
  });
  it("changes one tool, keeps centers, individual scene edits, missing states and unrelated fields", () => {
    const p = fixture(), object = p.stageObjects[0];
    p.stageObjects.push({ ...object, id: "other" });
    const next = applyObjectAppearance(p, object.id, { widthMeters: 1.33 });
    expect(next.stageObjects[0].widthMeters).toBe(1.33);
    expect(next.stageObjects[1]).toBe(p.stageObjects[1]);
    for (const index of [0, 1]) {
      const state = next.frames[index].objectStates[object.id];
      expect(state.x + state.widthMeters / 2).toBeCloseTo(5.1234 + 1.23 / 2, 10);
      expect(state.y).toBe(3.2345); expect(state.rotation).toBe(37);
      expect(state.visible).toBe(p.frames[index].objectStates[object.id].visible);
      expect(state.zIndex).toBe(p.frames[index].objectStates[object.id].zIndex);
      expect(next.frames[index].objectAssignments).toBe(p.frames[index].objectAssignments);
    }
    expect(next.frames[2]).toBe(p.frames[2]); expect(next.frames[3]).toBe(p.frames[3]);
    expect(next.objectGroups).toBe(p.objectGroups);
    expect(p.stageObjects[0].widthMeters).toBe(1.23);
  });
  it("counts exact saved pairs without rounding, then matches update targets within 1e-6", () => {
    const p = fixture(), object = p.stageObjects[0]; object.widthMeters = 4;
    p.frames[1].objectStates[object.id].widthMeters = 1.2300001;
    expect(objectBaseSize(p, object).widthMeters).toBe(4);
    p.frames[2].objectStates[object.id].widthMeters = 1.23;
    expect(objectBaseSize(p, object).widthMeters).toBe(1.23);
    const next = applyObjectAppearance(p, object.id, { widthMeters: 1.33 });
    expect(next.frames[1].objectStates[object.id].widthMeters).toBe(1.33);
  });
  it("corrects only overflowing positions and rejects an undersized effective scene atomically", () => {
    const p = fixture(), id = p.stageObjects[0].id;
    p.frames[0].objectStates[id].x = 0;
    p.frames[1].objectStates[id].x = p.stage.widthMeters - 1.23;
    const next = applyObjectAppearance(p, id, { widthMeters: 2 });
    expect(next.frames[0].objectStates[id].x).toBe(0);
    expect(next.frames[1].objectStates[id].x).toBe(p.stage.widthMeters - 2);
    p.useGlobalStageSize = false; p.frames[1].stageWidthMeters = 1.5;
    const before = structuredClone(p);
    expect(() => applyObjectAppearance(p, id, { widthMeters: 2 })).toThrow(/場面1.*収まらない/);
    expect(p).toEqual(before);
    // Differently sized scenes not in the update set do not reject.
    p.frames[1].objectStates[id].widthMeters = 2;
    p.frames[0].objectStates[id].widthMeters = 2;
    p.stageObjects[0].widthMeters = 2;
    expect(() => applyObjectAppearance(p, id, { heightMeters: 1 })).toThrow(/場面1/);
  });
  it("uses parade backward distance only for effective scene bounds", () => {
    const p = fixture(); p.mode = "parade";
    p.paradeSettings = { ...createSampleProject().paradeSettings!, width: 10, totalDistance: 20, backwardDistanceMeters: 7 };
    expect(objectSizeLimits(p)).toEqual({ widthMeters: 10, heightMeters: 20 });
    expect(objectSceneBounds(p, p.frames[0]).heightMeters).toBe(27);
  });
  it.each(["rectangle", "circle", "curtain", "custom", "line"] as StageObjectShape[])("shape-only %s preserves precise/small dimensions", shape => {
    const p = fixture(), object = p.stageObjects[0]; object.shape = shape; object.widthMeters = .01234;
    const next = applyObjectAppearance(p, object.id, { shape: "rectangle" });
    expect(next.stageObjects[0].widthMeters).toBe(.01234); expect(next.frames).toBe(p.frames);
    expect(objectShapeChoice(shape)).toBe(shape === "circle" ? "circle" : "rectangle");
  });
  it("unchanged, deleted and unchanged modal size produce no update", () => {
    const p = fixture(), object = p.stageObjects[0];
    expect(applyObjectAppearance(p, object.id, { widthMeters: 1.23 })).toBe(p);
    expect(applyObjectAppearance(p, object.id, { shape: object.shape as "rectangle" })).toBe(p);
    expect(applyObjectAppearance(p, "deleted", { widthMeters: 1 })).toBe(p);
    object.widthMeters = 4;
    expect(applyObjectAppearance(p, object.id, { widthMeters: 1.23 })).toBe(p);
  });
  it("validates edited axes but preserves untouched precise axes", () => {
    const p = fixture(), id = p.stageObjects[0].id;
    for (const widthMeters of [NaN, Infinity, .09, 1.234, 100]) expect(() => applyObjectAppearance(p, id, { widthMeters })).toThrow();
    p.frames.forEach(f => { if (f.objectStates[id]) f.objectStates[id].heightMeters = .01234; });
    expect(applyObjectAppearance(p, id, { widthMeters: 1.33 }).stageObjects[0].heightMeters).toBe(.01234);
  });
  it("new curtain presets use rectangle while keeping type", () => {
    const curtain = createSampleProject().stageObjects.find(o => o.type === "curtain")!;
    expect(curtain.shape).toBe("rectangle");
    expect(objectRenderShape(curtain)).toBe("curtain");
    for (const shape of ["curtain", "custom", "line", "circle"] as const) expect(objectRenderShape({ type: "curtain", shape })).toBe(shape);
  });
});
describe("グループ追加と所属変更", () => {
  it("votes by each tool's saved shape and oldBase, deduplicates IDs; ties follow ID order", () => {
    const p = fixture(), first = p.stageObjects[0], group = p.objectGroups![0];
    const draft = { type: first.type, name: "new", color: first.color, shape: first.shape, widthMeters: 1.2, heightMeters: .8 };
    p.stageObjects.push({ ...first, id: "b", shape: "curtain", widthMeters: 3, heightMeters: 2 }, { ...first, id: "c", shape: "curtain", widthMeters: 3, heightMeters: 2 });
    first.widthMeters = 8;
    group.objectIds = [first.id, first.id, "missing", "b", "c"];
    expect(objectDraftForGroup(p, group, draft)).toMatchObject({ shape: "curtain", widthMeters: 3, heightMeters: 2 });
    group.objectIds = [first.id, "b", "missing"];
    expect(objectDraftForGroup(p, group, draft)).toMatchObject({ shape: first.shape, widthMeters: 1.23, heightMeters: .8 });
    group.objectIds.reverse(); expect(objectDraftForGroup(p, group, draft).shape).toBe("curtain");
    expect(objectDraftForGroup(p, p.objectGroups![1], draft)).toMatchObject({ shape: "line", widthMeters: 1.2, heightMeters: .8 });
  });
  it.each([true, false])("membership and explicit color decision %s leave all geometry and shape unchanged", copyColor => {
    const p = fixture(), id = p.stageObjects[0].id; p.objectGroups![1].color = "#00ff00";
    const next = changeObjectMembership(p, id, "empty", copyColor);
    expect(next.frames).toBe(p.frames);
    expect(next.stageObjects[0]).toEqual({ ...p.stageObjects[0], color: copyColor ? "#00ff00" : p.stageObjects[0].color });
    expect(next.objectGroups![0].objectIds).toEqual([]); expect(next.objectGroups![1].objectIds).toEqual([id]);
    expect(changeObjectMembership(next, id, "empty", copyColor)).toBe(next);
    const ungrouped = changeObjectMembership(next, id, null, true);
    expect(ungrouped.stageObjects).toBe(next.stageObjects); expect(ungrouped.frames).toBe(next.frames);
    expect(changeObjectMembership(p, "missing", "empty", true)).toBe(p);
    expect(changeObjectMembership(p, id, "missing", true)).toBe(p);
  });
});
