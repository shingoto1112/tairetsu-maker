import { expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { Position, Project } from "../types";
import { placeNewMembers } from "./memberPlacement";

const fixture = (mode: "stage" | "parade" = "stage"): Project => {
  const p = createSampleProject();
  p.mode = mode; p.members = []; p.frames = [p.frames[0]]; p.frames[0].positions = {};
  p.stage = { ...p.stage, widthMeters: 5, depthMeters: 4.3, gridSizeMeters: .25, memberDiameterMeters: .5, horizontalGuideMode: "meters" };
  p.paradeSettings = { width: 5, totalDistance: 500, backwardDistanceMeters: 500, cellSizeMeters: .05,
    direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true };
  return p;
};
function separated(positions: Position[], diameter: number) {
  positions.forEach((a, i) => positions.slice(i + 1).forEach(b =>
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(diameter - 1e-8)));
}
it.each(["stage", "parade"] as const)("places %s circles deterministically in rows without mutating existing hidden members", mode => {
  const p = fixture(mode), f = p.frames[0];
  p.members = [{ id: "old", name: "旧", color: "red", visible: false }];
  f.positions.old = { x: 2.51, y: 2.15 }; f.memberVisibility = { old: false };
  const before = structuredClone(p), origin = { x: 2.5, y: 2.15 };
  const result = placeNewMembers(p, f, 30, origin);
  expect(result.overlapCount).toBe(0); expect(result).toEqual(placeNewMembers(p, f, 30, origin));
  separated([f.positions.old, ...result.positions], .5);
  result.positions.forEach(pos => {
    expect(pos.x).toBeGreaterThanOrEqual(0); expect(pos.x).toBeLessThanOrEqual(5);
    expect(pos.y).toBeGreaterThanOrEqual(0); expect(pos.y).toBeLessThanOrEqual(mode === "parade" ? 1000 : 4.3);
  });
  expect(p).toEqual(before);
});
it("keeps stage vertical coordinates unsnapped and reuses center-split horizontal snapping", () => {
  const p = fixture(); p.stage.gridSizeMeters = 1; p.stage.horizontalGuideMode = "centerSplit";
  expect(placeNewMembers(p, p.frames[0], 3).positions).toEqual([
    { x: 2, y: 2.15 }, { x: 3, y: 2.15 }, { x: 4, y: 2.15 },
  ]);
});
it("lays a batch out left to right as a centred block, and later additions continue to its right", () => {
  const p = fixture(), f = p.frames[0]; p.stage.gridSizeMeters = .5; p.stage.widthMeters = 6;
  const batch = placeNewMembers(p, f, 5).positions;
  expect(batch.map(pos => pos.x)).toEqual([2, 2.5, 3, 3.5, 4]);
  expect(new Set(batch.map(pos => pos.y)).size).toBe(1);
  batch.forEach((pos, i) => { p.members.push({ id: `m${i}`, name: "m", color: "red" }); f.positions[`m${i}`] = pos; });
  const next = placeNewMembers(p, f, 1).positions[0];
  expect(next).toEqual({ x: 4.5, y: batch[0].y });
});
it("uses the effective stage circle diameter, including its minimum and maximum", () => {
  for (const [saved, effective] of [[.1, .2], [2, 1]]) {
    const p = fixture(); p.stage.memberDiameterMeters = saved; p.stage.showGrid = false;
    const result = placeNewMembers(p, p.frames[0], 10);
    expect(result.overlapCount).toBe(0); separated(result.positions, effective);
    expect(result.positions[1].x - result.positions[0].x).toBeCloseTo(effective);
  }
});
it.each(["stage", "parade"] as const)("handles edges and a narrow %s without moving an existing circle", mode => {
  const p = fixture(mode); p.stage.widthMeters = 1; p.stage.depthMeters = 2; p.stage.memberDiameterMeters = 1;
  p.paradeSettings = { ...p.paradeSettings!, width: 1, totalDistance: 2, backwardDistanceMeters: 0 };
  const result = placeNewMembers(p, p.frames[0], 4, { x: -5, y: 0 });
  expect(result.overlapCount).toBe(0); separated(result.positions, 1);
  expect(result.positions.every(pos => pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 2)).toBe(true);
});
it("uses scene dimensions and finds an edge left over by a full stride", () => {
  const p = fixture(); p.useGlobalStageSize = false;
  Object.assign(p.frames[0], { stageWidthMeters: .8, stageDepthMeters: .1 });
  p.stage.showGrid = false;
  const result = placeNewMembers(p, p.frames[0], 2, { x: .2, y: .05 });
  expect(result.positions).toEqual([{ x: .2, y: .05 }, { x: .7, y: .05 }]);
  expect(result.overlapCount).toBe(0);
});
it.each(["stage", "parade"] as const)("continues with overlapping default positions when %s has no vacancy", mode => {
  const p = fixture(mode); Object.assign(p.stage, { widthMeters: 1, depthMeters: 1, memberDiameterMeters: 1 });
  Object.assign(p.paradeSettings!, { width: 1, totalDistance: 1, backwardDistanceMeters: 0 });
  const result = placeNewMembers(p, p.frames[0], 4);
  expect(result.positions).toHaveLength(4); expect(result.overlapCount).toBeGreaterThan(0);
  const placed = result.positions.length - result.overlapCount;
  separated(result.positions.slice(0, placed), 1);
  const stacked = result.positions.slice(placed);
  expect(stacked.every(pos => JSON.stringify(pos) === JSON.stringify(stacked[0]))).toBe(true);
});
it("places 300 members on a long fine-grid parade quickly, including sequential additions", () => {
  const p = fixture("parade"), f = p.frames[0], start = performance.now();
  const bulk = placeNewMembers(p, f, 300, { x: 2.5, y: 400.123 });
  expect(bulk.overlapCount).toBe(0);
  for (let i = 0; i < 300; i++) {
    const result = placeNewMembers(p, f, 1, { x: 2.5, y: 400.123 });
    expect(result.overlapCount).toBe(0);
    const id = `m${i}`; p.members.push({ id, name: id, color: "red" }); f.positions[id] = result.positions[0];
  }
  const sequential = Object.values(f.positions);
  // One-by-one additions start at the centre and continue to the right.
  expect(sequential[1].y).toBe(sequential[0].y); expect(sequential[1].x).toBeGreaterThan(sequential[0].x);
  expect(performance.now() - start).toBeLessThan(2000);
  separated(bulk.positions, .5); separated(sequential, .5);
});
