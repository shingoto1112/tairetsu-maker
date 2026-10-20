import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { vectorPdfFixture, vectorStage2Fixture } from "./fixture";
import { defaultPrintOptions, getPrintMetrics, paginateFrames } from "../printLayout";
import { buildAssignmentDrawings, type AssignmentLayout } from "./assignmentModel";
import { buildScenePage, visibleTextLines } from "./model";
import { cachedFontBytes, fontFileName, parsedFont, registerFonts, requiredFontWeights, type FontBytesReader } from "./fonts";
import { withVectorFallback, vectorPdfDiagnostics } from "./a4Document";

it("shares auto pagination with mixed dimensions, scene gaps and fixed-count layouts", () => {
  const p = vectorPdfFixture(9, 1, 5); p.useGlobalStageSize = false;
  p.frames.forEach((f, i) => { f.stageWidthMeters = 7 + i / 2; f.stageDepthMeters = i === 2 ? 8 : 1; });
  const options = { ...defaultPrintOptions, sceneGapRows: 1 };
  const metrics = getPrintMetrics(p, p.frames, options);
  expect(metrics.commonWidthMeters).toBe(9);
  expect(paginateFrames(p, p.frames, metrics, options).map(pg => pg.map(f => f.id))).toEqual([["s0", "s1"], ["s2"], ["s3", "s4"]]);
  expect(paginateFrames(p, p.frames, metrics, { ...options, layout: "three" }).map(pg => pg.length)).toEqual([3, 2]);
  expect(paginateFrames(p, [], metrics, options)).toEqual([]);
  const before = JSON.stringify(p);
  buildScenePage(p, "s0", options, () => [], undefined, { metrics, gapAfter: true });
  expect(JSON.stringify(p)).toBe(before);
});

it("uses CSS-assigned columns/rows, includes hidden assigned members and keeps assignment props unrotated", () => {
  const p = vectorStage2Fixture(), f = p.frames[0];
  f.objectAssignments = { panel: ["m0", "m1", "m2"] }; f.memberVisibility = { m1: false };
  f.objectStates.panel.rotation = 137;
  const rect = { x: 220, y: 20, width: 40, height: 10 };
  const line = (text: string) => ({ kind: "text" as const, text, x: 240, y: 25, size: 3, weight: 800, color: "#000000" });
  const layout: AssignmentLayout = { panel: { x: 200, y: 9, width: 72, height: 140 }, gridMm: 10, emptyText: [],
    entries: [{ objectId: "panel", object: rect, name: [line("大道具Ａ")],
      members: ["m0", "m1", "m2"].map((memberId, i) => ({ memberId, rect: { x: 220 + i % 2 * 12, y: 35 + Math.floor(i / 2) * 12, width: 10, height: 10 },
        lines: [line(p.members[i].name)], shadow: { kind: "image", dataUrl: "shadow", x: 0, y: 0, width: 1, height: 1 } })) }] };
  const nodes = buildAssignmentDrawings(p, f, layout);
  const names = visibleTextLines(nodes).map(l => l.text);
  expect(names).toEqual(["大道具Ａ", "あお", "紅", "みどり"]);
  const prop = nodes.find(n => n.kind === "group" && n.id === "assignment-panel");
  expect(prop).toMatchObject({ rotation: 0 });
  expect(nodes.find(n => n.kind === "group" && n.id === "assignment-panel-m2")).toMatchObject({ children: expect.arrayContaining([
    expect.objectContaining({ kind: "shape", x: 220, y: 47, width: 10 }), expect.objectContaining({ kind: "image" }),
  ]) });
  expect(() => buildAssignmentDrawings(p, f, { ...layout, entries: [] })).toThrow("計測件数");
  p.stageObjects[0].shape = "unknown" as typeof p.stageObjects[0]["shape"];
  expect(() => buildAssignmentDrawings(p, f, layout)).toThrow("未対応");
});

it("only selects drawn weights and caches bytes, while parsing fresh subsets per document", async () => {
  const p = vectorPdfFixture(), page = buildScenePage(p, "s0", {}, () => []);
  const weights = requiredFontWeights(visibleTextLines(page.drawings));
  expect(weights).toEqual(["bold"]);
  const read: FontBytesReader = vi.fn(async name => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`)));
  const pdf1 = new jsPDF(), a = await registerFonts(pdf1, read, undefined, weights);
  const pdf2 = new jsPDF(), b = await registerFonts(pdf2, read, undefined, weights);
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(fontFileName("bold"), undefined);
  expect(a.fetchedBytes).toBeGreaterThan(4_000_000); expect(b.fetchedBytes).toBe(0);
  expect(parsedFont(pdf1, "bold") === parsedFont(pdf2, "bold")).toBe(false);
  expect(requiredFontWeights([{ kind: "text", text: "", x: 0, y: 0, size: 3, color: "#000", weight: 400 }])).toEqual([]);
});

it("does not poison the byte cache on failure or cancellation", async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => { controller.abort(); return new Uint8Array([1]); });
  await expect(cachedFontBytes(read, "font", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  await cachedFontBytes(read, "font"); expect(read).toHaveBeenCalledTimes(2);
  const fails = vi.fn().mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(new Uint8Array([2]));
  await expect(cachedFontBytes(fails, "font")).rejects.toThrow();
  expect((await cachedFontBytes(fails, "font")).bytes[0]).toBe(2);
});

it("replaces the whole document once and records the reason without changing the UI", async () => {
  const fallback = vi.fn(async () => "whole legacy document");
  expect(await withVectorFallback(async () => { throw new Error("page 7 unsupported glyph"); }, fallback)).toBe("whole legacy document");
  expect(fallback).toHaveBeenCalledOnce();
  expect(vectorPdfDiagnostics()[0].reason).toContain("page 7");
  expect(await withVectorFallback(async () => "vector", fallback)).toBe("vector");
  expect(fallback).toHaveBeenCalledOnce();
});

it("cancellation before/during generation, cross-realm AbortError and fallback never yields a file", async () => {
  for (const phase of ["before", "during", "abort-error", "fallback"]) {
    const c = new AbortController(), fallback = vi.fn(async () => { c.abort(); return "legacy"; });
    if (phase === "before") c.abort();
    await expect(withVectorFallback(async () => {
      if (phase === "during") c.abort();
      if (phase === "abort-error") throw { name: "AbortError" };
      if (phase === "fallback") throw new Error("unsupported");
      return "vector";
    }, fallback, c.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fallback).toHaveBeenCalledTimes(phase === "fallback" ? 1 : 0);
  }
});
