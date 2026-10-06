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
    expect(context.fillStyle).toBe("#64748b"); expect(context.globalAlpha).toBe(0.7);
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

  it("uses a bounded canvas, moves by transform without measuring/drawing every frame, and rebases by window", () => {
    size.width = 900;
    const long = { durationSec: 900, peaks: new Float32Array(1600).fill(0.5) };
    const measure = vi.mocked(HTMLCanvasElement.prototype.getBoundingClientRect);
    const view = render(<WaveformCanvas data={long} currentTime={30} visibleSeconds={30} songDuration={900} />);
    const canvas = view.container.querySelector("canvas")!;
    expect(canvas.style.width).toBe("300%"); expect(canvas.width).toBe(1800);
    expect(context.clearRect).toHaveBeenCalledOnce(); expect(measure).toHaveBeenCalledOnce();
    expect(canvas.style.transform).toBe("translate3d(-150px,0,0)");
    for (const time of [30.1, 31, 45, 59.9]) view.rerender(<WaveformCanvas data={long} currentTime={time} visibleSeconds={30} songDuration={900} />);
    expect(context.clearRect).toHaveBeenCalledOnce(); expect(measure).toHaveBeenCalledOnce();
    view.rerender(<WaveformCanvas data={long} currentTime={60} visibleSeconds={30} songDuration={900} />);
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    expect(context.fillRect.mock.calls.every(call => call[2] <= 2)).toBe(true);
    // Half a viewport of blank space at the start/end, with no phantom waveform outside the song.
    view.rerender(<WaveformCanvas data={long} currentTime={0} visibleSeconds={30} songDuration={900} />);
    expect(canvas.style.transform).toBe("translate3d(-150px,0,0)");
  });
});
