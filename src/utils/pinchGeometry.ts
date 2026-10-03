export type Point = { x: number; y: number };
export type PinchGeometry = {
  viewport: { left: number; top: number; width: number; height: number };
  padding: { left: number; right: number; top: number; bottom: number };
  fixed: { left: number; right: number; top: number };
  stageMeters: { width: number; height: number };
  startZoom: number;
  pixelsPerMeter: number;
  startScroll: Point;
  startOrigin: Point;
  anchorMeters: Point;
};
const constrain = (n: number, max: number) => Math.min(Math.max(0, n), Math.max(0, max));

/** Fixed rulers/padding are never multiplied by zoom. No DOM reads in a gesture frame. */
export const resolvePinchView = (geometry: PinchGeometry, zoom: number, midpoint: Point) => {
  const { viewport: v, padding: p, fixed: f, stageMeters: m } = geometry;
  const ppm = geometry.pixelsPerMeter * zoom;
  const width = m.width * ppm + f.left + f.right;
  const height = m.height * ppm + f.top;
  const origin = {
    x: p.left + Math.max(0, (v.width - p.left - p.right - width) / 2),
    y: p.top,
  };
  const anchor = { x: f.left + geometry.anchorMeters.x * ppm, y: f.top + geometry.anchorMeters.y * ppm };
  const scroll = {
    x: constrain(origin.x + anchor.x - (midpoint.x - v.left), width + p.left + p.right - v.width),
    y: constrain(origin.y + anchor.y - (midpoint.y - v.top), height + p.top + p.bottom - v.height),
  };
  const scale = zoom / geometry.startZoom;
  const startAnchor = {
    x: f.left + geometry.anchorMeters.x * geometry.pixelsPerMeter * geometry.startZoom,
    y: f.top + geometry.anchorMeters.y * geometry.pixelsPerMeter * geometry.startZoom,
  };
  // Place the scaled old stage anchor at the same clamped position as the final layout.
  const translate = {
    x: origin.x + anchor.x - scroll.x - (geometry.startOrigin.x - geometry.startScroll.x + startAnchor.x * scale),
    y: origin.y + anchor.y - scroll.y - (geometry.startOrigin.y - geometry.startScroll.y + startAnchor.y * scale),
  };
  return { width, height, origin, anchor, scroll, scale, translate };
};

export const stageAnchorMeters = (midpoint: Point, stageOrigin: Point, pixelsPerMeter: number): Point => ({
  x: (midpoint.x - stageOrigin.x) / pixelsPerMeter,
  y: (midpoint.y - stageOrigin.y) / pixelsPerMeter,
});
