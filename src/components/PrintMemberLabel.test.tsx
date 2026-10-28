// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formationExportFixture } from "../utils/formationExportFixture";
import { exportMemberLabelFitLimit, splitMemberLabel } from "../utils/memberLabel";
import { getPrintMemberLabelFontSizeMm } from "../utils/printLayout";
import { StaticStagePreview } from "./StaticStagePreview";
import { PrintPreview } from "./PrintPreview";
import { defaultPrintOptions, getEffectiveSize, getFramePrintVerticalRange, getPrintMetrics, PrintStagePreview } from "./PrintStagePreview";

describe("both print renderers retain full names and cap boosted text", () => {
  for (const component of ["document", "stage"] as const) for (const mode of ["stage", "parade"] as const) {
    it(`${component} ${mode}`, () => {
      const project = formationExportFixture(); project.mode = mode;
      project.stage.depthMeters = 5.4; project.stage.memberDiameterMeters = 0.4;
      project.paradeSettings = { width: 9, totalDistance: 10.13, backwardDistanceMeters: 2.31, cellSizeMeters: 0.5,
        direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true };
      const names = ["あ", "あい", "あおい", "鈴木一郎", "たかはしゆ", "佐々木小次郎", "あいうえおかき", "Takahashi", "男右1", "AB12", "iiiiii", "WWWWWW"];
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
        expect(parseFloat(token.style.fontSize)).toBeCloseTo(getPrintMemberLabelFontSizeMm(diameter, lines), 2);
        expect(parseFloat(token.style.fontSize)).toBeLessThanOrEqual(exportMemberLabelFitLimit(diameter, lines));
      });
    });
  }
  for (const component of ["document", "stage"] as const) for (const mode of ["stage", "parade"] as const) {
    it(`${component} ${mode}: assignment chips keep their old sizes`, () => {
      const project = formationExportFixture(); project.mode = mode;
      project.members = project.members.slice(0, 6);
      ["あ", "あい", "あおい", "鈴木一郎", "たかはしゆ", "佐々木小次郎"].forEach((name, i) => project.members[i].name = name);
      const frame = project.frames[0]; frame.objectAssignments = { flag: project.members.map(m => m.id) };
      const options = { ...defaultPrintOptions, includeAssignments: true };
      const metrics = getPrintMetrics(project, [frame], options);
      const html = renderToStaticMarkup(component === "document" ? <PrintPreview project={project} scope="current" selectedFrameId={frame.id} options={options} /> :
        <PrintStagePreview project={project} frame={frame} metrics={metrics} commonWidthMeters={metrics.commonWidthMeters}
          verticalRange={getFramePrintVerticalRange(project, frame, getEffectiveSize(project, frame), metrics)} gapAfter={false} options={options} />);
      const host = document.createElement("div"); host.innerHTML = html;
      const chips = [...host.querySelectorAll<HTMLElement>(".print-assignment-sheet__member")];
      expect(chips).toHaveLength(6);
      const parent = host.querySelector<HTMLElement>("[style*='--print-assignment-member-size']")!;
      const diameter = parseFloat(parent.style.getPropertyValue("--print-assignment-member-size"));
      chips.forEach((chip, i) => expect(parseFloat(chip.style.fontSize)).toBeCloseTo(getPrintMemberLabelFontSizeMm(diameter, splitMemberLabel(project.members[i].name), "preview"), 2));
    });
  }
  it("keeps screen previews at the old size while camera output uses containment", () => {
    const project = formationExportFixture(); project.stage.widthMeters = 36; project.stage.depthMeters = 20;
    project.members = [project.members[0]]; project.members[0].name = "あおい";
    for (const camera of [false, true]) {
      const html = renderToStaticMarkup(camera ? <PrintPreview project={project} variant="stage-only" scope="current" selectedFrameId="s0" /> :
        <StaticStagePreview project={project} frame={project.frames[0]} stageWidth={36} range={{ left: 0, right: 36, top: 0, bottom: 20 }} outputWidth={200} />);
      const host = document.createElement("div"); host.innerHTML = html;
      const token = host.querySelector<HTMLElement>(".print-member")!;
      const diameter = parseFloat(host.querySelector<HTMLElement>("[style*='--print-member-size']")!.style.getPropertyValue("--print-member-size"));
      expect(parseFloat(token.style.fontSize)).toBeCloseTo(getPrintMemberLabelFontSizeMm(diameter, ["あおい"], camera ? "export" : "preview"), 2);
      if (camera) expect(parseFloat(token.style.fontSize)).toBeLessThan(1.8);
    }
  });
});
