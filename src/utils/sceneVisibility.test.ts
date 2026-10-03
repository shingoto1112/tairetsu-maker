import { describe, expect, it } from "vitest";
import { buildVisibilityBlocks, normalizeVisibilitySearch, revealVisibilityChip, visibilityRows, type VisibilityItem } from "./sceneVisibility";
const item = (id: string, name = id): VisibilityItem => ({ id, name, visible: true, selected: false, color: "#000", status: "表示", fullStatus: "表示" });

describe("scene visibility grouping and search", () => {
  it("preserves group and ID order, first membership only, and ungrouped last", () => {
    const blocks = buildVisibilityBlocks([item("a"), item("b"), item("c"), item("d")], [
      { id: "empty", name: "空", ids: ["missing"] },
      { id: "first", name: "1年", ids: ["b", "missing", "a", "b"] },
      { id: "second", name: "2年", ids: ["a", "c"] },
    ]);
    expect(blocks.map((block) => [block.id, block.items.map((value) => value.id), block.total])).toEqual([
      ["first", ["b", "a"], 2], ["second", ["c"], 1], ["__ungrouped__", ["d"], 1],
    ]);
  });
  it("normalizes width, case and kana only for partial name matches", () => {
    expect(normalizeVisibilitySearch("ＡbＣｴﾋﾞ" )).toBe("abcえび");
    const blocks = buildVisibilityBlocks([item("a", "ＡＢＣえび"), item("b", "他")], [{ id: "g", name: "1年", ids: ["a", "b"] }], "bcエビ");
    expect(blocks[0].items[0].name).toBe("ＡＢＣえび");
    expect(blocks[0].total).toBe(2);
    expect(buildVisibilityBlocks([item("a")], [], "一致なし")).toEqual([]);
  });
  it.each([[-100, 1], [43, 1], [44, 1], [93, 1], [94, 2], [143, 2], [144, 3], [193, 3], [194, 4], [244, 5], [294, 6], [1000, 6]])("uses measured space %s for %s rows", (space, rows) => {
    expect(visibilityRows(space)).toBe(rows);
  });
  it("reveals only the horizontal owner by the smallest delta", () => {
    const owner = { scrollLeft: 200, scrollTop: 80, getBoundingClientRect: () => ({ left: 100, right: 400 }) };
    const target = (left: number, right: number) => ({ getBoundingClientRect: () => ({ left, right }) });
    revealVisibilityChip(owner as HTMLElement, target(50, 242) as HTMLElement); expect(owner.scrollLeft).toBe(150);
    revealVisibilityChip(owner as HTMLElement, target(300, 492) as HTMLElement); expect(owner.scrollLeft).toBe(242);
    revealVisibilityChip(owner as HTMLElement, target(120, 312) as HTMLElement); expect(owner.scrollLeft).toBe(242);
    expect(owner.scrollTop).toBe(80);
  });
});
