import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRanges, DEVICE_SPACE_WIDTH, deviceGlyph, deviceTjArray, loadDeviceGlyphTable, pdfNumber, planDeviceRuns } from "./deviceFont";
import { DEVICE_GLYPH_SOURCE } from "./deviceGlyphs.generated";
import { inspectTrueType } from "./trueType";

const biz = (weight: "Regular" | "Bold") => {
  const info = inspectTrueType(new Uint8Array(readFileSync(`public/fonts/biz-udp-gothic/BIZUDPGothic-${weight}.ttf`)));
  return (code: number) => info.advance(code) * 1000 / info.unitsPerEm;
};
const regular = biz("Regular"), bold = biz("Bold");

describe("device glyph table", () => {
  it("decodes range lists and rejects corrupt ones", () => {
    expect([...decodeRanges("a.2,3.0")]).toEqual([10, 12, 15, 15]);
    expect(decodeRanges("").length).toBe(0);
    expect(() => decodeRanges("a.2,0.1")).toThrow();
    expect(() => decodeRanges("zzzz.0")).toThrow();
  });

  it("is generated from the pinned pdfjs-dist CMap", async () => {
    const pkg = JSON.parse(readFileSync("node_modules/pdfjs-dist/package.json", "utf8"));
    expect(DEVICE_GLYPH_SOURCE.pdfjsDist).toBe(pkg.version);
    const table = await loadDeviceGlyphTable();
    expect(table.counts.wide).toBeGreaterThan(13000);
  });

  it("classifies kana, kanji, brackets, symbols and half-width kana; leaves Latin embedded", async () => {
    const table = await loadDeviceGlyphTable(), g = (ch: string, advance = 1000) => deviceGlyph(table, ch.charCodeAt(0), advance);
    for (const ch of "あアー・髙﨑漢々〆ヶ０Ａ㈱〜～") expect(g(ch, 900)).toEqual({ em: 1000, align: "center" });
    for (const ch of "「『（【") expect(g(ch, 500)?.align).toBe("end");
    for (const ch of "」』）】、。，．") expect(g(ch, 500)?.align).toBe("start");
    for (const ch of "①Ⅱ→★♪♡℃") { expect(g(ch, 1000)).toEqual({ em: 1000, align: "center" }); expect(g(ch, 800)).toBeUndefined(); }
    expect(g("ｱ", 500)).toEqual({ em: 500, align: "center" });
    for (const ch of "Aa0 -.×※…“é") expect(g(ch, 500)).toBeUndefined();
    expect(g("あ", 0)).toBeUndefined();
  });
});

describe("device runs and placement", () => {
  it("splits a line into embedded (ASCII) and device runs with BIZ positions", async () => {
    const table = await loadDeviceGlyphTable();
    const runs = planDeviceRuns(table, "Aiko佐藤2列目", regular);
    expect(runs.map(r => [r.text, r.device])).toEqual([["Aiko", false], ["佐藤", true], ["2", false], ["列目", true]]);
    let position = 0;
    for (const r of runs) { expect(r.start).toBeCloseTo(position, 9); position += [...r.text].reduce((n, ch) => n + regular(ch.charCodeAt(0)), 0); }
    expect(() => planDeviceRuns(table, "𠮷", regular)).toThrow();
    // An ASCII space joins the run before it.
    expect(planDeviceRuns(table, "高橋 あかね", regular).map(r => [r.text, r.device])).toEqual([["高橋 あかね", true]]);
    expect(planDeviceRuns(table, "Aiko Sato", regular).map(r => [r.text, r.device])).toEqual([["Aiko Sato", false]]);
    expect(planDeviceRuns(table, "2列目 No.3", regular).map(r => [r.text, r.device])).toEqual([["2", false], ["列目 ", true], ["No.3", false]]);
  });

  it("places every substitute em box inside its BIZ advance (centre / opening / closing)", async () => {
    const table = await loadDeviceGlyphTable();
    for (const [text, advance] of [["トーマス・ジェファーソン", regular], ["「みかん箱」（大）、旗。", bold], ["ｶﾀｶﾅﾃｽﾄｼｮｯﾌﾟ", regular], ["漢字だけ", bold], ["高橋 あかね", bold]] as const) {
      const { lead, operand } = deviceTjArray(table, text, advance);
      // Replay the TJ operand: strings advance by each glyph's em, numbers move the pen left.
      const tokens = operand.slice(1, -1).match(/<[0-9A-F]+>|-?\d+(?:\.\d+)?/g)!;
      const boxes: number[] = []; let pen = -lead;
      for (const t of tokens) {
        if (t.startsWith("<")) for (let i = 1; i < t.length - 1; i += 4) {
          const code = parseInt(t.slice(i, i + 4), 16); boxes.push(pen); pen += code === 0x20 ? DEVICE_SPACE_WIDTH : deviceGlyph(table, code, advance(code))!.em;
        } else pen -= Number(t);
      }
      let start = 0;
      [...text].forEach((ch, i) => {
        const code = ch.charCodeAt(0), w = advance(code), glyph = code === 0x20 ? { em: DEVICE_SPACE_WIDTH, align: "center" } : deviceGlyph(table, code, w)!;
        const extra = glyph.em - w, expected = start - (glyph.align === "end" ? extra : glyph.align === "start" ? 0 : extra / 2);
        expect(Math.abs(boxes[i] - expected)).toBeLessThanOrEqual(0.51); // whole thousandths of an em, no drift
        start += w;
      });
    }
  });

  it("writes only finite fixed-point numbers", () => {
    expect(pdfNumber(1e-7, 5)).toBe("0");
    expect(pdfNumber(-0.000001, 5)).toBe("0");
    expect(pdfNumber(12.3456789, 5)).toBe("12.34568");
    expect(pdfNumber(4.2, 5)).toBe("4.2");
    for (const bad of [NaN, Infinity, -Infinity, 1e12]) expect(() => pdfNumber(bad, 5)).toThrow();
  });

  it("writes plain strings when no correction is needed", async () => {
    const table = await loadDeviceGlyphTable();
    expect(deviceTjArray(table, "漢字", regular)).toEqual({ lead: 0, operand: "[<6F225B57>]" });
    const kana = deviceTjArray(table, "ト", regular);
    expect(kana.operand).toBe("[<30C8>]");
    expect(kana.lead).toBeCloseTo((1000 - regular(0x30c8)) / 2, 9);
    expect(() => deviceTjArray(table, "AB", regular)).toThrow();
  });
});
