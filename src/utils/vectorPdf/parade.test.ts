import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultPrintOptions, getEffectiveSize, getFramePrintVerticalRange, getParadePrintRulerLabels, getPrintMetrics, paginateFrames } from "../printLayout";
import { buildScenePage, visibleTextLines } from "./model";
import { vectorParadeFixture, vectorLargeParadeFixture } from "./paradeFixture";
import { renderScenePages, prepareTextDrawings } from "./renderer";
import { createHbSubsetter } from "./hbSubset";
import { validateParadeA4Export, UnsafeParadeA4Export, PARADE_A4_DRAWING_BUDGET, PARADE_A4_DOCUMENT_DRAWING_BUDGET,
  PARADE_A4_SCENE_CHARACTER_BUDGET, PARADE_A4_DOCUMENT_CHARACTER_BUDGET } from "../paradeA4Limits";
import { createA4VectorPdf } from "./a4Document";
import { boundedJpegPixelRatio } from "../exportImage";

it("preserves fractional full-length grid origin, zero crossing, ruler order/classes and fallback", () => {
  const p = vectorParadeFixture({ total: 100.3, backward: 10, crossing: true, cell: 2 });
  const f = p.frames[0], metrics = getPrintMetrics(p, [f], defaultPrintOptions);
  const range = getFramePrintVerticalRange(p, f, getEffectiveSize(p, f), metrics);
  const labels = getParadePrintRulerLabels(100.3, 10, range);
  expect(labels.some(l => l.meter === 0 && l.className === "major")).toBe(true);
  expect(labels.map(l => l.meter)).toEqual([...labels.map(l => l.meter)].sort((a, b) => a - b));
  const page = buildScenePage(p, f.id, {}, () => []), stage = page.drawings.find(d => d.kind === "group" && d.id === "stage");
  if (stage?.kind !== "group") throw new Error("stage missing");
  expect(stage.clip).toBeUndefined();
  const background = stage.children.find(d => d.kind === "group" && d.id === "stage-background");
  if (background?.kind !== "group") throw new Error("background missing");
  expect(background.reuse).toBe(true);
  expect(background.children.some(d => d.kind === "line" && Math.abs(d.y1 - (100.3 - range.topMeters) * metrics.mmPerMeter) < 1e-6)).toBe(true);
  const annotation = stage.children.find(d => d.kind === "group" && d.id === "annotations");
  expect(annotation).toMatchObject({ clip: { height: range.depthMeters * metrics.mmPerMeter }, children: [
    expect.objectContaining({ y1: (f.annotationLines!.diagonal.y1 - range.topMeters) * metrics.mmPerMeter }), expect.anything(),
  ] });
  expect(getParadePrintRulerLabels(100.3, 10, { topMeters: 99.5, bottomMeters: 99.6, depthMeters: .1 }))
    .toEqual([{ meter: 1, label: "1m", internalY: 99.3, className: "minor" }]);
});

it("keeps editor rulerPosition irrelevant and long scenes whole; hidden/assigned members stay omitted", () => {
  const p = vectorParadeFixture({ long: true, assignments: true, count: 3 });
  const options = { ...defaultPrintOptions, includeAssignments: true }, m = getPrintMetrics(p, p.frames, options);
  expect(paginateFrames(p, p.frames, m, options).map(pg => pg.length)).toEqual([1, 1, 1]);
  const pages = ["both", "left", "right", "none"].map(value => {
    p.paradeSettings!.rulerPosition = value as "both";
    return buildScenePage(p, "s0", options, () => []);
  });
  pages.forEach(page => expect(page).toEqual(pages[0]));
  const stage = pages[0].drawings.find(d => d.kind === "group" && d.id === "stage");
  if (stage?.kind !== "group") throw new Error("stage missing");
  expect(stage.children.some(d => d.kind === "group" && ["m24", "m25", "m31"].includes(d.id))).toBe(false);
  expect(visibleTextLines(pages[0].drawings).some(l => l.weight === 600)).toBe(true);
});

