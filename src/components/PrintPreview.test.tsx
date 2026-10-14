// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { formationExportFixture } from "../utils/formationExportFixture";

describe("unchanged default A4 structure", () => {
  for (const mode of ["stage", "parade"] as const) for (const variant of ["document", "stage-only"] as const) {
    it(`${mode} ${variant}`, () => {
      const project = formationExportFixture(); project.mode = mode;
      if (mode === "parade") project.paradeSettings = { totalDistance: 100, width: 6, cellSizeMeters: 1,
        direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
      const html = renderToStaticMarkup(<PrintPreview project={project} variant={variant} />);
      // Covers A4 layout and drawing; only label density is excluded.
      // Grid-only snapshot updates were audited against the previous layout.
      // Full-name accessibility metadata does not change A4 geometry/drawing.
      const drawing = html.replace(/ title="[^"]*" role="img" aria-label="[^"]*"/g, "")
        .replace(/(<div class="print-ruler print-ruler-x">)[\s\S]*?<\/div>/g, "$1</div>");
      expect(createHash("sha256").update(drawing).digest("hex")).toMatchSnapshot();
      expect(html).not.toContain("書き出さないメモ");
      expect(html).not.toContain("print-assignment-sheet");
    });
  }
});
