// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { StaticStagePreview } from "./StaticStagePreview";
import { formationExportFixture } from "../utils/formationExportFixture";
import { createHorizontalRulerLabels } from "../utils/horizontalRuler";
import { createHorizontalGridLines } from "../utils/horizontalGrid";
import { defaultPrintOptions } from "../utils/printLayout";
import type { Project, ViewerPerspective } from "../types";
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

it('puts the centre counts beside the displayed 0m line without changing any height', () => {
  const previews = (project: Project, viewerPerspective: ViewerPerspective, extra: Partial<typeof defaultPrintOptions> = {}) =>
    [...new DOMParser().parseFromString(renderToStaticMarkup(<PrintPreview project={project}
      options={{ ...defaultPrintOptions, includeAssignments: true, viewerPerspective, ...extra }}/>), 'text/html')
      .querySelectorAll<HTMLElement>('.print-stage-preview')];
  const project = formationExportFixture();
  project.useGlobalStageSize = false;
  // One wide scene sets the common scale, so the first two scenes share page 1 with a scene gap between them.
  [[30, 4], [12, 3], [12, 3]].forEach(([w, d], i) => { project.frames[i].stageWidthMeters = w; project.frames[i].stageDepthMeters = d; });
  const audience = previews(project, 'audience'), performer = previews(project, 'performer');
  expect(audience.length).toBe(3);
  expect(audience.every(el => el.classList.contains('is-ruler-bottom'))).toBe(true);
  expect(performer.some(el => el.classList.contains('is-ruler-bottom') || el.classList.contains('has-scene-gap'))).toBe(false);
  // Only a scene followed by a gap masks the gap grid behind its labels.
  expect(audience.map(el => el.classList.contains('has-scene-gap'))).toEqual(audience.map(el => !!el.querySelector('.print-scene-gap-start')));
  expect(audience.some(el => el.classList.contains('has-scene-gap'))).toBe(true);
  audience.forEach((el, i) => {
    // The two margins swap; the drawing height and the total stay the same.
    const [top, stage] = el.style.gridTemplateRows.split(' ');
    const [performerTop, performerStage] = performer[i].style.gridTemplateRows.split(' ');
    expect(stage).toBe(performerStage);
    expect(top).toBe(performer[i].style.paddingBottom);
    expect(el.style.paddingBottom).toBe(performerTop);
    expect(el.style.getPropertyValue('--print-ruler-x-top-mm')).not.toBe('');
    expect(performer[i].style.getPropertyValue('--print-ruler-x-top-mm')).toBe('');
  });
  // Old data with the front at the top has 0m at the top for the audience.
  const top = formationExportFixture(); top.stage.frontDirection = 'top';
  expect(previews(top, 'audience').some(el => el.classList.contains('is-ruler-bottom'))).toBe(false);
  expect(previews(top, 'performer').every(el => el.classList.contains('is-ruler-bottom'))).toBe(true);
  // Parades and drawings without rulers keep today's layout.
  const parade = formationExportFixture(); parade.mode = 'parade';
  parade.paradeSettings = { totalDistance: 100, width: 12, cellSizeMeters: 1, direction: 'up', rulerPosition: 'both', emphasizeEvery5m: true, emphasizeEvery10m: true };
  for (const view of ['audience', 'performer'] as const) {
    expect(previews(parade, view).some(el => el.classList.contains('is-ruler-bottom'))).toBe(false);
    expect(previews(project, view, { includeMeterRulers: false }).some(el => el.classList.contains('is-ruler-bottom'))).toBe(false);
  }
  // The roster's small drawing follows the same side.
  const small = (viewerPerspective: ViewerPerspective) => new DOMParser().parseFromString(renderToStaticMarkup(<StaticStagePreview project={project}
    frame={project.frames[1]} stageWidth={12} range={{ left: 0, right: 12, top: 0, bottom: 8 }} outputWidth={500} viewerPerspective={viewerPerspective}/>), 'text/html')
    .querySelector('.print-stage-preview')!.classList.contains('is-ruler-bottom');
  expect([small('audience'), small('performer')]).toEqual([true, false]);
});