it("embeds both subset weights, ToUnicode and portrait MediaBoxes on every page", async () => {
  const p = vectorParadeFixture({ count: 2 });
  const pages = p.frames.map(f => buildScenePage(p, f.id, {}, () => []));
  const { instance } = await WebAssembly.instantiate(await readFile("node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm"));
  const subset = createHbSubsetter(instance.exports);
  const result = await renderScenePages(pages, { orientation: "portrait", fillStrokes: true, clipPage: true, readFontBytes: async name => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`)),
    subsetFont: async (source, codes) => subset(source, codes) });
  expect(result.metrics.fontAttempts).toEqual(["subset"]); expect(result.metrics.embeddedFonts).toHaveLength(2);
  expect(result.metrics.fontInputBytes.every(n => n < 30_000)).toBe(true);
  const task = getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()), useSystemFonts: false });
  try {
    const pdf = await task.promise;
    for (let i = 1; i <= 2; i++) {
      const page = await pdf.getPage(i); expect(page.view[2]).toBeLessThan(page.view[3]);
      const actual = (await page.getTextContent()).items.flatMap(x => "str" in x ? [x.str] : []).join("").replace(/\s/g, "");
      expect(actual).toBe(result.vectorText[i - 1].join("").replace(/\s/g, ""));
    }
  } finally { await task.destroy(); }
}, 15000);

it("uses portrait fit for fallback-grapheme resolution", async () => {
  const sizes: number[] = [];
  const page = { frameId: "emoji", width: 190, height: 277, drawings: [{ kind: "text" as const, text: "🔥", x: 0, y: 10, size: 3, weight: 800, color: "#000000",
    measureMixed: () => [{ text: "🔥", x: 0, baseline: 10, advance: 3 }] }] };
  const rasterize = (_text: string, _line: unknown, unit: number) => { sizes.push(unit); return { dataUrl: "png", width: 1, height: 1, left: 0, top: 0, pixels: 1 }; };
  await prepareTextDrawings(() => false, [page], { orientation: "portrait", rasterize });
  await prepareTextDrawings(() => false, [page], { orientation: "landscape", rasterize });
  expect(sizes[0]).toBeGreaterThan(sizes[1]);
});

it("accepts safe legacy lengths over 500m but stops nonfinite/unsafe scene work without raster fallback", async () => {
  const p = vectorParadeFixture({ total: 1200, backward: 600 });
  expect(() => validateParadeA4Export(p, ["s0"], defaultPrintOptions)).not.toThrow();
  p.paradeSettings!.totalDistance = Infinity;
  const fallback = vi.fn(async () => new Blob());
  await expect(createA4VectorPdf({ project: p, frameIds: ["s0"], options: defaultPrintOptions, element: {} as HTMLElement, title: "unsafe", fallback })).rejects.toBeInstanceOf(UnsafeParadeA4Export);
  expect(fallback).not.toHaveBeenCalled();
  const huge = vectorParadeFixture({ total: 100000, long: true, count: 3 });
  expect(() => validateParadeA4Export(huge, huge.frames.map(f => f.id), defaultPrintOptions)).toThrow("安全上限");
});

it.each([[146, 100], [300, 60], [300, 500]])("accepts ordinary %i-member x %i-scene documents", (members, scenes) => {
  const p = vectorLargeParadeFixture(members, scenes), before = JSON.stringify(p);
  const result = validateParadeA4Export(p, p.frames.map(f => f.id), { ...defaultPrintOptions, includeAssignments: true })!;
  expect(p.frames).toHaveLength(scenes); expect(p.members).toHaveLength(members); expect(p.stageObjects).toHaveLength(6);
  expect(result.documentDrawings).toBeGreaterThan(PARADE_A4_DRAWING_BUDGET);
  expect(result.documentDrawings).toBeLessThan(PARADE_A4_DOCUMENT_DRAWING_BUDGET);
  expect(result.maxSceneDrawings).toBeLessThan(PARADE_A4_DRAWING_BUDGET / 10);
  expect(JSON.stringify(p)).toBe(before);
});

it.each([NaN, Infinity, -Infinity, 1e7])("rejects corrupt distance %s", value => {
  const p = vectorParadeFixture(); p.paradeSettings!.totalDistance = value;
  expect(() => validateParadeA4Export(p, ["s0"], defaultPrintOptions)).toThrow("パレード設定");
});

it("rejects tiny grid, nonfinite geometry and huge dashed annotations with actionable scene context", () => {
  const p = vectorParadeFixture({ cell: .001 });
  expect(() => validateParadeA4Export(p, ["s0"], defaultPrintOptions)).toThrow("格子間隔");
  p.paradeSettings!.cellSizeMeters = 1;
  p.frames[0].positions.m0.x = NaN;
  expect(() => validateParadeA4Export(p, ["s0"], defaultPrintOptions)).toThrow("対象シーン1「パレード・シーン1」");
  p.frames[0].positions.m0.x = 1;
  p.frames[0].annotationLines!.diagonal.x2 = 1e6;
  expect(() => validateParadeA4Export(p, ["s0"], defaultPrintOptions)).toThrow("破線の注釈");
  expect(() => validateParadeA4Export(p, [], defaultPrintOptions)).not.toThrow();
});

it("includes exact drawing budgets and rejects the next dash, per scene and per document", () => {
  const p = vectorParadeFixture({ empty: true }); p.stageObjects = []; p.members = [];
  const validate = () => validateParadeA4Export(p, p.frames.map(f => f.id), defaultPrintOptions)!;
  const base = validate().documentDrawings;
  const m = getPrintMetrics(p, p.frames, defaultPrintOptions).mmPerMeter;
  const setDrawings = (count: number) => { p.frames[0].annotationLines = { edge: { x1: 0, y1: 0, x2: (count - base - 1 - .25) * (14 * 25.4 / 96) / m, y2: 0, dash: "dashed", color: "black" } }; };
  setDrawings(PARADE_A4_DRAWING_BUDGET);
  expect(validate().documentDrawings).toBe(PARADE_A4_DRAWING_BUDGET);
  const source = structuredClone(p.frames[0]);
  p.frames = Array.from({ length: PARADE_A4_DOCUMENT_DRAWING_BUDGET / PARADE_A4_DRAWING_BUDGET }, (_, i) => ({ ...structuredClone(source), id: `s${i}` }));
  expect(validate().documentDrawings).toBe(PARADE_A4_DOCUMENT_DRAWING_BUDGET);
  p.frames.push({ ...structuredClone(source), id: "extra" });
  expect(validate).toThrow("文書全体の描画量");
  p.frames = [source]; setDrawings(PARADE_A4_DRAWING_BUDGET + 1);
  expect(validate).toThrow("1シーンの描画量");
});

it("includes character, scene-count and minimum grid boundaries", () => {
  const p = vectorParadeFixture({ empty: true, cell: .01 }); p.stageObjects = []; p.members = [];
  const validate = () => validateParadeA4Export(p, p.frames.map(f => f.id), defaultPrintOptions)!;
  p.frames[0].label = "名".repeat(PARADE_A4_SCENE_CHARACTER_BUDGET);
  expect(validate().documentCharacters).toBe(PARADE_A4_SCENE_CHARACTER_BUDGET);
  p.frames[0].label += "名"; expect(validate).toThrow("シーン名・メンバー名");
  p.frames[0].label = "名".repeat(PARADE_A4_SCENE_CHARACTER_BUDGET);
  const source = p.frames[0];
  p.frames = Array.from({ length: 10 }, (_, i) => ({ ...source, id: `s${i}` }));
  expect(validate().documentCharacters).toBe(PARADE_A4_DOCUMENT_CHARACTER_BUDGET);
  p.frames.push({ ...source, id: "extra", label: "名" }); expect(validate).toThrow("文書全体の文字数");
  p.paradeSettings!.cellSizeMeters = 1;
  p.frames = Array.from({ length: 500 }, (_, i) => ({ ...source, id: `s${i}`, label: "短" }));
  expect(validate).not.toThrow(); p.frames.push({ ...source, id: "extra" }); expect(validate).toThrow("500以下");
});

it("bounds preview/fallback destinations while keeping ordinary JPEG resolution", () => {
  for (const [w, h] of [[1000, 100000], [100000, 1000], [800, 600]]) {
    const r = boundedJpegPixelRatio(w, h, { maxSide: 2048, maxPixels: 2_000_000 });
    expect(w * r).toBeLessThanOrEqual(2048.00001); expect(h * r).toBeLessThanOrEqual(2048.00001);
    expect(w * h * r * r).toBeLessThanOrEqual(2_000_000.00001);
  }
  expect(boundedJpegPixelRatio(400, 300, { maxSide: 2048, maxPixels: 2_000_000 })).toBe(2);
  expect(() => boundedJpegPixelRatio(Infinity, 1, { maxSide: 2048, maxPixels: 2_000_000 })).toThrow();
  expect(() => boundedJpegPixelRatio(20000000, 100, { maxSide: 2048, maxPixels: 2_000_000 })).toThrow("極端");
});
