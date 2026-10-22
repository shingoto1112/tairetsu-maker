// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StageCanvas } from "./components/StageCanvas";
import type { ParadeCanvas } from "./components/ParadeCanvas";
import type { Project } from "./types";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { createSharedDocument } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";
import { SharedProjectEditor } from "./collaboration/editorSession";
import { getSnapshotForFrame } from "./utils/interpolation";
import { StageCanvas as RenderStageCanvas } from "./components/StageCanvas";
import { ParadeCanvas as RenderParadeCanvas } from "./components/ParadeCanvas";
import * as audioStorage from "./utils/audioStorage";

type StageProps = ComponentProps<typeof StageCanvas>;
type ParadeProps = ComponentProps<typeof ParadeCanvas>;
const observed = vi.hoisted(() => ({
  canvas: null as StageProps | ParadeProps | null,
  stage: null as StageProps | null,
  delayBegin: null as Promise<boolean> | null,
}));
let project: Project;
let repository: MemoryProjectRepository;
let useYjs = false;
let raf: Map<number, FrameRequestCallback>;
let serial: number;
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    if (!repository) {
      repository = new MemoryProjectRepository();
      const doc = useYjs ? createSharedDocument(project) : null;
      await repository.commit({ project, ...(doc ? { collaboration: createCollaborationData(doc) } : {}),
        localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-scene-editing" });
      doc?.destroy();
    }
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/StageCanvas", async original => {
  const { StageCanvas: Canvas } = await original<typeof import("./components/StageCanvas")>();
  return { StageCanvas: forwardRef<HTMLDivElement, StageProps>((p, ref) => {
    observed.canvas = p; observed.stage = p;
    return <Canvas {...p} ref={ref} onBeginProjectEdit={(...args) => {
      const result = p.onBeginProjectEdit(...args);
      return observed.delayBegin ?? result;
    }} />;
  }) };
});
vi.mock("./components/ParadeCanvas", async original => {
  const { ParadeCanvas: Canvas } = await original<typeof import("./components/ParadeCanvas")>();
  return { ParadeCanvas: forwardRef<HTMLDivElement, ParadeProps>((p, ref) => {
    observed.canvas = p;
    return <Canvas {...p} ref={ref} onBeginProjectEdit={(...args) => {
      const result = p.onBeginProjectEdit(...args);
      return observed.delayBegin ?? result;
    }} />;
  }) };
});
import App from "./App";

beforeEach(() => {
  localStorage.clear(); useYjs = false;
  repository = undefined as unknown as MemoryProjectRepository;
  observed.canvas = null; observed.stage = null; observed.delayBegin = null;
  raf = new Map(); serial = 0;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? "mouse";
    }
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { raf.set(++serial, cb); return serial; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { raf.delete(id); });
  const captures = new WeakMap<HTMLElement, Set<number>>();
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: function(this: HTMLElement, id: number) { const ids = captures.get(this) ?? new Set(); ids.add(id); captures.set(this, ids); } },
    hasPointerCapture: { configurable: true, value: function(this: HTMLElement, id: number) { return captures.get(this)?.has(id) ?? false; } },
    releasePointerCapture: { configurable: true, value: function(this: HTMLElement, id: number) { captures.get(this)?.delete(id); } },
    scrollIntoView: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} } as DOMRect);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(audioStorage, "resolveAudioPlaybackURL").mockResolvedValue("data:audio/mpeg;base64,AA==");
  vi.spyOn(audioStorage, "listDeviceAudio").mockResolvedValue([]);
  project = { ...createSampleProject(), id: "scene-editing", title: "シーン検証" };
  const frame = project.frames[0];
  project.frames = [
    { ...structuredClone(frame), id: "A", label: "A", timeSec: 0 },
    { ...structuredClone(frame), id: "B", label: "B", timeSec: 0 },
    { ...structuredClone(frame), id: "C", label: "C", timeSec: 60 },
  ];
  project.frames.forEach((f, i) => {
    f.positions.m_anna = { x: 2 + i, y: 2 + i };
    f.objectStates.o_chair = { ...f.objectStates.o_chair, x: 3 + i, y: 2 + i };
    f.memberVisibility = { ...f.memberVisibility, m_ben: false };
    f.sceneViewState = { zoom: 1, scrollLeft: 0, scrollTop: 0 };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tick = () => act(() => { const pending = [...raf.values()]; raf.clear(); pending.forEach(cb => cb(0)); });
async function open() {
  const view = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "シーン検証を開く" }));
  await waitFor(() => expect(observed.canvas).not.toBeNull(), { timeout: 5000 }); tick();
  return view;
}
const railSelect = (id: string) => fireEvent.click(document.querySelector(`.scene-thumbnail-rail [data-thumbnail-frame-id="${id}"]`)!);
const current = () => observed.canvas!;
const pointer = (id: number, x: number) => ({ pointerId: id, pointerType: "mouse", clientX: x, clientY: 250, button: 0 });
async function dragStart(element: Element, id = 1) {
  fireEvent.pointerDown(element, pointer(id, 300));
  fireEvent.pointerMove(element, pointer(id, 380));
  await act(async () => {});
}
const geometry = (p: Project) => p.frames.map(f => ({ id: f.id, positions: f.positions, objectStates: f.objectStates }));
const tokenSelector = (mode: "stage" | "parade", kind: string) => mode === "stage"
  ? `.stage-surface .${kind === "member" ? "member-token" : "stage-object"}`
  : `.parade-stage .${kind === "member" ? "parade-member" : "parade-object"}`;

