import { describe, expect, it } from "vitest";
import { snapAnnotationPoint } from "./annotationLines";
import { horizontalGridOriginMeters } from "./horizontalGrid";
import { verticalEmphasizedLines } from "./gridEmphasis";
import { formationExportFixture } from "./formationExportFixture";

describe("line-only half-grid snapping", () => {
  it.each(["meters", "centerSplit", "normalMeter"])("retains horizontal %s origin for non-integral widths/steps", mode => {
    // 0.3 exposes the difference between origins; 0.5/1 can share half-step lattices.
    const origin = horizontalGridOriginMeters(9.3, mode === "centerSplit" ? "centerSplit" : "meters");
    for (const offset of [-3, -1, 0, 1, 3]) {
      const x = Number((origin + offset * 0.15).toFixed(9));
      expect(snapAnnotationPoint({ x: x + 0.02, y: 1.66 }, 9.3, 10, 0.3, mode)).toEqual({ x, y: 1.65 });
    }
  });
  it.each([[0.5, 1.25, 2.75], [0.1, 1.05, 2.15]])("%sm has half steps with no extra minimum", (step, x, y) => {
    expect(snapAnnotationPoint({ x: x + step / 20, y: y - step / 20 }, 12, 8, step, "centerSplit")).toEqual({ x, y });
  });
  it("parade aligns both grid lines and their midpoints with totalDistance, including backward area", () => {
    const stage = formationExportFixture().stage;
    const parade = { width: 12, totalDistance: 10.13, backwardDistanceMeters: 2.31, cellSizeMeters: 0.5, direction: "up" as const, rulerPosition: "both" as const, emphasizeEvery5m: true, emphasizeEvery10m: true };
    const depth = parade.totalDistance + parade.backwardDistanceMeters;
    const ticks = verticalEmphasizedLines(depth, parade.cellSizeMeters, stage, parade).map(t => t.positionMeters);
    for (const y of ticks) {
      const snap = snapAnnotationPoint({ x: 6, y }, parade.width, depth, parade.cellSizeMeters, "normalMeter", parade.totalDistance);
      expect(snap.y).toBeCloseTo(y, 9);
    }
    for (const y of [0.38, 9.88, 10.38, 12.38]) {
      expect(snapAnnotationPoint({ x: 6, y: y + 0.03 }, 12, depth, 0.5, "normalMeter", parade.totalDistance).y).toBeCloseTo(y, 9);
    }
    expect(snapAnnotationPoint({ x: 6, y: 0 }, 12, depth, 0.5, "normalMeter", parade.totalDistance).y).toBe(0.13);
  });
  it("stage keeps its zero-based fine grid even with non-integral depth", () => {
    expect(snapAnnotationPoint({ x: 6, y: 1.27 }, 12, 8.13, 0.5).y).toBe(1.25);
  });
});
