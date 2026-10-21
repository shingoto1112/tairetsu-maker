import { readFile } from "node:fs/promises";
import { jsPDF } from "jspdf";
import { PNG } from "pngjs";
import { beforeAll, expect, it, vi } from "vitest";
import { registerFonts } from "./fonts";
import { graphemes, planTextRuns } from "./textRuns";
import { createGraphemeImageCache, GRAPHEME_IMAGE_LIMITS, type GlyphRasterizer } from "./graphemeImages";
import { prepareTextDrawings, renderScenePages } from "./renderer";
import { withVectorFallback } from "./a4Document";
import type { ScenePage, TextLine } from "./model";

const readFonts = async (name: string) => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`));
const line = (text: string): TextLine => ({ kind: "text", text, x: 5, y: 5, size: 3, weight: 800, color: "#123456",
  measureMixed: () => graphemes(text).map((text, i) => ({ text, x: 5 + i * 3, baseline: 6, advance: 3 })) });
const page = (text: string): ScenePage => ({ frameId: "test", width: 100, height: 80, drawings: [line(text)] });
const png = new PNG({ width: 4, height: 4 }); png.data.fill(128);
const dataUrl = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
const raster: GlyphRasterizer = () => ({ dataUrl, left: -.1, top: -2.5, width: 3.2, height: 3.2, pixels: 16 });
let pdf: jsPDF;
beforeAll(async () => { pdf = new jsPDF(); await registerFonts(pdf, readFonts, undefined, ["bold"]); });

it.each(["🔥", "👩🏽‍🎤", "❤️", "葛\u{e0100}", "か\u3099", "𠮷"])("keeps %s as one raster grapheme with adjacent vector runs", text => {
  expect(graphemes(text)).toEqual([text]);
  expect(planTextRuns(pdf, line(`あお${text}みどり`)).map(r => [r.text, r.raster])).toEqual([["あお", false], [text, true], ["みどり", false]]);
});
it("preserves an ordinary continuous run and rejects contextual scripts/controls", () => {
  expect(planTextRuns(pdf, line("あお山田ABC"))).toEqual([{ text: "あお山田ABC", raster: false, start: 0, end: 7 }]);
  for (const text of ["مرحبا", "नमस्ते", "あ\u202eお", "あ\u0000", "あ\u200dお", "\u3099"]) expect(() => planTextRuns(pdf, line(text))).toThrow();
});
it("rasterizes independent Hangul names and compatibility jamo, preserving adjacent vector runs", () => {
  expect(planTextRuns(pdf, line("山田김민지ABCㄱ")).map(r => [r.text, r.raster])).toEqual([
    ["山田", false], ["김", true], ["민", true], ["지", true], ["ABC", false], ["ㄱ", true],
  ]);
});
it.each(["\u1100\u1161", "\ua960", "\ud7b0", "가\u11a8"])("rejects conjoining Hangul jamo %s", text => {
  expect(() => planTextRuns(pdf, line(text))).toThrow("文脈依存");
});
it("without Segmenter does not split ZWJ sequences with Array.from", () => {
  const original = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
  Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true });
  try {
    for (const value of ["👩🏽‍🎤", "❤️", "김"]) expect(() => planTextRuns(pdf, line(value))).toThrow("Segmenter");
    expect(planTextRuns(pdf, line("山田"))[0].raster).toBe(false);
  }
  finally { Object.defineProperty(Intl, "Segmenter", original); }
});
it("keys images by grapheme/font/weight/size/color/resolution and isolates document aliases", () => {
  const draw = vi.fn(raster), cache = createGraphemeImageCache(draw), base = line("🔥");
  const first = cache.image("🔥", base, 1, 5, 6);
  expect(cache.image("🔥", base, 1, 15, 16)).toMatchObject({ cacheKey: "vector-grapheme-1", x: 14.9, y: 13.5 });
  for (const changed of [{ size: 4 }, { color: "#ffffff" }, { weight: 700 }]) cache.image("🔥", { ...base, ...changed }, 1, 5, 6);
  cache.image("🔥", base, 2, 5, 6);
  expect(draw).toHaveBeenCalledTimes(5); expect(cache.metrics).toMatchObject({ imageTypes: 5, imageUses: 6, cacheHits: 1 });
  expect(first).toMatchObject({ x: 4.9, y: 3.5 });
  expect(createGraphemeImageCache(draw).image("❤️", base, 1, 0, 0)).toMatchObject({ cacheKey: "vector-grapheme-1" });
});
it("planned uses share one bitmap per grapheme/style at the largest page resolution", () => {
  const draw = vi.fn(raster), cache = createGraphemeImageCache(draw), base = line("🔥");
  cache.plan("🔥", base, 1); cache.plan("🔥", base, 2); cache.plan("🔥", { ...base, size: 4 }, 1);
  const small = cache.image("🔥", base, 1, 5, 6), large = cache.image("🔥", base, 2, 15, 16);
  expect(small.kind === "image" && large.kind === "image" && small.cacheKey === large.cacheKey).toBe(true);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.calls[0][2]).toBe(30.25); // ceil(2 * 384 / 25.4 * 4) / 4, not the page-1 unit
  cache.image("🔥", { ...base, size: 4 }, 2, 0, 0); // another style keeps its own planned unit
  expect(draw).toHaveBeenCalledTimes(2);
  expect(draw.mock.calls[1][2]).toBe(15.25);
  expect(cache.metrics).toMatchObject({ imageTypes: 2, imageUses: 3, cacheHits: 1 });
});
it("enforces image type, side and aggregate pixel limits", () => {
  const cache = createGraphemeImageCache(raster);
  for (let i = 0; i < GRAPHEME_IMAGE_LIMITS.types; i++) cache.image(String(i), line("🔥"), 1, 0, 0);
  expect(() => cache.image("overflow", line("🔥"), 1, 0, 0)).toThrow("種類数");
  expect(() => createGraphemeImageCache(() => ({ ...raster("", line(""), 1), pixels: 4_000_001 })).image("🔥", line("🔥"), 1, 0, 0)).toThrow();
  expect(() => createGraphemeImageCache(() => ({ ...raster("", line(""), 1), width: 10_000 })).image("🔥", line("🔥"), 1, 0, 0)).toThrow();
});
it("only subsets and validates vector runs; reuses PNG/SMask under the existing rotated clip", async () => {
  const pages = [page("あお🔥みどり🔥")];
  pages[0].drawings = [{ kind: "group", id: "rotated", x: 20, y: 20, rotation: 137,
    clip: { x: -5, y: -2, width: 10, height: 4 }, children: pages[0].drawings }];
  const result = await renderScenePages(pages, { readFontBytes: readFonts, rasterize: raster, title: "メタデータ🔥مرحبا" });
  expect(result.vectorText).toEqual([["あお", "みどり"]]);
  expect(result.metrics.graphemeImages).toMatchObject({ imageTypes: 1, imageUses: 2, cacheHits: 1 });
  const raw = await result.blob.text(); expect(raw).toContain("/SMask"); expect(raw).toContain("/ToUnicode");
  expect((raw.match(/\/Subtype \/Image/g) ?? []).length).toBe(2); // RGB plus alpha, one unique asset
  const prepared = await prepareTextDrawings(pdf, pages, { rasterize: raster });
  expect(prepared.pages[0].drawings[0]).toMatchObject({ rotation: 137, clip: { width: 10 }, children: expect.arrayContaining([expect.objectContaining({ kind: "image" })]) });
}, 15000);
it("can serialize a page containing only raster glyphs without requiring an unused font subset", async () => {
  const result = await renderScenePages([page("🔥김")], { readFontBytes: readFonts, rasterize: raster });
  expect(result.vectorText).toEqual([[]]);
  expect(result.metrics.embeddedFonts).toEqual([]);
  expect(result.metrics.graphemeImages).toMatchObject({ imageTypes: 2, imageUses: 2 });
  expect(await result.blob.text()).toContain("/SMask");
});
it.each(["arabic", "hangul-jamo", "failure", "layout"])("falls back for the entire document on %s", async mode => {
  const pages = [page("山田"), page(mode === "arabic" ? "مرحبا" : mode === "hangul-jamo" ? "\u1100\u1161" : "🔥")];
  if (mode === "layout") delete (pages[1].drawings[0] as TextLine).measureMixed;
  const fallback = vi.fn(async () => "legacy");
  expect(await withVectorFallback(async () => { await renderScenePages(pages, { readFontBytes: readFonts,
    rasterize: () => { throw new Error("代替失敗"); } }); return "vector"; }, fallback)).toBe("legacy");
  expect(fallback).toHaveBeenCalledOnce();
}, 15000);
it("cancellation during rasterization never falls back or emits a PDF", async () => {
  const c = new AbortController(), fallback = vi.fn(async () => "legacy");
  await expect(withVectorFallback(async () => { await renderScenePages([page("🔥")], { readFontBytes: readFonts, signal: c.signal,
    rasterize: (...args) => { c.abort(); return raster(...args); } }); return "vector"; }, fallback, c.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fallback).not.toHaveBeenCalled();
});
