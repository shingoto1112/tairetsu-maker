import { describe, expect, it } from "vitest";
import { formationExportFixture } from "./formationExportFixture";
import { formationSize, formationVerticalRange, rotatedObjectBounds } from "./formationExportLayout";
describe("shared preview bounds", () => {
  it("uses scene dimensions and stage bleed", () => {
    const p = formationExportFixture(); p.useGlobalStageSize = false; p.frames[0].stageWidthMeters = 6; p.frames[0].stageDepthMeters = 30;
    expect(formationSize(p, p.frames[0])).toEqual({ width: 6, depth: 30 });
    expect(formationVerticalRange(p, p.frames[0])).toEqual({ top: -.25, bottom: 30.25 });
  });
  it("covers rotated props and visible unassigned members with parade padding", () => {
    const p = formationExportFixture(); p.mode = "parade";
    p.paradeSettings = { totalDistance: 100, width: 6, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
    p.stageObjects[0] = { ...p.stageObjects[0], widthMeters: 10, heightMeters: 1, defaultRotation: 90, defaultY: 50 };
    p.frames[0].positions.m0.y = 95; p.frames[0].memberVisibility = { m0: false };
    const bounds = rotatedObjectBounds({ x: 4, y: 50, widthMeters: 10, heightMeters: 1, rotation: 90 });
    expect(bounds.top).toBeCloseTo(45.5); expect(bounds.bottom).toBeCloseTo(55.5);
    expect(formationVerticalRange(p, p.frames[0])).toEqual({ top: 0, bottom: 58 });
  });
});
