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
      expect(createHash("sha256").update(html).digest("hex")).toMatchSnapshot();
      expect(html).not.toContain("書き出さないメモ");
      expect(html).not.toContain("print-assignment-sheet");
    });
  }
});
