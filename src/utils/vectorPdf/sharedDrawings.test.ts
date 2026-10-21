import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { countSharedDrawings, renderScenePages } from "./renderer";
import type { Drawing, ScenePage } from "./model";

const background = (width: number, opacity?: number): Drawing => ({ kind: "group", id: "stage-background", x: 0, y: 0, rotation: 0, reuse: true,
  children: [{ kind: "shape", x: 0, y: 0, width, height: 40, fill: "#ffffff", stroke: "#94a3b8", lineWidth: .26 },
    { kind: "line", x1: 10, y1: 0, x2: 10, y2: 40, color: "#e2e8f0", width: .26, opacity }] });
const page = (width: number, opacity?: number): ScenePage => ({ frameId: `p${width}`, width: 120, height: 80,
  drawings: [{ kind: "group", id: "stage", x: 10, y: 10, rotation: 0, children: [background(width, opacity),
    { kind: "line", x1: width / 2, y1: 0, x2: width / 2, y2: 40, color: "#0d8b78", width: .4, opacity: .45 }] }] });
const streams = (raw: string) => [...raw.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs)]
  .map(m => ({ dict: m[1], text: (() => { try { return inflateSync(Buffer.from(m[2], "latin1")).toString("latin1"); } catch { return m[2]; } })() }));

it("counts only opaque, untransformed reuse groups", () => {
  expect([...countSharedDrawings([page(80), page(80), page(60)], false).counts.values()].sort()).toEqual([1, 2]);
  expect(countSharedDrawings([page(80, .5), page(80, .5)], false).counts.size).toBe(0);
});

it("writes a background used twice once as a Form XObject and draws single uses inline", async () => {
  const result = await renderScenePages([page(80), page(80), page(60)]);
  const raw = Buffer.from(await result.blob.arrayBuffer()).toString("latin1");
  const all = streams(raw), forms = all.filter(s => /\/Subtype \/Form/.test(s.dict));
  expect(forms).toHaveLength(1);
  expect(forms[0].dict).toMatch(/\/BBox \[/);
  // The form carries geometry and colour only: no graphics-state or font resources needed.
  expect(forms[0].text).not.toMatch(/ gs\b| Tf\b/);
  expect(forms[0].text).toMatch(/ re\n|\bm\n/);
  const pages = all.filter(s => !/\/Subtype/.test(s.dict) && /( re| m| Do)\n/.test(s.text));
  expect(pages.filter(p => /\/Xo1 Do/.test(p.text))).toHaveLength(2);
  // The 60mm background (used once) and the semi-transparent centre lines stay inline.
  expect(pages.filter(p => / 60 40 re|60 0 m|0 60 /.test(p.text) || !/\/Xo1 Do/.test(p.text))).toHaveLength(1);
  expect(pages.every(p => / gs\n/.test(p.text))).toBe(true);
  expect(raw).toMatch(/\/XObject <<\s*\/Xo1 \d+ 0 R/);
}, 15000);

it("shares a member circle path only when one radius is used often enough", async () => {
  const members = (count: number): ScenePage => ({ frameId: `m${count}`, width: 120, height: 80, drawings: Array.from({ length: count }, (_, i): Drawing => ({
    kind: "group", id: `m${i}`, x: 5 + i % 20 * 5, y: 5 + Math.floor(i / 20) * 5, rotation: 0,
    children: [{ kind: "shape", x: -2, y: -2, width: 4, height: 4, radius: 2, fill: i % 2 ? "#38bdf8" : "#f43f5e" }] })) });
  const forms = async (pages: ScenePage[]) => (Buffer.from(await (await renderScenePages(pages)).blob.arrayBuffer()).toString("latin1").match(/\/Subtype \/Form/g) ?? []).length;
  expect(await forms([members(30)])).toBe(0);
  expect(await forms([members(120), members(120)])).toBe(1);
}, 20000);

it("rebuilds the same document without forms when nothing repeats", async () => {
  const raw = Buffer.from(await (await renderScenePages([page(80)])).blob.arrayBuffer()).toString("latin1");
  expect(raw).not.toContain("/Subtype /Form");
}, 15000);
