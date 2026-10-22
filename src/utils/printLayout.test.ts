import { describe, expect, it } from "vitest";
import { formationExportFixture } from "./formationExportFixture";
import { createDefaultObjectState } from "./interpolation";
import { defaultPrintOptions, getEffectiveSize, getFramePrintVerticalRange, getPrintMetrics } from "./printLayout";

const fixture = () => {
  const p = formationExportFixture();
  p.mode = "parade";
  p.paradeSettings = { totalDistance: 100, width: 12, cellSizeMeters: 1, direction: "up",
    rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
  p.members = [p.members[0]];
  p.frames = [p.frames[0]];
  p.frames[0].positions = { m0: { x: 6, y: 50 } };
  p.stageObjects = [];
  return p;
};
const range = (p: ReturnType<typeof fixture>) => getFramePrintVerticalRange(p, p.frames[0],
  getEffectiveSize(p, p.frames[0]), getPrintMetrics(p, p.frames, defaultPrintOptions));
const expected = (topMeters: number, bottomMeters: number) => ({ topMeters, bottomMeters, depthMeters: bottomMeters - topMeters });
const line = (y1: number, y2: number) => ({ x1: 1, x2: 11, y1, y2, color: "red" as const, dash: "dashed" as const });

describe("parade print vertical range (metres, including the existing 2m padding)", () => {
  it.each([[120, 130], [130, 120], [-30, -20], [-20, -30]])("ignores annotation-only intervals outside the route: %s -> %s", (y1, y2) => {
    const p = fixture(); p.members = []; p.frames[0].annotationLines = { outside: line(y1, y2) };
    expect(range(p)).toEqual(expected(0, 10));
    p.frames[0].annotationLines!.otherSide = line(y1 < 0 ? 120 : -30, y1 < 0 ? 130 : -20);
    expect(range(p)).toEqual(expected(0, 10));
  });

  it.each([[95, 120, 93, 110], [120, 95, 93, 110], [-20, 5, 0, 7], [5, -20, 0, 7]])(
    "clips partially intersecting intervals, including backward distance: %s -> %s", (y1, y2, top, bottom) => {
      const p = fixture(); p.members = []; p.paradeSettings!.backwardDistanceMeters = 10;
      p.frames[0].annotationLines = { partial: line(y1, y2), outside: line(130, 140) };
      expect(range(p)).toEqual(expected(top, bottom));
    });

  it.each([-100, 150])("ignores legacy rotated props wholly outside at y=%s", y => {
    const p = fixture(); p.members = []; p.paradeSettings!.backwardDistanceMeters = 10;
    p.stageObjects = [{ ...formationExportFixture().stageObjects[0], defaultY: y,
      widthMeters: 20, heightMeters: 1, defaultRotation: 90 }];
    expect(range(p)).toEqual(expected(0, 10));
    p.frames[0].annotationLines = { inside: line(40, 50) };
    expect(range(p)).toEqual(expected(38, 52));
  });

  it("falls back for invalid final member bounds, and always returns depth = bottom - top", () => {
    const p = fixture(); p.frames[0].positions.m0.y = 200;
    expect(range(p)).toEqual(expected(0, 10));
    for (const cell of [.3, 1, 20]) for (const y of [-200, 0, 50, 110, 200]) {
      p.paradeSettings!.cellSizeMeters = cell; p.paradeSettings!.backwardDistanceMeters = 10;
      p.frames[0].positions.m0.y = y;
      const r = range(p);
      expect(r.topMeters).toBeGreaterThanOrEqual(0); expect(r.bottomMeters).toBeGreaterThan(r.topMeters);
      expect(r.bottomMeters).toBeLessThanOrEqual(110); expect(r.depthMeters).toBe(r.bottomMeters - r.topMeters);
    }
  });

  it("keeps visible-member radius and padding", () => {
    expect(range(fixture())).toEqual(expected(47, 53));
  });

  it.each([[20.2, 80.3], [80.3, 20.2]])("includes remote annotation endpoints %s -> %s in either order", (y1, y2) => {
    const p = fixture(); p.frames[0].annotationLines = { remote: line(y1, y2) };
    expect(range(p)).toEqual(expected(18, 83));
  });

  it("includes all annotations without members or objects", () => {
    const p = fixture(); p.members = []; p.frames[0].positions = {};
    p.frames[0].annotationLines = { first: line(40.2, 41.7), second: line(72.3, 22.2) };
    expect(range(p)).toEqual(expected(20, 75));
  });

  it.each([
    // Stored y=50, height=1: centre 50.5; rotated half-height is
    // 0.5 (0deg), 10 (90deg), 21/(2*sqrt(2)) (45deg).
    [20, 1, 0, 48, 53], [20, 1, 90, 38, 63], [20, 1, 45, 41, 60],
    // Preserve the old crop when a tall thin rectangle becomes shorter after rotation.
    [1, 20, 0, 48, 72], [1, 20, 90, 48, 72], [1, 20, 45, 48, 72],
  ])("includes object-only rotated bounds: %sx%s at %s degrees -> [%s,%s]", (width, height, rotation, top, bottom) => {
    const p = fixture(); p.members = []; p.frames[0].positions = {};
    const object = { ...formationExportFixture().stageObjects[0], defaultY: 50,
      widthMeters: width, heightMeters: height, defaultRotation: rotation };
    p.stageObjects = [object];
    // Missing scene state must use the default object's geometry too.
    expect(range(p)).toEqual(expected(top, bottom));
    p.frames[0].objectStates[object.id] = createDefaultObjectState(object);
    expect(range(p)).toEqual(expected(top, bottom));
  });

  it("uses scene object geometry over defaults", () => {
    const p = fixture(); p.members = [];
    const object = formationExportFixture().stageObjects[0]; p.stageObjects = [object];
    p.frames[0].objectStates[object.id] = { ...createDefaultObjectState(object), y: 50,
      widthMeters: 20, heightMeters: 1, rotation: 90 };
    expect(range(p)).toEqual(expected(38, 63));
  });

  it("omits globally hidden, scene-hidden and assigned members", () => {
    const p = fixture();
    p.members.push({ id: "global", name: "G", color: "#000000", visible: false },
      { id: "scene", name: "S", color: "#000000" }, { id: "assigned", name: "A", color: "#000000" });
    Object.assign(p.frames[0].positions, { global: { x: 1, y: 0 }, scene: { x: 2, y: 100 }, assigned: { x: 3, y: 95 } });
    p.frames[0].memberVisibility = { scene: false };
    p.frames[0].objectAssignments = { flag: ["assigned"] };
    expect(range(p)).toEqual(expected(47, 53));
  });

  it("omits default-hidden and scene-hidden rotated objects", () => {
    const p = fixture();
    const object = { ...formationExportFixture().stageObjects[0], defaultY: 0,
      widthMeters: 100, defaultRotation: 90, visible: false };
    p.stageObjects = [object, { ...object, id: "scene", defaultY: 95, visible: true }];
    p.frames[0].objectStates.scene = { ...createDefaultObjectState(p.stageObjects[1]), visible: false };
    expect(range(p)).toEqual(expected(47, 53));
    // Scene visibility overrides the object's default visibility.
    p.frames[0].objectStates[object.id] = { ...createDefaultObjectState(object), y: 50,
      widthMeters: 20, heightMeters: 1, visible: true };
    expect(range(p)).toEqual(expected(38, 63));
  });

  it("keeps zero-origin fractional grid rounding rather than the route grid origin", () => {
    const p = fixture(); p.members = [];
    p.paradeSettings!.totalDistance = 100.3; p.paradeSettings!.cellSizeMeters = .3;
    p.frames[0].annotationLines = { fractional: line(20.2, 21.1) };
    const actual = range(p);
    expect(actual.topMeters).toBeCloseTo(18, 10);
    expect(actual.bottomMeters).toBeCloseTo(23.1, 10);
    expect(actual.depthMeters).toBeCloseTo(5.1, 10);
  });

  it("includes the backward section and clamps padding at both route ends", () => {
    const p = fixture(); p.members = []; p.paradeSettings!.backwardDistanceMeters = 10;
    p.frames[0].annotationLines = { backward: line(109, 104) };
    expect(range(p)).toEqual(expected(102, 110));
    p.frames[0].annotationLines = { ends: line(.1, 109.9) };
    expect(range(p)).toEqual(expected(0, 110));
    p.frames[0].annotationLines = { beyond: line(-5, 115) };
    expect(range(p)).toEqual(expected(0, 110));
  });

  it("clamps rotated object bounds to the route including backward distance", () => {
    const p = fixture(); p.members = []; p.paradeSettings!.backwardDistanceMeters = 10;
    p.stageObjects = [{ ...formationExportFixture().stageObjects[0], defaultY: 50,
      widthMeters: 140, heightMeters: 10, defaultRotation: 90 }];
    expect(range(p)).toEqual(expected(0, 110));
  });

  it.each([[100, 1, 10], [100, 2, 20], [6, 1, 6]])("keeps the empty fallback: route=%s cell=%s -> [0,%s]", (total, cell, bottom) => {
    const p = fixture(); p.members[0].visible = false;
    p.paradeSettings!.totalDistance = total; p.paradeSettings!.cellSizeMeters = cell;
    expect(range(p)).toEqual(expected(0, bottom));
  });
});

it.each([undefined, "stage"] as const)("keeps %s stage bounds independent of annotations, rotated props and print metrics", mode => {
  const p = fixture(); p.mode = mode;
  p.frames[0].annotationLines = { beyond: line(-100, 1000) };
  p.stageObjects = formationExportFixture().stageObjects;
  expect(getFramePrintVerticalRange(p, p.frames[0], { widthMeters: 9.3, depthMeters: 5.4 },
    getPrintMetrics(p, p.frames, defaultPrintOptions))).toEqual(expected(0, 5.4));
});
