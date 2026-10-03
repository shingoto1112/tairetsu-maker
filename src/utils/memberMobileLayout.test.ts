import { describe, expect, it } from "vitest";
import { createRosterExportSnapshot } from "./rosterExportSnapshot";
import { planMemberMobile, memberLineHeight, memberTextWidth } from "./memberMobileLayout";
import type { TextMeasure } from "./mobileExportLayout";

const measure: TextMeasure = (text, width, font, line) => Math.max(1, Math.ceil(Array.from(text).length * font / width)) * line;
const people = (n: number, name = "田中花子") => Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, name }));
const verify = (snapshot: ReturnType<typeof createRosterExportSnapshot>, allowSmall = false) => {
  const plan = planMemberMobile(snapshot, measure, allowSmall)!;
  expect(plan).toBeTruthy();
  expect(plan.headerHeight).toBeGreaterThanOrEqual(140);
  expect(plan.headerHeight).toBeLessThanOrEqual(180);
  expect([1152, 1536]).toContain(plan.width); expect(plan.height).toBe(2048);
  expect(plan.width / plan.height).toBe(plan.width === 1152 ? 9 / 16 : 3 / 4);
  const entries = plan.blocks.flatMap(b => b.entry ? [b.entry] : []);
  expect(entries).toEqual(snapshot.columns.flatMap(c => c.items));
  expect(entries).toHaveLength(snapshot.totalCount);
  expect(new Set(entries.map(e => e.id)).size).toBe(snapshot.totalCount);
  for (const block of plan.blocks) {
    expect(block.x).toBeGreaterThanOrEqual(48);
    expect(block.x + block.width).toBeLessThanOrEqual(plan.width - 48 + .001);
    expect(block.y + block.height).toBeLessThanOrEqual(plan.height - 48 - 42 + .001);
    if (block.entry) expect(block.height).toBe(measure(block.entry.name, memberTextWidth(block.width - plan.numberWidth,plan.fontSize), plan.fontSize, memberLineHeight(plan.fontSize)) + 9);
  }
  return plan;
};
describe("member one-image layout", () => {
  it.each([0, 1, 146, 300])("preserves every ID exactly once for %i ungrouped people", n => {
    const plan = verify(createRosterExportSnapshot("演目", "members", people(n), []), n === 300);
    expect(plan.belowMinimum).toBe(plan.fontSize < 24);
    if (n <= 146) expect(plan.fontSize).toBeGreaterThanOrEqual(24);
    if (n <= 1) expect(plan.width).toBe(1152);
  });
  it("flows one large group down then right, repeating the group and preserving numbers", () => {
    const items = people(146);
    const plan = verify(createRosterExportSnapshot("演目", "members", items, [{ id: "a", name: "赤組", memberIds: items.map(e => e.id), color: "red" }]));
    const headings = plan.blocks.filter(b => b.heading);
    expect(headings.length).toBeGreaterThan(1);
    expect(headings[0].heading?.text).toBe("赤組（146人）");
    expect(headings.slice(1).every(b => b.heading?.text === "赤組（続き）（146人）")).toBe(true);
    expect(headings.map(b => b.x)).toEqual([...headings.map(b => b.x)].sort((a,b) => a-b));
    expect(plan.fontSize).toBe(32);
  });
  it("preserves group/source order, unassigned last and duplicate names as separate IDs", () => {
    const items = people(146);
    const groups = [
      { id: "small", name: "小さい組", memberIds: [items[5].id, items[1].id] },
      { id: "large", name: "多い組", memberIds: items.slice(6, 139).map(e => e.id).reverse() },
    ];
    const snapshot = createRosterExportSnapshot("演目", "members", items, groups);
    verify(snapshot);
    expect(snapshot.columns[0].items.map(e => [e.id,e.no])).toEqual([["id-5",1],["id-1",2]]);
    expect(snapshot.columns[snapshot.columns.length-1]?.label).toBe("未所属");
  });
  it("evaluates many tiny groups and both tiers while keeping group order", () => {
    const items = people(146);
    const groups = items.map(e => ({ id: e.id, name: "組", memberIds: [e.id] }));
    const plan = verify(createRosterExportSnapshot("多数の組", "members", items, groups), true);
    expect(plan.blocks.filter(b => b.heading)).toHaveLength(146);
    expect(plan.splits).toBe(0);
  });
  it("measures full long names, group names, titles and emoji without cutting text", () => {
    const items = people(20, "とても長い名前👨‍👩‍👧‍👦田中花子さん".repeat(4));
    const snapshot = createRosterExportSnapshot("長い演目🌸".repeat(20), "members", items, [{ id: "g", name: "長いグループ名🎉".repeat(8), memberIds: items.map(e => e.id) }]);
    const plan = verify(snapshot, true);
    expect(plan.blocks.find(b => b.entry)?.entry?.name).toBe(items[0].name);
    expect(plan.blocks.find(b => b.heading)?.heading?.text).toContain("長いグループ名🎉".repeat(8));
  });
  it("reports the 24px boundary instead of stretching or silently paginating", () => {
    const snapshot = createRosterExportSnapshot("演目", "members", people(300, "長い名前".repeat(6)), []);
    expect(planMemberMobile(snapshot, measure)).toBeNull();
    const plan = verify(snapshot, true);
    expect(plan.belowMinimum).toBe(true); expect(plan.fontSize).toBeLessThan(24);
    expect(plan.columns).toBeLessThanOrEqual(6);
  });
});
