// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formationExportFixture } from "../utils/formationExportFixture";
import { FORMATION_TOP, planFormationPages } from "../utils/formationExportLayout";
import { MOBILE_PADDING } from "../utils/mobileExportLayout";
import { FormationMobilePage } from "./FormationMobilePage";
import { StaticStagePreview } from "./StaticStagePreview";
import { formationRulerSide, FORMATION_RULER_FONT_PX, FORMATION_RULER_GAP_PX, stageViewportMeterTicks } from "../utils/formationRulers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("formation static mobile drawing", () => {
  const renderPage = (project: ReturnType<typeof formationExportFixture>, page: ReturnType<typeof planFormationPages>[number]) => {
    const dom = document.createElement("div");
    dom.innerHTML = renderToStaticMarkup(<FormationMobilePage snapshot={{ project, title: project.title,
      exportedAt: project.updatedAt, scopeLabel: "全シーン" }} page={page} />);
    return dom;
  };

  it("draws only tile-contained centers, including shared-band and exact-edge members, as whole circles", () => {
    const project = formationExportFixture();
    project.frames = [project.frames[0]];
    const snapshot = { project, title: project.title, exportedAt: project.updatedAt, scopeLabel: "全シーン" };
    const pages = planFormationPages(snapshot, true, (_text, _width, _font, line) => line);
    const details = pages.filter((page) => page.blocks[0].detail);
    const left = details[0].blocks[0].range, right = details[1].blocks[0].range;
    const positions = {
      insideLeft: { x: 3, y: 3 }, insideRight: { x: 9, y: 3 },
      shared: { x: 6, y: 6 }, sharedLeftEdge: { x: right.left, y: 3 }, sharedRightEdge: { x: left.right, y: 6 },
      leftOnly: { x: right.left - 0.01, y: 3 }, rightOnly: { x: left.right + 0.01, y: 6 },
      topEdge: { x: 3, y: left.top }, bottomEdge: { x: 9, y: right.bottom },
      outsideLeft: { x: left.left - 0.01, y: 3 }, outsideRight: { x: right.right + 0.01, y: 6 },
      outsideTop: { x: 3, y: left.top - 0.01 }, outsideBottom: { x: 9, y: right.bottom + 0.01 },
      hidden: { x: 6, y: 3 }, assigned: { x: 6, y: 3 },
    };
    project.members = Object.keys(positions).map((id) => ({ id, name: id, color: "#0d8b78" }));
    project.frames[0].positions = positions;
    project.frames[0].memberVisibility = { hidden: false };
    project.frames[0].objectAssignments = { flag: ["assigned"] };
    for (const [index, page] of details.entries()) {
      const dom = renderPage(project, page);
      const stage = dom.querySelector<HTMLElement>(".print-stage")!;
      const layer = dom.querySelector<HTMLElement>(".print-stage-members")!;
      expect(layer.parentElement).toBe(stage.parentElement);
      expect(layer.style.overflow).toBe("visible");
      expect(stage.querySelector(".print-member")).toBeNull();
      expect(stage.querySelector(".print-object")).not.toBeNull();
      const circles = Array.from(layer.querySelectorAll<HTMLElement>(".print-member"));
      expect(circles.map((circle) => circle.textContent)).toEqual(index === 0
        ? ["insideLeft", "shared", "sharedLeftEdge", "sharedRightEdge", "leftOnly", "topEdge"]
        : ["insideRight", "shared", "sharedLeftEdge", "sharedRightEdge", "rightOnly", "bottomEdge"]);
      const block = page.blocks[0];
      const diameter = project.stage.memberDiameterMeters! * block.scale;
      for (const circle of circles) {
        const x = parseFloat(circle.style.left) * 96 / 25.4;
        const y = parseFloat(circle.style.top) * 96 / 25.4;
        const position = positions[circle.textContent as keyof typeof positions];
        expect(x + diameter / 2).toBeCloseTo((position.x - block.range.left) * block.scale);
        expect(y + diameter / 2).toBeCloseTo((position.y - block.range.top) * block.scale);
        expect(MOBILE_PADDING + block.side + x).toBeGreaterThanOrEqual(0);
        expect(MOBILE_PADDING + block.side + x + diameter).toBeLessThanOrEqual(540);
        const drawingTop = MOBILE_PADDING + 30 + block.headingHeight + 72 + FORMATION_TOP;
        expect(drawingTop + y).toBeGreaterThanOrEqual(0);
        expect(drawingTop + y + diameter).toBeLessThanOrEqual(page.height);
      }
      // Shared boundary circles actually extend beyond the grid, with no clipping ancestor there.
      const edge = circles.find((circle) => circle.textContent === (index === 0 ? "sharedRightEdge" : "sharedLeftEdge"))!;
      const edgeX = parseFloat(edge.style.left) * 96 / 25.4;
      if (index === 0) expect(edgeX + diameter).toBeGreaterThan((block.range.right - block.range.left) * block.scale);
      else expect(edgeX).toBeLessThan(0);
    }
  });

  it("keeps overview and parade members in the existing clipped stage layer", () => {
    for (const mode of ["stage", "parade"] as const) {
      const project = formationExportFixture(); project.mode = mode;
      const pages = planFormationPages({ project, title: project.title, exportedAt: project.updatedAt, scopeLabel: "全シーン" }, true,
        (_text, _width, _font, line) => line);
      for (const page of pages.filter((item) => mode === "parade" || !item.blocks[0].detail)) {
        const dom = renderPage(project, page);
        expect(dom.querySelector(".print-stage-members")).toBeNull();
        for (const stage of dom.querySelectorAll(".print-stage")) expect(stage.querySelectorAll(".print-member")).toHaveLength(24);
      }
    }
  });
  it("anchors both stage rulers to integer meters in overview and detail despite vertical padding", () => {
    const project = formationExportFixture();
    const snapshot = { project, title: project.title, exportedAt: new Date().toISOString(), scopeLabel: "全シーン" };
    const pages = planFormationPages(snapshot, true, (_text, _width, _font, line) => line);
    for (const page of [pages[0], pages.find((candidate) => candidate.blocks[0].detail)!]) {
      const dom = document.createElement("div");
      dom.innerHTML = renderToStaticMarkup(<FormationMobilePage snapshot={snapshot} page={page} />);
      for (const [index, section] of Array.from(dom.querySelectorAll("section")).entries()) {
        const block = page.blocks[index];
        for (const ruler of section.querySelectorAll(".print-ruler-y")) {
          const labels = Array.from(ruler.querySelectorAll<HTMLSpanElement>("span"));
          expect(labels.map((label) => label.textContent)).toEqual(Array.from({ length: 9 }, (_, meter) => `${meter}m`));
          labels.forEach((label, meter) => {
            // The existing 4mm-high label is centered on the absolute meter line.
            const expectedMm = (meter - block.range.top) * block.scale * 25.4 / 96 - 2;
            expect(parseFloat(label.style.top)).toBeCloseTo(expectedMm);
          });
        }
      }
    }
    expect(stageViewportMeterTicks(-0.25, 12.75, 12.5)).toEqual(Array.from({ length: 13 }, (_, i) => i));
    expect(stageViewportMeterTicks(2.25, 8.25, 8)).toEqual([3, 4, 5, 6, 7, 8]);
  });
  it("reserves page-contained ruler bands for large stage and signed parade distances", () => {
    const sheet = document.createElement("style");
    sheet.textContent = readFileSync(resolve("src/styles.css"), "utf8");
    document.head.append(sheet);
    try {
      for (const [mode, limit, backward, expected] of [
        ["stage", 18, 0, "18m"], ["parade", 100, 0, "100m"], ["parade", 1000, 10000, "-10000m"],
      ] as const) {
        const project = formationExportFixture(); project.mode = mode; project.stage.depthMeters = limit;
        if (mode === "parade") project.paradeSettings = { totalDistance: limit, backwardDistanceMeters: backward,
          width: 4, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
        const top = mode === "stage" ? limit - 2.25 : backward ? limit + backward - 2.25 : -0.25;
        const range = { left: -0.25, right: 4.25, top, bottom: top + 2.5 };
        const side = formationRulerSide(project);
        const dom = document.createElement("div");
        dom.innerHTML = renderToStaticMarkup(<StaticStagePreview project={project} frame={project.frames[0]} stageWidth={4} range={range} outputWidth={492} />);
        document.body.append(dom);
        try {
          const preview = dom.querySelector<HTMLElement>(".print-stage-preview")!;
          const columns = preview.style.gridTemplateColumns.split(" ").map((mm) => parseFloat(mm) * 96 / 25.4);
          expect(columns.reduce((sum, width) => sum + width, 0)).toBeCloseTo(492);
          expect(columns[0]).toBeCloseTo(side); expect(columns[2]).toBeCloseTo(side);
          for (const ruler of dom.querySelectorAll(".print-ruler-y")) {
            expect(ruler.textContent).toContain(expected);
            for (const label of ruler.querySelectorAll("span")) {
              const style = getComputedStyle(label);
              expect(style.fontFamily).toBe("monospace"); expect(style.fontSize).toBe("10px");
              expect(style.left).toBe("4px"); expect(style.right).toBe("4px");
              // A full em for each character plus both gaps fits inside either band.
              expect(label.textContent!.length * FORMATION_RULER_FONT_PX + FORMATION_RULER_GAP_PX * 2).toBeLessThanOrEqual(side);
            }
          }
        } finally { dom.remove(); }
      }
    } finally { sheet.remove(); }
  });
  it("renders exact locator ranges, overlaps and cropped rulers, without notes, assignments or selection UI", () => {
    const project = formationExportFixture(); project.frames[0].objectAssignments = { flag: ["m0"] };
    project.stage.horizontalGuideMode = "centerSplit";
    const snapshot = { project, title: project.title, exportedAt: new Date().toISOString(), scopeLabel: "全シーン" };
    const pages = planFormationPages(snapshot, true, (_text, _width, _font, line) => line);
    const detail = pages.find((page) => page.blocks[0].detail)!;
    const html = renderToStaticMarkup(<FormationMobilePage snapshot={snapshot} page={detail} />);
    const dom = document.createElement("div"); dom.innerHTML = html;
    const block = detail.blocks[0];
    expect(dom.querySelector("[data-formation-locator-range]")?.getAttribute("x")).toBe(String(block.range.left));
    expect(dom.querySelector("[data-formation-locator-range]")?.getAttribute("width")).toBe(String(block.range.right - block.range.left));
    expect(dom.querySelectorAll("[data-formation-overlap]").length).toBeGreaterThan(0);
    expect(dom.querySelector(".print-ruler-x")?.textContent).not.toMatch(/[-+]|0m/);
    expect(dom.querySelectorAll(".print-ruler-y")).toHaveLength(2);
    const expectedMembers = project.members.filter((member) => {
      const position = block.frame.positions[member.id];
      return member.id !== "m0" && position.x >= block.range.left && position.x <= block.range.right
        && position.y >= block.range.top && position.y <= block.range.bottom;
    });
    expect(dom.querySelectorAll(".print-member")).toHaveLength(expectedMembers.length);
    expect(dom.querySelector(".print-assignment-sheet")).toBeNull();
    expect(dom.querySelectorAll("button,input,[data-selected],.selection-box")).toHaveLength(0);
    expect(html).not.toContain("書き出さないメモ");
  });
  it("retains parade 5m/10m guide lines, time and page numbers", () => {
    const project = formationExportFixture(); project.mode = "parade";
    project.paradeSettings = { totalDistance: 30, width: 6, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
    project.frames[0].positions.m0.y = 20;
    const snapshot = { project, title: project.title, exportedAt: new Date().toISOString(), scopeLabel: "全シーン" };
    const pages = planFormationPages(snapshot, false, (_text, _width, _font, line) => line);
    const html = renderToStaticMarkup(<FormationMobilePage snapshot={snapshot} page={pages[0]} />);
    expect(html).toContain("print-parade-distance-line--major"); expect(html).toContain("0:00");
    expect(html).toContain(`1/${pages.length}`);
  });
});
