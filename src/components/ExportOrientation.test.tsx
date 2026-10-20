// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { PrintPreview } from "./PrintPreview";
import { defaultPrintOptions } from "./PrintStagePreview";
import { StaticStagePreview } from "./StaticStagePreview";
import { StageCanvas } from "./StageCanvas";
import { formationExportFixture } from "../utils/formationExportFixture";
import { createDefaultObjectState, getSnapshotForFrame } from "../utils/interpolation";
import { normalizeProject } from "../project/normalizeProject";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const sorted = (items: number[]) => items.sort((a,b) => a-b);
for (const perspective of ["audience", "performer"] as const)
for (const front of ["bottom", "top", "left", "right"] as const)
for (const mode of ["meters", "centerSplit"] as const) {
  it(`${perspective}/${front}/${mode}: both renderers match the editor`, () => {
    const p = formationExportFixture();
    p.viewerPerspective = perspective === "audience" ? "performer" : "audience";
    p.stage = { ...p.stage, widthMeters: 9.3, depthMeters: 5.4, gridSizeMeters: .5,
      horizontalGuideMode: mode, frontDirection: front, emphasizeVerticalNumbers: true };
    p.members = p.members.slice(0,5);
    const f = p.frames[0]; p.frames = [f];
    f.positions = { m0: {x:.8,y:.6}, m1:{x:7.6,y:4.2}, m2:{x:4.1,y:1.7}, m3:{x:2,y:2},m4:{x:3,y:3} };
    f.objectStates.flag = { ...createDefaultObjectState(p.stageObjects[0]), x:2, y:1.1, widthMeters:2, heightMeters:.6, rotation:137 };
    f.annotationLines = { a: { x1:-1, y1:.8, x2:6, y2:4.6, color:"red", dash:"dashed" } };
    f.objectAssignments = { flag: ["m3", "m4"] };
    const before = JSON.stringify(p), noop = vi.fn();
    const props: ComponentProps<typeof StageCanvas> = {
      project:p, snapshot:getSnapshotForFrame(p,f.id), selected:null, selectedFrameId:f.id, selectedFrameLabel:f.label,
      selectedFrameTime:0, selectedMemberIds:[], isMemberSelectionMode:false, focusMode:false, isFullscreen:false,
      canUndo:false, canRedo:false, mode:"members", isPlaying:false, viewerPerspective:perspective,
      showMovementPaths:false, showMeterRulers:true, movementPathMode:"all", currentTime:0, audioDuration:100, audioName:null,
      onUndo:noop,onRedo:noop,onSelect:noop,onStagePointerPositionChange:noop,onMoveMember:noop,onUpdateObjectState:noop,
      onBeginProjectEdit:noop,onEndProjectEdit:noop,onToggleFullscreen:noop,onContextMenuRequest:noop,
      onTogglePlayback:noop,onSaveFrame:noop,onCaptureStageImage:noop,onTogglePerspective:noop,onSeekAudio:noop,
    };
    const editor = parse(renderToStaticMarkup(<StageCanvas {...props} />));
    const outputs = [
      parse(renderToStaticMarkup(<PrintPreview project={p} options={{...defaultPrintOptions, viewerPerspective:perspective, includeAssignments:true}} />)),
      parse(renderToStaticMarkup(<StaticStagePreview project={p} frame={f} stageWidth={9.3} range={{left:0,right:9.3,top:0,bottom:5.4}} outputWidth={700} viewerPerspective={perspective} />)),
    ];
    for (const out of outputs) {
      const drawing = out.querySelector<HTMLElement>(".print-stage-preview")!;
      const scale = parseFloat(drawing.style.getPropertyValue("--print-stage-width-mm")) / 9.3;
      const diameter = parseFloat(drawing.style.getPropertyValue("--print-member-size"));
      const members = [...out.querySelectorAll<HTMLElement>(".print-stage .print-member")];
      const editorMembers = [...editor.querySelectorAll<HTMLElement>(".member-token")];
      expect(members.length).toBe(3);
      members.forEach((el,i) => {
        expect((parseFloat(el.style.left)+diameter/2)/scale).toBeCloseTo(parseFloat(editorMembers[i].style.left)*9.3/100,6);
        expect((parseFloat(el.style.top)+diameter/2)/scale).toBeCloseTo(parseFloat(editorMembers[i].style.top)*5.4/100,6);
      });
      const prop = out.querySelector<HTMLElement>(".print-object")!, editorProp = editor.querySelector<HTMLElement>(".stage-object")!;
      expect(parseFloat(prop.style.left)/scale).toBeCloseTo(parseFloat(editorProp.style.left.replace("calc(",""))*9.3/100,6);
      expect(parseFloat(prop.style.top)/scale).toBeCloseTo(parseFloat(editorProp.style.top.replace("calc(",""))*5.4/100,6);
      expect(prop.style.transform).toBe("rotate(137deg)");
      // The name follows the 137° prop flipped upright: net -43°, i.e. rotate(-180deg) inside the shape.
      expect((prop.firstElementChild as HTMLElement).style.transform).toBe("rotate(-180deg)");
      const assignment = out.querySelector<HTMLElement>(".print-assignment-sheet__object");
      if (assignment) expect(assignment.style.transform).toBe("");
      const line = out.querySelector("[data-annotation-line='a']")!, editorLine = editor.querySelector("[data-annotation-line='a']")!;
      for (const attr of ["x1","y1","x2","y2"]) expect(Number(line.getAttribute(attr))).toBeCloseTo(Number(editorLine.getAttribute(attr)),6);
      for (const horizontal of [true,false]) {
        const dimension = horizontal ? 9.3 : 5.4;
        const ed = [...editor.querySelectorAll<HTMLElement>(horizontal ? ".stage-grid-line--vertical" : ".stage-grid-line--horizontal")];
        const exp = [...out.querySelectorAll(".print-stage-guides [data-emphasis]")].filter(el => horizontal ? el.getAttribute("x1") === el.getAttribute("x2") : el.getAttribute("y1") === el.getAttribute("y2"));
        const expected = sorted(ed.map(el => parseFloat(horizontal ? el.style.left : el.style.top)*dimension/100));
        const actual = sorted(exp.map(el => Number(el.getAttribute(horizontal ? "x1" : "y1"))));
        expect(actual.length).toBe(expected.length); actual.forEach((n,i)=>expect(n).toBeCloseTo(expected[i],6));
        const er = [...editor.querySelectorAll<HTMLElement>(horizontal ? ".meter-ruler--horizontal .meter-ruler__tick" : ".meter-ruler--vertical-left .meter-ruler__tick")];
        const pr = [...out.querySelectorAll<HTMLElement>(horizontal ? ".print-ruler-x span" : ".print-ruler-y--left span")];
        expect(pr.length).toBe(er.length);
        pr.forEach(el => {
          const pos = (parseFloat(horizontal ? el.style.left : el.style.top)+(horizontal ? 7 : 4)/2)/scale;
          const match = er.find(e => {
            const internal = Number(e.dataset.position);
            return Math.abs((perspective === "performer" ? dimension-internal : internal)-pos)<1e-6;
          });
          expect(match).toBeDefined();
          // Editor float subtraction can render integer ticks as "3.0m".
          expect(Number.parseFloat(match!.textContent!)).toBe(Number.parseFloat(el.textContent!));
        });
      }
    }
    expect(JSON.stringify(p)).toBe(before);
  });
}

