// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createTouchScroller } from "./touchScroll";
afterEach(() => vi.restoreAllMocks());
const setup = () => {
  const el = document.createElement("div");
  Object.defineProperties(el, { scrollWidth: { value: 2000 }, scrollHeight: { value: 5000 }, clientWidth: { value: 500 }, clientHeight: { value: 500 } });
  el.scrollTop = 500; el.scrollLeft = 400;
  let callback: FrameRequestCallback | undefined, now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(fn => { callback = fn; return 1; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => { callback = undefined; });
  const step = () => { const fn = callback; callback = undefined; now += 16; fn?.(now); return Boolean(fn); };
  return { el, pan: createTouchScroller(el), step, pending: () => Boolean(callback) };
};
const point = (y: number, timeStamp: number, pointerId = 1) => ({ clientX: 300, clientY: y, timeStamp, pointerId });
it("scrolls one finger, decelerates without a release jump and comes to rest", () => {
  const { el, pan, step, pending } = setup();
  pan.start(point(300, 0)); expect(pan.move(point(298, 10))).toBe(false);
  pan.move(point(250, 20)); pan.move(point(200, 40)); expect(el.scrollTop).toBe(600);
  pan.end(point(200, 45)); expect(el.scrollTop).toBe(600);
  const deltas: number[] = [];
  for (let i = 0; i < 200 && pending(); i++) { const before = el.scrollTop; step(); deltas.push(el.scrollTop - before); }
  expect(el.scrollTop).toBeGreaterThan(600); expect(pending()).toBe(false);
  expect(deltas.every((d, i) => !i || d <= deltas[i - 1] + .001)).toBe(true);
});
it("stops at an edge, on cancel/new gesture, and ignores other pointers", () => {
  const { el, pan, step, pending } = setup(); el.scrollTop = 4350;
  pan.start(point(300, 0)); expect(pan.move(point(200, 20, 2))).toBe(false);
  pan.move(point(200, 20)); pan.end(point(200, 25));
  for (let i = 0; i < 200 && pending(); i++) step();
  expect(el.scrollTop).toBe(4500); expect(pending()).toBe(false);
  el.scrollTop = 500; pan.start(point(300, 30)); pan.move(point(200, 50)); pan.end(point(200, 55), true);
  expect(pending()).toBe(false);
  pan.start(point(300, 60)); pan.move(point(200, 80)); pan.end(point(200, 85)); expect(pending()).toBe(true);
  pan.start(point(100, 90)); expect(pending()).toBe(false);
});
