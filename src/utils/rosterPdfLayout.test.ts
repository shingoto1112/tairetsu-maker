import { describe, expect, it } from "vitest";
import { collectGroupedItems, collectRosterTableColumns } from "./rosterColumns";
import { createRosterExportSnapshot } from "./rosterExportSnapshot";
import { chooseRosterTablePlan, planRosterPdf, rosterPdfColumns, splitRosterPdfName, wrapRosterPdfLine,
  ROSTER_PDF as C, type RosterPdfColumn } from "./rosterPdfLayout";

const column = (count: number, width = 30, lines = 1): RosterPdfColumn => ({ id:"g", groupId:"g", label:"組", width, header:["■ 組"],
  items:Array.from({length:count}, (_, i) => ({id:String(i),name:"名前",no:i + 1})), names:Array.from({length:count}, () => Array(lines).fill("名前")) });
describe("Excel-compatible PDF columns, independent of PNG", () => {
  it("keeps empty groups, ignores missing IDs and assigns duplicates to the first group in membership order", () => {
    const items = [{id:"a",name:"同名"},{id:"b",name:"同名"},{id:"c",name:"未所属"}];
    const groups = [{id:"1",name:"先",memberIds:["b","missing","a","a"]},{id:"2",name:"空",memberIds:["a"]}];
    const columns = collectRosterTableColumns(items, groups, "memberIds");
    expect(columns.map(c=>c.items.map(i=>i.id))).toEqual([["b","a"],[],["c"]]);
    expect(rosterPdfColumns(createRosterExportSnapshot("t","members",items,groups))).toEqual(columns.map(c=>({...c,items:c.items.map((i,j)=>({...i,no:j+1}))})));
    expect(collectRosterTableColumns(items.slice(0,2), groups,"memberIds")).toHaveLength(2);
    expect(collectGroupedItems(items.slice(0,2), groups,"memberIds")).toHaveLength(3);
    expect(collectRosterTableColumns([],[],"memberIds").map(c=>c.label)).toEqual(["未所属"]);
    expect(collectRosterTableColumns([],groups,"memberIds")).toHaveLength(2);
  });
});
describe("complete grapheme names", () => {
  it.each([
    ["あいうえおか",["あいうえおか"]], ["あいうえおかき",["あいうえ","おかき"]],
    ["123456789",["12345","6789"]], ["山田 太郎花子",["山田","太郎花子"]],
    ["ab cd ef",["ab cd","ef"]], ["abc de fghij",["abc de","fghij"]],
    ["abc   defgh",["abc","defgh"]],
    ["👨‍👩‍👧‍👦あいうえお",["👨‍👩‍👧‍👦あいうえお"]],
    ["葛󠄀あいうえおか",["葛󠄀あいう","えおか"]],
    ["한글이름가나다",["한글이름","가나다"]],
  ])("splits %s without losing a grapheme", (value, expected) => expect(splitRosterPdfName(value as string)).toEqual(expected));
  it("wraps only after the two-line decision and retains every character", () => {
    const parts = splitRosterPdfName("1234567890123456789012345");
    const lines = parts.flatMap(p=>wrapRosterPdfLine(p, 5, s=>s.length));
    expect(lines).toEqual(["12345","67890","123","45678","90123","45"]);
    expect(lines.join("")).toBe("1234567890123456789012345");
  });
  it("requires Segmenter even for an empty roster", () => {
    const original = Object.getOwnPropertyDescriptor(Intl,"Segmenter")!;
    Object.defineProperty(Intl,"Segmenter",{value:undefined,configurable:true});
    try { expect(()=>rosterPdfColumns(createRosterExportSnapshot("t","members",[],[]))).toThrow("Intl.Segmenter"); }
    finally { Object.defineProperty(Intl,"Segmenter",original); }
  });
});
describe("A4 table pagination", () => {
  it("uses column-local No., repeats headers and continues vertically before the next horizontal batch", () => {
    const columns = Array.from({length:12},(_,i)=>({...column(i===0?65:3,50),id:String(i)}));
    const p = planRosterPdf(columns,"portrait");
    expect(p.pages[0].start).toBe(0); expect(p.pages[0].end).toBeGreaterThan(0);
    expect(p.pages[1].columns).toBe(p.pages[0].columns); expect(p.pages[1].start).toBe(p.pages[0].end);
    const next=p.pages.find(page=>page.columns[0].id!=="0")!;expect(next.start).toBe(0);
    expect(p.pages.every(page=>page.headerHeight===8.5)).toBe(true);
  });
  it("raises only the affected row to the maximum in that horizontal batch", () => {
    const a=column(3),b=column(2); b.names[1]=["長い","名前"];
    const page=planRosterPdf([a,b],"portrait").pages[0];expect(page.heights).toEqual([8.5,14,8.5]);
  });
  it("repeats the tallest wrapped header, without changing name-based column widths", () => {
    const a=column(60);a.header=["■ 長い","見出し","全部表示"];
    const p=planRosterPdf([a],"portrait");expect(p.pages.length).toBeGreaterThan(1);
    expect(p.pages.every(page=>page.headerHeight===19.5&&page.columns[0].width===30)).toBe(true);
  });
  it("selects the smaller page count and portrait on ties", () => {
    expect(chooseRosterTablePlan([column(5)]).orientation).toBe("portrait");
    expect(chooseRosterTablePlan(Array.from({length:7},()=>column(3)))).toMatchObject({orientation:"landscape",pages:expect.any(Array)});
    expect(chooseRosterTablePlan([column(60)]).orientation).toBe("portrait");
  });
  it("rejects a row taller than A4 and never clips it", () => {
    expect(()=>chooseRosterTablePlan([column(1,50,100)])).toThrow("A4の高さを超え");
  });
  it("lets a very wide short name use landscape instead of breaking the one-line rule", () => {
    expect(chooseRosterTablePlan([column(1,220)]).orientation).toBe("landscape");
    expect(()=>chooseRosterTablePlan([column(1,280)])).toThrow("A4の用紙幅");
  });
  it("enforces character, entry, column and page limits", () => {
    expect(()=>rosterPdfColumns(createRosterExportSnapshot("t","members",[{id:"1",name:"名".repeat(C.maxCharacters)}],[]))).toThrow("上限");
    expect(()=>rosterPdfColumns(createRosterExportSnapshot("t","members",Array.from({length:C.maxEntries+1},(_,i)=>({id:String(i),name:"a"})),[]))).toThrow("上限");
    expect(()=>rosterPdfColumns(createRosterExportSnapshot("t","members",[],Array.from({length:C.maxColumns+1},(_,i)=>({id:String(i),name:"g",memberIds:[]}))))).toThrow("256");
    expect(()=>chooseRosterTablePlan([column(4000)])).toThrow("100ページ");
  });
});
