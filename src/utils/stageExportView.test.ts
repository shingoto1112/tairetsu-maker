import { expect, it } from "vitest";
import { createStageExportView, readablePropLabelRotation } from "./stageExportView";
import { formationExportFixture } from "./formationExportFixture";
import { getEffectiveSize } from "../components/PrintStagePreview";
import { createDefaultObjectState } from "./interpolation";

it("uses each effective scene center, preserving rotation, source coordinates and endpoints before clipping", () => {
  const p = formationExportFixture(); p.useGlobalStageSize = false;
  for (const [width,depth] of [[9.3,5.4],[13,7.1]]) {
    const f=p.frames[0]; f.stageWidthMeters=width; f.stageDepthMeters=depth;
    const view=createStageExportView(getEffectiveSize(p,f),p.stage,"performer");
    expect(view.point({x:1,y:2})).toEqual({x:width-1,y:depth-2});
    const state={...createDefaultObjectState(p.stageObjects[0]),x:1,y:2,rotation:137};
    expect(view.object(state)).toEqual({...state,x:width-1-state.widthMeters,y:depth-2-state.heightMeters});
    const line={x1:-1,y1:1,x2:2,y2:4,color:"red" as const,dash:"dashed" as const};
    expect(view.annotations({line})?.line).toEqual({...line,x1:width+1,y1:depth-1,x2:width-2,y2:depth-4});
    expect(state.x).toBe(1); expect(line.x1).toBe(-1);
  }
});
it("reflects internal grids and origins: 5.4m/.5m and asymmetric center+0.5m/2m", () => {
  const stage={...formationExportFixture().stage,widthMeters:9.3,depthMeters:5.4,horizontalGuideMode:"centerSplit" as const};
  const audience=createStageExportView(stage,stage,"audience"), performer=createStageExportView(stage,stage,"performer");
  const clean=(ns:number[])=>ns.map(n=>Number(n.toFixed(6))).sort((a,b)=>a-b);
  expect(clean(audience.verticalGrid(.5,true).map(l=>l.positionMeters))).toEqual([.4,.9,1.4,1.9,2.4,2.9,3.4,3.9,4.4,4.9]);
  expect(clean(performer.verticalGrid(.5,true).map(l=>l.positionMeters))).toEqual([.5,1,1.5,2,2.5,3,3.5,4,4.5,5]);
  expect(audience.verticalLabels.find(l=>l.label==="0m")?.positionMeters).toBe(5.4);
  expect(performer.verticalLabels.find(l=>l.label==="0m")?.positionMeters).toBe(0);
  const a=audience.horizontalGrid(.3,true).map(l=>l.positionMeters), b=performer.horizontalGrid(.3,true).map(l=>l.positionMeters);
  expect(clean(b)).toEqual(clean(a.map(x=>9.3-x))); expect(clean(a)).not.toEqual(clean(b));
  expect(createStageExportView(stage,stage,"performer",true).point({x:1,y:2})).toEqual({x:1,y:2});
});
it.each([
  // [prop rotation, net text angle]: names follow the prop but never read upside down.
  [0, 0], [30, 30], [-30, -30], [-0.335, -0.335], [90, 90], [90.41, -89.59], [137, -43],
  [180, 0], [-90, 90], [270, 90], [300, -60], [450, 90], [NaN, 0],
])("prop name inside a %s° prop reads at %s°", (rotation, net) => {
  const textAngle = (Number.isFinite(rotation) ? rotation : 0) + readablePropLabelRotation(rotation);
  expect(textAngle).toBeCloseTo(net, 9);
  expect(textAngle).toBeGreaterThan(-90);
  expect(textAngle).toBeLessThanOrEqual(90);
});
