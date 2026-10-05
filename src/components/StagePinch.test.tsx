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
  it("keeps all selected names visible during one-finger panning in dense scenes", () => {
    const p = props(); p.compact = false; p.selectedMemberIds = ["m0","m1","m2"];
    const view = render(<StageCanvas {...p} />); flush();
    const viewport = view.container.querySelector(".stage-fit-area")!;
    fireEvent.pointerDown(viewport,touch(1,300)); fireEvent.pointerMove(viewport,touch(1,350));
    const named = [...view.container.querySelectorAll(".member-token")].filter(e => e.querySelector(".member-token__label"));
    expect(named.map(e => e.getAttribute("aria-label"))).toEqual(["匿名0","匿名1","匿名2"]);
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
