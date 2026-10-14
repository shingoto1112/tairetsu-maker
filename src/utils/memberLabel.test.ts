import { describe, expect, it, vi } from "vitest";
import { estimateMemberLabelWidthEm, getMemberLabelClassName, getMemberLabelFontSize, getMemberLabelVariant, memberLabelCharacters, memberLabelFitLimit, MEMBER_LABEL_INK_HEIGHT_EM, MEMBER_LONG_LABEL_LINE_HEIGHT, splitMemberLabel } from "./memberLabel";

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
