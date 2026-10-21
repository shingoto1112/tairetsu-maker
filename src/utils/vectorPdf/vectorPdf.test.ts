import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { buildScenePage, visibleTextLines, type Drawing, type TextLine } from "./model";
import { vectorPdfFixture } from "./fixture";
import { FONT_FAMILY, FONT_VERSION, fetchFontBytes, registerFonts, unsupportedCharacters, type FontBytesReader } from "./fonts";
import { renderScenePages } from "./renderer";
import { createVectorPdfPrototype } from "./index";
import { createStageExportView } from "../stageExportView";
import { getPrintMetrics, defaultPrintOptions, getPrintMemberLabelFontSizeMm } from "../../components/PrintPreview";
import { splitMemberLabel } from "../memberLabel";

// Resolve from repository root on Windows and POSIX without importing Node into product code.
const readFonts: FontBytesReader = async name => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`));
const propText = (name: string): TextLine[] => [{ kind: "text", text: name, x: 0, y: 0, size: 3, weight: 800, color: "#172033" }];
const find = (nodes: Drawing[], id: string): Extract<Drawing, { kind: "group" }> => {
  for (const node of nodes) if (node.kind === "group") {
    if (node.id === id) return node;
    try { return find(node.children, id); } catch { /* next sibling */ }
  }
  throw new Error(`missing ${id}`);
};

it("reads only versioned same-origin public assets on demand with the caller's cancellation signal", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetcher);
  try {
    const signal = new AbortController().signal;
    expect(await fetchFontBytes("BIZUDPGothic-Regular.ttf", signal)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetcher).toHaveBeenCalledWith(`/fonts/biz-udp-gothic/BIZUDPGothic-Regular.ttf?v=${FONT_VERSION}`,
      { signal, cache: "force-cache" });
  } finally { vi.unstubAllGlobals(); }
});

it.each(["audience", "performer"] as const)("reuses PrintPreview coordinates, grids, names and rotations (%s)", perspective => {
  const p = vectorPdfFixture(9.3, 5.4), frame = p.frames[0];
  const before = JSON.stringify(p);
  const page = buildScenePage(p, frame.id, { viewerPerspective: perspective }, propText);
  const m = getPrintMetrics(p, [frame], defaultPrintOptions).mmPerMeter;
  const view = createStageExportView(p.stage, p.stage, perspective);
  const stage = find(page.drawings, "stage");
  expect(stage.clip).toBeUndefined();
  for (const member of p.members) {
    const node = find(stage.children, member.id), point = view.point(frame.positions[member.id]);
    expect(node.x).toBeCloseTo(point.x * m); expect(node.y).toBeCloseTo(point.y * m);
    const labels = visibleTextLines(node.children), lines = splitMemberLabel(member.name);
    expect(labels.map(l => l.text)).toEqual(lines);
    expect(labels[0].size).toBe(getPrintMemberLabelFontSizeMm(.5 * m, lines));
  }
  const prop = find(stage.children, "panel"), state = view.object(frame.objectStates.panel);
  expect(prop.x).toBeCloseTo((state.x + state.widthMeters / 2) * m);
  expect(prop.y).toBeCloseTo((state.y + state.heightMeters / 2) * m);
  expect(prop.rotation).toBe(137);
  expect(find(stage.children, "panel-label").rotation + prop.rotation).toBe(-43);
  const annotation = find(stage.children, "annotations");
  expect(annotation.clip?.width).toBeCloseTo(9.3 * m);
  const line = annotation.children[0];
  expect(line.kind).toBe("line");
  if (line.kind === "line") {
    expect(line.x1).toBeCloseTo(view.x(-1) * m); expect(line.x2).toBeCloseTo(view.x(10.3) * m);
    expect(line.dash).toHaveLength(2);
  }
  for (const grid of view.verticalGrid(.5, true)) expect(stage.children.some(d => d.kind === "line" && Math.abs(d.y1 - grid.positionMeters * m) < 1e-7)).toBe(true);
  expect(JSON.stringify(p)).toBe(before);
});

it("does not embed hidden, assigned, omitted names or fully clipped prop text", () => {
  const p = vectorPdfFixture(); p.members[0].name = "𠮷"; p.members[0].visible = false;
  p.frames[0].objectAssignments = { panel: ["m1"] };
  const page = buildScenePage(p, "s0", { includeSceneName: false }, () => []);
  expect(visibleTextLines(page.drawings).map(l => l.text).join("")).not.toContain("𠮷");
  expect(() => find(page.drawings, "m1")).toThrow();
  expect(visibleTextLines(page.drawings)[0].text).toBe("シーン1");
});

it("matches CSS four-character line gap, border inset, opacity and measured page extent", () => {
  const p = vectorPdfFixture();
  const extent = { width: 278.6, height: 186.2 };
  const page = buildScenePage(p, "s0", {}, propText, extent);
  expect({ width: page.width, height: page.height }).toEqual(extent);
  const label = visibleTextLines(find(page.drawings, "m3").children);
  expect(label[1].y - label[0].y).toBeCloseTo(label[0].size * .9);
  const shape = find(page.drawings, "panel").children[0];
  expect(shape.kind).toBe("shape");
  if (shape.kind === "shape") {
    expect(shape.opacity).toBe(0x24 / 255);
    expect(shape.lineWidth).toBeCloseTo(25.4 / 96);
  }
  expect(find(page.drawings, "panel-label").clip).toBeUndefined();
  expect(() => find(page.drawings, "panel-clip")).toThrow();
  expect(() => buildScenePage(p, "s0", {}, propText, { width: NaN, height: 10 })).toThrow();
});

it("validates actual cmap in both weights and rejects supplementary/marks/variation selectors", async () => {
  const pdf = new jsPDF(); await registerFonts(pdf, readFonts);
  const line = (text: string, weight = 800): TextLine => ({ kind: "text", text, x: 0, y: 0, size: 3, weight, color: "#000000" });
  expect(unsupportedCharacters(pdf, [line("髙﨑 日本語 abc"), line("日本語", 600)])).toEqual([]);
  expect(unsupportedCharacters(pdf, [line("𠮷😀葛\u{e0100}か\u3099a\u0301\ufe0f")])).toEqual(expect.arrayContaining(["𠮷", "😀", "\u{e0100}", "\u3099", "\u0301", "\ufe0f"]));
});

it("writes real compressed FontFile2/ToUnicode PDFs within a 400KiB prototype budget", async () => {
  const p = vectorPdfFixture(), page = buildScenePage(p, "s0", { viewerPerspective: "performer" }, propText);
  page.drawings.push({ kind: "text", text: "Regular確認", x: 10, y: 8, size: 2, weight: 600, color: "#000000" });
  const result = await renderScenePages([page], { readFontBytes: readFonts });
  expect(result.blob.size).toBeLessThan(400 * 1024);
  expect(result.metrics.embeddedFonts).toHaveLength(2);
  expect(result.metrics.embeddedFonts.every(f => f.compressedBytes > 1000)).toBe(true);
  const raw = await result.blob.text();
  expect(raw).toContain("/FontFile2"); expect(raw).toContain("/ToUnicode"); expect(raw).not.toContain("/Subtype /Image");
}, 15000);

it("serializes correctly anchored text in advanced mode with actual embedded glyph advances", async () => {
  const pdf = new jsPDF(); await registerFonts(pdf, readFonts); pdf.setFont(FONT_FAMILY, "bold");
  const advance = pdf.getStringUnitWidth("あお", { doKerning: false }) * 4;
  const result = await renderScenePages([{ frameId: "anchor", width: 100, height: 80,
    drawings: (["left", "center", "right"] as const).map(align => ({ kind: "text", text: "あお", x: 40, y: 20,
      size: 4, weight: 800, color: "#000000", align })) }], { readFontBytes: readFonts });
  const raw = Buffer.from(await result.blob.arrayBuffer()).toString("latin1");
  const streams = [...raw.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs)]
    .flatMap(match => { try { return [inflateSync(Buffer.from(match[2], "latin1")).toString("latin1")]; } catch { return []; } });
  const content = streams.find(s => s.includes(" Tm\n"))!;
  expect(content).toBeDefined();
  const anchors = [...content.matchAll(/1\. 0\. 0\. -1\. ([\d.-]+) [\d.-]+ Tm/g)].map(m => Number(m[1]));
  expect(anchors).toHaveLength(3);
  [40, 40 - advance / 2, 40 - advance].forEach((x, i) => expect(anchors[i]).toBeCloseTo(x, 4));
}, 15000);

it("falls back for the whole document on unsupported layouts, glyphs and font failure", async () => {
  for (const mode of ["glyph", "parade", "assignments", "pages", "font"] as const) {
    const p = vectorPdfFixture();
    if (mode === "glyph") p.members[0].name = "𠮷";
    if (mode === "parade") p.mode = "parade";
    const fallback = vi.fn(async () => new Blob(["legacy"]));
    const result = await createVectorPdfPrototype({ project: p, frameIds: mode === "pages" ? ["s0", "s1"] : ["s0"],
      options: { includeAssignments: mode === "assignments" }, propText,
      readFontBytes: mode === "font" ? async () => { throw new Error("offline failure"); } : readFonts, fallback });
    expect(result.mode).toBe("image"); expect(await result.blob.text()).toBe("legacy"); expect(fallback).toHaveBeenCalledOnce();
  }
}, 15000);

it("never falls back after cancellation, including cancellation during font loading", async () => {
  for (const duringLoad of [false, true]) {
    const controller = new AbortController(), fallback = vi.fn(async () => new Blob());
    if (!duringLoad) controller.abort();
    await expect(createVectorPdfPrototype({ project: vectorPdfFixture(), frameIds: ["s0"], propText,
      signal: controller.signal, fallback, readFontBytes: async name => { controller.abort(); return readFonts(name); },
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fallback).not.toHaveBeenCalled();
  }
});

it("propagates AbortError from a reader even across realms without image fallback", async () => {
  const fallback = vi.fn(async () => new Blob());
  await expect(createVectorPdfPrototype({ project: vectorPdfFixture(), frameIds: ["s0"], propText, fallback,
    readFontBytes: async () => { throw { name: "AbortError" }; },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(fallback).not.toHaveBeenCalled();
});

it("rejects corrupt source TTF before jsPDF can swallow a parser error", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await createVectorPdfPrototype({ project: vectorPdfFixture(), frameIds: ["s0"], propText,
      fallback: async () => new Blob(["legacy"]), readFontBytes: async () => new Uint8Array([0, 1, 2]),
    });
    expect(result.mode).toBe("image");
    expect(logged).not.toHaveBeenCalled();
  } finally { logged.mockRestore(); }
});
