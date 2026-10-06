import { describe, expect, it } from "vitest";
import { horizontalLineNumber, lineEmphasis, horizontalEmphasizedLines, verticalEmphasizedLines } from "./gridEmphasis";
import { createSampleProject } from "../sampleProject";
import { createDefaultParadeSettings } from "../project/defaults";
import { snapHorizontalPosition, horizontalGridOriginMeters } from "./horizontalGrid";
describe("grid emphasis uses full scene coordinates", () => {
  it.each([12,12.5,13,40])("numbers and priority at width %s", width => {
    for (const mode of ["meters", "centerSplit"] as const) {
      const offset = mode === "centerSplit" ? .5 : 0;
      expect(horizontalLineNumber(width/2,width,mode)).toBeUndefined();
      for (const n of [1,5,10,15,20]) for (const sign of [-1,1]) {
        const number=horizontalLineNumber(width/2+sign*(n-offset),width,mode);
        expect(number).toBe(n);
        expect(lineEmphasis(number,{every5:true})).toBe(n%5===0?"5":"none");
        expect(lineEmphasis(number,{every10:true})).toBe(n%10===0?"10":"none");
        expect(lineEmphasis(number,{numbers:true,every5:true,every10:true})).toBe(n%10===0?"10":n%5===0?"5":"number");
      }
    }
  });
  it("all OFF keeps counting positions normal; display flags cannot affect snap",()=>{
    const stage=createSampleProject().stage;
    for(const mode of ["meters","centerSplit"] as const){
      const plain=horizontalEmphasizedLines(23.5,mode,.3,stage);
      const strong=horizontalEmphasizedLines(23.5,mode,.3,{...stage,emphasizeHorizontalEvery5:true});
      expect(strong.map(l=>l.positionMeters)).toEqual(plain.map(l=>l.positionMeters));
      expect(plain.every(l=>l.emphasis==="none")).toBe(true);
      expect(snapHorizontalPosition(12.12,.3,horizontalGridOriginMeters(23.5,mode))).toBe(mode === "meters" ? 12.05 : 12.25);
    }
  });
  it("front origin, negative distance, crop and grid OFF preserve strengths",()=>{
    const stage={...createSampleProject().stage,depthMeters:12.5,emphasizeVerticalEvery5m:true};
    expect(verticalEmphasizedLines(12.5,.5,stage).find(l=>l.positionMeters===2.5)?.emphasis).toBe("5");
    const parade=createDefaultParadeSettings({totalDistance:23.5,backwardDistanceMeters:12,cellSizeMeters:.3,emphasizeEvery5m:true,emphasizeEvery10m:false});
    const full=verticalEmphasizedLines(35.5,.3,stage,parade);
    expect(full.find(l=>l.positionMeters===13.5)?.emphasis).toBe("5");
    expect(full.find(l=>l.positionMeters===23.5)?.emphasis).toBe("5");
    expect(full.find(l=>l.positionMeters===33.5)?.emphasis).toBe("5");
    expect(verticalEmphasizedLines(35.5,.3,stage,parade,true,12,34)).toEqual(full.filter(l=>l.positionMeters>=12&&l.positionMeters<=34));
    expect(verticalEmphasizedLines(35.5,.3,stage,parade,false).every(l=>l.emphasis!=="none")).toBe(true);
  });
});
