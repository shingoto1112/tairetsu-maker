import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import pako from "pako";
import { PDFDocument, PDFName, PDFRawStream, type PDFContext, type PDFDict, type PDFRef } from "pdf-lib";
import { PNG } from "pngjs";
import { createHbSubsetter } from "./hbSubset";
import { renderScenePages, type FontSubsetter } from "./renderer";
import { recompressFlateStreams } from "./recompress";
import type { ScenePage } from "./model";

const FLATE = PDFName.of("FlateDecode");
/** Decoded bytes and the dictionary (without /Length) of every single-filter Flate stream, by reference. */
const flateStreams = (context: PDFContext) => {
  const out = new Map<string, { decoded: Uint8Array; dict: string; predictor: boolean }>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of("Filter")) !== FLATE) continue;
    const dict = object.dict.entries().filter(([k]) => k.asString() !== "/Length").map(([k, v]) => `${k}=${v}`).sort().join(" ");
    out.set(ref.toString(), { decoded: pako.inflate(object.contents), dict, predictor: dict.includes("/DecodeParms") });
  }
  return out;
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const pngImage = () => {
  const png = new PNG({ width: 24, height: 24 });
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const i = (y * 24 + x) * 4; png.data[i] = x * 10; png.data[i + 1] = y * 10; png.data[i + 2] = 128; png.data[i + 3] = (x + y) * 5;
  }
  return new Uint8Array(PNG.sync.write(png));
};
const jsPdfSample = () => {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (let i = 0; i < 3; i++) {
    if (i) pdf.addPage();
    for (let k = 0; k < 40; k++) { pdf.circle(20 + k * 4, 40 + i * 5, 1.5, "F"); pdf.rect(10 + k, 100, 2, 3); }
    pdf.text(`Scene ${i + 1} 0m 1m 2m 3m`, 10, 20);
    pdf.addImage(pngImage(), "PNG", 10, 150, 20, 20);
  }
  return pdf.output("arraybuffer");
};

it("re-encodes jsPDF's Flate streams smaller without changing one decoded byte, under the same references", async () => {
  const bytes = jsPdfSample(), doc = await PDFDocument.load(bytes);
  const before = flateStreams(doc.context);
  expect([...before.values()].some(s => s.predictor)).toBe(true); // a PNG image with a predictor is included
  const result = await recompressFlateStreams(doc);
  expect(result.replaced).toBeGreaterThan(0);
  expect(result.savedBytes).toBeGreaterThan(0);
  const after = flateStreams(doc.context);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [ref, stream] of before) {
    expect(same(after.get(ref)!.decoded, stream.decoded)).toBe(true);
    expect(after.get(ref)!.dict).toBe(stream.dict);
  }
  // The saved file carries the new /Length values and reads back to the same decoded bytes.
  const saved = await doc.save({ useObjectStreams: true }), again = await PDFDocument.load(saved);
  expect(again.getPageCount()).toBe(3);
  const reread = flateStreams(again.context);
  for (const [ref, stream] of before) expect(same(reread.get(ref)!.decoded, stream.decoded)).toBe(true);
  const unchanged = await (await PDFDocument.load(bytes)).save({ useObjectStreams: true });
  expect(saved.byteLength).toBeLessThan(unchanged.byteLength);
});

it("leaves other filters, chained filters, broken and already optimal data exactly as they are", async () => {
  const doc = await PDFDocument.create(), context = doc.context;
  const text = new TextEncoder().encode("0 0 m 10 10 l S\n".repeat(200));
  const add = (dict: Record<string, unknown>, data: Uint8Array) =>
    context.register(PDFRawStream.of(context.obj(dict as never) as unknown as PDFDict, data));
  const refs = [
    add({ Filter: "ASCIIHexDecode" }, new TextEncoder().encode("41424344>")),
    add({ Filter: [FLATE] }, pako.deflate(text, { level: 1 })),
    add({ Filter: "FlateDecode" }, new Uint8Array([1, 2, 3, 4, 5])),
    add({ Filter: "FlateDecode" }, pako.deflate(text, { level: 9 })),
    add({}, text),
  ];
  const objects = refs.map(ref => context.lookup(ref));
  const result = await recompressFlateStreams(doc);
  expect(result).toEqual({ replaced: 0, savedBytes: 0 });
  refs.forEach((ref, i) => expect(context.lookup(ref)).toBe(objects[i]));
});

it("keeps a shared stream shared: both users still point at the same, re-encoded object", async () => {
  const doc = await PDFDocument.create(), context = doc.context;
  const text = new TextEncoder().encode("q 1 0 0 1 5 5 cm /X Do Q\n".repeat(300));
  const shared = context.register(PDFRawStream.of(context.obj({ Filter: "FlateDecode" }), pako.deflate(text, { level: 1 })));
  const users = [context.obj({ Form: shared }), context.obj({ Form: shared })] as PDFDict[];
  const original = context.lookup(shared);
  expect((await recompressFlateStreams(doc)).replaced).toBe(1);
  for (const user of users) expect(user.get(PDFName.of("Form"))).toBe(shared as PDFRef);
  const now = context.lookup(shared);
  expect(now).not.toBe(original);
  expect(same(pako.inflate((now as PDFRawStream).contents), text)).toBe(true);
});

it("stops at once when cancelled and yields to the page between streams", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(recompressFlateStreams(await PDFDocument.load(jsPdfSample()), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  const timer = vi.spyOn(globalThis, "setTimeout");
  try {
    await recompressFlateStreams(await PDFDocument.load(jsPdfSample()), undefined, 0);
    expect(timer).toHaveBeenCalled();
  } finally { timer.mockRestore(); }
});

describe("finished exports are already at zlib's best", () => {
  const readFonts = async (name: string) => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`));
  const pages = (): ScenePage[] => [1, 2].map(n => ({ frameId: `p${n}`, width: 200, height: 100, drawings: [
    ...Array.from({ length: 30 }, (_, i) => ({ kind: "shape" as const, x: 10 + i * 6, y: 40, width: 4, height: 4, radius: 2, fill: "#38bdf8" })),
    { kind: "text" as const, text: `シーン${n} あおい 0m 5m`, x: 20, y: 20, size: 4.2, weight: 700, color: "#0f766e", align: "left" as const },
  ] }));
  it.each(["device", "subset"] as const)("%s fonts: re-running the step finds almost nothing left to save", async fontMode => {
    const { instance } = await WebAssembly.instantiate(new Uint8Array(await readFile("node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm")));
    const hb = createHbSubsetter(instance.exports);
    const subsetFont: FontSubsetter = async (source, codes) => hb(source, codes);
    const result = await renderScenePages(pages(), { readFontBytes: readFonts, subsetFont, fontMode, objectStreams: true });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const doc = await PDFDocument.load(bytes);
    expect(flateStreams(doc.context).size).toBeGreaterThan(0);
    // Only pdf-lib's own small streams (e.g. the viewer-font ToUnicode) may still shrink slightly.
    const again = await recompressFlateStreams(doc);
    expect(again.savedBytes).toBeLessThan(bytes.byteLength * 0.01);
    expect(doc.getPageCount()).toBe(2);
  }, 30000);
});
