// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaveformCanvas } from "./WaveformCanvas";
import type { WaveformData } from "../utils/audioWaveform";

const data: WaveformData = { durationSec: 10, peaks: new Float32Array([0.25, 1, 0, 0.5]) };
let callback: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
let context: { setTransform: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn>; fillRect: ReturnType<typeof vi.fn>; fillStyle: string; globalAlpha: number };
let size: { width: number; height: number };
const resize = (canvas: HTMLCanvasElement, width: number, height = 48) => {
  size = { width, height };
  act(() => callback([{ target: canvas, contentRect: size } as unknown as ResizeObserverEntry], {} as ResizeObserver));
};
beforeEach(() => {
  size = { width: 200, height: 48 };
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(() => size as DOMRect);
  context = { setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "", globalAlpha: 1 };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: ResizeObserverCallback) { callback = cb; }
    observe() {} disconnect = disconnect;
  });
  vi.stubGlobal("devicePixelRatio", 2);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("WaveformCanvas", () => {
  it("does not redraw for identical data, new metadata wrappers, or class changes", () => {
    const view = render(<WaveformCanvas data={data} className="timeline-wave" />);
    const canvas = view.container.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true"); expect(canvas.classList.contains("timeline-wave")).toBe(true);
    expect(context.clearRect).toHaveBeenCalledOnce();
    view.rerender(<WaveformCanvas data={data} />);
    view.rerender(<WaveformCanvas data={{ ...data, durationSec: 20 }} />);
    resize(canvas, 200);
    expect(context.clearRect).toHaveBeenCalledOnce();
    view.rerender(<WaveformCanvas data={{ ...data, peaks: new Float32Array([1]) }} />);
    expect(context.clearRect).toHaveBeenCalledTimes(2);
  });

  it("redraws for width/height changes with DPR-sized pixels and disconnects", () => {
    const view = render(<WaveformCanvas data={data} />); const canvas = view.container.querySelector("canvas")!;
    expect(canvas.width).toBe(400); expect(canvas.height).toBe(96);
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    resize(canvas, 300); expect(canvas.width).toBe(600); expect(context.clearRect).toHaveBeenCalledTimes(2);
    resize(canvas, 300, 64); expect(canvas.height).toBe(128); expect(context.clearRect).toHaveBeenCalledTimes(3);
    view.unmount(); expect(disconnect).toHaveBeenCalledOnce();
    resize(canvas, 400); expect(context.clearRect).toHaveBeenCalledTimes(3);
  });

  it("redraws when DPR changes but ignores unchanged window resize", () => {
    const view = render(<WaveformCanvas data={data} />); const canvas = view.container.querySelector("canvas")!;
    fireEvent(window, new Event("resize")); expect(context.clearRect).toHaveBeenCalledOnce();
    vi.stubGlobal("devicePixelRatio", 3); fireEvent(window, new Event("resize"));
    expect(canvas.width).toBe(600); expect(context.clearRect).toHaveBeenCalledTimes(2);
  });

  it("keeps narrow-column maxima, clears absent data, and draws silence without bars", () => {
    size.width = 1;
    const view = render(<WaveformCanvas data={data} />);
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(0, 1, 1, 46);
    expect(context.fillStyle).toBe("#94a3b8"); expect(context.globalAlpha).toBe(0.45);
    view.rerender(<WaveformCanvas data={null} />); expect(context.clearRect).toHaveBeenCalledTimes(2);
    view.rerender(<WaveformCanvas data={{ ...data, peaks: new Float32Array(4) }} />);
    expect(context.fillRect).toHaveBeenCalledOnce();
  });

  it("waits for a visible size and tolerates unavailable canvas/ResizeObserver", () => {
    size.width = 0; const view = render(<WaveformCanvas data={data} />);
    expect(context.clearRect).not.toHaveBeenCalled();
    resize(view.container.querySelector("canvas")!, 100); expect(context.clearRect).toHaveBeenCalledOnce();
    view.unmount(); vi.stubGlobal("ResizeObserver", undefined);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(() => render(<WaveformCanvas data={data} />)).not.toThrow();
  });
});
