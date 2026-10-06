// @vitest-environment jsdom
import { fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useAnnotationEditor } from "./useAnnotationEditor";
import type { AnnotationLine } from "../types";
beforeAll(() => {
  class TestPointer extends MouseEvent { pointerId: number; constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; } }
  window.PointerEvent = TestPointer as unknown as typeof PointerEvent;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  SVGElement.prototype.setPointerCapture = () => {};
  SVGElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 360, bottom: 240, width: 360, height: 240, toJSON: () => ({}) });
});
afterEach(cleanup);
const emptyLines = {};
const Harness = ({ onChange, context = "scene1", disabled = false, lines = emptyLines }: { onChange: (id: string, line: AnnotationLine | null) => void; context?: string; disabled?: boolean; lines?: Record<string, AnnotationLine> }) => {
  const editor = useAnnotationEditor({ lines, width: 12, depth: 8, step: 1, counting: "centerSplit", context, disabled, onChange });
  return <>{editor.toolbar}{editor.layer}</>;
};
describe("annotation gesture commit boundaries", () => {
  it("commits one snapped diagonal on pointer-up; zero length is ignored", () => {
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} />); fireEvent.click(view.getByText("線を引く"));
    const svg = view.container.querySelector("svg")!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 30, clientY: 30 }); fireEvent.pointerUp(svg, { pointerId: 1 }); expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 30, clientY: 30 }); fireEvent.pointerMove(svg, { pointerId: 2, clientX: 150, clientY: 120 }); expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(svg, { pointerId: 2 }); expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toMatchObject({ x1: 1.5, y1: 1, x2: 5.5, y2: 4 });
  });
  it.each(["pointercancel", "two fingers", "outside second touch", "完了", "Esc", "scene", "playback", "sync/Undo"])("cancels pending drawing on %s", interruption => {
    const onChange = vi.fn(), view = render(<Harness onChange={onChange} />); fireEvent.click(view.getByText("線を引く"));
    const svg = view.container.querySelector("svg")!; fireEvent.pointerDown(svg, { pointerId: 1, clientX: 30, clientY: 30 }); fireEvent.pointerMove(svg, { pointerId: 1, clientX: 150, clientY: 120 });
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
});
