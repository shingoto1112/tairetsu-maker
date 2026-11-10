// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import * as sceneExports from "./PrintStagePreview";
import { StaticStagePreview } from "./StaticStagePreview";
import * as layout from "../utils/printLayout";
import { formationExportFixture } from "../utils/formationExportFixture";

const parse = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
};

describe("scene drawing compatibility", () => {
  it("keeps every public layout re-export identical to printLayout", () => {
    for (const name of ["defaultPrintOptions", "getPrintMetrics", "getEffectiveSize",
      "getFramePrintVerticalRange", "getPrintOrientation", "paginateFrames", "PRINT_SCENE_TITLE_MM"] as const) {
      expect(sceneExports[name]).toBe(layout[name]);
    }
  });

  it("preserves the curtain shape difference in both the scene and assignment panel", () => {
    const project = formationExportFixture();
    const frame = project.frames[0];
    project.stageObjects[0].type = "curtain";
    project.stageObjects[0].shape = "rectangle";
    frame.objectAssignments = { [project.stageObjects[0].id]: [project.members[0].id] };
    const options = { ...layout.defaultPrintOptions, includeAssignments: true };
    const metrics = layout.getPrintMetrics(project, [frame], options);
    const documentScene = parse(renderToStaticMarkup(
      <PrintPreview project={project} scope="current" selectedFrameId={frame.id} options={options} />));
    const standaloneScene = parse(renderToStaticMarkup(
      <sceneExports.PrintStagePreview project={project} frame={frame} options={options} metrics={metrics}
        commonWidthMeters={metrics.commonWidthMeters} gapAfter={false}
        verticalRange={layout.getFramePrintVerticalRange(project, frame, layout.getEffectiveSize(project, frame), metrics)} />));
    for (const selector of [".print-object", ".print-assignment-sheet__object"]) {
      expect(documentScene.querySelector(selector)?.classList.contains("shape-curtain")).toBe(true);
      expect(standaloneScene.querySelector(selector)?.classList.contains("shape-rectangle")).toBe(true);
    }
  });

  it("retains static crop, whole circles, highlighting and name suppression", () => {
    const project = formationExportFixture();
    const frame = project.frames[0];
    frame.positions = { [project.members[0].id]: { x: 2, y: 1 }, [project.members[1].id]: { x: 0, y: 0 } };
    const scene = parse(renderToStaticMarkup(
      <StaticStagePreview project={project} frame={frame} stageWidth={12}
        range={{ left: 2, right: 9, top: 1, bottom: 6 }} outputWidth={700}
        viewerPerspective="audience" wholeMembersWithinRange hideLabels
        highlightedObjectId={project.stageObjects[0].id} />));
    expect(scene.querySelector(".print-stage-guides")?.getAttribute("viewBox")).toBe("2 0 7 5");
    expect(scene.querySelectorAll(".print-stage-members .print-member")).toHaveLength(1);
    expect(scene.querySelector(".print-stage .print-member")).toBeNull();
    expect(scene.querySelectorAll(".print-object.is-highlighted")).toHaveLength(1);
    expect(scene.querySelector(".print-member__label, [data-print-object-label]")).toBeNull();
  });

  it("keeps camera margin outside the scene and assignment panels ahead of that margin", () => {
    const project = formationExportFixture();
    const frame = project.frames[0];
    const camera = (includeAssignments: boolean) => parse(renderToStaticMarkup(
      <PrintPreview project={project} scope="current" selectedFrameId={frame.id} variant="stage-only"
        stageOnlyMarginRatio={0.1} options={{ ...layout.defaultPrintOptions, includeAssignments }} />));
    expect(camera(false).querySelector(".print-stage-outer-margin > .print-stage-preview")).not.toBeNull();
    const withAssignments = camera(true);
    expect(withAssignments.querySelector(".print-stage-with-assignments")).not.toBeNull();
    expect(withAssignments.querySelector(".print-stage-outer-margin")).toBeNull();
  });
});
