import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { createDefaultParadeSettings } from "../project/defaults";
import { verticalEmphasizedLines } from "./gridEmphasis";
import { stageVerticalGridOriginMeters } from "./verticalGrid";
import { snapMemberGroupAxis, snapPositionInBounds } from "./positionGrid";
import { snapPastedMemberPosition, snapPastedObjectPosition } from "./placementGrid";
import { snapToGrid } from "./coordinates";
import { snapAnnotationPoint } from "./annotationLines";

const stage = { ...createSampleProject().stage, widthMeters: 9, depthMeters: 5.4, gridSizeMeters: 0.5 };
const positions = (front: "top" | "bottom" | "left" | "right", override?: "top" | "bottom") =>
  verticalEmphasizedLines(5.4, 0.5, { ...stage, frontDirection: front }, undefined, true, 0, 5.4, override).map(line => line.positionMeters);

describe("stage vertical origin and entry snapping", () => {
  it("shares bottom origin across all ten lines and snapping", () => {
    const expected = [0.4, 0.9, 1.4, 1.9, 2.4, 2.9, 3.4, 3.9, 4.4, 4.9];
    for (const front of ["bottom", "left", "right"] as const) expect(positions(front)).toEqual(expected);
    expect(positions("top")).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    expect(stageVerticalGridOriginMeters(5.4, { audienceSide: "top" })).toBe(0);
    expect(stageVerticalGridOriginMeters(5.4, { audienceSide: "bottom" })).toBe(5.4);
    expect(stageVerticalGridOriginMeters(5.4, {} as typeof stage)).toBe(5.4);
    const origin = stageVerticalGridOriginMeters(5.4, stage);
    expect(snapPositionInBounds(0, 0.5, origin, 0, 5.4)).toBe(0.4);
    expect(snapPastedMemberPosition({ x: 4.6, y: 1.17 }, stage).y).toBe(1.4);
    expect(snapAnnotationPoint({ x: 4.6, y: 1.17 }, 9, 5.4, 0.5, "meters", origin).y).toBe(1.15);
    expect(snapPositionInBounds(1.17, 0.25, origin, 0.6, 4.8)).toBe(1.15);
  });
  it("uses full effective depth with export override before crop/reflection", () => {
    expect(positions("bottom", "top")).toEqual(positions("top"));
    expect(positions("top", "bottom")).toEqual(positions("bottom"));
    for (const override of ["top", "bottom"] as const) {
      const full = verticalEmphasizedLines(5.4, 0.5, stage, undefined, true, 0, 5.4, override);
      expect(verticalEmphasizedLines(5.4, 0.5, stage, undefined, true, 1.2, 4.2, override))
        .toEqual(full.filter(line => line.positionMeters >= 1.2 && line.positionMeters <= 4.2));
    }
    const reflected = positions("bottom").map(y => Number((5.4 - y).toFixed(9))).sort((a,b) => a-b);
    expect(reflected).toEqual(positions("top"));
    expect(stageVerticalGridOriginMeters(7.13, stage)).toBe(7.13);
    expect(verticalEmphasizedLines(5.4, 0.3, stage).length).toBeGreaterThan(17); // intentional 1m number lines
  });
  it("keeps Grid OFF positions, dimensions, and stored coordinates unchanged", () => {
    const point = { x: 4.617, y: 1.173 };
    expect(snapPastedMemberPosition(point, { ...stage, showGrid: false })).toEqual(point);
    expect(snapPositionInBounds(1.173, NaN, 5.4, 0, 5.4)).toBe(1.173);
    expect(snapPastedMemberPosition({ x: 4.61734, y: 1.17345 }, { ...stage, showGrid: false })).toEqual(point);
    expect(snapToGrid(1.173, 0.5, true)).toBe(1);
    expect(snapToGrid(1.173, 0.5, false)).toBe(1.173);
    expect(point).toEqual({ x: 4.617, y: 1.173 });
  });
});