// Keep the real canvases mounted across scope changes while inspecting their
// callbacks directly; the App tests above/below cover persistence and Undo.
async function isolatedCanvas(mode: "stage" | "parade", kind: string) {
  project.mode = mode;
  const app = await open();
  const original = current();
  app.unmount();
  const p = { ...original, mode: kind === "member" ? "members" : "objects",
    deferMemberDragCommit: true, deferObjectDragCommit: true,
    onSelect: vi.fn(), onContextMenuRequest: vi.fn(), onBeginProjectEdit: vi.fn(() => true),
    onEndProjectEdit: vi.fn(), onMoveMember: vi.fn(), onUpdateObjectState: vi.fn(), onFrameViewStateChange: vi.fn() };
  const canvas = (nextProject = original.project, selectedFrameId = "A") => {
    const next = { ...p, project: nextProject, selectedFrameId, snapshot: getSnapshotForFrame(nextProject, selectedFrameId) };
    return mode === "stage" ? <RenderStageCanvas {...next as StageProps} /> : <RenderParadeCanvas {...next as ParadeProps} />;
  };
  const view = render(canvas()); tick();
  const target = () => view.container.querySelector<HTMLElement>(tokenSelector(mode, kind))!;
  return { p, view, canvas, target, project: original.project };
}

it("A1: new project, member drag, +scene, B drag, assignment preview, save and repository reload retain both formations at playhead zero", async () => {
  const view = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /追加.*新規/ }));
  fireEvent.click(screen.getByRole("button", { name: /新しく作る/ }));
  fireEvent.click(screen.getByRole("button", { name: /ステージ隊列/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "隊列表名" }), { target: { value: "A1新規" } });
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  await waitFor(() => expect(observed.canvas).not.toBeNull()); tick();
  fireEvent.click(screen.getByRole("tab", { name: "メンバー" }));
  fireEvent.click(screen.getByRole("button", { name: "メンバー" }));
  const member = () => view.container.querySelector(".stage-surface .member-token")!;
  await dragStart(member()); fireEvent.pointerUp(member(), pointer(1, 380));
  const aId = current().selectedFrameId!;
  const aPositions = structuredClone(current().snapshot.positions);
  fireEvent.click(screen.getByRole("tab", { name: "道具" }));
  fireEvent.click(await screen.findByRole("button", { name: "道具" }));
  const object = () => view.container.querySelector(".stage-surface .stage-object")!;
  await dragStart(object(), 3); fireEvent.pointerUp(object(), pointer(3, 380));
  const aObjects = structuredClone(current().snapshot.objectStates);
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  await screen.findByRole("heading", { name: "シーン一覧" });
  fireEvent.click(document.querySelector(".scene-nav button.primary")!);
  const bId = current().selectedFrameId!; expect(bId).not.toBe(aId);
  fireEvent.click(screen.getByRole("tab", { name: "メンバー" }));
  await dragStart(member(), 2); fireEvent.pointerUp(member(), pointer(2, 380));
  const bPositions = structuredClone(current().snapshot.positions);
  expect(bPositions).not.toEqual(aPositions);
  fireEvent.click(screen.getByRole("tab", { name: "道具" }));
  await dragStart(object(), 4); fireEvent.pointerUp(object(), pointer(4, 380));
  const bObjects = structuredClone(current().snapshot.objectStates);
  expect(bObjects).not.toEqual(aObjects);
  expect(document.querySelector("audio")!.currentTime).toBe(0);
  for (const tab of ["割当", "音源", "ステージ", "道具", "シーン", "メンバー", "割当"]) {
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    expect(current().selectedFrameId).toBe(bId);
    expect(current().snapshot.positions).toEqual(bPositions);
    expect(current().snapshot.objectStates).toEqual(bObjects);
  }
  fireEvent.click(screen.getByTitle("現在のシーンを保存"));
  const expected = geometry(current().project);
  expect(expected.find(f => f.id === aId)!.positions).toEqual(aPositions);
  expect(expected.find(f => f.id === bId)!.positions).toEqual(bPositions);
  expect(expected.find(f => f.id === aId)!.objectStates).toEqual(aObjects);
  expect(expected.find(f => f.id === bId)!.objectStates).toEqual(bObjects);
  fireEvent.click(screen.getByTitle("変更を保存"));
  const id = current().project.id!;
  await waitFor(async () => expect(geometry((await repository.get(id))!.project)).toEqual(expected));
  view.unmount(); observed.canvas = null;
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "A1新規を開く" }));
  await waitFor(() => expect(observed.canvas).not.toBeNull());
  expect(geometry(current().project)).toEqual(expected);
}, 25_000);

