// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { StaticStagePreview } from "./StaticStagePreview";
import { formationExportFixture } from "../utils/formationExportFixture";
import { createHorizontalRulerLabels } from "../utils/horizontalRuler";
for(const mode of ['stage','parade'] as const) for(const counting of ['meters','centerSplit'] as const) for(const width of [12,13,12.5,40]) {
 it(mode+' '+counting+' '+width+' A4 and image/PDF/mobile drawing agree',()=>{
  const project=formationExportFixture();project.mode=mode;project.stage.widthMeters=width;project.stage.horizontalGuideMode=counting;
  project.paradeSettings={totalDistance:100,width,cellSizeMeters:1,direction:'up',rulerPosition:'both',emphasizeEvery5m:true,emphasizeEvery10m:true,horizontalMeasureMode:counting==='meters'?'normalMeter':'centerSplit'};
  const getLabels=(html:string)=>{const dom=new DOMParser().parseFromString(html,'text/html');return [...dom.querySelector('.print-ruler-x')!.children].map(el=>el.textContent);};
  const expected=createHorizontalRulerLabels(width,counting).map(i=>i.label);
  const a4=renderToStaticMarkup(<PrintPreview project={project}/>);
  const staticHtml=renderToStaticMarkup(<StaticStagePreview project={project} frame={project.frames[0]} stageWidth={width} range={{left:0,right:width,top:0,bottom:8}} outputWidth={500}/>);
  expect(getLabels(a4)).toEqual(expected);expect(getLabels(staticHtml)).toEqual(expected);
  const cropped=renderToStaticMarkup(<StaticStagePreview project={project} frame={project.frames[0]} stageWidth={width} range={{left:width/2,right:width/2+2,top:0,bottom:8}} outputWidth={500}/>);
  expect(getLabels(cropped)).toEqual(createHorizontalRulerLabels(width,counting).filter(i=>i.positionMeters>=width/2&&i.positionMeters<=width/2+2).map(i=>i.label));
  const dom=new DOMParser().parseFromString(a4,'text/html');
  expect([...dom.querySelectorAll('.print-ruler-y span')].every(el=>el.textContent?.endsWith('m'))).toBe(true);
 });
}
