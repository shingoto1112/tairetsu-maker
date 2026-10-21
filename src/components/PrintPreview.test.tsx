// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { PrintStagePreview } from "./PrintStagePreview";
import { defaultPrintOptions, getPrintMetrics, getFramePrintVerticalRange, getEffectiveSize } from "../utils/printLayout";
import { formationExportFixture } from "../utils/formationExportFixture";

const legacyHashes = {
  stage: { document: "3d361cbf95fe7a14e412271e794f6e242cc669c48c4b8a4a590d012e5e0b5d5f", "stage-only": "826df88a01d2edea86d31d39e74eec1b7bc4121bbb34b7f811dfd95a5824db20" },
  parade: { document: "69b250c0baf0be7814181c693ec24b913f36ed0bd8e48078b79c42fabef5702e", "stage-only": "3724000303adf8c90790adbb46af5e8e4e7a6f9561e6e7f22cc50a4027e81d07" },
};
const drawingMarkup = (html: string) => html.replace(/ title="[^"]*" role="img" aria-label="[^"]*"/g, "")
  .replace(/(<div class="print-ruler print-ruler-x">)[\s\S]*?<\/div>/g, "$1</div>");

describe("default A4 layout and drawing", () => {
  for (const mode of [undefined, "stage", "parade"] as const) {
    it(`keeps the empty assignment label complete in both renderers (${mode ?? "legacy stage"})`, () => {
      const project = formationExportFixture(); project.mode = mode;
      project.frames.forEach(frame => { frame.objectAssignments = {}; });
      const options = { ...defaultPrintOptions, includeAssignments: true };
      const frame = project.frames[0], metrics = getPrintMetrics(project, [frame], options);
      const label = mode === "parade" ? "道具割当なし" : "このシーンの道具割当はありません";
      const previews = [
        <PrintPreview project={project} scope="current" selectedFrameId={frame.id} options={options} />,
        <PrintStagePreview project={project} frame={frame} options={options} metrics={metrics}
          commonWidthMeters={metrics.commonWidthMeters} gapAfter={false}
          verticalRange={getFramePrintVerticalRange(project, frame, getEffectiveSize(project, frame), metrics)} />,
      ];
      for (const preview of previews) {
        const container = document.createElement("div"); container.innerHTML = renderToStaticMarkup(preview);
        expect(container.querySelectorAll(".print-assignment-sheet__empty")).toHaveLength(1);
        expect(container.querySelector(".print-assignment-sheet__empty")?.textContent).toBe(label);
      }
    });
  }
  for (const mode of ["stage", "parade"] as const) for (const variant of ["document", "stage-only"] as const) {
    it(`${mode} ${variant}`, () => {
      const project = formationExportFixture(); project.mode = mode;
      if (mode === "parade") project.paradeSettings = { totalDistance: 100, width: 6, cellSizeMeters: 1,
        direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
      const html = renderToStaticMarkup(<PrintPreview project={project} variant={variant} />);
      // Keep the original exact geometry/page/member hash by normalizing ONLY
      // this change's prop label wrapper. A separate snapshot records the new HTML.
      const baselineProject = { ...project, stage: { ...project.stage, frontDirection: "top" as const } };
      const baseline = drawingMarkup(renderToStaticMarkup(<PrintPreview project={baselineProject} variant={variant} />))
        .replace(/<span class="print-object-label"[^>]*>旗<\/span>/g, "旗");
      expect(createHash("sha256").update(baseline).digest("hex")).toBe(legacyHashes[mode][variant]);
      const drawing = drawingMarkup(html);
      expect(createHash("sha256").update(drawing).digest("hex")).toMatchSnapshot();
      expect(html).not.toContain("書き出さないメモ");
      expect(html).not.toContain("print-assignment-sheet");
    });
  }
});
