import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { createDefaultParadeSettings } from "../project/defaults";
import type { Position } from "../types";
import { constrainMemberPosition, stagePointToDisplayPoint } from "./coordinates";
import { getEffectiveStageSize } from "./effectiveStageSize";
import { getKeyboardNudgeDelta } from "./keyboardNudge";
import { moveMembersRelative } from "./memberRelativeMove";

const stage = { ...createSampleProject().stage, widthMeters: 9, depthMeters: 5.4 };
const ids = ["a", "b", "c"];
const positions = { a: { x: 0.17, y: 0.31 }, b: { x: 3.283, y: 2.147 }, c: { x: 8.89, y: 5.27 } };

describe("relative member movement within shared bounds", () => {
  it.each([
    [-100, 0], [100, 0], [0, -100], [0, 100],
    [-100, -100], [-100, 100], [100, -100], [100, 100],
  ])("preserves all offsets at edge/corner (%s, %s), without snapping", (x, y) => {
    const before = structuredClone(positions);
    const result = moveMembersRelative(positions, ids, { x, y }, stage);
    for (const id of ids) {
      expect(result.positions[id].x - positions[id as keyof typeof positions].x).toBeCloseTo(result.delta.x, 12);
      expect(result.positions[id].y - positions[id as keyof typeof positions].y).toBeCloseTo(result.delta.y, 12);
      expect(result.positions[id].x).toBeGreaterThanOrEqual(-1e-12);
      expect(result.positions[id].y).toBeGreaterThanOrEqual(-1e-12);
      expect(result.positions[id].x).toBeLessThanOrEqual(9 + 1e-12);
      expect(result.positions[id].y).toBeLessThanOrEqual(5.4 + 1e-12);
    }
    expect(result.delta.x).toBeCloseTo(x < 0 ? -0.17 : x > 0 ? 0.11 : 0, 12);
    expect(result.delta.y).toBeCloseTo(y < 0 ? -0.31 : y > 0 ? 0.13 : 0, 12);
    expect(positions).toEqual(before);
    expect(result.blocked).toEqual({ x: false, y: false });
  });

  it.each(["x", "y"] as const)("leaves an oversized %s axis untouched while the other axis moves", axis => {
    const source = { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } };
    source.b[axis] = axis === "x" ? 11 : 8;
    const result = moveMembersRelative(source, ["a", "b"], { x: 0.25, y: 0.25 }, stage);
    expect(result.blocked[axis]).toBe(true);
    expect(result.delta[axis]).toBe(0);
    expect(result.positions.a[axis]).toBe(source.a[axis]);
    expect(result.positions.b[axis]).toBe(source.b[axis]);
    const other = axis === "x" ? "y" : "x";
    expect(result.delta[other]).toBe(0.25);
  });

  it("returns the same record on zero movement, missing IDs and fully blocked movement", () => {
    const source = { a: { x: 0, y: 0 }, b: { x: 9, y: 5.4 } };
    for (const delta of [{ x: 0, y: 0 }, { x: 0.25, y: -0.25 }]) {
      expect(moveMembersRelative(source, ["a", "b"], delta, stage).positions).toBe(source);
    }
    expect(moveMembersRelative(source, ["missing"], { x: 1, y: 1 }, stage).positions).toBe(source);
    expect(moveMembersRelative({ a: { x: -1, y: 3 } }, ["a"], { x: 0, y: 0.25 }, stage).positions.a.x).toBe(-1);
  });

  it("matches the former single-member clamp throughout the stage", () => {
    for (const position of [{ x: 0, y: 0 }, { x: 4.617, y: 1.173 }, { x: 9, y: 5.4 }]) {
      for (const delta of [{ x: -100, y: -100 }, { x: 100, y: 100 }, { x: 0.01, y: -0.25 }]) {
        const expected = constrainMemberPosition({ x: position.x + delta.x, y: position.y + delta.y }, stage);
        const actual = moveMembersRelative({ a: position }, ["a"], delta, stage).positions.a;
        expect(actual.x).toBeCloseTo(expected.x, 12);
        expect(actual.y).toBeCloseTo(expected.y, 12);
      }
    }
  });

  it("uses scene dimensions and retains the global/legacy size fallback", () => {
    const project = createSampleProject();
    project.stage = stage;
    project.useGlobalStageSize = false;
    const frame = { ...project.frames[0], stageWidthMeters: 4, stageDepthMeters: 3 };
    const source = { a: { x: 1, y: 1 }, b: { x: 3.9, y: 2.9 } };
    const move = () => moveMembersRelative(source, ["a", "b"], { x: 0.5, y: 0.5 }, getEffectiveStageSize(project, frame));
    expect(move().delta.x).toBeCloseTo(0.1, 12);
    expect(move().delta.y).toBeCloseTo(0.1, 12);
    project.useGlobalStageSize = true;
    expect(move().delta).toEqual({ x: 0.5, y: 0.5 });
    project.useGlobalStageSize = undefined;
    project.useGlobalStageWidth = false;
    expect(move().delta.x).toBeCloseTo(0.1, 12);
    expect(getEffectiveStageSize(project, undefined)).toEqual({ widthMeters: 9, depthMeters: 5.4 });
  });

  it("includes parade backward distance, using parade width instead of scene dimensions", () => {
    const project = createSampleProject();
    project.mode = "parade";
    project.paradeSettings = createDefaultParadeSettings({ width: 4, totalDistance: 10.13, backwardDistanceMeters: 2.31 });
    const size = getEffectiveStageSize(project, { ...project.frames[0], stageWidthMeters: 1, stageDepthMeters: 1 });
    expect(size.widthMeters).toBe(4);
    expect(size.depthMeters).toBeCloseTo(12.44, 12);
    const result = moveMembersRelative({ a: { x: 1, y: 10.13 }, b: { x: 3.8, y: 12.3 } }, ["a", "b"], { x: 0.5, y: 0.5 }, size);
    expect(result.delta.x).toBeCloseTo(0.2, 12);
    expect(result.delta.y).toBeCloseTo(0.14, 12);
    expect(result.positions.b.y).toBeCloseTo(12.44, 12);
  });

  it.each(["audience", "performer"] as const)("retains all keyboard directions and modifier units in %s view", perspective => {
    const keys: [string, Position][] = [["ArrowLeft", { x: -1, y: 0 }], ["ArrowRight", { x: 1, y: 0 }],
      ["ArrowUp", { x: 0, y: -1 }], ["ArrowDown", { x: 0, y: 1 }]];
    const variants = [[{}, 0.25], [{ shiftKey: true }, 0.3], [{ ctrlKey: true }, 0.01],
      [{ metaKey: true, shiftKey: true }, 0.01]] as const;
    for (const [key, direction] of keys) for (const [modifiers, step] of variants) {
      const delta = getKeyboardNudgeDelta({ key, ...modifiers } as KeyboardEvent, perspective, 0.3)!;
      const start = { x: 4.617, y: 1.173 };
      const result = moveMembersRelative({ a: start }, ["a"], delta, stage);
      const before = stagePointToDisplayPoint(start, stage, perspective);
      const after = stagePointToDisplayPoint(result.positions.a, stage, perspective);
      expect(after.x - before.x).toBeCloseTo(direction.x * step, 12);
      expect(after.y - before.y).toBeCloseTo(direction.y * step, 12);
    }
    expect(getKeyboardNudgeDelta({ key: "Enter" } as KeyboardEvent, perspective, 0.3)).toBeNull();
    expect(Math.abs(getKeyboardNudgeDelta({ key: "ArrowRight", shiftKey: true } as KeyboardEvent, perspective, 0)!.x)).toBe(0.5);
  });
});

it("rounds moved axes to millimetres without leaving the stage", () => {
  const result = moveMembersRelative({ a: { x: 0.1, y: 1 }, b: { x: 2.2, y: 1.0004 } }, ["a", "b"], { x: 0.2, y: 0 },
    { widthMeters: 10, depthMeters: 6 });
  expect(result.positions.a).toEqual({ x: 0.3, y: 1 });
  expect(result.positions.b).toEqual({ x: 2.4, y: 1.0004 });
  const edge = moveMembersRelative({ a: { x: 9.9996, y: 1 } }, ["a"], { x: 0.25, y: 0 }, { widthMeters: 10, depthMeters: 6 });
  expect(edge.positions.a.x).toBe(10);
});
