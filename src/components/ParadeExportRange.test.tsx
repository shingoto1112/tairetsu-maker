// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { PrintStagePreview, getFramePrintVerticalRange as previewRange, paginateFrames as previewPaginate } from "./PrintStagePreview";
import { StaticStagePreview } from "./StaticStagePreview";
import { formationExportFixture } from "../utils/formationExportFixture";
import { createDefaultObjectState } from "../utils/interpolation";
import { defaultPrintOptions, getEffectiveSize, getFramePrintVerticalRange, getPrintMetrics, paginateFrames } from "../utils/printLayout";
import { buildScenePage, type Drawing } from "../utils/vectorPdf/model";
import { validateParadeA4Export, UnsafeParadeA4Export } from "../utils/paradeA4Limits";

const options = { ...defaultPrintOptions, sceneGapRows: 0 };
const fixture = () => {
  const p = formationExportFixture(); p.mode = "parade";
  p.paradeSettings = { totalDistance: 100, width: 12, cellSizeMeters: 1, direction: "up",
    rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
  p.members = [p.members[0]]; p.frames = [p.frames[0]];
  p.frames[0].positions = { m0: { x: 6, y: 50 } };
  p.stageObjects[0] = { ...p.stageObjects[0], widthMeters: 8, heightMeters: 1, defaultRotation: 90, defaultY: 50 };
  p.frames[0].objectStates.flag = createDefaultObjectState(p.stageObjects[0]);
  return p;
};
const group = (drawings: Drawing[], id: string) => {
  const found = drawings.find(d => d.kind === "group" && d.id === id);
  if (found?.kind !== "group") throw new Error(`Missing drawing ${id}`);
  return found;
};

it("re-exports the exact same range implementation from PrintStagePreview", () => {
  expect(previewRange).toBe(getFramePrintVerticalRange);
});

it.each([
  { name: "annotations only", members: false, objects: false, annotations: true, top: 18, bottom: 83 },
  { name: "rotated thin object only", members: false, objects: true, annotations: false, top: 44, bottom: 57 },
  { name: "members, annotations and rotated object", members: true, objects: true, annotations: true, top: 18, bottom: 83 },
])("uses the same numerical crop for A4 image/fallback DOM, camera PNG/PDF DOM, static drawing and vector PDF: $name", spec => {
  const p = fixture(), f = p.frames[0];
  if (!spec.members) { p.members = []; f.positions = {}; }
  if (!spec.objects) p.stageObjects = [];
  if (spec.annotations) f.annotationLines = { remote: { x1: 1, y1: 80.3, x2: 11, y2: 20.2, color: "red", dash: "dashed" } };
  const before = JSON.stringify(p), metrics = getPrintMetrics(p, [f], options);
  const range = getFramePrintVerticalRange(p, f, getEffectiveSize(p, f), metrics);
  expect(range).toEqual({ topMeters: spec.top, bottomMeters: spec.bottom, depthMeters: spec.bottom - spec.top });
  // A4 PNG and image-PDF fallback both consume .print-page from document.
  // Both camera formats consume stage-only; PDF wraps that same PNG.
  const outputs = [
    <PrintPreview project={p} options={options} variant="document" />,
    <PrintPreview project={p} options={options} variant="stage-only" />,
    <PrintStagePreview project={p} frame={f} options={options} metrics={metrics} commonWidthMeters={12} gapAfter={false}
      verticalRange={previewRange(p, f, getEffectiveSize(p, f), metrics)} />,
    <StaticStagePreview project={p} frame={f} stageWidth={12} outputWidth={720}
      range={{ left: 0, right: 12, top: spec.top, bottom: spec.bottom }} />,
  ];
  for (const output of outputs) {
    const root = document.createElement("div"); root.innerHTML = renderToStaticMarkup(output);
    const drawing = root.querySelector<HTMLElement>(".print-stage-preview")!;
    const m = parseFloat(drawing.style.getPropertyValue("--print-stage-width-mm")) / 12;
    expect(parseFloat(drawing.style.getPropertyValue("--print-stage-height-mm")) / m).toBeCloseTo(range.depthMeters, 10);
    expect(root.querySelector(".print-stage-guides")?.getAttribute("viewBox")).toBe(`0 0 12 ${range.depthMeters}`);
    if (spec.annotations) {
      const ink = root.querySelector("[data-annotation-line=remote]")!;
      expect(Number(ink.getAttribute("y1"))).toBeCloseTo(80.3 - spec.top, 10);
      expect(Number(ink.getAttribute("y2"))).toBeCloseTo(20.2 - spec.top, 10);
      expect(ink.getAttribute("stroke-dasharray")).toBe("8 6");
    }
    if (spec.objects) {
      const object = root.querySelector<HTMLElement>(".print-object")!;
      expect(parseFloat(object.style.top) / m).toBeCloseTo(50 - spec.top, 10);
      expect(object.style.transform).toContain("rotate(90deg)");
    }
  }
  const page = buildScenePage(p, f.id, options, () => []), stage = group(page.drawings, "stage");
  expect(group(stage.children, "annotations").clip?.height).toBeCloseTo(range.depthMeters * metrics.mmPerMeter, 10);
  if (spec.annotations) expect(group(stage.children, "annotations").children[0]).toMatchObject({
    y1: (80.3 - spec.top) * metrics.mmPerMeter, y2: (20.2 - spec.top) * metrics.mmPerMeter,
  });
  if (spec.objects) expect(group(stage.children, "flag")).toMatchObject({ y: (50.5 - spec.top) * metrics.mmPerMeter, rotation: 90 });
  // Independent numerical budget expectation verifies the limits use the same depth.
  // limits count all registered members/objects even when no member has a position.
  const depth = spec.bottom - spec.top, m = metrics.mmPerMeter;
  const expectedDrawings = 32 + 2 * (12 + 2) + 2 * (depth + 2) + 2 * (depth + 2)
    + p.members.length * 12 + (spec.annotations ? 1 + Math.ceil(Math.hypot(10, 60.1) * m / (14 * 25.4 / 96)) : 0)
    + (spec.objects ? 12 + Math.ceil(8 * m / (16 * 25.4 / 96)) : 0);
  expect(validateParadeA4Export(p, [f.id], options)?.documentDrawings).toBe(expectedDrawings);
  expect(JSON.stringify(p)).toBe(before);
});

it("uses the expanded range in common pagination and both DOM renderers", () => {
  const p = fixture(); p.stageObjects = [];
  p.frames = Array.from({ length: 3 }, (_, i) => ({ ...structuredClone(p.frames[0]), id: `s${i}` }));
  const metrics = getPrintMetrics(p, p.frames, options);
  expect(paginateFrames(p, p.frames, metrics, options).map(page => page.length)).toEqual([2, 1]);
  p.frames.forEach(f => { f.annotationLines = { remote: { x1: 1, y1: 20.2, x2: 11, y2: 80.3, color: "blue", dash: "solid" } }; });
  expect(paginateFrames(p, p.frames, metrics, options).map(page => page.length)).toEqual([1, 1, 1]);
  expect(previewPaginate(p, p.frames, metrics, options)).toEqual(paginateFrames(p, p.frames, metrics, options));
  const root = document.createElement("div"); root.innerHTML = renderToStaticMarkup(<PrintPreview project={p} options={options} />);
  expect(root.querySelectorAll(".print-page")).toHaveLength(3);
});

it.each(["annotation", "rotated object"])("keeps the existing actionable safety rejection when %s expands the crop", kind => {
  const p = fixture(); p.paradeSettings!.totalDistance = 1000;
  p.paradeSettings!.cellSizeMeters = .01;
  p.stageObjects = [];
  p.frames[0].objectStates = {};
  expect(() => validateParadeA4Export(p, ["s0"], options)).not.toThrow();
  if (kind === "annotation") p.frames[0].annotationLines = { remote: { x1: 1, x2: 11, y1: 0, y2: 1000, color: "red", dash: "solid" } };
  else p.stageObjects = [{ ...formationExportFixture().stageObjects[0], defaultY: 499.5,
    widthMeters: 1000, heightMeters: 1, defaultRotation: 90 }];
  expect(() => validateParadeA4Export(p, ["s0"], options)).toThrow(UnsafeParadeA4Export);
  expect(() => validateParadeA4Export(p, ["s0"], options)).toThrow(/対象シーン1.*格子・目盛り.*安全上限/);
});
