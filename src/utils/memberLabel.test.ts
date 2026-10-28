import { describe, expect, it, vi } from "vitest";
import { estimateMemberLabelWidthEm, getMemberLabelClassName, getMemberLabelFontSize, getMemberLabelVariant, memberLabelCharacters, memberLabelFitLimit, MEMBER_LABEL_INK_HEIGHT_EM, MEMBER_LONG_LABEL_LINE_HEIGHT, splitMemberLabel } from "./memberLabel";
import { estimateExportMemberLabelInkWidthEm, exportMemberLabelFitLimit, exportMemberLabelLineHeightEm, fitExportMemberLabelFontSize } from "./memberLabel";
import { defaultPrintOptions, getPrintMemberLabelFontSizeMm, getPrintMetrics } from "./printLayout";
import { formationExportFixture } from "./formationExportFixture";

describe("deterministic member name text", () => {
  it.each([
    ["あ", ["あ"], "one"], ["あい", ["あい"], "two"], ["男右1", ["男右1"], "three"],
    ["鈴木一郎", ["鈴木", "一郎"], "four"], ["AB12", ["AB", "12"], "four"], ["Yuki", ["Yu", "ki"], "four"],
  ])("keeps short name %s unchanged", (name, lines, variant) => {
    expect(splitMemberLabel(name as string)).toEqual(lines);
    expect(getMemberLabelVariant(lines as string[])).toBe(variant);
    for (const diameter of [31, 42]) expect(getMemberLabelFontSize(diameter, lines as string[])).toBe(Math.round(diameter * 3) / 10);
  });
  it.each([
    ["たかはしゆ", ["たかは", "しゆ"]], ["佐々木小次郎", ["佐々木", "小次郎"]],
    ["あいうえおかき", ["あいう", "えお…"]], ["Takahashi", ["Takah", "ashi"]],
    ["abcdefghijkl", ["abcdef", "ghijkl"]], ["abcdefghijklm", ["abcdef", "ghij…"]],
    ["ABCあDEF", ["ABC", "あD…"]], ["abc defgh", ["abc d", "efgh"]], ["WWW@@@", ["WWW", "@@@"]],
  ])("uses fixed text for %s across zoom", (name, lines) => {
    expect(splitMemberLabel(name as string)).toEqual(lines);
    for (const diameter of [12, 31, 42, 84]) {
      getMemberLabelFontSize(diameter, splitMemberLabel(name as string));
      expect(splitMemberLabel(name as string)).toEqual(lines);
    }
  });
  it("counts graphemes including combining marks and emoji sequences", () => {
    expect(memberLabelCharacters("か\u3099👨‍👩‍👧‍👦🇯🇵")).toHaveLength(3);
    expect(splitMemberLabel("か\u3099いうえお")).toEqual(["か\u3099いう", "えお"]);
  });
  it("falls back to code points when Segmenter is unavailable", async () => {
    vi.resetModules(); vi.stubGlobal("Intl", { Segmenter: undefined });
    try {
      const fallback = await import("./memberLabel");
      expect(fallback.memberLabelCharacters("あ😀い")).toEqual(["あ", "😀", "い"]);
      expect(fallback.splitMemberLabel("あいうえおかき")).toEqual(["あいう", "えお…"]);
    } finally { vi.unstubAllGlobals(); vi.resetModules(); }
  });
});

