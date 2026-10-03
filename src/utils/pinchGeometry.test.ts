import { describe, expect, it } from "vitest";
import { stickyRulerTranslate, resolvePinchView, stageAnchorMeters, type PinchGeometry } from "./pinchGeometry";
const geometry: PinchGeometry = {
  viewport: { left: 100, top: 20, width: 700, height: 500 },
  padding: { left: 14, right: 14, top: 10, bottom: 14 },
  fixed: { left: 58, right: 58, top: 28 }, stageMeters: { width: 20, height: 100 },
  startZoom: 1, pixelsPerMeter: 32, startScroll: { x: 20, y: 400 },
  startOrigin: { x: 14, y: 10 }, anchorMeters: { x: 8, y: 18 },
};
describe("pinch stage anchor geometry", () => {
  it("holds metres relative to the stage body rather than the fixed-width rulers", () => {
    expect(stageAnchorMeters({ x: 400, y: 600 }, { x: 144, y: 24 }, 32)).toEqual({ x: 8, y: 18 });
    const view = resolvePinchView(geometry, 1.5, { x: 450, y: 270 });
    expect(view.anchor).toEqual({ x: 58 + 8 * 48, y: 28 + 18 * 48 });
    expect(view.scroll.x).toBe(14 + 58 + 8 * 48 - 350);
    expect(view.scroll.y).toBe(10 + 28 + 18 * 48 - 250);
    expect(geometry.startOrigin.x-geometry.startScroll.x+(58+8*32)*view.scale+view.translate.x).toBeCloseTo(350);
  });
  it.each([{ x: -1000, y: -1000 }, { x: 3000, y: 8000 }])("clamps preview and final view identically at either edge", mid => {
    const v = resolvePinchView(geometry, .75, mid);
    expect(v.scroll.x).toBeGreaterThanOrEqual(0); expect(v.scroll.x).toBeLessThanOrEqual(Math.max(0,v.width+28-700));
    expect(v.scroll.y).toBeGreaterThanOrEqual(0); expect(v.scroll.y).toBeLessThanOrEqual(v.height+24-500);
    expect(geometry.startOrigin.x-geometry.startScroll.x+(58+8*32)*v.scale+v.translate.x).toBeCloseTo(v.origin.x+v.anchor.x-v.scroll.x);
  });
  it("includes centering and padding after shrinking below the viewport", () => {
    const v = resolvePinchView(geometry, .5, { x: 450, y: 270 });
    expect(v.origin.x).toBe(14+(700-28-v.width)/2); expect(v.scroll.x).toBe(0);
  });
  it("countertranslates a sticky ruler to exactly its viewport position at any scale", () => {
    for (const scale of [.5, 1, 1.75, 3]) {
      const top = 20, origin = -390, translate = -120;
      const correction = stickyRulerTranslate(top, origin, top, origin, scale, translate);
      expect(origin + translate + scale * (top - origin + correction)).toBeCloseTo(top);
    }
  });
  it("follows natural content above padding until reaching the sticky viewport edge", () => {
    const origin = 40, edge = 20;
    expect(stickyRulerTranslate(40, 30, edge, origin, 2, -10)).toBe(0);
    expect(stickyRulerTranslate(40, 10, edge, origin, 2, -30)).toBe(5);
    // Final fixed-width ruler placement differs from the scaled old layout.
    expect(stickyRulerTranslate(40, 35, edge, origin, 2, -10)).toBe(2.5);
  });
});
