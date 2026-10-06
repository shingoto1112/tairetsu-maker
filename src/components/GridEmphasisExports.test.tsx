// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { defaultPrintOptions } from "./PrintStagePreview";
import { StaticStagePreview } from "./StaticStagePreview";
import { formationExportFixture } from "../utils/formationExportFixture";
const colors={none:"#e2e8f0",number:"#94a3b8","5":"#64748b","10":"#475569"};
const widths={none:1,number:1,"5":1.25,"10":1.5};
for(const mode of ["stage","parade"] as const)for(const counting of ["meters","centerSplit"] as const)for(let bits=0;bits<8;bits++){
 it(mode+" "+counting+" combination "+bits+" A4/image/PDF/mobile agree",()=>{
  const p=formationExportFixture();p.mode=mode;p.frames=p.frames.slice(0,1);p.useGlobalStageSize=true;
  const numbers=Boolean(bits&1),five=Boolean(bits&2),ten=Boolean(bits&4);
  p.stage={...p.stage,widthMeters:23.5,depthMeters:12.5,gridSizeMeters:.5,horizontalGuideMode:counting,emphasizeHorizontalNumbers:numbers,emphasizeHorizontalEvery5:five,emphasizeHorizontalEvery10:ten,emphasizeVerticalNumbers:numbers,emphasizeVerticalEvery5m:five,emphasizeVerticalEvery10m:ten};
  p.paradeSettings={width:23.5,totalDistance:23.5,backwardDistanceMeters:12,cellSizeMeters:.5,direction:"up",rulerPosition:"both",horizontalMeasureMode:counting==="meters"?"normalMeter":"centerSplit",emphasizeHorizontalNumbers:numbers,emphasizeHorizontalEvery5:five,emphasizeHorizontalEvery10:ten,emphasizeVerticalNumbers:numbers,emphasizeEvery5m:five,emphasizeEvery10m:ten};
  const depth=mode==="stage"?12.5:35.5;
  p.frames[0].positions.m0.y=0;p.frames[0].positions.m1.y=depth;
  const parse=(html:string)=>new DOMParser().parseFromString(html,"text/html");
  const a4=parse(renderToStaticMarkup(<PrintPreview project={p}/>));
  const exported=parse(renderToStaticMarkup(<StaticStagePreview project={p} frame={p.frames[0]} stageWidth={23.5} range={{left:0,right:23.5,top:0,bottom:depth}} outputWidth={700}/>));
  const lines=(dom:Document)=>[...dom.querySelectorAll(".print-stage-guides [data-emphasis]")].map(el=>({position:Number(el.getAttribute("data-position")),emphasis:el.getAttribute("data-emphasis"),color:el.getAttribute("stroke"),width:Number(el.getAttribute("stroke-width")),axis:el.getAttribute("x1")===el.getAttribute("x2")?"x":"y"}));
  const union=(dom:Document)=>[...new Map(lines(dom).map(l=>[l.axis+":"+l.position,l])).values()].sort((a,b)=>a.axis.localeCompare(b.axis)||a.position-b.position);
  const original=union(a4);expect(union(exported)).toEqual(original);
  for(const line of original){
    const d=line.axis==="x"?Math.abs(line.position-11.75)+(counting==="centerSplit"?.5:0):mode==="stage"?line.position:23.5-line.position;
    const isNumber=Math.abs(d-Math.round(d))<1e-7;
    const expected=isNumber&&ten&&Math.round(d)%10===0?"10":isNumber&&five&&Math.round(d)%5===0?"5":isNumber&&numbers?"number":"none";
    expect(line.emphasis).toBe(expected);expect(line.color).toBe(colors[expected]);expect(line.width).toBe(widths[expected]);
  }
  const cropped=parse(renderToStaticMarkup(<StaticStagePreview project={p} frame={p.frames[0]} stageWidth={23.5} range={{left:12.25,right:22.25,top:2.5,bottom:depth-1}} outputWidth={400}/>));
  expect(union(cropped)).toEqual(original.filter(l=>l.axis==="x"?l.position>=12.25&&l.position<=22.25:l.position>=2.5&&l.position<=depth-1));
  const off=parse(renderToStaticMarkup(<PrintPreview project={p} options={{...defaultPrintOptions,includeGrid:false}}/>));
  expect(union(off)).toEqual(original.filter(l=>l.emphasis!=="none"));
 });
}
