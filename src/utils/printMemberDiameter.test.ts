import { expect, it } from "vitest";
import { formationExportFixture } from "./formationExportFixture";
import { defaultPrintOptions, getPrintMetrics, getPrintMemberDiameterMm, getPrintSideRulerWidthMm,
  getPrintPageUsableSize, getPrintRulerTopMm, getPrintRulerBottomMm, PRINT_STAGE_RIGHT_SAFETY_MM } from "./printLayout";

it.each(["stage", "parade"] as const)("keeps larger %s circles on paper and clear of assignments even on narrow stages without rulers", mode => {
  for (const width of [1, 6, 10, 36]) for (const diameter of [1.5, 2])
    for (const includeMeterRulers of [false, true]) for (const includeAssignments of [false, true]) {
      const project = formationExportFixture(); project.mode = mode;
      project.stage.widthMeters = width; project.stage.memberDiameterMeters = diameter;
      project.paradeSettings = { width, totalDistance: 80, cellSizeMeters: .5, direction: "up",
        rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
      const options = { ...defaultPrintOptions, includeMeterRulers, includeAssignments };
      const m = getPrintMetrics(project, project.frames, options);
      const radius = getPrintMemberDiameterMm(project, m) / 2;
      const side = getPrintSideRulerWidthMm(mode === "parade", includeMeterRulers, m);
      expect(side - radius).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(side + m.assignmentSideGapMm - radius).toBeGreaterThanOrEqual(1.5 - 1e-9);
      const safety = mode === "parade" && includeMeterRulers ? PRINT_STAGE_RIGHT_SAFETY_MM : 0;
      expect(2 * side + m.stageWidthMm + safety + m.assignmentSideGapMm + m.assignmentSideWidthMm)
        .toBeLessThanOrEqual(getPrintPageUsableSize(m.orientation).width + 1e-9);
      expect(getPrintRulerTopMm(project, m, options) - radius).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(getPrintRulerBottomMm(project, m, options) - radius).toBeGreaterThanOrEqual(1.5 - 1e-9);
    }
});
