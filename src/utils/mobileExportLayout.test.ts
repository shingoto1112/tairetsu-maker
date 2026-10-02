import { describe, expect, it } from "vitest";
import { assignmentMobileSections, planMobilePages, rosterMobileSections, type TextMeasure } from "./mobileExportLayout";
import { createRosterExportSnapshot } from "./rosterExportSnapshot";

// Deterministic measured heights for planner tests; browser font measurements are separate.
const measure: TextMeasure = (text, width, font, line) => Math.max(1, Math.ceil(text.length * font / width)) * line;
const roster = (count: number, name = "名前") => createRosterExportSnapshot("演目", "members",
  Array.from({ length: count }, (_, i) => ({ id: String(i), name: `${name}${i + 1}` })), [{ id: "g", name: "赤組", memberIds: Array.from({ length: count }, (_, i) => String(i)) }]);

describe("mobile page planning", () => {
  it("uses two columns with left-to-right ordering, and one column for many measured long names", () => {
    const sections = rosterMobileSections(roster(3), measure);
    expect(sections[0].rows.map((row) => row.cells.map((cell) => cell.no))).toEqual([[1, 2], [3]]);
    expect(rosterMobileSections(roster(4, "非常に長い名前".repeat(6)), measure)[0].rows.every((row) => row.cells.length === 1)).toBe(true);
    const wideGlyphs: TextMeasure = () => 102;
    expect(rosterMobileSections(roster(4, "一"), wideGlyphs)[0].rows[0].cells).toHaveLength(1);
  });
  it("preserves No., repeats group headings, attaches the first row, numbers pages and shrinks the final page", () => {
    const pages = planMobilePages(rosterMobileSections(roster(70), measure), measure, (first) => first ? 150 : 120);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].height).toBe(960);
    expect(pages[pages.length - 1]!.height).toBeLessThan(960);
    expect(pages.flatMap((p) => p.blocks.flatMap((b) => b.row?.cells.map((c) => c.no) ?? []))).toEqual(Array.from({ length: 70 }, (_, i) => i + 1));
    pages.forEach((page, index) => {
      expect(page.pageNumber).toBe(index + 1); expect(page.totalPages).toBe(pages.length);
      expect(page.blocks[page.blocks.length - 1]?.row).toBeDefined();
      expect(page.blocks[0].heading?.text).toContain(index ? "（続き）" : "赤組");
    });
  });
  it("splits an oversized name without losing characters or renumbering", () => {
    const text = "長い名前".repeat(180);
    const pages = planMobilePages([{ headings: [{ key: "g", text: "赤組", kind: "group" }], rows: [{ cells: [{ text, no: 17 }] }] }], measure, () => 120);
    const cells = pages.flatMap((p) => p.blocks.flatMap((b) => b.row?.cells ?? []));
    expect(cells.map((cell) => cell.text).join("")).toBe(text);
    expect(cells.every((cell) => cell.no === 17)).toBe(true);
  });
  it("never strands a new group heading and only marks previously emitted groups as continuations", () => {
    const first = rosterMobileSections(roster(24), measure)[0];
    const second = { ...first, headings: [{ key: "next", text: "青組", kind: "group" as const }], rows: [{ cells: [{ text: "次の名前" }] }] };
    const pages = planMobilePages([first, second], measure, () => 250);
    for (const page of pages) expect(page.blocks[page.blocks.length - 1]?.row).toBeDefined();
    const heading = pages.flatMap((p) => p.blocks).find((b) => b.heading?.key === "next")!.heading!;
    expect(heading.text).toBe("青組");
  });
  it("splits assignees with tool/group continuations and starts each scene on a fresh page", () => {
    const names = "担当者名、".repeat(200);
    const snapshot = { title: "演目", exportedAt: new Date().toISOString(), totalCount: 2, scopeLabel: "全シーン", scenes: [0, 1].map((i) => ({ name: `場面${i}`, time: "0:00", groups: [{ name: "旗", color: "red", tools: [{ name: "大旗", color: "blue", assignees: [i ? "次の担当" : names] }] }] })) };
    const pages = planMobilePages(assignmentMobileSections(snapshot), measure, () => 130);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[1].blocks.some((b) => b.heading?.text === "大旗（続き）")).toBe(true);
    const next = pages.find((p) => p.blocks.some((b) => b.heading?.text === "場面1・0:00"))!;
    expect(next.blocks[0].heading?.kind).toBe("scene");
    expect(next.blocks[next.blocks.length - 1]?.row?.cells[0].text).toBe("次の担当");
    expect(pages.slice(0, -1).flatMap((p) => p.blocks.flatMap((b) => b.row?.cells.map((c) => c.text) ?? [])).join("")).toBe(names);
  });
});
