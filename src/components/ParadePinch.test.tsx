// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParadeCanvas } from "./ParadeCanvas";
import { createSampleProject } from "../sampleProject";
import type { EphemeralSession } from "../collaboration/ephemeralSession";

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
    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 700, bottom: 500, width: 700, height: 500 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const stage = this.classList.contains("parade-stage");
      const viewport = this.classList.contains("parade-viewport");
      const left = stage ? 72 : viewport ? 0 : 14, top = stage ? -362 : viewport ? 0 : -390;
      const width = stage ? parseFloat(this.style.width) : 700, height = stage ? parseFloat(this.style.height) : 500;
      return { left, top, right: left+width, bottom: top+height, x: left, y: top, width, height, toJSON: () => ({}) };
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("renders a huge remote/legacy route with bounded full-range meter labels and grid lines", () => {
    const p = props();
    p.project.paradeSettings = { totalDistance: 1e12, backwardDistanceMeters: 1e12, width: 10, cellSizeMeters: .5,
      direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true };
    const view = render(<ParadeCanvas {...p} />); flush();
    const labels = view.container.querySelectorAll(".parade-ruler span");
    expect(labels.length).toBeGreaterThan(0); expect(labels.length).toBeLessThanOrEqual(16384 * 2);
    expect(view.container.querySelectorAll(".parade-grid-line").length).toBeLessThanOrEqual(16384 * 2 + 100);
    fireEvent.scroll(view.container.querySelector(".parade-viewport")!);
    expect(view.container.querySelectorAll(".parade-ruler span").length).toBe(labels.length);
  }, 20_000);
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
  const annotationSetup = (activate = true) => {
    const p = props(); p.onAnnotationLineChange = vi.fn();
    p.project.frames[0].sceneViewState = { zoom: 2, scrollLeft: 300, scrollTop: 400 };
    const view = render(<ParadeCanvas {...p} />); flush();
    vi.mocked(p.onFrameViewStateChange).mockClear();
    const viewport = view.container.querySelector<HTMLElement>(".parade-viewport")!;
    const svg = view.container.querySelector<SVGSVGElement>(".annotation-interaction-layer")!;
    svg.setPointerCapture = vi.fn();
    if (activate) fireEvent.click(view.getByRole("button", { name: "線を引く" }));
    return { p, view, viewport, svg };
  };
  it.each(["member", "object"])("closes a locked second-touch %s drag, clears deferred previews and permits the next drag", async kind => {
    const { p, view, viewport } = setup(kind === "object");
    const ephemeral = { begin: vi.fn(), latestMeasured: vi.fn(), cancel: vi.fn(), finish: vi.fn() };
    view.rerender(<ParadeCanvas {...p} deferMemberDragCommit deferObjectDragCommit ephemeral={ephemeral as unknown as EphemeralSession} />);
    fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
    const target = view.container.querySelector<HTMLElement>(`.parade-${kind}`)!;
    const css = kind === "member" ? "--member-drag-x" : "--object-drag-x";
    const move = kind === "member" ? p.onMoveMember : p.onUpdateObjectState;
    fireEvent.pointerDown(target, { ...touch(1, 300), button: 0 });
    await act(async () => { fireEvent.pointerMove(target, touch(1, 360)); });
    expect(p.onBeginProjectEdit).toHaveBeenCalledTimes(1);
    expect(target.style.getPropertyValue(css)).not.toBe("");
    expect(move).not.toHaveBeenCalled();
    fireEvent.pointerDown(viewport, touch(2, 500));
    expect(p.onEndProjectEdit).toHaveBeenCalledTimes(1);
    expect(ephemeral.cancel).toHaveBeenCalled();
    expect(target.style.getPropertyValue(css)).toBe("");
    fireEvent.pointerUp(viewport, touch(2, 500)); fireEvent.pointerUp(target, touch(1, 360)); flush();
    expect(move).not.toHaveBeenCalled(); expect(p.onEndProjectEdit).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(target, { ...touch(3, 300), button: 0 });
    await act(async () => { fireEvent.pointerMove(target, touch(3, 360)); });
    fireEvent.pointerUp(target, touch(3, 360)); flush();
    expect(p.onBeginProjectEdit).toHaveBeenCalledTimes(2); expect(p.onEndProjectEdit).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenCalledTimes(1); expect(target.style.getPropertyValue(css)).toBe("");
  });

  it("ends a locked drag while permission is pending, ignoring a late permission reply", async () => {
    const { p, view, viewport } = setup();
    let allow!: (value: boolean) => void;
    vi.mocked(p.onBeginProjectEdit).mockImplementationOnce(() => new Promise<boolean>(resolve => { allow = resolve; }));
    fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
    const target = view.container.querySelector<HTMLElement>(".parade-member")!;
    fireEvent.pointerDown(target, { ...touch(1, 300), button: 0 });
    fireEvent.pointerMove(target, touch(1, 360));
    fireEvent.pointerDown(viewport, touch(2, 500));
    expect(p.onEndProjectEdit).toHaveBeenCalledTimes(1);
    await act(async () => { allow(true); });
    expect(p.onMoveMember).not.toHaveBeenCalled();
    expect(target.style.getPropertyValue("--member-drag-x")).toBe("");
  });
  it.each([false, true])("clears ordinary pan/inertia when entering line mode (released=%s)", released => {
    const { view, viewport, svg } = annotationSetup(false);
    const send = (type: string, x: number, time: number) => {
      const event = new PointerEvent(type, { ...touch(1, x), bubbles: true });
      Object.defineProperty(event, "timeStamp", { value: time }); fireEvent(viewport, event);
    };
    send("pointerdown", 300, 100); send("pointermove", 270, 120);
    expect(viewport.scrollLeft).toBe(330);
    if (released) { send("pointerup", 270, 130); expect(frames.size).toBeGreaterThan(0); }
    fireEvent.click(view.getByRole("button", { name: "線を引く" }));
    fireEvent.pointerMove(svg, touch(1, 230)); flush();
    expect(viewport.scrollLeft).toBe(330);
    fireEvent.pointerCancel(svg, touch(1, 230));
  });
  it("retains unlocked two-finger zoom on the SVG and discards draft ink", () => {
    const { p, svg } = annotationSetup();
    fireEvent.pointerDown(svg, touch(1, 300)); fireEvent.pointerMove(svg, touch(1, 280));
    fireEvent.pointerDown(svg, touch(2, 500)); fireEvent.pointerMove(svg, touch(2, 560)); flush();
    fireEvent.pointerUp(svg, touch(2, 560)); fireEvent.pointerMove(svg, touch(1, 250));
    fireEvent.pointerUp(svg, touch(1, 250)); flush();
    expect(vi.mocked(p.onFrameViewStateChange).mock.lastCall![1].zoom).toBeGreaterThan(2);
    expect(p.onAnnotationLineChange).not.toHaveBeenCalled();
  });
  it("draws once on the SVG at 200% without pan/inertia; completion restores ordinary pan", () => {
    const { p, view, viewport, svg } = annotationSetup();
    const scroll = [viewport.scrollLeft, viewport.scrollTop];
    fireEvent.pointerDown(svg, touch(1, 300));
    fireEvent.pointerMove(svg, { ...touch(1, 250), clientY: 200 }); flush();
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual(scroll);
    fireEvent.pointerUp(svg, { ...touch(1, 250), clientY: 200 }); flush();
    fireEvent.pointerUp(svg, touch(1, 250));
    expect(p.onAnnotationLineChange).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(viewport, touch(2, 300)); fireEvent.pointerMove(viewport, touch(2, 250));
    fireEvent.pointerUp(viewport, touch(2, 250)); flush();
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual(scroll);
    fireEvent.click(view.getByRole("button", { name: "完了" }));
    fireEvent.pointerDown(viewport, touch(3, 300)); fireEvent.pointerMove(viewport, touch(3, 250));
    expect(viewport.scrollLeft).toBe(scroll[0] + 50);
    fireEvent.pointerCancel(viewport, touch(3, 250));
  });
  it("pans on the SVG with pinch locked, fixes zoom, and waits for all fingers before another line", () => {
    const { p, view, viewport, svg } = annotationSetup();
    fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
    const scroll = [viewport.scrollLeft, viewport.scrollTop];
    fireEvent.pointerDown(svg, touch(1, 300)); fireEvent.pointerMove(svg, touch(1, 320));
    fireEvent.pointerDown(svg, touch(2, 500));
    fireEvent.pointerMove(svg, { ...touch(1, 240), clientY: 200 });
    fireEvent.pointerMove(svg, { ...touch(2, 470), clientY: 210 }); flush();
    fireEvent.pointerUp(svg, { ...touch(2, 470), clientY: 210 }); flush();
    expect([viewport.scrollLeft, viewport.scrollTop]).not.toEqual(scroll);
    expect(p.onFrameViewStateChange).toHaveBeenLastCalledWith("one", expect.objectContaining({ zoom: 2 }));
    expect(viewport.classList.contains("is-parade-pinch-locked")).toBe(true);
    fireEvent.pointerMove(svg, touch(1, 350));
    fireEvent.pointerDown(svg, touch(3, 450)); fireEvent.pointerUp(svg, touch(3, 450));
    fireEvent.pointerUp(svg, touch(1, 350)); flush();
    expect(p.onAnnotationLineChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(svg, touch(4, 300)); fireEvent.pointerMove(svg, touch(4, 250));
    fireEvent.pointerUp(svg, touch(4, 250));
    expect(p.onAnnotationLineChange).toHaveBeenCalledTimes(1);
  });
  it.each(["third finger", "cancel", "outside", "scene"])("never commits an interrupted SVG line: %s", interruption => {
    const { p, view, svg } = annotationSetup();
    fireEvent.pointerDown(svg, touch(1, 300)); fireEvent.pointerMove(svg, touch(1, 250));
    if (interruption === "third finger") {
      fireEvent.pointerDown(svg, touch(2, 500)); fireEvent.pointerDown(svg, touch(3, 600));
      fireEvent.pointerUp(svg, touch(3, 600)); fireEvent.pointerUp(svg, touch(2, 500));
    }
    if (interruption === "cancel") fireEvent.pointerCancel(svg, touch(1, 250));
    if (interruption === "outside") fireEvent.pointerMove(svg, touch(1, 800));
    if (interruption === "scene") view.rerender(<ParadeCanvas {...p} selectedFrameId="two" />);
    fireEvent.pointerUp(svg, touch(1, 250)); flush();
    expect(p.onAnnotationLineChange).not.toHaveBeenCalled();
  });
  it("does not commit or save on ordinary/locked pointer releases", () => {
    const { p, view, viewport, layout } = setup(); const width = layout.style.width;
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerUp(viewport,touch(1,300)); flush();
    fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
    begin(viewport); fireEvent.pointerUp(viewport,touch(1,300)); fireEvent.pointerCancel(viewport,touch(2,500)); flush();
    expect(p.onFrameViewStateChange).not.toHaveBeenCalled(); expect(layout.style.width).toBe(width);
  });
  it.each(["member", "object"])("defers first-touch %s selection, drops it for pinch, selects on release or movement", kind => {
    const { p, view, viewport } = setup(kind === "object");
    const target = view.container.querySelector<HTMLElement>(`.parade-${kind}`)!;
    fireEvent.pointerDown(target, { ...touch(1, 300), button: 0 });
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(viewport, touch(2, 500));
    fireEvent.pointerUp(viewport, touch(2, 500)); fireEvent.pointerUp(target, touch(1, 300)); flush();
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(target, { ...touch(3, 300), button: 0 });
    fireEvent.pointerUp(target, touch(3, 300));
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    vi.mocked(p.onSelect).mockClear();
    fireEvent.pointerDown(target, { ...touch(4, 300), button: 0 });
    fireEvent.pointerMove(target, touch(4, 310));
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    fireEvent.pointerCancel(target, touch(4, 310));
  });
  it("pans empty space with pinch locked and cancels without selecting", () => {
    const { p, view, viewport } = setup();
    fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
    fireEvent.pointerDown(viewport, touch(1, 300));
    fireEvent.pointerMove(viewport, touch(1, 250));
    expect(viewport.scrollLeft).toBe(50);
    fireEvent.pointerCancel(viewport, touch(1, 250));
    expect(p.onSelect).not.toHaveBeenCalled();
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
    expect(p.onFrameViewStateChange).toHaveBeenCalledWith("one", expect.objectContaining({ zoom: 1.285 }));
    expect(layout.style.width).not.toBe(""); expect(layout.style.height).not.toBe("");
    expect(preview.style.transform).toBe(""); expect(preview.style.willChange).toBe("");
    fireEvent.scroll(viewport); flush(); expect(p.onFrameViewStateChange).toHaveBeenCalledTimes(1);
  });
  it("ignores an older saved zoom echo during a pinch without resizing the committed DOM", () => {
    const { p, view, viewport, layout, preview } = setup();
    begin(viewport); fireEvent.pointerMove(viewport, touch(2, 560)); flush();
    const width = layout.style.width;
    const project = structuredClone(p.project);
    project.frames[0].sceneViewState!.zoom = .75;
    view.rerender(<ParadeCanvas {...p} project={project} />); flush();
    expect(layout.style.width).toBe(width);
    expect(preview.style.transform).toContain("scale(1.3)");
    fireEvent.pointerUp(viewport, touch(2, 560)); flush();
    expect(p.onFrameViewStateChange).toHaveBeenLastCalledWith("one", expect.objectContaining({ zoom: 1.3 }));
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
  it("retains pinch lock and Ctrl/Command wheel while removing navigation and reset buttons", () => {
    const { p, view, viewport } = setup();
    expect(view.queryByTitle("拡大")).toBeNull(); expect(view.queryByTitle("縮小")).toBeNull();
    expect(view.queryByRole("button", { name: "100%" })).toBeNull();
    expect(view.queryByTitle("スタートへ")).toBeNull(); expect(view.queryByTitle("ゴールへ")).toBeNull();
    expect(view.getByRole("button", { name: "全画面" }).closest(".parade-history-controls")).toBeTruthy();
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 250 }); flush();
    expect(p.onFrameViewStateChange).toHaveBeenLastCalledWith("one", expect.objectContaining({ zoom: 1.14 }));
    fireEvent.wheel(viewport, { metaKey: true, deltaY: 100, clientX: 300, clientY: 250 }); flush();
    expect(p.onFrameViewStateChange).toHaveBeenLastCalledWith("one", expect.objectContaining({ zoom: 1 }));
  });
  it("uses one group select for both reflection actions and resets deleted groups to all", () => {
    const { p, view } = setup();
    p.project.memberGroups = [{ id: "red", name: "赤組", memberIds: ["m0"] }];
    view.rerender(<ParadeCanvas {...p} />);
    const select = view.getByLabelText("対象") as HTMLSelectElement;
    expect([...select.options].map(o => o.text)).toEqual(["全員", "赤組"]);
    fireEvent.change(select, { target: { value: "red" } });
    fireEvent.click(view.getByRole("button", { name: "前シーンを反映" }));
    expect(p.onReflectPreviousFrame).toHaveBeenLastCalledWith(expect.objectContaining({ target: "group", groupId: "red", moveMeters: 0 }));
    fireEvent.click(view.getByRole("button", { name: "反映して移動" }));
    expect(p.onReflectPreviousFrame).toHaveBeenLastCalledWith(expect.objectContaining({ target: "group", groupId: "red", moveMeters: 5 }));
    view.rerender(<ParadeCanvas {...p} project={{ ...p.project, memberGroups: [] }} />);
    expect(select.value).toBe("");
    fireEvent.click(view.getByRole("button", { name: "前シーンを反映" }));
    expect(p.onReflectPreviousFrame).toHaveBeenLastCalledWith(expect.objectContaining({ target: "all", groupId: undefined }));
  });
  it("shows the foremost finite visible member center, excluding assignments, and keeps it outside the image", () => {
    const { p, view } = setup();
    const project = { ...p.project, members: p.project.members.slice(0, 5),
      paradeSettings: { totalDistance: 120, backwardDistanceMeters: 10, width: 18, cellSizeMeters: 1,
        direction: "up" as const, rulerPosition: "both" as const, emphasizeEvery5m: true, emphasizeEvery10m: true } };
    project.members[0] = { ...project.members[0], visible: false };
    project.frames[0] = { ...project.frames[0], objectAssignments: { flag: ["m1"] } };
    const snapshot = { ...p.snapshot, positions: { m0: { x: 1, y: 0 }, m1: { x: 1, y: 1 },
      m2: { x: 1, y: 8.25 }, m3: { x: 1, y: NaN }, m4: { x: 1, y: 15 } } };
    view.rerender(<ParadeCanvas {...p} project={project} snapshot={snapshot} />);
    expect(view.getByText("最前 111.75m")).toBeTruthy();
    expect(view.container.querySelector(".parade-stage-wrap")!.textContent).not.toContain("最前");
    view.rerender(<ParadeCanvas {...p} project={project} snapshot={{ ...snapshot, positions: { ...snapshot.positions, m2: { x: 1, y: 20 } } }} />);
    expect(view.getByText("最前 105m")).toBeTruthy();
    view.rerender(<ParadeCanvas {...p} project={project} snapshot={{ ...snapshot, memberVisibility: { m2: false, m3: false, m4: false } }} />);
    expect(view.getByText("最前 —")).toBeTruthy();
  });
});
