// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { StaticStagePreview } from "./StaticStagePreview";
import { formationExportFixture } from "../utils/formationExportFixture";
import { createHorizontalRulerLabels } from "../utils/horizontalRuler";
import { createHorizontalGridLines } from "../utils/horizontalGrid";
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
  for (const html of [a4, staticHtml, cropped]) {
    const output = new DOMParser().parseFromString(html, 'text/html');
    const isCrop = html === cropped;
    const expectedLines = createHorizontalGridLines(width, counting, 1)
      .filter(line => line.kind === 'counting' && (!isCrop || (line.positionMeters >= width / 2 && line.positionMeters <= width / 2 + 2)));
    const actualLines = [...output.querySelector('.print-stage-guides')!.querySelectorAll('.print-counting-line')];
    expect(actualLines.map(line => Number(line.getAttribute('x1')))).toEqual(expectedLines.map(line => line.positionMeters));
    for (const line of actualLines) expect(line.getAttribute('x1')).toBe(line.getAttribute('x2'));
    expect(actualLines.length).toBe(new Set(actualLines.map(line => line.getAttribute('x1'))).size);
  }
 });
}

it('uses each scene width while preserving the common A4 scale and frame', () => {
  const project = formationExportFixture();
  project.useGlobalStageSize = false;
  project.stage.horizontalGuideMode = 'centerSplit';
  project.frames[0].stageWidthMeters = 10.3;
  project.frames[1].stageWidthMeters = 13;
  const dom = new DOMParser().parseFromString(renderToStaticMarkup(<PrintPreview project={project}/>), 'text/html');
  const rulers = [...dom.querySelectorAll('.print-ruler-x')];
  expect([...rulers[0].children].map(el => el.textContent)).toEqual(createHorizontalRulerLabels(10.3, 'centerSplit').map(l => l.label));
  expect([...rulers[1].children].map(el => el.textContent)).toEqual(createHorizontalRulerLabels(13, 'centerSplit').map(l => l.label));
  const centers = [...dom.querySelectorAll('.print-center-line')];
  expect(Number(centers[0].getAttribute('x1'))).toBe(5.15);
  expect(Number(centers[1].getAttribute('x1'))).toBe(6.5);
  const viewBoxes = [...dom.querySelectorAll('.print-stage-guides')].map(el => el.getAttribute('viewBox')?.split(' ')[2]);
  expect(new Set(viewBoxes)).toEqual(new Set(['13']));
});
