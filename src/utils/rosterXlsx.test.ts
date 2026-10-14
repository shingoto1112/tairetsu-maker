// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { ExportSource } from "./mobileExportTypes";
import { generateRosterXlsx, normalizeRosterColor, validateRosterXlsxSize, xlsxColumnName, XLSX_MIME } from "./rosterXlsx";

const source = (): ExportSource => {
  const project = createSampleProject();
  return { project, projectTitle: project.title, members: project.members, memberGroups: [], objects: project.stageObjects,
    objectGroups: [], frames: project.frames, currentFrame: null, objectStates: {} };
};
const bytes = (file: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(file);
});
async function unpack(input: ExportSource, include = true) {
  const result = await generateRosterXlsx(input, include);
  expect(result.preview).toBeNull(); expect(result.files).toHaveLength(1); expect(result.files[0].type).toBe(XLSX_MIME);
  const zip = await JSZip.loadAsync(await bytes(result.files[0]));
  const docs = new Map<string, Document>();
  for (const file of Object.values(zip.files).filter(file => !file.dir)) {
    const text = await file.async("string");
    const doc = new DOMParser().parseFromString(text, "application/xml");
    expect(doc.querySelector("parsererror"), file.name).toBeNull();
    expect(doc.getElementsByTagName("f").length).toBe(0);
    docs.set(file.name, doc);
  }
  const content = docs.get("[Content_Types].xml")!;
  for (const override of content.getElementsByTagName("Override")) expect(zip.file(override.getAttribute("PartName")!.slice(1))).toBeTruthy();
  expect(docs.get("_rels/.rels")!.querySelector("Relationship")!.getAttribute("Target")).toBe("xl/workbook.xml");
  const relations = docs.get("xl/_rels/workbook.xml.rels")!;
  for (const rel of relations.getElementsByTagName("Relationship")) expect(zip.file(`xl/${rel.getAttribute("Target")}`)).toBeTruthy();
  for (const sheet of docs.get("xl/workbook.xml")!.getElementsByTagName("sheet")) {
    expect(relations.querySelector(`[Id="${sheet.getAttribute("r:id")}"]`)).toBeTruthy();
  }
  expect(docs.get("xl/styles.xml")!.querySelector("fonts font b")).toBeTruthy();
  const styles = docs.get("xl/styles.xml")!;
  const xfs = styles.querySelectorAll("cellXfs > xf");
  for (const xf of xfs) {
    for (const [attribute, selector] of [["fontId", "fonts > font"], ["fillId", "fills > fill"], ["borderId", "borders > border"]]) {
      expect(Number(xf.getAttribute(attribute))).toBeLessThan(styles.querySelectorAll(selector).length);
    }
  }
  for (const [file, doc] of docs) if (file.startsWith("xl/worksheets/")) {
    for (const cell of doc.querySelectorAll("c")) expect(Number(cell.getAttribute("s"))).toBeLessThan(xfs.length);
  }
  for (const color of styles.querySelectorAll("[rgb]")) expect(color.getAttribute("rgb")).toMatch(/^FF[0-9A-F]{6}$/);
  return { zip, docs, result };
}
const values = (doc: Document) => Array.from(doc.getElementsByTagName("row"), row => Array.from(row.getElementsByTagName("c"), cell => cell.textContent));

