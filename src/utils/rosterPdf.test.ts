// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { drawRosterPdfPage } from "./rosterPdf";
import { planRosterPdf, ROSTER_PDF as C, type RosterPdfColumn } from "./rosterPdfLayout";

const c = (id: string, names: string[][], label = id): RosterPdfColumn => ({id,groupId:id,label,color:"rgba(255,0,0,.5)",width:30,
  header:[`■ ${label}`],names,items:names.map((lines,i)=>({id:`${id}${i}`,name:lines.join(""),no:i+1}))});
afterEach(()=>document.body.replaceChildren());
describe("PDF table DOM",()=>{
  it("contains only the table, safe text, rich header runs and shared No. rows",()=>{
    const columns=[c("g",[["<img src=x>"],["同名"]]),c("b",[["同名"]]),c("empty",[])];
    const p=planRosterPdf(columns,"portrait").pages[0],sheet=drawRosterPdfPage(p,"portrait");document.body.append(sheet);
    expect(sheet.querySelectorAll("[data-member-id]")).toHaveLength(3);
    expect(sheet.querySelector("img,input,button")).toBeNull();
    expect(sheet.textContent).toBe("No.■ g■ b■ empty12<img src=x>同名同名");
    const mark=sheet.querySelector<HTMLElement>("[data-pdf-run][style]")!;
    expect(mark.textContent).toBe("■ ");expect(mark.style.color).toBe("rgb(255, 128, 128)");
    expect(mark.nextElementSibling?.textContent).toBe("g");
    expect(sheet.querySelectorAll('[data-roster-pdf-cell]')).toHaveLength(9);
  });
  it("draws each boundary once and leaves shorter/empty columns blank below their last cell",()=>{
    const p=planRosterPdf([c("a",[["a"],["b"],["c"]]),c("b",[["d"]]),c("empty",[])],"portrait").pages[0];
    const sheet=drawRosterPdfPage(p,"portrait"),lines=[...sheet.querySelectorAll("line")];
    const keys=lines.map(l=>["x1","y1","x2","y2"].map(a=>l.getAttribute(a)).join(","));expect(new Set(keys).size).toBe(keys.length);
    const horizontal=lines.filter(l=>l.getAttribute("y1")===l.getAttribute("y2"));
    expect(horizontal).toHaveLength(1+4+3+3+1); // top, header bottoms, No. bottoms, long column, short column
    expect(lines.filter(l=>l.getAttribute("stroke-width")===String(C.thick))).toHaveLength(3);
    const right=lines.find(l=>Number(l.getAttribute("x1"))===102.5&&l.getAttribute("x1")===l.getAttribute("x2"))!;
    expect(Number(right.getAttribute("y2"))).toBe(C.inset+p.headerHeight);
  });
  it("repeats header/No. and does not restart No. on a vertical continuation",()=>{
    const names=Array.from({length:60},(_,i)=>[String(i)]),p=planRosterPdf([c("a",names)],"portrait");
    expect(p.pages.length).toBeGreaterThan(1);
    const page=p.pages[1],sheet=drawRosterPdfPage(page,"portrait");
    const cells=[...sheet.querySelectorAll("[data-roster-pdf-cell]")];
    expect(cells[0].textContent).toBe("No.");expect(cells[2].textContent).toBe(String(page.start+1));
    expect(sheet.querySelectorAll("[data-member-id]")).toHaveLength(page.end-page.start);
  });
});
