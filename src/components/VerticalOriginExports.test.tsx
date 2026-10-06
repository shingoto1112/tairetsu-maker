// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrintPreview } from './PrintPreview';
import { StaticStagePreview } from './StaticStagePreview';
import { defaultPrintOptions } from './PrintStagePreview';
import { formationExportFixture } from '../utils/formationExportFixture';
import { lineEmphasis, verticalEmphasizedLines } from '../utils/gridEmphasis';
for (const origin of ['top', 'bottom'] as const) for (const perspective of ['audience', 'performer'] as const) {
 it(`${origin} ${perspective}: each scene uses its own depth`, () => {
  const p = formationExportFixture(); p.useGlobalStageSize = false; p.viewerPerspective = perspective;
  p.frames[0].stageDepthMeters = 8; p.frames[1].stageDepthMeters = 12.5; p.frames = p.frames.slice(0, 2);
  const dom = new DOMParser().parseFromString(renderToStaticMarkup(<PrintPreview project={p} options={{...defaultPrintOptions, verticalOrigin: origin}}/>), 'text/html');
  const rulers = dom.querySelectorAll('.print-ruler-y');
  for (const [index, depth] of [8, 12.5].entries()) {
   const labels = [...rulers[index * 2].querySelectorAll('span')].map(el => el.textContent);
   expect(labels[0]).toBe(origin === 'top' ? '0m' : `${depth}m`);
   expect(labels[labels.length - 1]).toBe(origin === 'top' ? `${depth}m` : '0m');
  }
 });
}
for(const origin of ['top','bottom'] as const)for(const depth of [12,12.5])for(const front of ['top','bottom','left','right'] as const)for(const flag of ['off','numbers','every5','every10'] as const){
 it(`${origin} ${depth} ${front} ${flag}: rulers and emphasis share full-stage origin`,()=>{
  const p=formationExportFixture();p.useGlobalStageSize=true;p.stage={...p.stage,depthMeters:depth,frontDirection:front,gridSizeMeters:.3,emphasizeVerticalNumbers:flag==='numbers',emphasizeVerticalEvery5m:flag==='every5',emphasizeVerticalEvery10m:flag==='every10'};
  const flags={numbers:flag==='numbers',every5:flag==='every5',every10:flag==='every10'};
  for(const l of verticalEmphasizedLines(depth,.3,p.stage,undefined,true,2.25,depth-1,origin))expect(l.emphasis).toBe(lineEmphasis(origin==='top'?l.positionMeters:depth-l.positionMeters,flags));
  const dom=new DOMParser().parseFromString(renderToStaticMarkup(<PrintPreview project={p} options={{...defaultPrintOptions,verticalOrigin:origin}}/>),'text/html');
  const ruler=dom.querySelector('.print-ruler-y')!;const texts=[...ruler.querySelectorAll('span')].map(e=>e.textContent);expect(texts[0]).toBe(origin==='top'?'0m':`${depth}m`);expect(texts[texts.length-1]).toBe(origin==='top'?`${depth}m`:'0m');
  const crop=new DOMParser().parseFromString(renderToStaticMarkup(<StaticStagePreview project={p} frame={p.frames[0]} stageWidth={12} range={{left:0,right:12,top:2.25,bottom:depth-1}} outputWidth={500} verticalOrigin={origin}/>),'text/html');
  expect([...crop.querySelectorAll('.print-ruler-y span')].map(e => e.textContent)).not.toContain('0m');
 });
}
it('explicit export origin does not affect parade or implicit editor behavior',()=>{const p=formationExportFixture();expect(verticalEmphasizedLines(12.5,1,p.stage)).toEqual(verticalEmphasizedLines(12.5,1,p.stage,undefined,true,0,12.5,'bottom'));const parade={totalDistance:20,width:12,cellSizeMeters:1,direction:'up' as const,rulerPosition:'both' as const,emphasizeEvery5m:true,emphasizeEvery10m:true};expect(verticalEmphasizedLines(20,1,p.stage,parade,true,0,20,'top')).toEqual(verticalEmphasizedLines(20,1,p.stage,parade,true,0,20,'bottom'));});
