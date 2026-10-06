import { describe, expect, it } from "vitest";
import { createGridTicksInRange, createHorizontalGridLines, horizontalGridOriginMeters, snapHorizontalPosition, snapHorizontalPositionInBounds, snapMemberGroupHorizontal } from "./horizontalGrid";
import { createHorizontalRulerLabels } from "./horizontalRuler";

describe("horizontal grid coordinates", () => {
  for (const width of [10, 11, 10.5, 10.3, 12, 13]) {
    for (const mode of ["meters", "centerSplit"] as const) {
      for (const step of [0.25, 0.5, 1]) {
        it(`${width} ${mode} ${step}: origin, every line, snap and edges`, () => {
          const origin = horizontalGridOriginMeters(width, mode);
          expect(origin).toBe(width / 2 + (mode === "centerSplit" ? 0.5 : 0));
          const ticks = createGridTicksInRange(0, width, step, origin);
          expect(new Set(ticks).size).toBe(ticks.length);
          ticks.forEach((x, i) => {
            expect((x - origin) / step).toBeCloseTo(Math.round((x - origin) / step));
            expect(snapHorizontalPosition(x + step * 0.3, step, origin)).toBeCloseTo(x);
            if (i) expect(x - ticks[i - 1]).toBeCloseTo(step);
          });
          for (const x of [-100, 0, 0.1, width / 2, width - 0.01, width, width + 100]) {
            const snapped = snapHorizontalPositionInBounds(x, step, origin, 0, width);
            expect(ticks).toContain(snapped);
            expect(snapped).toBe(ticks.reduce((best, tick) => Math.abs(tick - x) <= Math.abs(best - x) ? tick : best));
          }
          const lines = createHorizontalGridLines(width, mode, step);
          expect(new Set(lines.map(l => l.positionMeters)).size).toBe(lines.length);
          for (const label of createHorizontalRulerLabels(width, mode)) {
            if (label.positionMeters === 0 || label.positionMeters === width) continue;
            expect(lines.find(l => l.positionMeters === label.positionMeters)?.kind).toBe("counting");
          }
          expect(lines.some(l => l.positionMeters === width / 2 || l.positionMeters === 0 || l.positionMeters === width)).toBe(false);
        });
      }
    }
  }
  it("keeps every 1m counting line when numbers are thinned or grid is coarse", () => {
    for (const mode of ["meters", "centerSplit"] as const) for (const step of [0.3, 2]) {
      // Labels are thinned only above 40m; the 1m counting lines never are.
      const lines = createHorizontalGridLines(100, mode, step);
      const counting = lines.filter(l => l.kind === "counting");
      expect(counting.length).toBe(mode === "meters" ? 98 : 100);
      expect(counting.length).toBeGreaterThan(createHorizontalRulerLabels(100, mode).length);
      expect(new Set(lines.map(l => l.positionMeters)).size).toBe(lines.length);
    }
  });
  it("snaps the primary in the common range without changing relative spacing", () => {
    const positions = [{ x: 0.15, y: 0 }, { x: 9.7, y: 1 }];
    for (const requested of [-100, 0, 10, 100]) {
      const x = snapMemberGroupHorizontal(requested, 0.15, positions, 10.3, 0.5, 5.65);
      const delta = x - 0.15;
      for (const p of positions) expect(p.x + delta).toBeGreaterThanOrEqual(-1e-9);
      for (const p of positions) expect(p.x + delta).toBeLessThanOrEqual(10.3 + 1e-9);
      expect((positions[1].x + delta) - (positions[0].x + delta)).toBeCloseTo(9.55);
    }
  });
  it("prioritizes bounds if a narrow range has no lattice point", () => {
    expect(snapHorizontalPositionInBounds(5, 1, 0.5, 0, 0.2)).toBe(0.2);
    expect(createGridTicksInRange(0, 0.2, 1, 0.5)).toEqual([]);
    expect(snapHorizontalPositionInBounds(-1, 1, 0.5, 0, 0.2)).toBe(0);
  });
  it("handles invalid geometry without hanging or generating invalid coordinates", () => {
    for (const width of [NaN, Infinity, -1, 0]) {
      expect(horizontalGridOriginMeters(width, "meters")).toBeNaN();
      expect(createHorizontalGridLines(width, "meters", 0.5)).toEqual([]);
    }
    for (const step of [NaN, Infinity, -1, 0]) {
      expect(createGridTicksInRange(0, 10, step, 5)).toEqual([]);
      expect(snapHorizontalPosition(1.2, step, 5)).toBe(1.2);
      expect(snapHorizontalPositionInBounds(11, step, 5, 0, 10)).toBe(10);
    }
    expect(createGridTicksInRange(0, 10, 0.5, NaN)).toEqual([]);
    expect(createGridTicksInRange(NaN, 10, 0.5)).toEqual([]);
    expect(createGridTicksInRange(0, Infinity, 0.5)).toEqual([]);
    expect(createGridTicksInRange(2, 1, 0.5)).toEqual([]);
    expect(createGridTicksInRange(0, 10, Number.MIN_VALUE)).toEqual([]);
    expect(snapHorizontalPositionInBounds(NaN, 1, 0, 0, 10)).toBeNaN();
  });
});
