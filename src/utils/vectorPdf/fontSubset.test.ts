import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHbSubsetter, instantiateHbResponse, REQUIRED_HB_EXPORTS } from "./hbSubset";
import { inspectTrueType, sourceTrueType, validateSubset } from "./trueType";
import { fontFileName, type FontWeight } from "./fonts";
import { renderScenePages, type FontSubsetter } from "./renderer";
import type { ScenePage, TextLine } from "./model";

const readFonts = async (name: string) => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`));
const wasm = new Uint8Array(await readFile("node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm"));
const { instance } = await WebAssembly.instantiate(wasm);
const subset = createHbSubsetter(instance.exports);
const subsetFont: FontSubsetter = async (source, codes) => subset(source, codes);
const text = "空白 半角ABC123 全角ＡＢ１２　記号！？・髙﨑漢字かなカナéÅ";
const codes = [...new Set([...text].map(c => c.charCodeAt(0)))];
const line = (text: string, weight = 800): TextLine => ({ kind: "text", text, weight, x: 10, y: 20, size: 3, color: "#000000", align: "left" });
const pages = (value = "日本語 ABC　空白"): ScenePage[] => [{ frameId: "subset", width: 200, height: 100, drawings: [line(value), { ...line(value, 400), y: 30 }] }];
async function extract(blob: Blob) {
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false });
  try { return (await (await (await task.promise).getPage(1)).getTextContent()).items.flatMap(i => "str" in i ? [i.str] : []); }
  finally { await task.destroy(); }
}

it("pins the actual harfbuzzjs version and required WASM exports", async () => {
  expect(JSON.parse(await readFile("node_modules/harfbuzzjs/package.json", "utf8")).version).toBe("1.6.3");
  expect(Object.keys(instance.exports)).toEqual(expect.arrayContaining(REQUIRED_HB_EXPORTS));
  expect(() => createHbSubsetter({})).toThrow("ABI");
});
it.each(["bold", "normal"] as FontWeight[])("preserves BMP cmap, advances, .notdef/composites and pdfjs extraction (%s)", async weight => {
  const source = await readFonts(fontFileName(weight)), info = sourceTrueType(source), before = source.slice();
  const bytes = subset(source, codes), result = validateSubset(info, bytes, codes);
  expect(Buffer.compare(source, before)).toBe(0); // no cached source buffer mutation/detachment
  expect(bytes.length).toBeLessThan(30_000);
  expect(result.glyphCount).toBeGreaterThanOrEqual(codes.length + 1);
  expect(result.glyphCount).toBeLessThan(codes.length + 20); // composite dependencies, not retain-gids
  for (const code of codes) { expect(result.glyph(code)).toBeGreaterThan(0); expect(result.advance(code)).toBe(info.advance(code)); }
  expect(result.tableTags).not.toEqual(expect.arrayContaining(["GSUB"]));
  for (const tag of ["GSUB", "GPOS", "vhea", "vmtx", "gasp", "DSIG", "fpgm", "prep", "cvt "]) expect(result.tableTags).not.toContain(tag);
  expect(result.tableTags).toContain("name");
  // A later allocation/subset must not detach or overwrite the returned copy.
  const copy = bytes.slice(); subset(source, [65]); expect(bytes).toEqual(copy);
  const rendered = await renderScenePages([{ ...pages()[0], drawings: [line(text, weight === "bold" ? 800 : 400)] }], { readFontBytes: readFonts, subsetFont });
  expect(rendered.metrics.fontAttempts).toEqual(["subset"]);
  // pdfjs canonicalizes U+3000 to ASCII space in getTextContent. cmap/advance
  // and the renderer's ToUnicode checks above still validate the original code.
  expect((await extract(rendered.blob)).join("")).toBe(text.replace(/　/g, " "));
  const original = await renderScenePages([{ ...pages()[0], drawings: [line(text, weight === "bold" ? 800 : 400)] }], { readFontBytes: readFonts, fontMode: "original" });
  expect(await extract(rendered.blob)).toEqual(await extract(original.blob));
  expect(rendered.blob.size).toBeLessThan(original.blob.size / 2);
}, 15000);
it("falls back from streaming MIME rejection to ArrayBuffer", async () => {
  const stream = vi.spyOn(WebAssembly, "instantiateStreaming").mockRejectedValueOnce(new TypeError("MIME"));
  try { expect(Object.keys(await instantiateHbResponse(new Response(wasm)))).toEqual(expect.arrayContaining(REQUIRED_HB_EXPORTS)); }
  finally { stream.mockRestore(); }
  await expect(instantiateHbResponse(new Response("offline", { status: 503 }))).rejects.toThrow("503");
});
it.each(["load", "corrupt-output", "corrupt-ttf", "missing-code"])("recreates a VECTOR PDF from original fonts after %s", async failure => {
  const injected: FontSubsetter = vi.fn(async (source: Uint8Array, requested: readonly number[]) => {
    if (failure === "load") throw new Error("WASM load failure");
    if (failure === "corrupt-output") return new Uint8Array([0, 1, 2]);
    if (failure === "corrupt-ttf") return subset(new Uint8Array([0, 1, 2]), requested);
    return subset(source, requested.filter(c => c !== "日".charCodeAt(0)));
  });
  const result = await renderScenePages(pages(), { readFontBytes: readFonts, subsetFont: injected });
  expect(result.metrics.fontAttempts).toEqual(["subset", "original"]);
  expect(result.metrics.retryReason).toBeTruthy();
  expect(result.metrics.graphemeImages.imageUses).toBe(0); // collection bug cannot hide as raster
  expect(result.metrics.embeddedFonts).toHaveLength(2);
  expect((await extract(result.blob)).join("")).toBe("日本語 ABC 空白日本語 ABC 空白");
}, 15000);
it.each(["addFont", "text", "serialization", "ToUnicode"])("discards the first jsPDF on %s failure", async phase => {
  const instances: jsPDF[] = [];
  const hook: [string, (this: jsPDF) => void] = ["initialized", function () {
    instances.push(this); if (instances.length !== 1) return;
    if (phase === "addFont") this.addFont = () => { throw new Error("addFont injected"); };
    if (phase === "text") this.text = () => { throw new Error("draw injected"); };
    if (phase === "serialization") this.output = (() => new ArrayBuffer(0)) as unknown as typeof this.output;
    if (phase === "ToUnicode") {
      const output = this.output;
      this.output = ((...args: Parameters<typeof output>) => {
        const bytes = output.apply(this, args);
        const font = this.getFont().metadata as unknown as { toUnicode: Record<number, number> };
        font.toUnicode = {}; return bytes;
      }) as typeof output;
    }
  }];
  const events = jsPDF.API.events as unknown as typeof hook[]; events.push(hook);
  try {
    const result = await renderScenePages(pages(), { readFontBytes: readFonts, subsetFont });
    expect(instances).toHaveLength(2); expect(instances[0]).not.toBe(instances[1]);
    expect(result.metrics.fontAttempts).toEqual(["subset", "original"]);
    expect((await extract(result.blob)).join("")).toBe("日本語 ABC 空白日本語 ABC 空白");
  } finally { events.splice(events.indexOf(hook), 1); }
}, 15000);
it("isolates consecutive documents, both weights and character collections", async () => {
  const spy = vi.fn(subsetFont);
  for (const value of ["山田 A", "別人Ｂ", "山田 A"]) {
    const result = await renderScenePages(pages(value), { readFontBytes: readFonts, subsetFont: spy });
    expect(result.metrics.fontAttempts).toEqual(["subset"]); expect(await extract(result.blob)).toEqual([value, value]);
  }
  expect(spy).toHaveBeenCalledTimes(6);
});
it("does not retry cancellation before, during or immediately after synchronous subsetting", async () => {
  for (const phase of ["before", "during", "after", "abort-error"]) {
    const c = new AbortController(), progress = vi.fn(); if (phase === "before") c.abort();
    const injected = vi.fn(async (source: Uint8Array, requested: readonly number[]) => {
      if (phase === "during") { c.abort(); throw new Error("cancelled WASM"); }
      if (phase === "abort-error") throw new DOMException("cancel", "AbortError");
      const bytes = subset(source, requested); c.abort(); return bytes;
    });
    await expect(renderScenePages(pages(), { readFontBytes: readFonts, subsetFont: injected, signal: c.signal, onProgress: progress })).rejects.toMatchObject({ name: "AbortError" });
    expect(progress.mock.calls.flat().join("")).not.toContain("再作成");
    expect(injected).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
  }
});
it("rejects corrupted original TTF, non-TTF and non-BMP requests", () => {
  expect(() => inspectTrueType(new Uint8Array([0, 1, 2]))).toThrow();
  expect(() => subset(new Uint8Array(20), [65])).toThrow("TrueType");
});
