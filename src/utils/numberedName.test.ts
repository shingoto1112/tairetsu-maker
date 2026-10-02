import { describe, expect, it } from "vitest";
import { nextNumberedName } from "./numberedName";

describe("nextNumberedName", () => {
  it("starts at the requested number and skips collisions only from there", () => {
    expect(nextNumberedName("A", ["A1", "A3", "A4"], 3)).toBe("A5");
    expect(nextNumberedName("A", ["A1", "A3"], 4)).toBe("A4");
    expect(nextNumberedName("A", ["A1", "A3"], 1)).toBe("A2");
  });

  it.each([0, -1, NaN, Infinity])("uses a positive finite start for %s", (start) => {
    expect(nextNumberedName("A", [], start)).toBe("A1");
  });
  it("reuses the smallest unused positive number", () => {
    expect(nextNumberedName("メンバー", ["メンバー1", "メンバー3", "別名2"])).toBe("メンバー2");
    expect(nextNumberedName("メンバー", ["メンバー2"])).toBe("メンバー1");
  });

  it("supports an empty base and any iterable without altering names", () => {
    expect(nextNumberedName("", new Set(["1", "3"]))).toBe("2");
    expect(nextNumberedName(" A ", ["A1"])).toBe(" A 1");
  });

  it("handles a large roster and duplicate names", () => {
    const names = Array.from({ length: 10000 }, (_, index) => `道具${index + 1}`);
    expect(nextNumberedName("道具", [...names, "道具1"])).toBe("道具10001");
  });
});
