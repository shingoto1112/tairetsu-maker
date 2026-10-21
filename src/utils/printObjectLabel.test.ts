import { describe, expect, it } from "vitest";
import { getPrintObjectLabelLayout, printObjectLabelCandidates, printObjectLabelFits, type PrintObjectLabelInput } from "./printObjectLabel";
import { readablePropLabelRotation } from "./stageExportView";
import { memberLabelCharacters } from "./memberLabel";

const measure = (text: string, size: number) => ({ width: memberLabelCharacters(text).reduce((n, ch) => n + (/^[A-Za-z0-9]$/.test(ch) ? .65 : 1), 0) * size, height: size * 1.12 });
const box = (text: string, extra: Partial<PrintObjectLabelInput> = {}): PrintObjectLabelInput => ({ text, width: 14, height: 9,
  paddingX: .8, paddingY: .8, maxSize: 13 * 25.4 / 96, ...extra });

describe("print prop names (layout millimetres, no saved coordinates)", () => {
  it.each(["みかん箱1", "みかん箱2", "みかん箱準備", "大旗①", "舞妓台", "襖幕2", "箱", "旗👩🏽‍🎤", "箱한글", "箱e\u0301"])("preserves %s, with at most two lines inside the shape", name => {
    const input = box(name), result = getPrintObjectLabelLayout(input, measure);
    expect(result.lines.map(l => l.text).join("")).toBe(name);
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.size).toBeGreaterThanOrEqual(1.8);
    expect(result.size).toBeLessThanOrEqual(input.maxSize);
    expect(result.overflow).toBe(false);
    expect(printObjectLabelFits(input, result)).toBe(true);
  });
  it("compares one/two lines and keeps one line when both reach the cap", () => {
    expect(getPrintObjectLabelLayout(box("みかん箱1", { width: 28, height: 20 }), measure).lines).toHaveLength(1);
    const input = box("みかん箱1"), result = getPrintObjectLabelLayout(input, measure);
    expect(result.lines.map(l => l.text)).toEqual(["みかん", "箱1"]);
    expect(result.size).toBeGreaterThan(3.25);
    expect(result.size).toBeLessThanOrEqual(input.maxSize);
    const constrained = box("みかん箱準備", { width: 9, height: 7 });
    const fit = getPrintObjectLabelLayout(constrained, measure);
    expect(fit.lines).toHaveLength(2);
    expect(fit.overflow).toBe(false);
    expect(printObjectLabelFits(constrained, { ...fit, lines: fit.lines.map(l => ({ ...l, width: l.width * (fit.size + .002) / fit.size,
      height: l.height * (fit.size + .002) / fit.size, y: l.y * (fit.size + .002) / fit.size })) })).toBe(false);
  });
  it.each(["箱", "みかん箱1", "みかん箱2", "大旗①", "旗👩🏽‍🎤", "箱한글"])("shows all of %s at the floor when even two lines cannot fit", name => {
    const input = box(name, { width: .6, height: .4 }), result = getPrintObjectLabelLayout(input, measure);
    expect(result).toMatchObject({ size: 1.8, overflow: true, lines: [{ text: name, x: 0, y: 0 }] });
    expect(printObjectLabelFits(input, result)).toBe(false);
  });
  it("protects alphanumeric identifiers, final digits, parentheses and graphemes", () => {
    for (const name of ["みかん箱12", "箱AB12", "箱（12）", "旗👩🏽‍🎤", "箱e\u0301", "大旗①"]) {
      for (const lines of printObjectLabelCandidates(name)) {
        expect(lines.join("")).toBe(name);
        expect(lines.length).toBeLessThanOrEqual(2);
        if (lines.length === 2) {
          expect(lines[1]).not.toMatch(/^[0-9①（)]/u);
          const prefix = memberLabelCharacters(lines[0]);
          expect(memberLabelCharacters(name)).toContain(prefix[prefix.length - 1]);
        }
      }
    }
    expect(printObjectLabelCandidates("箱AB12")).toEqual([["箱AB12"], ["箱", "AB12"]]);
    expect(printObjectLabelCandidates("👩🏽‍🎤")).toEqual([["👩🏽‍🎤"]]);
  });
  it.each([0, 45, 90, 137, 180])("uses local shape axes and retains the readable rotation (%s degrees)", rotation => {
    const input = box("みかん箱1", { radius: 4.5 }), result = getPrintObjectLabelLayout(input, measure);
    expect(printObjectLabelFits(input, result)).toBe(true);
    const net = rotation + readablePropLabelRotation(rotation);
    expect(net).toBeGreaterThanOrEqual(-90); expect(net).toBeLessThanOrEqual(90);
    expect(result).toEqual(getPrintObjectLabelLayout(input, measure));
  });
  it("fits rounded/circular interiors rather than the enclosing rectangle", () => {
    const input = box("みかん箱準備", { width: 11, height: 11 });
    const square = getPrintObjectLabelLayout(input, measure), circle = getPrintObjectLabelLayout({ ...input, radius: 5.5 }, measure);
    expect(printObjectLabelFits({ ...input, radius: 5.5 }, square)).toBe(false);
    expect(circle.size).toBeLessThan(square.size);
    expect(printObjectLabelFits({ ...input, radius: 5.5 }, circle)).toBe(true);
  });
  it("uses the actual assignment dimensions/cap and supports narrow curtains", () => {
    const input = box("みかん箱準備", { width: 20, height: 5, maxSize: 9 * 25.4 / 72, paddingX: 2.4, paddingY: 1.6 });
    const result = getPrintObjectLabelLayout(input, measure);
    expect(result.overflow).toBe(true); expect(result.size).toBe(1.8);
    const curtain = getPrintObjectLabelLayout(box("襖幕2", { width: 60, height: 4 }), measure);
    expect(curtain.lines).toHaveLength(1); expect(curtain.overflow).toBe(false);
  });
});
