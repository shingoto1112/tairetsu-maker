import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHbSubsetter } from "./hbSubset";
import { renderScenePages, type FontSubsetter } from "./renderer";
import { deviceGlyph, loadDeviceGlyphTable, DEVICE_BOLD_STROKE_EM } from "./deviceFont";
import { deviceToUnicodeCMap } from "./deviceFontPdf";
import { inspectTrueType } from "./trueType";
import { graphemes } from "./textRuns";
import type { GlyphRasterizer } from "./graphemeImages";
import type { ScenePage, TextLine } from "./model";

const readFonts = async (name: string) => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`));
const { instance } = await WebAssembly.instantiate(new Uint8Array(await readFile("node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm")));
const hb = createHbSubsetter(instance.exports);
const subsetFont: FontSubsetter = async (source, codes) => hb(source, codes);
// pdf.js in Node reads CMaps from a file-system path (not a file: URL).
const cMapUrl = resolve("node_modules/pdfjs-dist/cmaps").replace(/\\/g, "/") + "/";
const advances = Object.fromEntries(await Promise.all((["Regular", "Bold"] as const).map(async w => {
  const info = inspectTrueType(await readFonts(`BIZUDPGothic-${w}.ttf`));
  return [w, (code: number) => info.advance(code) * 1000 / info.unitsPerEm] as const;
})));

const text = (value: string, y: number, weight: number, align: TextLine["align"], x = 60): TextLine =>
  ({ kind: "text", text: value, x, y, size: 4.2, weight, color: "#0f766e", align });
const LINES: TextLine[] = [text("佐藤ひかる", 10, 800, "center"), text("Aiko 2列目 No.3", 20, 400, "left", 10),
  text("「みかん箱」（大）、旗。", 30, 700, "right", 190), text("トーマス・ジェファーソン", 40, 600, "center"),
  text("ｶﾀｶﾅ ①→★ 髙﨑", 50, 800, "left", 10), text("0m 5m 10m", 60, 800, "right", 190)];
const pages = (): ScenePage[] => [{ frameId: "device", width: 200, height: 100,
  drawings: [{ kind: "group", id: "lines", x: 0, y: 0, rotation: 0, children: LINES.map(l => ({ ...l })) }] }];

type Glyph = { ch: string; x: number; y: number; width: number; font: string };
/** Replays the page's operator list (pdf.js, with the CMaps) into per-glyph pen positions in page units. */
async function glyphs(blob: Blob) {
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl, cMapPacked: true, useSystemFonts: false, fontExtraProperties: true });
  try {
    const doc = await task.promise, page = await doc.getPage(1), { fnArray, argsArray } = await page.getOperatorList();
    const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    let ctm = [1, 0, 0, 1, 0, 0], tm = [1, 0, 0, 1, 0, 0], size = 0, font = "";
    const stack: number[][] = [], out: Glyph[][] = [];
    for (let i = 0; i < fnArray.length; i++) {
      const f = fnArray[i], a = argsArray[i] as never as unknown[];
      if (f === OPS.save) stack.push(ctm.slice()); else if (f === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (f === OPS.transform) ctm = mul(ctm, a as number[]);
      // pdf.js passes its own font id; the loaded font object carries the PDF BaseFont name.
      else if (f === OPS.setFont) { font = String((page.commonObjs.get(String(a[0])) as { name?: string }).name); size = Number(a[1]); }
      else if (f === OPS.setTextMatrix) tm = [...(a[0] as number[] ?? a)] as number[];
      else if (f === OPS.showText) {
        const run: Glyph[] = []; let pen = 0; const m = mul(ctm, tm);
        for (const g of a[0] as ({ unicode: string; width: number } | number)[]) {
          if (typeof g === "number") { pen -= g / 1000 * size; continue; }
          run.push({ ch: g.unicode, x: m[0] * pen + m[4], y: m[1] * pen + m[5], width: m[0] * g.width / 1000 * size, font }); pen += g.width / 1000 * size;
        }
        out.push(run);
      }
    }
    const content = await page.getTextContent();
    return { runs: out, text: content.items.flatMap(i => "str" in i ? [i.str] : []).join("") };
  } finally { await task.destroy(); }
}
const streams = async (blob: Blob) => [...Buffer.from(await blob.arrayBuffer()).toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
  .map(m => { try { return inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { return ""; } });

describe("viewer-font PDFs", () => {
  it("keeps every glyph's cell where the embedded PDF puts it, with ASCII embedded and the rest left to the viewer", async () => {
    const embedded = await renderScenePages(pages(), { readFontBytes: readFonts, subsetFont });
    const device = await renderScenePages(pages(), { readFontBytes: readFonts, subsetFont, fontMode: "device" });
    expect(device.metrics.fontAttempts).toEqual(["device"]);
    expect(device.metrics).toMatchObject({ deviceFont: true, objectStreams: false });
    expect(device.metrics.deviceCharacters).toBeGreaterThan(20);
    expect(device.blob.size).toBeLessThan(embedded.blob.size * 0.8); // this sample is ASCII-heavy
    const a = await glyphs(embedded.blob), b = await glyphs(device.blob), table = await loadDeviceGlyphTable();
    expect(b.text).toBe(a.text); // copy/search text is unchanged (ToUnicode)
    const flat = (runs: Glyph[][]) => runs.flat().filter(g => g.ch.trim());
    const ea = flat(a.runs), db = flat(b.runs);
    expect(db.map(g => g.ch).join("")).toBe(ea.map(g => g.ch).join(""));
    // The embedded reference writes integer /W widths, so inside one Tj it drifts by up to ~0.5/1000 em per glyph;
    // the device PDF restarts every run at the exact BIZ position. 0.1pt ≈ 0.035mm.
    const TOLERANCE = 0.1;
    let deviceGlyphs = 0;
    ea.forEach((e, i) => {
      const d = db[i], line = LINES.find(l => l.text.includes(e.ch))!, code = e.ch.charCodeAt(0);
      expect(Math.abs(d.y - e.y), `baseline of ${e.ch}`).toBeLessThan(TOLERANCE);
      const bizWidth = (line.weight >= 700 ? advances.Bold : advances.Regular)(code);
      const glyph = deviceGlyph(table, code, bizWidth);
      expect(d.font.includes("NotoSansCJKjp"), e.ch).toBe(!!glyph);
      if (!glyph) { expect(Math.abs(d.x - e.x), e.ch).toBeLessThan(TOLERANCE); return; }
      deviceGlyphs++;
      // The substitute em box sits inside the embedded glyph's cell: centred, or flush right/left for brackets.
      const cell = [e.x, e.x + e.width], box = [d.x, d.x + d.width];
      const expected = glyph.align === "end" ? cell[1] - box[1] : glyph.align === "start" ? cell[0] - box[0] : (cell[0] + cell[1]) / 2 - (box[0] + box[1]) / 2;
      expect(Math.abs(expected), e.ch).toBeLessThan(TOLERANCE);
    });
    expect(deviceGlyphs).toBeGreaterThan(30);
  }, 30000);

  it("writes pseudo-bold only for bold weights and attaches one shared non-embedded font", async () => {
    const result = await renderScenePages(pages(), { readFontBytes: readFonts, subsetFont, fontMode: "device", objectStreams: true });
    expect(result.metrics.objectStreams).toBe(true);
    const content = (await streams(result.blob)).filter(s => s.includes("/DJ0"));
    const blocks = content.join("\n").split("BT").slice(1);
    const bold = blocks.filter(b => /\n2 Tr\n/.test(b)), regular = blocks.filter(b => !/\n2 Tr\n/.test(b));
    expect(bold.length).toBeGreaterThan(0); expect(regular.length).toBeGreaterThan(0);
    const widths = [...content.join("\n").matchAll(/\n([\d.]+) w\n1 j\nBT\n\/DJ0 ([\d.]+) Tf/g)];
    expect(widths.length).toBe(bold.length);
    for (const [, w, size] of widths) expect(Number(w)).toBeCloseTo(Number(size) * DEVICE_BOLD_STROKE_EM, 3);
    const raw = Buffer.from(await result.blob.arrayBuffer()).toString("latin1");
    expect(raw).toContain("/ObjStm");
    expect((await glyphs(result.blob)).text.replace(/ /g, "")).toBe(LINES.map(l => l.text).join("").replace(/ /g, ""));
  }, 30000);

  it("needs no viewer font when every character stays embedded", async () => {
    const ascii: ScenePage[] = [{ frameId: "ascii", width: 100, height: 50, drawings: [text("0m 5m 10m ×※", 10, 800, "left", 5)] }];
    const result = await renderScenePages(ascii, { readFontBytes: readFonts, subsetFont, fontMode: "device" });
    expect(result.metrics).toMatchObject({ deviceFont: false, deviceCharacters: 0, fontAttempts: ["device"] });
    expect((await streams(result.blob)).some(s => s.includes("/DJ0"))).toBe(false);
  }, 30000);

  it("keeps image-drawn graphemes beside device and embedded runs", async () => {
    const png = new PNG({ width: 4, height: 4 }); png.data.fill(128);
    const dataUrl = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
    const raster: GlyphRasterizer = () => ({ dataUrl, left: -.1, top: -2.5, width: 3.2, height: 3.2, pixels: 16 });
    const value = "あお🔥AB𠮷みどり";
    const line: TextLine = { ...text(value, 10, 800, "left", 5), measureMixed: () => graphemes(value).map((t, i) => ({ text: t, x: 5 + i * 3, baseline: 10, advance: 3 })) };
    const result = await renderScenePages([{ frameId: "mixed", width: 100, height: 50, drawings: [line] }], { readFontBytes: readFonts, subsetFont, fontMode: "device", rasterize: raster });
    expect(result.metrics).toMatchObject({ deviceFont: true, fontAttempts: ["device"] });
    expect(result.metrics.graphemeImages.imageTypes).toBe(2);
    expect((await glyphs(result.blob)).text.replace(/ /g, "")).toBe("あおABみどり"); // pdf.js adds spaces at the image gaps
  }, 30000);

  it("is cancelled without retrying in another font mode", async () => {
    const controller = new AbortController(), progress: string[] = [];
    await expect(renderScenePages(pages(), { readFontBytes: readFonts, subsetFont, fontMode: "device", signal: controller.signal,
      onProgress: message => { progress.push(message); if (message.includes("ページを作成中")) controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(progress.some(m => m.includes("再作成"))).toBe(false);
  }, 30000);
});

describe("viewer-font dictionaries", () => {
  it("adds one shared Adobe-Japan1 font to every page and refuses clashes and page-count mismatches", async () => {
    const { attachDeviceFont } = await import("./deviceFontPdf");
    const { PDFDocument, PDFName, PDFDict } = await import("pdf-lib");
    const two = await renderScenePages([...pages(), { ...pages()[0], frameId: "second" }], { readFontBytes: readFonts, subsetFont, fontMode: "device" });
    const doc = await PDFDocument.load(await two.blob.arrayBuffer());
    const fonts = doc.getPages().map(p => p.node.Resources()!.lookup(PDFName.of("Font"), PDFDict));
    expect(fonts[0]).toBe(fonts[1]);
    const font = fonts[0].lookup(PDFName.of("DJ0"), PDFDict);
    expect(font.get(PDFName.of("BaseFont"))?.toString()).toBe("/NotoSansCJKjp-Regular");
    expect(font.get(PDFName.of("Encoding"))?.toString()).toBe("/UniJIS-UTF16-H");
    // An existing DJ0 or a different page count is refused (the caller then embeds fonts instead).
    const bytes = await two.blob.arrayBuffer();
    await expect(attachDeviceFont(bytes, { codes: [0x3042], pageCount: 2, objectStreams: false })).rejects.toThrow("重なります");
    await expect(attachDeviceFont(bytes, { codes: [0x3042], pageCount: 3, objectStreams: false })).rejects.toThrow("ページ数");
  }, 30000);
});

describe("viewer-font ToUnicode", () => {
  it("maps each written code to itself, splitting ranges at high-byte boundaries", () => {
    const cmap = deviceToUnicodeCMap([0x30ff, 0x3100, 0x3042, 0x3041, 0x3043, 0x6f22]);
    expect(cmap).toContain("4 beginbfrange");
    expect(cmap).toContain("<3041> <3043> <3041>");
    expect(cmap).toContain("<30FF> <30FF> <30FF>\n<3100> <3100> <3100>");
    for (const bad of [0x1f, 0xd800, 0x10000, 1.5]) expect(() => deviceToUnicodeCMap([bad])).toThrow();
  });
});