describe("roster XLSX", () => {
  it("keeps Japanese, emoji, leading zeros, formulas and XML characters as inline strings in group order", async () => {
    const input = source(); input.objects = [];
    const names = ["日本語😀", "007", "=SUM(A1)", "+1", "-2", "@name", "& < > \" '"];
    input.members = names.map((name, index) => ({ id: `${index}`, name, color: "red" }));
    input.memberGroups = [{ id: "g", name: "組<&", color: "blue", memberIds: ["2", "1", "2", "missing"] }, { id: "g2", name: "二組", color: "red", memberIds: ["0", "2"] }];
    const { docs } = await unpack(input);
    const doc = docs.get("xl/worksheets/sheet1.xml")!;
    expect(values(doc)).toEqual([["No.", "■ 組<&", "■ 二組", "■ 未所属"], ["1", "=SUM(A1)", "日本語😀", "+1"], ["2", "007", "-2"], ["3", "@name"], ["4", "& < > \" '"]]);
    for (const cell of doc.querySelectorAll('c:not([r^="A"])')) expect(cell.getAttribute("t")).toBe("inlineStr");
    expect(doc.querySelector('[r="C3"]')).toBeNull();
    expect(doc.querySelector('[r="B4"]')).toBeNull();
    expect(doc.querySelector("dimension")!.getAttribute("ref")).toBe("A1:D5");
    expect(doc.querySelector('[r="A2"]')!.getAttribute("t")).toBeNull();
    expect(doc.querySelector('[r="A1"]')!.getAttribute("s")).toBe("1");
    expect(doc.querySelector("col")!.getAttribute("customWidth")).toBe("1");
  });
  it("escapes controls, literal OOXML sequences, CR and invalid XML units without corrupting emoji", async () => {
    const input = source(); input.members = [{ id: "1", name: "_x000A_\u0000\u0001\r\t\n\ufffe\uffff\ud800😀", color: "red" }];
    const { docs } = await unpack(input, false);
    expect(docs.get("xl/worksheets/sheet1.xml")!.querySelector('[r="B2"]')!.textContent).toBe("_x005F_x000A__x0000__x0001__x000D_\t\n_xFFFE__xFFFF__xD800_😀");
  });
  it.each([false, true])("writes a header-only member sheet for empty rosters (include=%s)", async include => {
    const input = source(); input.members = []; input.objects = [];
    const { docs } = await unpack(input, include);
    expect(values(docs.get("xl/worksheets/sheet1.xml")!)).toEqual([["No.", "■ 未所属"]]);
    expect(docs.get("xl/workbook.xml")!.querySelectorAll("sheet")).toHaveLength(1);
    expect(docs.has("xl/worksheets/sheet2.xml")).toBe(false);
  });
  it("includes only tool names in group columns and omits the tool sheet when unchecked", async () => {
    const input = source(); const object = input.objects[0];
    object.shape = "curtain"; input.frames.forEach(frame => { frame.objectStates[object.id].widthMeters = 3.25; frame.objectStates[object.id].heightMeters = 1.5; });
    input.objectGroups = [{ id: "o", name: "舞台", color: "red", objectIds: [input.objects[1].id, object.id] }];
    const { docs } = await unpack(input);
    expect(Array.from(docs.get("xl/workbook.xml")!.querySelectorAll("sheet"), sheet => sheet.getAttribute("name"))).toEqual(["メンバー", "道具"]);
    const doc = docs.get("xl/worksheets/sheet2.xml")!;
    expect(values(doc)[0]).toEqual(["No.", "■ 舞台"]);
    expect(values(doc)[2]).toEqual(["2", object.name]);
    expect(doc.querySelector('[r="B3"]')!.getAttribute("t")).toBe("inlineStr");
    expect((await unpack(input, false)).docs.has("xl/worksheets/sheet2.xml")).toBe(false);
    delete input.project; expect(values((await unpack(input)).docs.get("xl/worksheets/sheet2.xml")!)).toEqual(values(doc));
    input.objectGroups[0].objectIds = [object.id];
    expect(values((await unpack(input)).docs.get("xl/worksheets/sheet2.xml")!)[0]).toEqual(["No.", "■ 舞台", "■ 未所属"]);
  });
  it("preserves long names at the cell limit, rejects overflow, and bounds sanitized filenames", async () => {
    const input = source(); input.members = [{ id: "1", name: "あ".repeat(32765) + "😀", color: "red" }];
    input.projectTitle = '<演目>:/\\*?"|\u0001'.repeat(100);
    const { docs, result } = await unpack(input, false);
    expect(docs.get("xl/worksheets/sheet1.xml")!.querySelector('[r="B2"]')!.textContent).toBe(input.members[0].name);
    expect(result.files[0].name.length).toBeLessThan(150); expect(result.files[0].name).toMatch(/_名簿_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx$/);
    expect(result.files[0].name).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
    input.members[0].name += "x"; await expect(generateRosterXlsx(input)).rejects.toThrow("32,767");
  });
  it("freezes source before ZIP loading and supports cancellation before and during creation", async () => {
    const input = source(); input.members = [{ id: "1", name: "作成時", color: "red" }];
    const promise = generateRosterXlsx(input, false); input.members[0].name = "変更後";
    const zip = await JSZip.loadAsync(await bytes((await promise).files[0]));
    expect(await zip.file("xl/worksheets/sheet1.xml")!.async("string")).toContain("作成時");
    const abort = new AbortController(); abort.abort(); await expect(generateRosterXlsx(input, true, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    const later = new AbortController(); const pending = generateRosterXlsx(input, true, later.signal); later.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps empty registered groups and omits ungrouped only when it has no items", async () => {
    const input = source(); input.objects = [];
    input.members = [{ id: "1", name: "一人", color: "#f00" }];
    input.memberGroups = [{ id: "empty", name: "空組", color: "#123", memberIds: ["missing"] }, { id: "one", name: "一組", color: "#123", memberIds: ["1"] }];
    let doc = (await unpack(input)).docs.get("xl/worksheets/sheet1.xml")!;
    expect(values(doc)).toEqual([["No.", "■ 空組", "■ 一組"], ["1", "一人"]]);
    expect(doc.querySelector('[r="B2"]')).toBeNull();
    expect(doc.querySelector('[r="C2"]')!.textContent).toBe("一人");
    input.members = [];
    doc = (await unpack(input)).docs.get("xl/worksheets/sheet1.xml")!;
    expect(values(doc)).toEqual([["No.", "■ 空組", "■ 一組"]]);
    expect(doc.querySelector("dimension")!.getAttribute("ref")).toBe("A1:C1");
  });

  it("reuses color styles across groups and sheets and renders B-style borders, rich text and frozen panes", async () => {
    const input = source();
    input.memberGroups = [{ id: "a", name: "赤", color: "#f00", memberIds: input.members.map(item => item.id) }, { id: "b", name: "別", color: "rgb(255,0,0)", memberIds: [] }];
    input.objectGroups = [{ id: "o", name: "道具", color: "#FF0000FF", objectIds: input.objects.map(item => item.id) }];
    const { docs } = await unpack(input);
    const styles = docs.get("xl/styles.xml")!;
    expect(styles.querySelectorAll("cellXfs > xf")).toHaveLength(4);
    expect(styles.querySelectorAll("borders > border")).toHaveLength(3);
    for (const key of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
      const doc = docs.get(key)!;
      expect(doc.querySelector('sheetView')!.getAttribute("showGridLines")).toBe("0");
      for (const [attribute, value] of Object.entries({ xSplit: "1", ySplit: "1", topLeftCell: "B2", state: "frozen", activePane: "bottomRight" })) expect(doc.querySelector("pane")!.getAttribute(attribute)).toBe(value);
      expect(doc.querySelector('row[r="1"]')!.getAttribute("ht")).toBe("26");
      expect(doc.querySelector('row[r="2"]')!.getAttribute("ht")).toBe("22");
      expect(doc.querySelector('col[min="1"]')!.getAttribute("width")).toBe("7");
      expect(doc.querySelector('[r="B1"]')!.getAttribute("s")).toBe("3");
      expect(doc.querySelector('[r="B2"]')!.getAttribute("s")).toBe("2");
      expect(doc.querySelector('[r="B1"] r t')!.textContent).toBe("■ ");
      expect(doc.querySelector('[r="B1"] r color')!.getAttribute("rgb")).toBe("FFFF0000");
      expect(doc.querySelector("pageSetup")).toBeNull();
      // Names such as "007" stay text without Excel's "number stored as text" marker.
      expect(doc.querySelector("ignoredErrors > ignoredError")!.getAttribute("numberStoredAsText")).toBe("1");
      expect(doc.querySelector("ignoredErrors > ignoredError")!.getAttribute("sqref")).toBe(doc.querySelector("dimension")!.getAttribute("ref"));
    }
    const borders = styles.querySelectorAll("borders > border");
    expect(borders[2].querySelector("bottom")!.getAttribute("style")).toBe("thick");
    expect(borders[2].querySelector("bottom color")!.getAttribute("rgb")).toBe("FFFF0000");
    // Every styled cell has near-black thin column separators on both sides, never a group color.
    for (const border of [borders[1], borders[2]]) for (const side of ["left", "right"]) {
      expect(border.querySelector(side)!.getAttribute("style")).toBe("thin");
      expect(border.querySelector(`${side} color`)!.getAttribute("rgb")).toBe("FF0F172A");
    }
    expect(styles.querySelector('fgColor')!.getAttribute("rgb")).toBe("FFF1F5F9");
    // Fixed row heights: wrapping would clip the second line, so columns widen instead.
    expect(styles.querySelectorAll("cellXfs > xf")[2].querySelector("alignment")!.getAttribute("wrapText")).toBeNull();
    expect(docs.get("xl/worksheets/sheet1.xml")!.querySelector('[r="C1"]')!.getAttribute("s")).toBe("3");
    input.memberGroups[0].color = "#00f";
    expect((await unpack(input)).docs.get("xl/styles.xml")!.querySelectorAll("cellXfs > xf")).toHaveLength(5);
  });

  it.each([[0, "A"], [25, "Z"], [26, "AA"], [701, "ZZ"], [702, "AAA"], [16383, "XFD"]])("names column %i as %s", (index, name) => {
    expect(xlsxColumnName(index as number)).toBe(name);
  });
  it("writes extended cell references and dimensions through XFD and rejects excess columns before ZIP creation", async () => {
    const input = source(); input.members = []; input.objects = [];
    input.memberGroups = Array.from({ length: 16383 }, (_, index) => ({ id: String(index), name: `組${index}`, color: "#123", memberIds: [] }));
    const doc = (await unpack(input)).docs.get("xl/worksheets/sheet1.xml")!;
    for (const ref of ["Z1", "AA1", "ZZ1", "AAA1", "XFD1"]) expect(doc.querySelector(`c[r="${ref}"]`)).toBeTruthy();
    expect(doc.querySelector("dimension")!.getAttribute("ref")).toBe("A1:XFD1");
    input.memberGroups.push({ id: "excess", name: "超過", color: "#123", memberIds: [] });
    await expect(generateRosterXlsx(input)).rejects.toThrow("16,384");
  }, 30000);
  it("validates inclusive row and column bounds without truncation", () => {
    expect(() => validateRosterXlsxSize(16384, 1048576)).not.toThrow();
    expect(() => validateRosterXlsxSize(16385, 1)).toThrow("16,384");
    expect(() => xlsxColumnName(-1)).toThrow();
    expect(() => validateRosterXlsxSize(2, 1048577)).toThrow("1,048,576");
  });

  it.each([
    ["#123", "FF112233"], ["#123f", "FF112233"], ["#1230", "FFFFFFFF"],
    ["#112233", "FF112233"], ["#00000080", "FF7F7F7F"], [" #aAbBcCFF ", "FFAABBCC"],
    ["rgb(17, 34, 51)", "FF112233"], ["rgba(0, 0, 0, 0.5)", "FF808080"],
    ["rgb(100% 0% 0% / 50%)", "FFFF8080"], ["rgba(0 0 255 / 0)", "FFFFFFFF"],
    ["rgb(300,-1,0)", "FFFF0000"], ["", "FF94A3B8"], [undefined, "FF94A3B8"],
    ["red", "FF94A3B8"], ["#12", "FF94A3B8"], ["#GG0000", "FF94A3B8"],
    ['rgb(1,2,3)\"/><bad', "FF94A3B8"], ["rgb(NaN, 0, 0)", "FF94A3B8"],
    ["rgb(1 2)", "FF94A3B8"], ["rgba(1,2,3,)", "FF94A3B8"], ["rgb(1,2,3/0.5)", "FF94A3B8"],
    ["rgb(1 2 3 / .5 / .5)", "FF94A3B8"], ["hsl(0,0%,0%)", "FF94A3B8"],
  ])("normalizes %s over white", (color, expected) => expect(normalizeRosterColor(color)).toBe(expected));

  it("bounds long-name widths and includes the colored prefix in the header cell limit", async () => {
    const input = source(); input.objects = [];
    input.members = [{ id: "long", name: "長".repeat(100), color: "#000" }];
    const doc = (await unpack(input)).docs.get("xl/worksheets/sheet1.xml")!;
    expect(doc.querySelector('col[min="2"]')!.getAttribute("width")).toBe("50");
    input.members = [{ id: "long", name: "=SUM(A1)&<確定😀>", color: "#000" }];
    // 11 half-width (1.2) + 2 full-width and 1 emoji (2.2 each) + 3 padding = 22.8, rounded up.
    expect((await unpack(input)).docs.get("xl/worksheets/sheet1.xml")!.querySelector('col[min="2"]')!.getAttribute("width")).toBe("23");
    input.memberGroups = [{ id: "g", name: "あ".repeat(32765), color: "#000", memberIds: ["long"] }];
    await expect(generateRosterXlsx(input)).resolves.toBeTruthy();
    input.memberGroups[0].name += "あ";
    await expect(generateRosterXlsx(input)).rejects.toThrow("32,767");
  });
});
