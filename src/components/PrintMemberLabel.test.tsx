// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formationExportFixture } from "../utils/formationExportFixture";
import { getMemberLabelFontSize, memberLabelFitLimit, splitMemberLabel } from "../utils/memberLabel";
import { PrintPreview } from "./PrintPreview";
import { defaultPrintOptions, getEffectiveSize, getFramePrintVerticalRange, getPrintMetrics, PrintStagePreview } from "./PrintStagePreview";

describe("both print renderers retain full names and cap boosted text", () => {
  for (const component of ["document", "stage"] as const) for (const mode of ["stage", "parade"] as const) {
    it(`${component} ${mode}`, () => {
      const project = formationExportFixture(); project.mode = mode;
      project.stage.depthMeters = 5.4; project.stage.memberDiameterMeters = 0.4;
      project.paradeSettings = { width: 9, totalDistance: 10.13, backwardDistanceMeters: 2.31, cellSizeMeters: 0.5,
        direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true };
      const names = ["たかはしゆ", "佐々木小次郎", "あいうえおかき", "Takahashi", "男右1", "AB12"];
      project.members = names.map((name, i) => ({ id: `m${i}`, name, color: "#0d8b78" }));
      project.frames = [project.frames[0]]; project.stageObjects = [];
      const frame = project.frames[0], metrics = getPrintMetrics(project, [frame], defaultPrintOptions);
      const verticalRange = getFramePrintVerticalRange(project, frame, getEffectiveSize(project, frame), metrics);
      const html = renderToStaticMarkup(component === "document" ? <PrintPreview project={project} /> :
        <PrintStagePreview project={project} frame={frame} commonWidthMeters={metrics.commonWidthMeters} metrics={metrics}
          verticalRange={verticalRange} gapAfter={false} options={defaultPrintOptions} />);
      const host = document.createElement("div"); host.innerHTML = html;
      const tokens = [...host.querySelectorAll<HTMLElement>(".print-member")]; expect(tokens).toHaveLength(names.length);
      const diameter = parseFloat(host.querySelector<HTMLElement>("[style*='--print-member-size']")!.style.getPropertyValue("--print-member-size"));
      tokens.forEach((token, i) => {
        expect(token.title).toBe(names[i]); expect(token.getAttribute("aria-label")).toBe(names[i]);
        const lines = splitMemberLabel(names[i]);
        expect([...token.querySelectorAll(".print-member__label-line")].map(line => line.textContent)).toEqual(lines);
        const options = { min: 1.8, precision: 2, boost: 0.2, border: 0, inset: 0, borderOverlap: 0 };
        expect(parseFloat(token.style.fontSize)).toBeCloseTo(getMemberLabelFontSize(diameter, lines, options), 2);
        if (i < 4) expect(parseFloat(token.style.fontSize)).toBeLessThanOrEqual(memberLabelFitLimit(diameter, lines, options));
      });
    });
  }
});
