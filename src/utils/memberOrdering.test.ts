import { describe, expect, it } from "vitest";
import type { Member, MemberGroup } from "../types";
import { buildMemberGroupIndex, sortMembersForPicker } from "./memberOrdering";

const members: Member[] = [
  { id: "u1", name: "メンバー10", color: "#000000" },
  { id: "b", name: "メンバー2", color: "#000000" },
  { id: "a", name: "メンバー1", color: "#000000" },
  { id: "u2", name: "メンバー20", color: "#000000" },
  { id: "c", name: "メンバー3", color: "#000000" },
];
const groups: MemberGroup[] = [
  { id: "g1", name: "先頭", memberIds: ["c", "a", "c"] },
  { id: "g2", name: "次", memberIds: ["a", "b"] },
];
const ids = (items: Member[]) => items.map((item) => item.id);

describe("memberOrdering", () => {
  it("uses the first membership including duplicates within a group", () => {
    const index = buildMemberGroupIndex(groups);
    expect(index.get("a")).toEqual({ group: groups[0], groupIndex: 0, indexInGroup: 1 });
    expect(index.get("c")?.indexInGroup).toBe(0);
    expect(index.has("u1")).toBe(false);
  });

  it("orders by group and memberIds, placing ungrouped members last in original order", () => {
    expect(ids(sortMembersForPicker(members, "group", buildMemberGroupIndex(groups))))
      .toEqual(["c", "a", "b", "u1", "u2"]);
  });

  it("orders Japanese names with numeric comparison", () => {
    expect(ids(sortMembersForPicker(members, "name", buildMemberGroupIndex(groups))))
      .toEqual(["a", "b", "c", "u1", "u2"]);
  });

  it("returns a new array without mutating the source in both modes", () => {
    const before = structuredClone(members);
    const index = buildMemberGroupIndex(groups);
    const input = Object.freeze([...members]);
    for (const order of ["group", "name"] as const) {
      const result = sortMembersForPicker(input, order, index);
      expect(result).not.toBe(input);
    }
    expect(members).toEqual(before);
    expect(groups[0].memberIds).toEqual(["c", "a", "c"]);
  });

  it("handles no groups and empty candidate lists", () => {
    expect(sortMembersForPicker(members, "group", new Map())).toEqual(members);
    expect(sortMembersForPicker([], "name", new Map())).toEqual([]);
  });
});
