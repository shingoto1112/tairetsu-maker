import { expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { createTairetsuArchive, readTairetsuArchive } from "../utils/tairetsuFile";
import { createEmptyFormationProject } from "./createEmptyFormationProject";
import { copyRosterToNewProject, oversizedRosterObjects } from "./rosterCopy";
import type { FormationMode } from "../types";

const empty = (mode: FormationMode = "stage", width = 8, height = 12) => createEmptyFormationProject("新大会", {
  formationMode: mode, widthMeters: width, heightMeters: height, gridSizeMeters: .5,
  horizontalGuideMode: "centerSplit", memberDiameterMeters: .5, useGlobalStageSize: true,
}, null);
const fixture = () => {
  const p = createSampleProject(); p.id = "source";
  p.members[0].visible = false; p.members[0].zIndex = 999;
  p.memberGroups = [{ id: "old-g", name: "赤組", color: "#123456", memberIds: [p.members[2].id, p.members[0].id, "missing"] }];
  p.objectGroups = [{ id: "old-og", name: "道具組", color: "#987654", objectIds: [p.stageObjects[1].id, p.stageObjects[0].id], defaultType: "curtain", defaultShape: "line" }];
  p.stageObjects[0].shape = "curtain"; p.stageObjects[0].locked = true; p.stageObjects[0].defaultRotation = 90;
  p.frames.forEach(f => { f.objectStates[p.stageObjects[0].id].widthMeters = 10; f.objectStates[p.stageObjects[0].id].heightMeters = 2;
    f.notes = "秘密"; f.annotationLines = { line: { x1: 1, y1: 1, x2: 2, y2: 2, color: "red", dash: "solid" } };
    f.memberAppearanceOverrides = { [p.members[0].id]: { color: "black" } }; });
  return p;
};
const ids = () => { let serial = 0; return (prefix: string) => `${prefix}-new-${++serial}`; };

it.each([ ["stage", "stage"], ["stage", "parade"], ["parade", "stage"], ["parade", "parade"] ] as const)(
  "copies only allowed fields in order from %s to %s with fresh references and destination placement", (sourceMode, targetMode) => {
    const source = fixture(); source.mode = sourceMode;
    Object.assign(source, { sync: { accountId: "secret" }, collaboration: { outbox: ["secret"] }, audio: { id: "audio-secret" } });
    const destination = empty(targetMode); const before = structuredClone(source), destBefore = structuredClone(destination);
    const p = copyRosterToNewProject(destination, source, { includeObjects: true, oversizedPolicy: "shrink" }, ids()).project;
    expect(source).toEqual(before); expect(destination).toEqual(destBefore);
    expect(p.id).toBe(destination.id); expect(p.id).not.toBe(source.id);
    expect(p.stage).toEqual(destination.stage); expect(p.paradeSettings).toEqual(destination.paradeSettings);
    expect(p.members.map(m => [m.name, m.color])).toEqual(source.members.map(m => [m.name, m.color]));
    expect(p.memberGroups![0]).toEqual({ id: "g-new-6", name: "赤組", color: "#123456", memberIds: [p.members[2].id, p.members[0].id] });
    expect(p.objectGroups![0]).toMatchObject({ objectIds: [p.stageObjects[1].id, p.stageObjects[0].id], defaultType: "curtain", defaultShape: "line" });
    const oldIds = new Set([source.id, ...source.members.map(m => m.id), ...source.stageObjects.map(o => o.id), ...source.frames.map(f => f.id), "old-g", "old-og"]);
    const newIds = [p.id, ...p.members.map(m => m.id), ...p.stageObjects.map(o => o.id), ...p.frames.map(f => f.id), ...p.memberGroups!.map(g => g.id), ...p.objectGroups!.map(g => g.id)];
    expect(newIds.every(id => !oldIds.has(id))).toBe(true); expect(new Set(newIds).size).toBe(newIds.length);
    expect(p.frames).toHaveLength(1); expect(p.audio).toBeNull(); expect(p).not.toHaveProperty("sync"); expect(p).not.toHaveProperty("collaboration");
    expect(p.focusMemberId).toBeUndefined(); expect(p.movementPaths).toEqual([]);
    for (const key of ["notes", "annotationLines", "objectAssignments", "memberAppearanceOverrides"]) expect(p.frames[0]).not.toHaveProperty(key);
    expect(p.frames[0].sceneViewState).toBeUndefined();
    expect(Object.values(p.frames[0].memberVisibility!)).toEqual([false, false, false]);
    expect(p.members.every(m => m.visible)).toBe(true);
    // B1: preserve copy order while reserving separate circles instead of a shared center.
    // New stage projects open in the mirrored performer view, so roster order reads left to right on
    // screen with descending internal x; parades are never mirrored.
    const xs = [3.5, 4, 4.5];
    expect(p.members.map(m => p.frames[0].positions[m.id])).toEqual(
      (targetMode === "stage" ? xs.reverse() : xs).map(x => ({ x, y: 6 })));
    const positions = Object.values(p.frames[0].positions);
    positions.forEach((a, i) => {
      expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x).toBeLessThanOrEqual(8);
      expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y).toBeLessThanOrEqual(12);
      positions.slice(i + 1).forEach(b => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(.5));
    });
    expect(p.stageObjects[0]).toMatchObject({ widthMeters: 8, heightMeters: 2, shape: "curtain", defaultX: 0, defaultY: 5, defaultRotation: 0, locked: false, visible: true, zIndex: 10 });
    expect(Object.values(p.frames[0].objectStates).every(s => !s.visible && s.rotation === 0)).toBe(true);
  });

