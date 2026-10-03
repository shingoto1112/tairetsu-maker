type Point = { clientX: number; clientY: number; pointerId: number; timeStamp: number };
// Exponential deceleration (~0.998 per ms), independent of 60/120Hz refresh.
const DECAY_PER_MS = 0.002;
const STOP_SPEED = 0.02;

/** DOM-only pan/inertia. No React render or project write per animation frame. */
export const createTouchScroller = (container: HTMLElement) => {
  let pan: (Point & { startX: number; startY: number; left: number; top: number; moved: boolean }) | null = null;
  let vx = 0, vy = 0, frame = 0;
  const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; pan = null; vx = vy = 0; };
  const start = (point: Point) => {
    stop();
    pan = { ...point, startX: point.clientX, startY: point.clientY, left: container.scrollLeft, top: container.scrollTop, moved: false };
  };
  const move = (point: Point) => {
    if (!pan || pan.pointerId !== point.pointerId) return false;
    if (!pan.moved && Math.hypot(point.clientX - pan.startX, point.clientY - pan.startY) < 3) return false;
    pan.moved = true;
    const left = container.scrollLeft, top = container.scrollTop;
    container.scrollLeft = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, pan.left - (point.clientX - pan.startX)));
    container.scrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, pan.top - (point.clientY - pan.startY)));
    const dt = Math.max(1, point.timeStamp - pan.timeStamp);
    // A short low-pass filter smooths irregular touch sampling, without a release kick.
    const weight = 1 - Math.exp(-dt / 30);
    vx += ((container.scrollLeft - left) / dt - vx) * weight;
    vy += ((container.scrollTop - top) / dt - vy) * weight;
    pan.clientX = point.clientX; pan.clientY = point.clientY; pan.timeStamp = point.timeStamp;
    return true;
  };
  const end = (point: Point, cancelled = false) => {
    if (!pan || pan.pointerId !== point.pointerId) return;
    if (cancelled || !pan.moved || point.timeStamp - pan.timeStamp > 100) { stop(); return; }
    pan = null;
    let last = performance.now(), x = container.scrollLeft, y = container.scrollTop;
    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(50, Math.max(0, now - last)); last = now;
      const decay = Math.exp(-DECAY_PER_MS * dt);
      x += vx * (1 - decay) / DECAY_PER_MS; y += vy * (1 - decay) / DECAY_PER_MS;
      const maxX = Math.max(0, container.scrollWidth - container.clientWidth), maxY = Math.max(0, container.scrollHeight - container.clientHeight);
      if (x <= 0 || x >= maxX) { x = Math.max(0, Math.min(maxX, x)); vx = 0; }
      if (y <= 0 || y >= maxY) { y = Math.max(0, Math.min(maxY, y)); vy = 0; }
      container.scrollLeft = x; container.scrollTop = y;
      vx *= decay; vy *= decay;
      if (Math.hypot(vx, vy) >= STOP_SPEED) frame = requestAnimationFrame(tick);
    };
    if (Math.hypot(vx, vy) >= STOP_SPEED) frame = requestAnimationFrame(tick);
  };
  return { start, move, end, stop };
};
