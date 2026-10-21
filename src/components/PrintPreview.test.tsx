// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { formationExportFixture } from "../utils/formationExportFixture";

const legacyHashes = {
  stage: { document: "3d361cbf95fe7a14e412271e794f6e242cc669c48c4b8a4a590d012e5e0b5d5f", "stage-only": "826df88a01d2edea86d31d39e74eec1b7bc4121bbb34b7f811dfd95a5824db20" },
  parade: { document: "69b250c0baf0be7814181c693ec24b913f36ed0bd8e48078b79c42fabef5702e", "stage-only": "3724000303adf8c90790adbb46af5e8e4e7a6f9561e6e7f22cc50a4027e81d07" },
};
const drawingMarkup = (html: string) => html.replace(/ title="[^"]*" role="img" aria-label="[^"]*"/g, "")
  .replace(/(<div class="print-ruler print-ruler-x">)[\s\S]*?<\/div>/g, "$1</div>");

describe("default A4 layout and drawing", () => {
  for (const mode of ["stage", "parade"] as const) for (const variant of ["document", "stage-only"] as const) {
    it(`${mode} ${variant}`, () => {
      const project = formationExportFixture(); project.mode = mode;
      if (mode === "parade") project.paradeSettings = { totalDistance: 100, width: 6, cellSizeMeters: 1,
        direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
      const html = renderToStaticMarkup(<PrintPreview project={project} variant={variant} />);
      // Audit against the old exact hash: only the readable prop-name wrapper (the 45° 旗 needs no
      // flip, so 0deg inside the shape) and the stage's old top-origin override may differ.
      // Parade geometry is unchanged. Assignment-fix (build31) only removes the
      // short label-line CSS width cap: oversized readable-floor text is centred
      // instead of overflowing to the right. Markup and these hashes stay intact;
      // browser regression checks cover centred overflow and unchanged fitting text.
      const baselineProject = { ...project, stage: { ...project.stage, frontDirection: "top" as const } };
      const baseline = drawingMarkup(renderToStaticMarkup(<PrintPreview project={baselineProject} variant={variant} />))
        .replace(/<span style="transform:rotate\(0deg\)">旗<\/span>/g, "旗");
      expect(createHash("sha256").update(baseline).digest("hex")).toBe(legacyHashes[mode][variant]);
      const drawing = drawingMarkup(html);
      expect(createHash("sha256").update(drawing).digest("hex")).toMatchSnapshot();
      expect(html).not.toContain("書き出さないメモ");
      expect(html).not.toContain("print-assignment-sheet");
    });
  }
});
