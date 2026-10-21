import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { createHbSubsetter } from "./hbSubset";
import { renderScenePages, type FontSubsetter } from "./renderer";
import type { ScenePage } from "./model";

// The viewer font cannot be attached (pdf-lib failure, unexpected structure, …): the document must be rebuilt
// with embedded fonts, never delivered with an undefined /DJ0 font.
vi.mock("./deviceFontPdf", async original => ({ ...await original<typeof import("./deviceFontPdf")>(),
  attachDeviceFont: vi.fn(async () => { throw new Error("injected attach failure"); }) }));

const readFonts = async (name: string) => new Uint8Array(await readFile(`public/fonts/biz-udp-gothic/${name}`));
const { instance } = await WebAssembly.instantiate(new Uint8Array(await readFile("node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm")));
const hb = createHbSubsetter(instance.exports);
const subsetFont: FontSubsetter = async (source, codes) => hb(source, codes);
const pages: ScenePage[] = [{ frameId: "fallback", width: 100, height: 50,
  drawings: [{ kind: "text", text: "佐藤ひかる 2列目", x: 10, y: 10, size: 4, weight: 800, color: "#111827", align: "left" }] }];

it("rebuilds with embedded fonts when the viewer font cannot be attached", async () => {
  const progress: string[] = [];
  const result = await renderScenePages(pages, { readFontBytes: readFonts, subsetFont, fontMode: "device", objectStreams: true, onProgress: m => progress.push(m) });
  expect(result.metrics.fontAttempts).toEqual(["device", "subset"]);
  expect(result.metrics.retryReason).toContain("injected attach failure");
  expect(result.metrics).toMatchObject({ deviceFont: false, deviceCharacters: 0 });
  expect(progress).toContain("フォントを入れてPDFを再作成中");
  const raw = Buffer.from(await result.blob.arrayBuffer()).toString("latin1");
  const content = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(m => { try { return inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { return ""; } }).join("\n");
  expect(content).not.toContain("/DJ0");
  expect(result.metrics.embeddedFonts).toHaveLength(1);
}, 30000);