describe("parade internal T-origin snapping", () => {
  for (const step of [0.5, 0.3, 2]) {
    it(`T=10.13 B=2.31 step=${step}: front / zero / rear / paste / tools`, () => {
      const parade = createDefaultParadeSettings({ totalDistance: 10.13, backwardDistanceMeters: 2.31, width: 9, cellSizeMeters: step });
      const effective = { ...stage, depthMeters: 12.44, showGrid: false };
      for (const y of [-100, 0, 10.13, 12.44, 100]) {
        const result = snapPositionInBounds(y, step, 10.13, 0, 12.44);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(12.44);
        expect((result - 10.13) / step).toBeCloseTo(Math.round((result - 10.13) / step), 8);
        expect(snapPastedMemberPosition({ x: 4.51, y }, effective, parade).y).toBe(result);
      }
      expect(snapPositionInBounds(10.13, step, 10.13, 0, 12.44)).toBe(10.13);
      expect(snapPositionInBounds(0, 0.25, 10.13, 0, 11.64)).toBe(0.13);
      expect(snapPositionInBounds(100, 0.25, 10.13, 0, 11.64)).toBe(11.63);
      const center = { x: 4.77, y: 10.42 };
      const pasted = snapPastedObjectPosition(center, 0.73, 0.8, effective, parade);
      expect(pasted.y).toBe(10.13);
      expect(pasted.y).toBe(snapPositionInBounds(center.y - 0.4, 0.25, 10.13, 0, 11.64));
      expect(center).toEqual({ x: 4.77, y: 10.42 });
      const full = verticalEmphasizedLines(12.44, step, stage, parade);
      for (const line of full) {
        const cell = (line.positionMeters - 10.13) / step;
        const meter = line.positionMeters - 10.13;
        expect(Math.abs(cell - Math.round(cell)) < 1e-7 || Math.abs(meter - Math.round(meter)) < 1e-7).toBe(true);
      }
    });
  }
  it("ties round toward increasing internal y, not after a distance conversion", () => {
    expect(snapPositionInBounds(10.38, 0.5, 10.13, 0, 12.44)).toBe(10.63);
    expect(snapPositionInBounds(9.88, 0.5, 10.13, 0, 12.44)).toBe(10.13);
    for (const step of [0.5, 0.3, 2]) {
      expect(snapPositionInBounds(10.13 + step / 2, step, 10.13, 0, 12.44)).toBeCloseTo(10.13 + step, 9);
      expect(snapPositionInBounds(10.13 - step / 2, step, 10.13, 0, 12.44)).toBe(10.13);
    }
    expect(snapPositionInBounds(5.01, 2, 10.13, 5, 5.1)).toBe(5.01); // no lattice point
  });
  it("preserves former single-member lattice and both edges for divisible T/B", () => {
    for (const step of [0.5, 0.3, 2]) for (const y of [-10, 0, 1.11, 6, 12, 18, 100]) {
      expect(snapPositionInBounds(y, step, 12, 0, 18)).toBeCloseTo(Math.min(18, Math.max(0, Math.round(y / step) * step)), 9);
    }
  });
});

describe("both axes retain group formation at bounds", () => {
  it("keeps an in-range guide position ahead of the grid while retaining shared bounds", () => {
    const group = [1.2, 3.2];
    const grid = snapMemberGroupAxis(2.317, 1.2, group, 5.4, 0.5, 5.4);
    expect(grid).toBe(2.4);
    const guide = snapMemberGroupAxis(2.317, 1.2, group, 5.4, NaN, 5.4);
    expect(guide).toBeCloseTo(2.317, 12);
    expect(group[1] + guide - group[0]).toBeCloseTo(4.317, 12);
  });
  for (const [extent, origin] of [[5.4, 5.4], [12.44, 10.13]]) for (const step of [0.5, 0.3, 2, NaN]) {
    it(`${extent} step=${step}`, () => {
      const group = [0.15, extent - 0.31], original = [...group];
      for (const requested of [-100, 0, extent, 100]) {
        const primary = snapMemberGroupAxis(requested, group[0], group, extent, step, origin);
        const delta = primary - group[0], next = group.map(value => value + delta);
        expect(next[0]).toBeGreaterThanOrEqual(-1e-9);
        expect(next[1]).toBeLessThanOrEqual(extent + 1e-9);
        expect(next[1] - next[0]).toBeCloseTo(group[1] - group[0], 12);
      }
      expect(group).toEqual(original);
    });
  }
});
