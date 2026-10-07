// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StageCanvas } from "./StageCanvas";
import { createSampleProject } from "../sampleProject";
import type { SceneViewState } from "../types";

let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const flush = () => act(() => { const batch = [...frames]; frames.clear(); batch.forEach(([id, cb]) => cb(id * 16.67)); });
const touch = (id: number, x: number) => ({ pointerType: "touch", pointerId: id, clientX: x, clientY: 250 });
const props = (): ComponentProps<typeof StageCanvas> => {
  const project = createSampleProject(); project.stageObjects = [];
  project.members = Array.from({ length: 146 }, (_, i) => ({ id: `m${i}`, name: `匿名${i}`, color: "#06d6a0" }));
  const positions = Object.fromEntries(project.members.map((m,i) => [m.id, { x: i%10, y: Math.floor(i/10)/3 }]));
  project.frames = ["one", "two"].map((id, timeSec) => ({ id, timeSec, label: id, positions, objectStates: {} }));
  return { project, compact: true, snapshot: { positions, memberVisibility: {}, memberAppearanceOverrides: {}, objectStates: {} },
    viewStates: new Map(), selected: null, selectedFrameId: "one", selectedFrameLabel: "one", selectedFrameTime: 0,
    mode: "members", isPlaying: false, isFullscreen: false, viewerPerspective: "audience", showMovementPaths: false,
    showMeterRulers: true, movementPathMode: "all", selectedMemberIds: [], isMemberSelectionMode: false, focusMode: false,
    currentTime: 0, audioDuration: 0, audioName: null, canUndo: false, canRedo: false,
    onUndo: vi.fn(), onRedo: vi.fn(), onSelect: vi.fn(), onStagePointerPositionChange: vi.fn(), onMoveMember: vi.fn(),
    onUpdateObjectState: vi.fn(), onBeginProjectEdit: vi.fn(), onEndProjectEdit: vi.fn(), onToggleFullscreen: vi.fn(),
    onContextMenuRequest: vi.fn(), onTogglePlayback: vi.fn(), onSaveFrame: vi.fn(), onCaptureStageImage: vi.fn(),
    onTogglePerspective: vi.fn(), onSeekAudio: vi.fn() };
};
describe("stage view-only pinch", () => {
  beforeEach(() => {
    frames = new Map(); nextFrame = 1;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      pointerId: number; pointerType: string;
      constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? ""; }
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { const id = nextFrame++; frames.set(id,cb); return id; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1500);
    vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 700, bottom: 500, width: 700, height: 500 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const width = parseFloat(this.style.width) || 700, height = parseFloat(this.style.height) || 500;
      return { left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, width, height, toJSON: () => ({}) };
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const setup = () => {
    const p = props(), view = render(<StageCanvas {...p} />); flush();
    const viewport = view.container.querySelector<HTMLElement>(".stage-fit-area")!;
    const layout = view.container.querySelector<HTMLElement>(".stage-zoom-layout")!;
    const preview = view.container.querySelector<HTMLElement>(".stage-pinch-preview")!;
    return { p, view, viewport, layout, preview };
  };
  const annotationSetup = (activate = true) => {
    const p = props(); p.compact = false; p.onAnnotationLineChange = vi.fn();
    p.viewStates!.set("one", { zoom: 2, scrollLeft: 300, scrollTop: 400, viewportWidth: 700 });
    const view = render(<StageCanvas {...p} />); flush();
    const viewport = view.container.querySelector<HTMLElement>(".stage-fit-area")!;
    const svg = view.container.querySelector<SVGSVGElement>(".annotation-interaction-layer")!;
    const stage = view.container.querySelector<HTMLElement>(".stage-surface")!;
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect).getMockImplementation()!;
    stage.getBoundingClientRect = () => {
      // jsdom has no layout: model the preview transform that release re-measures.
      const rect = measure.call(stage);
      const transform = view.container.querySelector<HTMLElement>(".stage-pinch-preview")!.style.transform;
      const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(transform);
      if (!match) return rect;
      const left = rect.left + Number(match[1]), top = rect.top + Number(match[2]);
      const width = rect.width * Number(match[3]), height = rect.height * Number(match[3]);
      return { ...rect, left, top, width, height, right: left + width, bottom: top + height };
    };
    svg.setPointerCapture = vi.fn();
    if (activate) fireEvent.click(view.getByRole("button", { name: "線を引く" }));
    return { p, view, viewport, svg };
  };
  it("clears an in-progress ordinary pan when entering line mode", () => {
    const { view, viewport, svg } = annotationSetup(false);
    fireEvent.pointerDown(viewport, touch(1, 300)); fireEvent.pointerMove(viewport, touch(1, 270));
    expect(viewport.scrollLeft).toBe(330);
    fireEvent.click(view.getByRole("button", { name: "線を引く" }));
    fireEvent.pointerMove(svg, touch(1, 230)); flush();
    expect(viewport.scrollLeft).toBe(330);
    fireEvent.pointerCancel(svg, touch(1, 230));
  });
  it("retains unlocked two-finger zoom on the SVG and discards draft ink", () => {
    const { p, viewport, svg } = annotationSetup();
    fireEvent.pointerDown(svg, touch(1, 300)); fireEvent.pointerMove(svg, touch(1, 280));
    fireEvent.pointerDown(svg, touch(2, 500)); fireEvent.pointerMove(svg, touch(2, 560)); flush();
    fireEvent.pointerUp(svg, touch(2, 560)); fireEvent.pointerMove(svg, touch(1, 250));
    fireEvent.pointerUp(svg, touch(1, 250)); flush();
    expect(p.viewStates!.get("one")?.zoom).toBeGreaterThan(2);
    expect(p.onAnnotationLineChange).not.toHaveBeenCalled();
    expect(viewport.classList.contains("is-stage-pinching")).toBe(false);
  });
  it("draws once on the SVG at 200% without moving the background; completion restores ordinary pan", () => {
    const { p, view, viewport, svg } = annotationSetup();
    const scroll = [viewport.scrollLeft, viewport.scrollTop];
    expect(viewport.classList.contains("is-annotation-mode")).toBe(true);
    fireEvent.pointerDown(svg, touch(1, 300));
    fireEvent.pointerMove(svg, { ...touch(1, 250), clientY: 200 }); flush();
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual(scroll);
    fireEvent.pointerUp(svg, { ...touch(1, 250), clientY: 200 }); flush();
    fireEvent.pointerUp(svg, touch(1, 250));
    expect(p.onAnnotationLineChange).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(viewport, touch(2, 300)); fireEvent.pointerMove(viewport, touch(2, 250));
    fireEvent.pointerUp(viewport, touch(2, 250));
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual(scroll);
    fireEvent.click(view.getByRole("button", { name: "完了" }));
    expect(viewport.classList.contains("is-annotation-mode")).toBe(false);
    fireEvent.pointerDown(viewport, touch(3, 300)); fireEvent.pointerMove(viewport, touch(3, 250));
    expect(viewport.scrollLeft).toBe(scroll[0] + 50);
    fireEvent.pointerCancel(viewport, touch(3, 250));
  });
  it("pans on the SVG with pinch locked, fixes zoom, and waits for all fingers before another line", () => {
    const { p, view, viewport, svg } = annotationSetup();
    fireEvent.click(view.getByRole("button", { name: "ピンチ拡大縮小をロック" }));
    const scroll = [viewport.scrollLeft, viewport.scrollTop];
    fireEvent.pointerDown(svg, touch(1, 300)); fireEvent.pointerMove(svg, touch(1, 320));
    fireEvent.pointerDown(svg, touch(2, 500));
    fireEvent.pointerMove(svg, { ...touch(1, 240), clientY: 200 });
    fireEvent.pointerMove(svg, { ...touch(2, 470), clientY: 210 }); flush();
    fireEvent.pointerUp(svg, { ...touch(2, 470), clientY: 210 }); flush();
    expect([viewport.scrollLeft, viewport.scrollTop]).not.toEqual(scroll);
    expect(p.viewStates!.get("one")?.zoom).toBe(2);
    expect(viewport.classList.contains("is-stage-pinch-locked")).toBe(true);
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
    if (interruption === "scene") view.rerender(<StageCanvas {...p} selectedFrameId="two" />);
    fireEvent.pointerUp(svg, touch(1, 250)); flush();
    expect(p.onAnnotationLineChange).not.toHaveBeenCalled();
  });
  it("changes only the preview, retains all 146 label DOM nodes, then commits memory once", () => {
    const { p, view, viewport, layout, preview } = setup();
    const set = vi.spyOn(p.viewStates!, "set"), before = structuredClone(p.project);
    const labels = [...view.container.querySelectorAll(".member-token__label")];
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerDown(viewport,touch(2,500));
    const size = [layout.style.width,layout.style.height], scroll = [viewport.scrollLeft,viewport.scrollTop];
    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    fireEvent.pointerMove(viewport,touch(2,557)); flush();
    expect(preview.style.transform).toContain("scale(1.285)");
    expect([layout.style.width,layout.style.height]).toEqual(size);
    expect([viewport.scrollLeft,viewport.scrollTop]).toEqual(scroll);
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(reads);
    expect([...view.container.querySelectorAll(".member-token__label")]).toEqual(labels);
    expect(set).not.toHaveBeenCalled();
    fireEvent.pointerUp(viewport,touch(2,557)); fireEvent.pointerUp(viewport,touch(1,300)); flush();
    expect(set).toHaveBeenCalledTimes(1); expect(p.viewStates!.get("one")?.zoom).toBeCloseTo(1.285, 8);
    expect(preview.style.transform).toBe(""); expect(p.project).toEqual(before);
    expect(p.onBeginProjectEdit).not.toHaveBeenCalled(); expect(p.onSaveFrame).not.toHaveBeenCalled();
  });
  it("does not save on ordinary or locked touch release", () => {
    const { p, view, viewport } = setup(); const set = vi.spyOn(p.viewStates!, "set");
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerUp(viewport,touch(1,300)); flush();
    expect(set).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "その他のステージ操作" }));
    fireEvent.click(view.getByRole("menuitemcheckbox"));
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerDown(viewport,touch(2,500)); fireEvent.pointerUp(viewport,touch(2,500)); flush();
    expect(set).not.toHaveBeenCalled();
  });
  it("restores each scene's last memory view and uses the old defaults for first visits", () => {
    const { p, view, viewport } = setup();
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 250 }); flush();
    viewport.scrollLeft = 234; viewport.scrollTop = 456; fireEvent.scroll(viewport);
    view.rerender(<StageCanvas {...p} selectedFrameId="two" />); flush();
    expect(p.viewStates!.get("one")).toEqual(expect.objectContaining({ zoom: 1.14, scrollLeft: 234, scrollTop: 456 }));
    expect(view.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("100%");
    view.rerender(<StageCanvas {...p} />); flush();
    expect(view.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("114%");
    expect([viewport.scrollLeft, viewport.scrollTop]).toEqual([234,456]);
    expect(p.project.frames.every(f => f.sceneViewState === undefined)).toBe(true);
  });
  it("cancels a transient pinch on scene switch without copying it to the next scene", () => {
    const { p, view, viewport, preview } = setup();
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerDown(viewport,touch(2,500)); fireEvent.pointerMove(viewport,touch(2,560));
    view.rerender(<StageCanvas {...p} selectedFrameId="two" />); flush();
    expect(preview.style.transform).toBe(""); expect(p.viewStates!.get("one")?.zoom).toBe(1);
    expect(p.viewStates!.get("two")).toBeUndefined();
  });
  it("keeps every name visible during one-finger panning in dense scenes", () => {
    // User decision 2026-10-06: names are never hidden while panning or dragging, even with 120+ members.
    const p = props(); p.compact = false; p.selectedMemberIds = ["m0","m1","m2"];
    const view = render(<StageCanvas {...p} />); flush();
    const viewport = view.container.querySelector(".stage-fit-area")!;
    const tokens = view.container.querySelectorAll(".member-token").length;
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerMove(viewport,touch(1,350));
    const named = [...view.container.querySelectorAll(".member-token")].filter(e => e.querySelector(".member-token__label"));
    expect(tokens).toBeGreaterThanOrEqual(120);
    expect(named).toHaveLength(tokens);
  });
  it("restores horizontal position with a changed viewport width", () => {
    const p = props(); p.viewStates = new Map<string, SceneViewState>([["one", { zoom: 2, scrollLeft: 300, scrollTop: 400, viewportWidth: 900 }]]);
    const view = render(<StageCanvas {...p} />); flush();
    const viewport = view.container.querySelector<HTMLElement>(".stage-fit-area")!;
    expect(viewport.scrollLeft).toBe(400); expect(viewport.scrollTop).toBe(400);
  });
  it("centers the first landscape view after StrictMode effect replay", () => {
    const p = props(); p.compact = false;
    const view = render(<StrictMode><StageCanvas {...p} /></StrictMode>);
    flush(); flush(); flush();
    const viewport = view.container.querySelector<HTMLElement>(".stage-fit-area")!;
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    expect(p.viewStates!.size).toBe(0);
  });
  it("defers one-touch selection and suppresses it for a pinch so roster scrolling cannot move the viewport", () => {
    const { p, view, viewport } = setup();
    const member = view.container.querySelector<HTMLElement>(".member-token")!;
    member.setPointerCapture = vi.fn();
    fireEvent.pointerDown(member,touch(1,300)); expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(viewport,touch(2,500)); fireEvent.pointerUp(viewport,touch(2,500)); fireEvent.pointerUp(member,touch(1,300)); flush();
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(member,touch(1,300)); fireEvent.pointerUp(member,touch(1,300));
    expect(p.onSelect).toHaveBeenCalledWith({ type: "member", id: "m0" }, expect.anything());
  });
});
