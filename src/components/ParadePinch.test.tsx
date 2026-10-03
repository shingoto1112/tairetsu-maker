// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParadeCanvas } from "./ParadeCanvas";
import { createSampleProject } from "../sampleProject";

let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const flush = () => act(() => { const batch = [...frames]; frames.clear(); batch.forEach(([id, callback]) => callback(id * 16.67)); });
const props = (): ComponentProps<typeof ParadeCanvas> => {
  const project = createSampleProject(); project.mode = "parade"; project.stageObjects = [];
  project.members = Array.from({ length: 146 }, (_, i) => ({ id: `m${i}`, name: `匿名${i}`, color: "#06d6a0" }));
  const positions = Object.fromEntries(project.members.map((m,i) => [m.id, { x: i%20, y: Math.floor(i/20) }]));
  project.frames = [{ id: "one", label: "1", timeSec: 0, positions, objectStates: {}, sceneViewState: { zoom: 1, scrollLeft: 0, scrollTop: 400 } },
    { id: "two", label: "2", timeSec: 1, positions, objectStates: {}, sceneViewState: { zoom: .5, scrollLeft: 0, scrollTop: 200 } }];
  return { project, snapshot: { positions, memberVisibility: {}, memberAppearanceOverrides: {}, objectStates: {} },
    selected: null, selectedFrameId: "one", selectedFrameLabel: "1", selectedMemberIds: [], isMemberSelectionMode: false,
    focusMode: false, isFullscreen: false, canUndo: false, canRedo: false,
    onUndo: vi.fn(), onRedo: vi.fn(), onSelect: vi.fn(), onStagePointerPositionChange: vi.fn(), onMoveMember: vi.fn(),
    onUpdateObjectState: vi.fn(), onBeginProjectEdit: vi.fn(), onEndProjectEdit: vi.fn(), onToggleFullscreen: vi.fn(),
    onContextMenuRequest: vi.fn(), onReflectPreviousFrame: vi.fn(), onFrameViewStateChange: vi.fn() };
};
const touch = (id: number, x: number) => ({ pointerType: "touch", pointerId: id, clientX: x, clientY: 250 });
const begin = (v: HTMLElement) => { fireEvent.pointerDown(v, touch(1,300)); fireEvent.pointerDown(v,touch(2,500)); };
describe("parade pinch lifecycle", () => {
  beforeEach(() => {
    frames = new Map(); nextFrame = 1;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      pointerId: number; pointerType: string;
      constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? ""; }
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { const id = nextFrame++; frames.set(id,callback); return id; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(5000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const stage = this.classList.contains("parade-stage");
      const viewport = this.classList.contains("parade-viewport");
      const left = stage ? 72 : viewport ? 0 : 14, top = stage ? -362 : viewport ? 0 : -390;
      const width = stage ? parseFloat(this.style.width) : 700, height = stage ? parseFloat(this.style.height) : 500;
      return { left, top, right: left+width, bottom: top+height, x: left, y: top, width, height, toJSON: () => ({}) };
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const setup = (includeObject = false) => {
    const p = props();
    if (includeObject) {
      const sample = createSampleProject();
      p.project.stageObjects = sample.stageObjects;
      p.snapshot.objectStates = sample.frames[0].objectStates;
    }
    const view = render(<ParadeCanvas {...p} />); flush();
    vi.mocked(p.onFrameViewStateChange).mockClear();
    const viewport = view.container.querySelector<HTMLElement>(".parade-viewport")!;
    const layout = view.container.querySelector<HTMLElement>(".parade-zoom-layout")!;
    const preview = view.container.querySelector<HTMLElement>(".parade-pinch-preview")!;
    return { p, view, viewport, layout, preview };
  };
  it("does not commit or save on ordinary/locked pointer releases", () => {
    const { p, view, viewport, layout } = setup(); const width = layout.style.width;
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerUp(viewport,touch(1,300)); flush();
    fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
    begin(viewport); fireEvent.pointerUp(viewport,touch(1,300)); fireEvent.pointerCancel(viewport,touch(2,500)); flush();
    expect(p.onFrameViewStateChange).not.toHaveBeenCalled(); expect(layout.style.width).toBe(width);
  });
  it("updates only the preview transform per frame, keeps names mounted and commits once", () => {
    const { p, view, viewport, layout, preview } = setup();
    const labels = [...view.container.querySelectorAll(".parade-member__label")];
    begin(viewport); const width = layout.style.width, height = layout.style.height, scroll = [viewport.scrollLeft,viewport.scrollTop];
    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    fireEvent.pointerMove(viewport,touch(2,557)); flush();
    expect(preview.style.transform).toContain("scale(1.285)");
    expect([layout.style.width,layout.style.height]).toEqual([width,height]);
    expect([viewport.scrollLeft,viewport.scrollTop]).toEqual(scroll);
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
    expect([...view.container.querySelectorAll(".parade-member__label")]).toEqual(labels);
    expect(p.onFrameViewStateChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(viewport,touch(2,557)); fireEvent.pointerUp(viewport,touch(1,300)); flush();
    expect(p.onFrameViewStateChange).toHaveBeenCalledTimes(1);
    expect(p.onFrameViewStateChange).toHaveBeenCalledWith("one", expect.objectContaining({ zoom: 1.29 }));
    expect(layout.style.width).not.toBe(""); expect(layout.style.height).not.toBe("");
    expect(preview.style.transform).toBe(""); expect(preview.style.willChange).toBe("");
    fireEvent.scroll(viewport); flush(); expect(p.onFrameViewStateChange).toHaveBeenCalledTimes(1);
  });
  it.each(["cancel", "lock"])("commits %s once and cancels a pending frame", mode => {
    const { p, view, viewport, preview } = setup(); begin(viewport);
    fireEvent.pointerMove(viewport,touch(2,560));
    if (mode === "cancel") fireEvent.pointerCancel(viewport,touch(2,560));
    else fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
    fireEvent.pointerUp(viewport,touch(1,300)); flush();
    expect(p.onFrameViewStateChange).toHaveBeenCalledTimes(1);
    expect(preview.style.transform).toBe(""); expect(frames.size).toBe(0);
  });
  it("restores the committed source scene on scene change, with no late transform or save to the new scene", () => {
    const { p, view, viewport, preview } = setup(); begin(viewport); fireEvent.pointerMove(viewport,touch(2,560));
    view.rerender(<ParadeCanvas {...p} selectedFrameId="two" />); flush();
    expect(p.onFrameViewStateChange).toHaveBeenCalledTimes(1);
    expect(p.onFrameViewStateChange).toHaveBeenCalledWith("one", expect.objectContaining({ zoom: 1, scrollTop: 400 }));
    expect(preview.style.transform).toBe("");
    expect(view.container.querySelector<HTMLElement>(".parade-stage")!.style.width).toBe("320px");
  });
  it("cancels all gesture frames on unmount and saves only the committed view", () => {
    const { p, view, viewport, preview } = setup(); begin(viewport); fireEvent.pointerMove(viewport,touch(2,560));
    view.unmount(); flush();
    expect(frames.size).toBe(0); expect(preview.style.transform).toBe("");
    expect(p.onFrameViewStateChange).toHaveBeenCalledTimes(1);
    expect(p.onFrameViewStateChange).toHaveBeenCalledWith("one", expect.objectContaining({ zoom: 1 }));
  });
  it("flushes the latest pending scroll to its source scene before switching", () => {
    const { p, view, viewport } = setup();
    viewport.scrollTop = 987; viewport.scrollLeft = 123; fireEvent.scroll(viewport);
    view.rerender(<ParadeCanvas {...p} selectedFrameId="two" />); flush();
    expect(p.onFrameViewStateChange).toHaveBeenCalledTimes(1);
    expect(p.onFrameViewStateChange).toHaveBeenCalledWith("one", expect.objectContaining({ scrollTop: 987, scrollLeft: 123, viewportWidth: 700, viewportHeight: 500 }));
    expect(viewport.scrollTop).toBe(200);
  });
  it.each(["member", "object"])("ignores another pointer without detaching the real %s drag", async kind => {
    const { p, view } = setup(kind === "object");
    const move = kind === "member" ? p.onMoveMember : p.onUpdateObjectState;
    const member = view.container.querySelector<HTMLElement>(`.parade-${kind}`)!;
    fireEvent.pointerDown(member, { pointerType: "mouse", pointerId: 11, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 12, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(window, { pointerId: 12, clientX: 500, clientY: 500 });
    expect(move).not.toHaveBeenCalled(); expect(p.onEndProjectEdit).not.toHaveBeenCalled();
    await act(async () => { fireEvent.pointerMove(window, { pointerId: 11, clientX: 130, clientY: 100 }); });
    expect(move).toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 130, clientY: 100 });
    expect(p.onEndProjectEdit).toHaveBeenCalledTimes(1);
  });
  it.each(["member", "object"])("blocks %s drag starts during playback and resumes after stopping", async kind => {
    const { p, view } = setup(kind === "object"); view.rerender(<ParadeCanvas {...p} isPlaying />);
    const move = kind === "member" ? p.onMoveMember : p.onUpdateObjectState;
    const member = view.container.querySelector<HTMLElement>(`.parade-${kind}`)!;
    fireEvent.pointerDown(member, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    await act(async () => { fireEvent.pointerMove(window, { pointerId: 1, clientX: 130, clientY: 100 }); });
    expect(p.onBeginProjectEdit).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled();
    view.rerender(<ParadeCanvas {...p} isPlaying={false} />);
    fireEvent.pointerDown(member, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    await act(async () => { fireEvent.pointerMove(window, { pointerId: 1, clientX: 130, clientY: 100 }); });
    expect(move).toHaveBeenCalled();
  });
  it("retains 100% and pinch lock, removes zoom buttons, and accepts Ctrl/Command wheel", () => {
    const { p, view, viewport } = setup();
    expect(view.queryByTitle("拡大")).toBeNull(); expect(view.queryByTitle("縮小")).toBeNull();
    expect(view.getByRole("button", { name: "100%" })).toBeTruthy();
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 250 }); flush();
    expect(p.onFrameViewStateChange).toHaveBeenLastCalledWith("one", expect.objectContaining({ zoom: 1.14 }));
    fireEvent.wheel(viewport, { metaKey: true, deltaY: 100, clientX: 300, clientY: 250 }); flush();
    expect(p.onFrameViewStateChange).toHaveBeenLastCalledWith("one", expect.objectContaining({ zoom: 1 }));
  });
});
