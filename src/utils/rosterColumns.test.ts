import { describe, expect, it } from "vitest";
import { collectGroupedItems, nextRosterItemName } from "./rosterColumns";

const items = [
  { id: "u", name: "未所属" }, { id: "a", name: "A1" },
  { id: "b", name: "A2" }, { id: "c", name: "A3" },
];
const groups = [
  { id: "g", name: " A ", color: "#abc", memberIds: ["c", "missing", "a", "a", "b"] },
  { id: "g2", name: "B", memberIds: ["a"] },
];

describe("rosterColumns", () => {
  it("preserves group/id order, ignores missing IDs and repeated memberships, then lists remaining items", () => {
    const before = structuredClone({ items, groups });
    const columns = collectGroupedItems(items, groups, "memberIds");
    expect(columns.map((column) => column.items.map((item) => item.id))).toEqual([["c", "a", "b"], [], ["u"]]);
    expect(columns.map((column) => column.items.length)).toEqual([3, 0, 1]);
    expect(columns[0]).toMatchObject({ id: "g", groupId: "g", label: " A ", color: "#abc" });
    expect(columns[2]).toMatchObject({ id: "ungrouped", groupId: null, label: "未所属" });
    expect({ items, groups }).toEqual(before);
  });

  it("supports objectIds, no groups, and empty groups/rosters", () => {
    expect(collectGroupedItems(items, [{ id: "o", name: "道具", objectIds: ["a", "c"] }], "objectIds")
      .map((column) => column.items.length)).toEqual([2, 2]);
    expect(collectGroupedItems(items, [], "memberIds")[0].items).toEqual(items);
    expect(collectGroupedItems([], groups, "memberIds").map((column) => column.items.length)).toEqual([0, 0, 0]);
  });

  it("starts quick addition at row No.4 for a three-person column", () => {
    expect(nextRosterItemName(items, groups, "members", "g")).toBe("A4");
    expect(nextRosterItemName(items, [{ id: "g", name: "グループ1", memberIds: ["a", "b", "c"] }], "members", "g"))
      .toBe("グループ14");
  });

  it("skips existing names after deletion and checks all same-kind items", () => {
    const remaining = items.filter((item) => item.id !== "b");
    expect(nextRosterItemName(remaining, groups, "members", "g")).toBe("A4");
    expect(nextRosterItemName([...remaining, { id: "outside", name: "A4" }], groups, "members", "g")).toBe("A5");
  });

  it("uses the ungrouped count and member fallback", () => {
    expect(nextRosterItemName(items, groups, "members", null)).toBe("メンバー2");
    expect(nextRosterItemName(items, [{ ...groups[0], name: "  " }], "members", "g")).toBe("グループ4");
  });

  it("uses object column counts and fallbacks", () => {
    const objectGroups = [{ id: "g", name: "旗", objectIds: ["a", "b", "c"] }];
    expect(nextRosterItemName(items, objectGroups, "objects", "g")).toBe("旗4");
    expect(nextRosterItemName(items, objectGroups, "objects", null)).toBe("道具2");
    expect(nextRosterItemName(items, [{ ...objectGroups[0], name: " " }], "objects", "g")).toBe("道具4");
    expect(() => nextRosterItemName(items, objectGroups, "objects", "missing")).toThrow();
  });
});