it.each([[false, false], [false, true], [true, false], [true, true]])("A2: every explicit selection retains A/B ties and post-song C without project/history/shared edits (audio=%s, Yjs=%s)", async (audio, yjs) => {
  useYjs = yjs;
  if (audio) project.audio = { id: "song", name: "曲", type: "audio/mpeg", size: 1, duration: 20 };
  else project.audio = null;
  await open();
  // jsdom does not load media metadata; model the loaded song locally.
  if (audio) {
    Object.defineProperty(document.querySelector("audio")!, "duration", { configurable: true, value: 20 });
    fireEvent.loadedMetadata(document.querySelector("audio")!);
  }
  // Opening a Yjs document binds this device's song and queues its initial save.
  // Drain that work before measuring selection-only commits.
  if (yjs) {
    await act(async () => { await observed.stage!.onSaveFrame(); });
    expect((await repository.get(project.id!))!.project.audio).toEqual(project.audio);
  }
  const before = structuredClone(current().project);
  const edits = vi.spyOn(SharedProjectEditor.prototype, "edit");
  const commits = vi.spyOn(repository, "commit");
  const check = (id: string) => {
    expect(current().selectedFrameId).toBe(id);
    expect(current().snapshot.positions).toEqual(before.frames.find(f => f.id === id)!.positions);
    expect(document.querySelector("audio")!.currentTime).toBe(id === "C" ? audio ? 20 : 60 : 0);
    expect(current().project).toEqual(before);
    expect(current().canUndo).toBe(false);
    expect(edits).not.toHaveBeenCalled();
  };
  for (const id of ["C", "A", "B", "A"]) { railSelect(id); check(id); }
  fireEvent.click(screen.getByRole("tab", { name: "割当" }));
  fireEvent.click(await screen.findByRole("button", { name: "メンバー別" }));
  for (const id of ["C", "A", "B", "A"]) {
    fireEvent.click(within(screen.getByRole("region", { name: "メンバー別割当" })).getByRole("button", { name: id })); check(id);
  }
  fireEvent.click(screen.getByRole("button", { name: "全体名簿を開く" }));
  const modal = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
  fireEvent.click(within(modal).getByRole("button", { name: "道具管理" }));
  fireEvent.click(within(modal).getByRole("button", { name: "道具割当" }));
  for (const id of ["C", "A", "B", "A"]) {
    fireEvent.click(await within(modal).findByRole("button", { name: new RegExp(`^[123]\\. ${id} `) })); check(id);
  }
  fireEvent.click(within(modal).getByRole("button", { name: "隊列表へ戻る" }));
  fireEvent.click(screen.getByRole("tab", { name: "音源" }));
  await screen.findByRole("region", { name: "曲とシーンの区切り" });
  for (const id of ["C", "A", "B", "A"]) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^[123]\\. ${id}（.*を選ぶ$`) })); check(id);
  }
  expect(commits).not.toHaveBeenCalled();
  // A time-originated seek still selects the last scene at the clamped time.
  act(() => observed.stage!.onSeekAudio(60));
  expect(current().selectedFrameId).toBe(audio ? "B" : "C");
  expect(edits).not.toHaveBeenCalled();
}, 25_000);

it("A1: a retained save callback reads the latest target geometry and ignores a deleted target", async () => {
  await open();
  railSelect("B");
  const save = observed.stage!.onSaveFrame;
  act(() => {
    current().onMoveMember("m_anna", { x: 7, y: 4 });
    current().onUpdateObjectState("o_chair", { x: 6, y: 3 });
  });
  const latest = geometry(current().project);
  await act(async () => { await save(); });
  expect(geometry(current().project)).toEqual(latest);
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  fireEvent.click(await screen.findByRole("button", { name: "このシーンを削除" }));
  fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
  await waitFor(() => expect(current().project.frames.some(f => f.id === "B")).toBe(false));
  const before = current().project;
  await act(async () => { await save(); });
  expect(current().project).toBe(before);
}, 25_000);

it("A2: Timeline selection keeps transport; its audio-position action resolves time; playback keeps the last tie", async () => {
  project.audio = { id: "song", name: "曲", type: "audio/mpeg", size: 1, duration: 20 };
  await open();
  const audio = document.querySelector("audio")!;
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  fireEvent.click(document.querySelector('.timeline-card')!);
  expect(current().selectedFrameId).toBe("A"); expect(audio.currentTime).toBe(0);
  railSelect("C"); expect(audio.currentTime).toBe(20);
  fireEvent.click(document.querySelector('.timeline-card')!);
  expect(current().selectedFrameId).toBe("A"); expect(audio.currentTime).toBe(20);
  fireEvent.click(screen.getByRole("button", { name: "この時刻へ" }));
  expect(current().selectedFrameId).toBe("B"); expect(audio.currentTime).toBe(0);
  railSelect("A");
  await act(async () => { observed.stage!.onTogglePlayback(); });
  expect(current().isPlaying).toBe(true);
  expect(current().selectedFrameId).toBe("B");
  expect(current().snapshot.positions).toEqual(current().project.frames[1].positions);
  // A captured save callback must use the latest project, including during playback.
  const save = observed.stage!.onSaveFrame;
  const expected = geometry(current().project);
  await act(async () => { await save(); });
  expect(geometry(current().project)).toEqual(expected);
}, 25_000);

it.each(["stage", "parade"] as const)("A5: %s member/object scene-switch cancellation preserves committed edits, autosaves, then undoes the next drag", async mode => {
  project.mode = mode;
  const view = await open();
  for (const kind of ["member", "object"]) {
    railSelect("A");
    fireEvent.click(screen.getByRole("tab", { name: kind === "member" ? "メンバー" : "道具" }));
    const selector = mode === "stage" ? `.stage-surface .${kind === "member" ? "member-token" : "stage-object"}` : `.parade-stage .${kind === "member" ? "parade-member" : "parade-object"}`;
    const target = () => view.container.querySelector(selector)!;
    const initial = geometry(current().project);
    await dragStart(target());
    const moved = geometry(current().project);
    expect(moved).not.toEqual(initial);
    railSelect("B");
    fireEvent.pointerMove(target(), pointer(1, 500)); fireEvent.pointerUp(target(), pointer(1, 500)); tick();
    expect(geometry(current().project)).toEqual(moved);
    expect(current().project.frames[1]).toMatchObject(initial[1]);
    await waitFor(async () => expect(geometry((await repository.get(project.id!))!.project)).toEqual(moved), { timeout: 3000 });
    await dragStart(target(), 2); fireEvent.pointerUp(target(), pointer(2, 380));
    expect(geometry(current().project)).not.toEqual(moved);
    act(() => current().onUndo());
    expect(geometry(current().project)).toEqual(moved);
  }
}, 25_000);

it.each(["stage", "parade"] as const)("A5: %s pending member/object begin cannot revive or end a new drag with reused pointer ID", async mode => {
  project.mode = mode; useYjs = true;
  const view = await open();
  for (const kind of ["member", "object"]) {
    railSelect("A");
    fireEvent.click(screen.getByRole("tab", { name: kind === "member" ? "メンバー" : "道具" }));
    const selector = mode === "stage" ? `.stage-surface .${kind === "member" ? "member-token" : "stage-object"}` : `.parade-stage .${kind === "member" ? "parade-member" : "parade-object"}`;
    const target = () => view.container.querySelector(selector)!;
    const before = geometry(current().project);
    let resolve!: (allowed: boolean) => void;
    observed.delayBegin = new Promise<boolean>(r => { resolve = r; });
    await dragStart(target());
    railSelect("B");
    fireEvent.pointerMove(target(), pointer(1, 500)); fireEvent.pointerUp(target(), pointer(1, 500));
    expect(geometry(current().project)).toEqual(before);
    observed.delayBegin = null;
    await dragStart(target());
    const ends = vi.spyOn(SharedProjectEditor.prototype, "end"); ends.mockClear();
    await act(async () => { resolve(true); });
    expect(ends).not.toHaveBeenCalled();
    expect(geometry(current().project)).toEqual(before); // shared preview is deferred
    fireEvent.pointerMove(target(), pointer(1, 420)); fireEvent.pointerUp(target(), pointer(1, 420));
    expect(geometry(current().project)).not.toEqual(before);
    expect(current().project.frames[0]).toMatchObject(before[0]);
    act(() => current().onUndo());
    expect(geometry(current().project)).toEqual(before);
    ends.mockRestore();
  }
}, 25_000);

it.each(["stage", "parade"] as const)("A5: %s scene/Project switches discard member/object CSS previews, capture, guides and edge scrolling", async mode => {
  for (const kind of ["member", "object"]) {
    const { p, view, canvas, target, project: source } = await isolatedCanvas(mode, kind);
    for (const change of ["scene", "project"]) {
      view.rerender(canvas()); tick();
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(2000);
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(5000);
      const element = target();
      await dragStart(element);
      const css = kind === "member" ? "--member-drag-x" : "--object-drag-x";
      expect(element.style.getPropertyValue(css)).not.toBe("");
      fireEvent.pointerMove(element, { ...pointer(1, 795), clientY: 590 }); tick();
      const viewport = view.container.querySelector<HTMLElement>(mode === "stage" ? ".stage-fit-area" : ".parade-viewport")!;
      expect(viewport.scrollLeft + viewport.scrollTop).toBeGreaterThan(0);
      const ends = p.onEndProjectEdit.mock.calls.length;
      view.rerender(canvas(change === "project" ? { ...source, id: "other-project" } : source, change === "scene" ? "B" : "A"));
      expect(p.onEndProjectEdit).toHaveBeenCalledTimes(ends + 1);
      expect(element.hasPointerCapture(1)).toBe(false);
      expect(element.style.getPropertyValue(css)).toBe("");
      expect(view.container.querySelector(".snap-guide")).toBeNull();
      // Parade restores the destination's view on RAF; measure scrolling after
      // that intended scene transition, then send the cancelled drag's events.
      tick(); tick();
      const scroll = [viewport.scrollLeft, viewport.scrollTop];
      fireEvent.pointerMove(target(), { ...pointer(1, 795), clientY: 590 });
      fireEvent.pointerUp(target(), { ...pointer(1, 795), clientY: 590 }); tick(); tick();
      expect([viewport.scrollLeft, viewport.scrollTop]).toEqual(scroll);
      expect(p.onMoveMember).not.toHaveBeenCalled();
      expect(p.onUpdateObjectState).not.toHaveBeenCalled();
    }
    view.unmount(); observed.canvas = null;
  }
}, 25_000);

it.each(["stage", "parade"] as const)("A5: %s scene switches cancel member/object long-press timers", async mode => {
  for (const kind of ["member", "object"]) {
    const { p, view, canvas, target } = await isolatedCanvas(mode, kind);
    vi.useFakeTimers();
    fireEvent.pointerDown(target(), { ...pointer(1, 300), pointerType: "touch" });
    view.rerender(canvas(undefined, "B"));
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerUp(target(), { ...pointer(1, 300), pointerType: "touch" });
    expect(p.onContextMenuRequest).not.toHaveBeenCalled();
    expect(p.onBeginProjectEdit).not.toHaveBeenCalled();
    expect(p.onMoveMember).not.toHaveBeenCalled();
    expect(p.onUpdateObjectState).not.toHaveBeenCalled();
    view.unmount(); observed.canvas = null;
    vi.useRealTimers();
  }
}, 25_000);
