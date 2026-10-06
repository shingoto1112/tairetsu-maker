// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { StaticStagePreview } from "./StaticStagePreview";
import { formationExportFixture } from "../utils/formationExportFixture";
import type { AnnotationLine } from "../types";
const line: AnnotationLine = { x1: 1, y1: -2, x2: 8, y2: 90, color: "blue", dash: "dashed" };
const dom = (html: string) => { const root = document.createElement("div"); root.innerHTML = html; return root; };
describe("annotation exports preserve layout and original dash endpoints", () => {
  it.each(["stage", "parade"] as const)("A4 %s has identical geometry with and without lines", mode => {
    const p = formationExportFixture(); p.mode = mode;
    if (mode === "parade") p.paradeSettings = { width: 12, totalDistance: 100, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
    const before = dom(renderToStaticMarkup(<PrintPreview project={p} />));
    p.frames.forEach(f => { f.annotationLines = { line }; });
    const after = dom(renderToStaticMarkup(<PrintPreview project={p} />));
    // Remove only added annotation ink/clip definitions. The complete layout,
    // page orientation, all headings and frame dimensions must match bytewise.
    after.querySelectorAll(".annotation-lines").forEach(n => { const group = n.parentElement!; const defs = group.previousElementSibling; group.remove(); defs?.remove(); });
    expect(after.innerHTML).toBe(before.innerHTML);
    expect(before.querySelectorAll(".print-page").length).toBe(after.querySelectorAll(".print-page").length);
  });
  it("mobile/image/roster static drawing clips a crossing line without new endpoints or handles", () => {
    const p = formationExportFixture(); p.mode = "parade"; const f = p.frames[0]; f.annotationLines = { line };
    for (const [top, bottom] of [[0, 25], [25, 50]]) {
      const root = dom(renderToStaticMarkup(<StaticStagePreview project={p} frame={f} stageWidth={12} range={{ left: 0, right: 12, top, bottom }} outputWidth={720} />));
      const ink = root.querySelector("[data-annotation-line]")!;
      expect(ink.getAttribute("y1")).toBe(String(-2 - top)); expect(ink.getAttribute("y2")).toBe(String(90 - top));
      expect(ink.getAttribute("stroke-dasharray")).toBe("8 6"); expect(ink.parentElement!.parentElement!.getAttribute("clip-path")).toMatch(/url\(#/);
      expect(root.querySelector("[data-endpoint], [data-ephemeral]")).toBeNull();
    }
  });
});
