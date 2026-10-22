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
  bleedMeters?: number;
  /** The member bleed is also kept below the stage (horizontal ruler at the bottom); default only above.
   * Above is always kept: overflow above the scroll origin can never be scrolled into view. */
  bleedBelow?: boolean;
  bottom?: number;
  centerAtFit?: boolean;
};
const constrain = (n: number, max: number) => Math.min(Math.max(0, n), Math.max(0, max));

/** Fixed rulers/padding are never multiplied by zoom. No DOM reads in a gesture frame. */
export const resolvePinchView = (geometry: PinchGeometry, zoom: number, midpoint: Point) => {
  const { viewport: v, fixed: f, stageMeters: m } = geometry;
  const p = geometry.centerAtFit ? { left: zoom > 1 ? 8 : 0, right: zoom > 1 ? 8 : 0, top: zoom > 1 ? 8 : 0, bottom: zoom > 1 ? 8 : 0 } : geometry.padding;
  const ppm = geometry.pixelsPerMeter * zoom;
  const bleed = (geometry.bleedMeters ?? 0) * ppm;
  const width = m.width * ppm + f.left + f.right + bleed * 2;
  const height = m.height * ppm + f.top + bleed * (geometry.bleedBelow ? 2 : 1) + (geometry.bottom ?? 0);
  const origin = {
    x: p.left + Math.max(0, (v.width - p.left - p.right - width) / 2),
    y: geometry.centerAtFit && zoom <= 1 ? Math.max(0, (v.height - height) / 2) : p.top,
  };
  const anchor = { x: f.left + bleed + geometry.anchorMeters.x * ppm, y: f.top + bleed + geometry.anchorMeters.y * ppm };
  const scroll = {
    x: constrain(origin.x + anchor.x - (midpoint.x - v.left), width + p.left + p.right - v.width),
    y: constrain(origin.y + anchor.y - (midpoint.y - v.top), height + p.top + p.bottom - v.height),
  };
  const scale = zoom / geometry.startZoom;
  const startAnchor = {
    x: f.left + ((geometry.bleedMeters ?? 0) + geometry.anchorMeters.x) * geometry.pixelsPerMeter * geometry.startZoom,
    y: f.top + ((geometry.bleedMeters ?? 0) + geometry.anchorMeters.y) * geometry.pixelsPerMeter * geometry.startZoom,
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

/** Shared final anchor correction after React commits the real dimensions. */
export const commitPinchView = (container: HTMLElement, stage: HTMLElement, geometry: PinchGeometry, midpoint: Point) => {
  const rect = stage.getBoundingClientRect();
  container.scrollLeft = constrain(container.scrollLeft + rect.left + geometry.anchorMeters.x / geometry.stageMeters.width * rect.width - midpoint.x, container.scrollWidth - container.clientWidth);
  container.scrollTop = constrain(container.scrollTop + rect.top + geometry.anchorMeters.y / geometry.stageMeters.height * rect.height - midpoint.y, container.scrollHeight - container.clientHeight);
  return { x: container.scrollLeft, y: container.scrollTop };
};

/** Match sticky: follow the natural position until reaching the viewport edge. */
export const stickyRulerTranslate = (position: number, natural: number, edge: number, origin: number, scale: number, translate: number) => {
  const target = Math.max(edge, natural);
  const transformed = origin + translate + (position - origin) * scale;
  return (target - transformed) / scale;
};
