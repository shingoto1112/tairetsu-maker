import { describe, expect, it } from "vitest";
import { createHorizontalRulerLabels as labels, toHorizontalCountingMode, toParadeHorizontalMeasureMode } from "./horizontalRuler";
describe("center-based horizontal labels", () => {
  for(const width of [12,13,12.5,0.5,1,2,16,17,40,1000]) for(const mode of ["meters","centerSplit"] as const) {
    it(width + " " + mode, () => {
      const result=labels(width,mode),center=width/2;
      expect(result.every(item => item.positionMeters !== center && /^\d+$/.test(item.label))).toBe(true);
      for(const item of result) {
        const opposite=result.find(other => other.side !== item.side && other.label===item.label)!;
        expect(item.positionMeters+opposite.positionMeters).toBeCloseTo(width);
        expect(Math.abs(item.positionMeters-center)).toBeCloseTo(Number(item.label)-(mode==='centerSplit'?0.5:0));
        expect(item.positionMeters).toBeGreaterThanOrEqual(0);expect(item.positionMeters).toBeLessThanOrEqual(width);
      }
      // Up to 40m every ordinal 1, 2, 3... appears on both sides; wider stages thin evenly.
      const ordinals=[...new Set(result.map(item=>Number(item.label)))].sort((a,b)=>a-b);
      if(width<=40) expect(ordinals).toEqual(ordinals.map((_,i)=>i+1));
      else { expect(ordinals[0]).toBeGreaterThan(1); expect(result.length).toBeLessThanOrEqual(82); }
    });
  }
  it("fixed positions, legacy split edge inclusion and unchanged even-width positions",()=>{
    expect(labels(12,'meters').map(i=>i.positionMeters)).toEqual([0,1,2,3,4,5,7,8,9,10,11,12]);
    expect(labels(13,'meters').map(i=>i.positionMeters)).toEqual([0.5,1.5,2.5,3.5,4.5,5.5,7.5,8.5,9.5,10.5,11.5,12.5]);
    expect(labels(12.5,'meters')[0].positionMeters).toBe(0.25);
    expect(labels(13,'centerSplit').map(i=>i.positionMeters)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12]);
    expect(labels(1,'centerSplit')).toEqual([]);
    const all20=Array.from({length:20},(_,i)=>String(i+1));
    expect(labels(40,'meters').map(i=>i.label)).toEqual([...[...all20].reverse(),...all20]);
    expect(labels(20,'centerSplit').map(i=>i.label)).toEqual([...Array.from({length:10},(_,i)=>String(10-i)),...Array.from({length:10},(_,i)=>String(i+1))]);
    expect(labels(40,'centerSplit')[0].positionMeters).toBe(0.5);
  });
  it("rejects non-finite widths and adapts existing save values",()=>{
    for(const width of [NaN,Infinity,-1,0]) expect(labels(width,'meters')).toEqual([]);
    expect(toHorizontalCountingMode('normalMeter')).toBe('meters');
    expect(toParadeHorizontalMeasureMode('meters')).toBe('normalMeter');
  });
});