it("reflects each scene around its own dimensions, then crops the static drawing", () => {
  const p=formationExportFixture(); p.useGlobalStageSize=false; p.members=p.members.slice(0,1); p.stageObjects=[];
  p.frames=p.frames.slice(0,2);
  p.frames.forEach((f,i)=>{ f.stageWidthMeters=i?13:9.3; f.stageDepthMeters=i?7.1:5.4; f.positions={m0:{x:1,y:2}}; });
  const a4=parse(renderToStaticMarkup(<PrintPreview project={p} options={{...defaultPrintOptions,viewerPerspective:"performer"}}/>));
  const drawings=[...a4.querySelectorAll<HTMLElement>(".print-stage-preview")];
  for (const [i,f] of p.frames.entries()) {
    const w=f.stageWidthMeters!,d=f.stageDepthMeters!;
    for (const [dom,left,top] of [[drawings[i],0,0],
      [parse(renderToStaticMarkup(<StaticStagePreview project={p} frame={f} stageWidth={13} range={{left:w-3,right:w,top:d-3,bottom:d}} outputWidth={500} viewerPerspective="performer" wholeMembersWithinRange/>)).querySelector<HTMLElement>(".print-stage-preview")!,w-3,d-3]] as const) {
      const stage=dom.querySelector<HTMLElement>(".print-stage-members") ?? dom.querySelector<HTMLElement>(".print-stage")!;
      const member=stage.querySelector<HTMLElement>(".print-member")!;
      const scale=parseFloat(dom.style.getPropertyValue("--print-stage-width-mm"))/(left?3:13);
      const diameter=parseFloat(dom.style.getPropertyValue("--print-member-size"));
      expect((parseFloat(member.style.left)+diameter/2)/scale).toBeCloseTo(w-1-left,6);
      expect((parseFloat(member.style.top)+diameter/2)/scale).toBeCloseTo(d-2-top,6);
    }
  }
});

it("keeps parade output independent of perspective and loads old projects as audience without changing coordinates", () => {
  const old=formationExportFixture(); delete old.viewerPerspective;
  const coordinates=JSON.stringify(old.frames.map(f=>f.positions));
  const loaded=normalizeProject(old);
  expect(loaded.viewerPerspective ?? "audience").toBe("audience");
  expect(JSON.stringify(loaded.frames.map(f=>f.positions))).toBe(coordinates);
  const p=formationExportFixture(); p.mode="parade";
  p.paradeSettings={width:12,totalDistance:12,backwardDistanceMeters:2,cellSizeMeters:.5,direction:"up",rulerPosition:"both",emphasizeEvery5m:true,emphasizeEvery10m:true};
  const html=(perspective:"performer"|"audience")=>renderToStaticMarkup(<PrintPreview project={p} options={{...defaultPrintOptions,viewerPerspective:perspective}}/>);
  expect(html("performer")).toBe(html("audience"));
});