it("requires an explicit choice, excludes oversized objects with intact groups, and allows resizing before retry", () => {
  const source = fixture(), dest = empty();
  expect(oversizedRosterObjects(source, dest)).toEqual([{ id: source.stageObjects[0].id, name: "移動幕", widthMeters: 10, heightMeters: 2 }]);
  expect(() => copyRosterToNewProject(dest, source, { includeObjects: true }, ids())).toThrow("扱いを選んで");
  const excluded = copyRosterToNewProject(dest, source, { includeObjects: true, oversizedPolicy: "exclude" }, ids()).project;
  expect(excluded.stageObjects.map(o => o.name)).toEqual(["椅子"]);
  expect(excluded.objectGroups![0].objectIds).toEqual([excluded.stageObjects[0].id]);
  expect(dest.members).toEqual([]); // Returning makes no project and changes no input.
  const resized = copyRosterToNewProject(empty("stage", 12, 12), source, { includeObjects: true }, ids()).project;
  expect(resized.stageObjects[0].widthMeters).toBe(10);
  const twoAxes = copyRosterToNewProject(empty("parade", 8, 1), source, { includeObjects: true, oversizedPolicy: "shrink" }, ids()).project;
  expect(twoAxes.stageObjects[0]).toMatchObject({ widthMeters: 8, heightMeters: 1 });
});

it.each(["rectangle", "circle", "curtain", "custom", "line"] as const)("preserves saved %s shape and registration size on a modal-size tie", shape => {
  const source = fixture(); source.stageObjects[0].shape = shape;
  source.frames = source.frames.slice(0, 2); source.frames[0].objectStates[source.stageObjects[0].id].widthMeters = 3;
  const p = copyRosterToNewProject(empty(), source, { includeObjects: true }, ids()).project;
  expect(p.stageObjects[0]).toMatchObject({ shape, widthMeters: 2.2, heightMeters: 5.6 });
});
it("can omit tools and handles an empty roster and empty groups", () => {
  const source = fixture(); const p = copyRosterToNewProject(empty(), source, { includeObjects: false }, ids()).project;
  expect(p.stageObjects).toEqual([]); expect(p.objectGroups).toEqual([]); expect(p.frames[0].objectStates).toEqual({});
  source.members = []; source.stageObjects = [];
  const blank = copyRosterToNewProject(empty(), source, { includeObjects: true }, ids()).project;
  expect(blank.memberGroups![0].memberIds).toEqual([]); expect(blank.objectGroups![0].objectIds).toEqual([]);
  expect(blank.frames[0].positions).toEqual({});
});
it("round-trips the copied roster and hidden initial scene through ZIP", async () => {
  const p = copyRosterToNewProject(empty(), fixture(), { includeObjects: true, oversizedPolicy: "shrink" }, ids()).project;
  const archive = await createTairetsuArchive(p);
  const restored = await readTairetsuArchive(new File([await archive.arrayBuffer()], "roster.zip"));
  expect(restored.project).toEqual(JSON.parse(JSON.stringify(p))); expect(restored.audioBlob).toBeNull();
});