describe("export containment takes priority over the readable floor", () => {
  const names = ["あ", "あい", "あおい", "ががが", "ぎぎぎ", "鈴木一郎", "たかはしゆ", "佐々木小次郎", "WWWWWW", "iiiiii", "Wあi", "か\u3099いう", "👨‍👩‍👧‍👦🇯🇵😀", "abcdefghijkl", "bbbbbbbbbbbb", "QQQQQQQQQQQQ", "WWWWWWWWWWWW"];
  for (const name of names) it(`${name}: fits 1–16mm without changing split text`, () => {
    const lines = splitMemberLabel(name);
    for (let diameter = 1; diameter <= 16; diameter += .125) {
      const candidate = getPrintMemberLabelFontSizeMm(diameter, lines, "preview");
      const size = getPrintMemberLabelFontSizeMm(diameter, lines);
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(candidate);
      expect(size).toBeLessThanOrEqual(exportMemberLabelFitLimit(diameter, lines));
      const leading = exportMemberLabelLineHeightEm(lines), shift = getMemberLabelVariant(lines) === "three" ? -.04 : 0;
      for (const [i, line] of lines.entries()) {
        const x = estimateExportMemberLabelInkWidthEm(line) * size / 2;
        const y = (Math.abs((i - (lines.length - 1) / 2) * leading + shift) + .46) * size;
        expect(x * x + y * y).toBeLessThanOrEqual((diameter / 2) ** 2 + 1e-10);
      }
      if (candidate <= exportMemberLabelFitLimit(diameter, lines)) expect(size).toBe(candidate);
      else expect(size + .01).toBeGreaterThan(exportMemberLabelFitLimit(diameter, lines));
      expect(splitMemberLabel(name)).toEqual(lines);
    }
  });
  it("uses graphemes, narrow/wide ASCII ink, and unchanged text", () => {
    expect(estimateExportMemberLabelInkWidthEm("WWW")).toBeGreaterThan(estimateExportMemberLabelInkWidthEm("iii"));
    expect(estimateExportMemberLabelInkWidthEm("か\u3099")).toBe(estimateExportMemberLabelInkWidthEm("が"));
    expect(estimateExportMemberLabelInkWidthEm("👨‍👩‍👧‍👦")).toBe(1.15);
    expect(getPrintMemberLabelFontSizeMm(3.14, splitMemberLabel("あおい"))).toBeLessThan(1.8);
    expect(getPrintMemberLabelFontSizeMm(8, [""])).toBe(getPrintMemberLabelFontSizeMm(8, [""], "preview"));
  });
  it("never rounds a reduction up across a hundredth-mm boundary", () => {
    const lines = ["WWW"];
    for (const target of [.999999999, 1, 1.000000001, 1.239999999, 1.24, 1.240000001]) {
      const diameter = target / exportMemberLabelFitLimit(1, lines);
      const size = fitExportMemberLabelFontSize(diameter, lines, 2);
      expect(size).toBeLessThanOrEqual(exportMemberLabelFitLimit(diameter, lines));
      expect(size + .01).toBeGreaterThan(exportMemberLabelFitLimit(diameter, lines));
    }
    expect(fitExportMemberLabelFontSize(16, ["あ"], 2.3400000000000003)).toBe(2.3400000000000003);
  });
  it("preserves the agreed normal A4 examples and 8–13mm assignment chips", () => {
    for (const includeAssignments of [false, true]) {
      const project = formationExportFixture();
      const metrics = getPrintMetrics(project, [project.frames[0]], { ...defaultPrintOptions, includeAssignments });
      for (const name of ["あい", "あおい", "鈴木一郎"]) {
        const lines = splitMemberLabel(name), d = .5 * metrics.mmPerMeter;
        expect(getPrintMemberLabelFontSizeMm(d, lines)).toBe(getPrintMemberLabelFontSizeMm(d, lines, "preview"));
      }
    }
    const project = formationExportFixture(); project.stage.widthMeters = 29; project.stage.depthMeters = 23.5;
    const d = getPrintMetrics(project, [project.frames[0]], { ...defaultPrintOptions, includeAssignments: true }).mmPerMeter;
    expect(d).toBeCloseTo(6.139310344827586, 10); // model mm before the final A4 fitting
    expect(getPrintMemberLabelFontSizeMm(d, ["あおい"])).toBe(getPrintMemberLabelFontSizeMm(d, ["あおい"], "preview"));
    expect(getPrintMemberLabelFontSizeMm(6.27, ["あおい"])).toBe(getPrintMemberLabelFontSizeMm(6.27, ["あおい"], "preview"));
    for (let diameter = 8; diameter <= 13; diameter += .25) for (const name of ["あ", "あい", "あおい", "鈴木一郎", "たかはしゆ", "佐々木小次郎"]) {
      const lines = splitMemberLabel(name);
      expect(getPrintMemberLabelFontSizeMm(diameter, lines)).toBe(getPrintMemberLabelFontSizeMm(diameter, lines, "preview"));
    }
  });
});

describe("circle chord font sizing", () => {
  for (const name of ["たかはしゆ", "佐々木小次郎", "あいうえおかき", "WWW@@@"]) for (const diameter of [31, 42]) {
    it(`${name} fits diameter ${diameter} with >=8px`, () => {
      const lines = splitMemberLabel(name), size = getMemberLabelFontSize(diameter, lines);
      expect(size).toBeGreaterThanOrEqual(8);
      expect(size).toBeLessThanOrEqual(diameter * 0.3);
      expect(size).toBeLessThanOrEqual(memberLabelFitLimit(diameter, lines));
      const x = Math.max(...lines.map(estimateMemberLabelWidthEm)) * size / 2;
      const y = (MEMBER_LONG_LABEL_LINE_HEIGHT + MEMBER_LABEL_INK_HEIGHT_EM) * size / 2;
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(diameter / 2);
    });
  }
  it("gives wider ASCII less size, and retains readable floor at extreme zoom", () => {
    expect(getMemberLabelFontSize(42, splitMemberLabel("WWWWWWWWWWWW"))).toBeLessThan(getMemberLabelFontSize(42, splitMemberLabel("abcdefghijkl")));
    expect(getMemberLabelFontSize(42, splitMemberLabel("mmmmmmmm"))).toBeLessThan(getMemberLabelFontSize(42, splitMemberLabel("abcdefgh")));
    expect(estimateMemberLabelWidthEm("wmWM@")).toBe(5);
    expect(getMemberLabelFontSize(12, splitMemberLabel("あいうえおかき"))).toBe(8);
    expect(getMemberLabelClassName("member-token", splitMemberLabel("あいうえおかき"))).toBe("member-token--label-long");
  });
  it("caps the final print size after boost and rounds downward", () => {
    const options = { min: 1.8, precision: 2, boost: 0.2, border: 0, inset: 0, borderOverlap: 0 };
    for (const diameter of [9, 11.17, 16]) for (const name of ["たかはしゆ", "佐々木小次郎", "あいうえおかき", "Takahashi", "abcdefghijkl"]) {
      const lines = splitMemberLabel(name), size = getMemberLabelFontSize(diameter, lines, options);
      expect(size).toBeGreaterThanOrEqual(1.8);
      expect(size).toBeLessThanOrEqual(memberLabelFitLimit(diameter, lines, options));
      expect(size).toBeLessThanOrEqual(diameter * 0.3);
    }
    expect(getMemberLabelFontSize(7, splitMemberLabel("鈴木一郎"), options)).toBeCloseTo(2.3); // short-name print unchanged
    expect(getMemberLabelFontSize(3, splitMemberLabel("あいうえおかき"), options)).toBe(1.8); // mm floor retained; tiny circles cannot fit
  });
});
