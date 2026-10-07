// @vitest-environment jsdom
import { fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useAnnotationEditor } from "./useAnnotationEditor";
import type { AnnotationLine } from "../types";
import { withExportClone } from "../utils/exportImage";
beforeAll(() => {
  class TestPointer extends MouseEvent { pointerId: number; constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; } }
  window.PointerEvent = TestPointer as unknown as typeof PointerEvent;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  SVGElement.prototype.setPointerCapture = () => {};
  SVGElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 360, bottom: 240, width: 360, height: 240, toJSON: () => ({}) });
});
afterEach(cleanup);
const emptyLines = {};
const Harness = ({ onChange, context = "scene1", disabled = false, lines = emptyLines, step = 1, verticalOrigin = 0, reflected = false }: { onChange: (id: string, line: AnnotationLine | null) => void; context?: string; disabled?: boolean; lines?: Record<string, AnnotationLine>; step?: number; verticalOrigin?: number; reflected?: boolean }) => {
  const editor = useAnnotationEditor({ lines, width: 12, depth: 8, step, counting: "centerSplit", verticalOrigin, reflected, context, disabled, onChange });
  return <>{editor.toolbar}{editor.inkLayer}{editor.interactionLayer}</>;
};
describe("annotation gesture commit boundaries", () => {
  it("commits one snapped diagonal on pointer-up; zero length is ignored", () => {
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} />); fireEvent.click(view.getByText("線を引く"));
    const svg = view.container.querySelector(".annotation-interaction-layer")!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 30, clientY: 30 }); fireEvent.pointerUp(svg, { pointerId: 1 }); expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 30, clientY: 30 }); fireEvent.pointerMove(svg, { pointerId: 2, clientX: 150, clientY: 120 }); expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(svg, { pointerId: 2 }); expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toMatchObject({ x1: 1, y1: 1, x2: 5, y2: 4 });
  });
  it.each(["pointercancel", "two fingers", "outside second touch", "完了", "Esc", "scene", "playback", "sync/Undo"])("cancels pending drawing on %s", interruption => {
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} step={0.5} />); fireEvent.click(view.getByText("線を引く"));
    const svg = view.container.querySelector(".annotation-interaction-layer")!; fireEvent.pointerDown(svg, { pointerId: 1, clientX: 37.5, clientY: 37.5 }); fireEvent.pointerMove(svg, { pointerId: 1, clientX: 157.5, clientY: 127.5 });
    if (interruption === "pointercancel") fireEvent.pointerCancel(svg, { pointerId: 1 });
    if (interruption === "two fingers") fireEvent.pointerDown(svg, { pointerId: 2, clientX: 60, clientY: 60 });
    if (interruption === "outside second touch") fireEvent.pointerDown(document.body, { pointerId: 2, clientX: 600, clientY: 60 });
    if (interruption === "完了") fireEvent.click(view.getByText("完了"));
    if (interruption === "Esc") fireEvent.keyDown(window, { key: "Escape" });
    if (interruption === "scene") view.rerender(<Harness onChange={onChange} context="scene2" />);
    if (interruption === "playback") view.rerender(<Harness onChange={onChange} disabled />);
    if (interruption === "sync/Undo") view.rerender(<Harness onChange={onChange} lines={{}} />);
    fireEvent.pointerUp(svg, { pointerId: 1 }); expect(onChange).not.toHaveBeenCalled();
  });
  it.each([false, true])("draws both endpoints on half steps (reflected=%s), with ink only in the lower SVG", reflected => {
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} step={0.5} reflected={reflected} />);
    fireEvent.click(view.getByText("線を引く"));
    const svg = view.container.querySelector(".annotation-interaction-layer")!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 37.5, clientY: 37.5 });
    expect(view.container.querySelector(".annotation-layer [data-annotation-line]")).not.toBeNull();
    expect(svg.querySelector("[data-annotation-line]")).toBeNull();
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 157.5, clientY: 127.5 }); fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(onChange.mock.calls[0][1]).toMatchObject(reflected ? { x1: 10.75, y1: 6.75, x2: 6.75, y2: 3.75 } : { x1: 1.25, y1: 1.25, x2: 5.25, y2: 4.25 });
  });
  it.each(["start", "end"])("adjusts only the %s endpoint to a half step", end => {
    const line: AnnotationLine = { x1: 1.13, y1: 1.17, x2: 5.19, y2: 4.23, color: "blue", dash: "solid" };
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} lines={{ line }} step={0.5} />);
    fireEvent.click(view.getByText("線を引く")); const svg = view.container.querySelector(".annotation-interaction-layer")!;
    fireEvent.pointerDown(svg.querySelector('[data-line-id="line"]')!, { pointerId: 1, clientX: 90, clientY: 90 }); fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(svg.querySelector(`[data-endpoint="${end}"]`)!, { pointerId: 2, clientX: 90, clientY: 90 });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 67.5, clientY: 82.5 }); fireEvent.pointerUp(svg, { pointerId: 2 });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("line", end === "start" ? { ...line, x1: 2.25, y1: 2.75 } : { ...line, x2: 2.25, y2: 2.75 });
  });
  it("snaps the moving start only and preserves the original vector/length", () => {
    const line: AnnotationLine = { x1: 1.13, y1: 1.17, x2: 5.19, y2: 4.23, color: "red", dash: "dashed" };
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} lines={{ line }} step={0.5} />);
    fireEvent.click(view.getByText("線を引く")); const svg = view.container.querySelector(".annotation-interaction-layer")!;
    fireEvent.pointerDown(svg.querySelector('[data-line-id="line"]')!, { pointerId: 1, clientX: 90, clientY: 90 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 123.6, clientY: 137.4 }); fireEvent.pointerUp(svg, { pointerId: 1 });
    const moved = onChange.mock.calls[0][1] as AnnotationLine;
    expect(moved).toMatchObject({ x1: 2.25, y1: 2.75 });
    expect(moved.x2 - moved.x1).toBeCloseTo(line.x2 - line.x1, 12); expect(moved.y2 - moved.y1).toBeCloseTo(line.y2 - line.y1, 12);
    expect(Math.hypot(moved.x2 - moved.x1, moved.y2 - moved.y1)).toBeCloseTo(Math.hypot(line.x2 - line.x1, line.y2 - line.y1), 12);
  });
  it("settings and sync/Undo/Redo display existing off-grid coordinates without committing", () => {
    const line: AnnotationLine = { x1: 1.13, y1: 1.17, x2: 5.19, y2: 4.23, color: "blue", dash: "solid" };
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} lines={{ line }} />);
    fireEvent.click(view.getByText("線を引く"));
    for (const step of [0.1, 0.5, 2]) {
      view.rerender(<Harness onChange={onChange} lines={{ line: { ...line } }} step={step} verticalOrigin={7.13} />);
      const ink = view.container.querySelector("[data-annotation-line]")!;
      expect(["x1", "y1", "x2", "y2"].map(k => Number(ink.getAttribute(k)))).toEqual([line.x1, line.y1, line.x2, line.y2]);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
  it("removes the entire interaction SVG including selected handles from image/camera clones", async () => {
    const line: AnnotationLine = { x1: 1, y1: 1, x2: 5, y2: 4, color: "blue", dash: "solid" };
    const view = render(<Harness onChange={vi.fn()} lines={{ line }} />); fireEvent.click(view.getByText("線を引く"));
    const svg = view.container.querySelector(".annotation-interaction-layer")!;
    fireEvent.pointerDown(svg.querySelector('[data-line-id="line"]')!, { pointerId: 1, clientX: 90, clientY: 90 }); fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(svg.querySelectorAll("[data-endpoint]")).toHaveLength(2);
    vi.spyOn(view.container, "getBoundingClientRect").mockReturnValue({ width: 360, height: 240 } as DOMRect);
    await withExportClone(view.container, async clone => {
      expect(clone.querySelector("[data-annotation-line]")).not.toBeNull();
      expect(clone.querySelector(".annotation-interaction-layer, [data-endpoint], [data-ephemeral]")).toBeNull();
    });
    expect(svg.querySelectorAll("[data-endpoint]")).toHaveLength(2);
  });
});
