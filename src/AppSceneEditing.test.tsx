// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StageCanvas } from "./components/StageCanvas";
import type { ParadeCanvas } from "./components/ParadeCanvas";
import type { Project } from "./types";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { createSharedDocument, getModel, REMOTE_ORIGIN } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";
import { SharedProjectEditor } from "./collaboration/editorSession";
import { getSnapshotForFrame } from "./utils/interpolation";
import { StageCanvas as RenderStageCanvas } from "./components/StageCanvas";
import { ParadeCanvas as RenderParadeCanvas } from "./components/ParadeCanvas";
import * as audioStorage from "./utils/audioStorage";
import JSZip from "jszip";
import * as Y from "yjs";
import { encodeUpdate } from "./collaboration/persistence";
import type { FormationLibrary } from "./components/FormationLibrary";
import { RepositoryError } from "./repositories/types";
import { EphemeralSession } from "./collaboration/ephemeralSession";
import { TOUCH_LONG_PRESS_DELAY_MS } from "./utils/touchLongPress";

type StageProps = ComponentProps<typeof StageCanvas>;
type ParadeProps = ComponentProps<typeof ParadeCanvas>;
const observed = vi.hoisted(() => ({
  canvas: null as StageProps | ParadeProps | null,
  stage: null as StageProps | null,
  delayBegin: null as Promise<boolean> | null,
  library: null as ComponentProps<typeof FormationLibrary> | null,
  settings: null as ComponentProps<typeof import("./components/StageSettingsPanel").StageSettingsPanel> | null,
}));
let project: Project;
let repository: MemoryProjectRepository;
let useYjs = false;
let raf: Map<number, FrameRequestCallback>;
let serial: number;
vi.mock("./components/FormationLibrary", async original => {
  const { FormationLibrary: Library } = await original<typeof import("./components/FormationLibrary")>();
  return { FormationLibrary: (p: ComponentProps<typeof FormationLibrary>) => { observed.library = p; return <Library {...p} />; } };
});
vi.mock("./components/StageSettingsPanel", async original => {
  const { StageSettingsPanel: Panel } = await original<typeof import("./components/StageSettingsPanel")>();
  return { StageSettingsPanel: (p: NonNullable<typeof observed.settings>) => { observed.settings = p; return <Panel {...p} />; } };
});
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
  observed.settings = null;
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
  fireEvent.change(screen.getByRole("textbox", { name: "隊列表名（任意）" }), { target: { value: "A1新規" } });
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  await waitFor(() => expect(observed.canvas).not.toBeNull()); tick();
  fireEvent.click(screen.getByRole("tab", { name: "メンバー" }));
  fireEvent.click(screen.getByRole("button", { name: "メンバー" }));
  const member = () => view.container.querySelector(".stage-surface .member-token")!;
  await dragStart(member()); fireEvent.pointerUp(member(), pointer(1, 380));
  const aId = current().selectedFrameId!;
  const aPositions = structuredClone(current().snapshot.positions);
  fireEvent.click(screen.getByRole("tab", { name: "道具" }));
  // Panels load lazily; allow for a busy full-suite run.
  fireEvent.click(await screen.findByRole("button", { name: "道具" }, { timeout: 10_000 }));
  const object = () => view.container.querySelector(".stage-surface .stage-object")!;
  await dragStart(object(), 3); fireEvent.pointerUp(object(), pointer(3, 380));
  const aObjects = structuredClone(current().snapshot.objectStates);
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  await screen.findByRole("heading", { name: "シーン一覧" }, { timeout: 10_000 });
  fireEvent.click(document.querySelector(".scene-nav button.primary")!);
  const bId = current().selectedFrameId!; expect(bId).not.toBe(aId);
  expect(current().project.frames.map(f => f.label)).toEqual(["シーン1", "シーン2"]);
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
  const beforeSave = current().project;
  fireEvent.click(screen.getByRole("button", { name: "隊列表を保存" }));
  await screen.findByText("隊列表を保存しました。");
  expect(current().project).toBe(beforeSave);
  const expected = geometry(current().project);
  expect(expected.find(f => f.id === aId)!.positions).toEqual(aPositions);
  expect(expected.find(f => f.id === bId)!.positions).toEqual(bPositions);
  expect(expected.find(f => f.id === aId)!.objectStates).toEqual(aObjects);
  expect(expected.find(f => f.id === bId)!.objectStates).toEqual(bObjects);
  fireEvent.click(document.querySelector(".toolbar-save-button")!);
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
    await act(async () => { await observed.stage!.onSaveProject(); });
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
  // The first switch can suspend while the lazy object view loads.
  fireEvent.click(await within(modal).findByRole("button", { name: "道具割当" }));
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

it("A1/B2: a retained save callback persists the latest Project even after the selected scene is deleted", async () => {
  await open();
  railSelect("B");
  const save = observed.stage!.onSaveProject;
  act(() => {
    current().onMoveMember("m_anna", { x: 7, y: 4 });
    current().onUpdateObjectState("o_chair", { x: 6, y: 3 });
  });
  const latest = geometry(current().project);
  await act(async () => { await save(); });
  expect(geometry(current().project)).toEqual(latest);
  expect(geometry((await repository.get(project.id!))!.project)).toEqual(latest);
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  fireEvent.click(await screen.findByRole("button", { name: "このシーンを削除" }));
  fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
  await waitFor(() => expect(current().project.frames.some(f => f.id === "B")).toBe(false));
  const before = current().project;
  await act(async () => { await save(); });
  expect(current().project).toBe(before);
  expect((await repository.get(project.id!))!.project.frames).toEqual(before.frames);
}, 25_000);

it.each([false, true])("B2: both save buttons persist the same Project without changing scenes, Undo/Redo or shared recipes (Yjs=%s)", async yjs => {
  useYjs = yjs;
  await open();
  railSelect("B");
  const original = structuredClone(current().project.frames);
  act(() => current().onMoveMember("m_anna", { x: 7, y: 4 }));
  const edited = structuredClone(current().project.frames);
  // Leave both an undo and a redo entry to detect either stack being changed.
  act(() => current().onMoveMember("m_anna", { x: 8, y: 4 }));
  act(() => current().onUndo());
  expect(current().project.frames).toEqual(edited);
  const edits = vi.spyOn(SharedProjectEditor.prototype, "edit");
  for (const location of ["stage", "toolbar"]) {
    const before = current().project;
    expect(current().canUndo).toBe(true); expect(current().canRedo).toBe(true);
    await act(async () => { fireEvent.click(location === "stage"
      ? screen.getByRole("button", { name: "隊列表を保存" })
      : document.querySelector(".toolbar-save-button")!); });
    await screen.findByText("隊列表を保存しました。");
    await waitFor(async () => expect((await repository.get(project.id!))!.project.frames).toEqual(edited));
    expect(current().project).toBe(before);
    expect(current().selectedFrameId).toBe("B");
    expect(current().snapshot.positions).toEqual(edited[1].positions);
    expect(current().canUndo).toBe(true); expect(current().canRedo).toBe(true);
  }
  expect(edits).not.toHaveBeenCalled();
  act(() => current().onRedo());
  expect(current().project.frames[1].positions.m_anna).toEqual({ x: 8, y: 4 });
  act(() => current().onUndo());
  expect(current().project.frames).toEqual(edited);
  act(() => current().onUndo());
  expect(current().project.frames).toEqual(original);
}, 25_000);

it("B2: failed stage save retains edits and history, emits no success, and can retry", async () => {
  await open();
  const persisted = (await repository.get(project.id!))!.project.frames;
  act(() => current().onMoveMember("m_anna", { x: 7, y: 4 }));
  const before = current().project;
  const commit = vi.spyOn(repository, "commit").mockRejectedValueOnce(new Error("device write failed"));
  fireEvent.click(screen.getByRole("button", { name: "隊列表を保存" }));
  await waitFor(() => expect(commit).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("button", { name: "隊列表を保存" }).hasAttribute("disabled")).toBe(false));
  expect(screen.queryByText("隊列表を保存しました。")).toBeNull();
  expect(current().project).toBe(before); expect(current().canUndo).toBe(true);
  expect((await repository.get(project.id!))!.project.frames).toEqual(persisted);
  fireEvent.click(screen.getByRole("button", { name: "隊列表を保存" }));
  await screen.findByText("隊列表を保存しました。");
  expect((await repository.get(project.id!))!.project.frames).toEqual(before.frames);
}, 25_000);

it("B2: both save buttons stay disabled until the same pending device save completes", async () => {
  await open();
  act(() => current().onMoveMember("m_anna", { x: 7, y: 4 }));
  const originalCommit = repository.commit.bind(repository);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const commits = vi.spyOn(repository, "commit").mockImplementation(async input => { await pending; return originalCommit(input); });
  const stage = screen.getByRole<HTMLButtonElement>("button", { name: "隊列表を保存" });
  const toolbar = document.querySelector<HTMLButtonElement>(".toolbar-save-button")!;
  fireEvent.click(stage);
  await waitFor(() => expect(stage.disabled).toBe(true));
  expect(toolbar.disabled).toBe(true);
  fireEvent.click(stage); fireEvent.click(toolbar);
  expect(commits).toHaveBeenCalledOnce();
  await act(async () => { release(); });
  await waitFor(() => expect(stage.disabled).toBe(false));
  expect(toolbar.disabled).toBe(false);
  expect((await repository.get(project.id!))!.project.frames).toEqual(current().project.frames);
}, 25_000);

it.each(["stage", "parade"] as const)("B9: %s blank titles use the creation default and keep same-name projects apart by ID", async mode => {
  project.title = "新しい隊列表";
  const view = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /追加.*新規/ }));
  fireEvent.click(screen.getByRole("button", { name: /新しく作る/ }));
  fireEvent.click(screen.getByRole("radio", { name: mode === "stage" ? /^ステージ隊列/ : /^パレード隊列/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "隊列表名（任意）" }), { target: { value: " \u3000 " } });
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  await waitFor(() => { expect(current()?.project.title).toBe("新しい隊列表"); expect(current()!.project.id).not.toBe(project.id); });
  expect(current().project.mode).toBe(mode);
  expect(current().project.frames[0].label).toBe("シーン1");
  const id = current().project.id!;
  expect(id).not.toBe(project.id);
  await waitFor(async () => expect((await repository.get(id))!.project.title).toBe("新しい隊列表"));
  expect((await repository.get(project.id!))!.project.title).toBe("新しい隊列表");
  view.unmount(); observed.canvas = null;
  render(<App />);
  expect(await screen.findAllByRole("button", { name: "新しい隊列表を開く" })).toHaveLength(2);
  expect((await repository.get(id))!.project.mode).toBe(mode);
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
  const save = observed.stage!.onSaveProject;
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

it.each([["stage", false], ["stage", true], ["parade", false], ["parade", true]] as const)("A3: %s portrait=%s selecting a tool clears member multiselect before Delete", async (mode, portrait) => {
  project.mode = mode;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: portrait && query.includes("orientation"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await open();
  const before = structuredClone(current().project.frames);
  act(() => current().onSelect({ type: "member", id: "m_anna" }));
  act(() => current().onSelect({ type: "member", id: "m_chika" }, { append: true }));
  expect(current().selectedMemberIds).toEqual(["m_anna", "m_chika"]);
  act(() => current().onSelect({ type: "object", id: "o_chair" }));
  expect(current().selectedMemberIds).toEqual([]);
  fireEvent.keyDown(window, { key: "Delete" });
  const frames = current().project.frames;
  expect(frames[0].objectStates.o_chair.visible).toBe(false);
  expect(frames[0].positions).toEqual(before[0].positions);
  expect(frames[0].memberVisibility).toEqual(before[0].memberVisibility);
  expect(frames[0].objectStates.o_curtain).toEqual(before[0].objectStates.o_curtain);
  expect(frames.slice(1)).toEqual(before.slice(1));
}, 25_000);

it.each(["add", "paste"] as const)("A3: selecting a tool through %s also clears member multiselect", async entrance => {
  await open();
  if (entrance === "paste") {
    act(() => current().onSelect({ type: "object", id: "o_chair" }));
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
  }
  act(() => current().onSelect({ type: "member", id: "m_anna" }));
  act(() => current().onSelect({ type: "member", id: "m_chika" }, { append: true }));
  expect(current().selectedMemberIds).toHaveLength(2);
  const before = structuredClone(current().snapshot.positions);
  if (entrance === "paste") fireEvent.keyDown(window, { key: "v", ctrlKey: true });
  else {
    fireEvent.click(screen.getByRole("tab", { name: "道具" }));
    fireEvent.click(screen.getByRole("button", { name: "道具" }));
  }
  expect(current().selectedMemberIds).toEqual([]);
  expect(current().selected?.type).toBe("object");
  const id = current().selected!.id;
  fireEvent.keyDown(window, { key: "Delete" });
  expect(current().snapshot.objectStates[id].visible).toBe(false);
  expect(current().snapshot.positions).toEqual(before);
}, 25_000);

it.each(["stage", "parade"] as const)("A4: %s locked tools stay selectable without drag, history or shared ephemeral; unlock restores all gestures", async mode => {
  project.mode = mode; useYjs = true;
  project.stageObjects.forEach(object => { object.locked = true; });
  const view = await open();
  fireEvent.click(screen.getByRole("tab", { name: "道具" }));
  await act(async () => { fireEvent.click(document.querySelector(".toolbar-save-button")!); });
  const before = geometry(current().project);
  const begin = vi.spyOn(SharedProjectEditor.prototype, "begin");
  const edit = vi.spyOn(SharedProjectEditor.prototype, "edit");
  const ephemeral = vi.spyOn(EphemeralSession.prototype, "begin");
  const selector = tokenSelector(mode, "object");
  const target = () => view.container.querySelector<HTMLElement>(selector)!;
  await dragStart(target()); fireEvent.pointerUp(target(), pointer(1, 380));
  expect(target().className).toContain("is-selected");
  expect(target().hasPointerCapture(1)).toBe(false);
  expect(target().style.getPropertyValue("--object-drag-x")).toBe("");
  expect(target().querySelector(".resize-handle, .rotate-handle")).toBeNull();
  expect(geometry(current().project)).toEqual(before);
  expect(current().canUndo).toBe(false); expect(begin).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
  expect(ephemeral).not.toHaveBeenCalled();
  // The actual selection panel must still provide the lock toggle.
  fireEvent.click(within(document.querySelector('article[data-object-id="o_curtain"]')!).getByRole("button", { name: "ロック" }));
  for (const kind of ["move", "resize", "rotate"]) {
    const element = kind === "move" ? target() : target().querySelector<HTMLElement>(`.${kind}-handle`)!;
    expect(element).not.toBeNull();
    const initial = geometry(current().project);
    await dragStart(element); fireEvent.pointerUp(element, pointer(1, 380));
    expect(geometry(current().project)).not.toEqual(initial);
    expect(current().canUndo).toBe(true);
  }
}, 25_000);

it.each(["stage", "parade"] as const)("A4: isolated %s locked canvas cannot begin or commit a drag", async mode => {
  project.stageObjects.forEach(object => { object.locked = true; });
  const { p, view, target } = await isolatedCanvas(mode, "object");
  await dragStart(target()); fireEvent.pointerUp(target(), pointer(1, 380));
  expect(p.onSelect).toHaveBeenCalled();
  expect(p.onBeginProjectEdit).not.toHaveBeenCalled(); expect(p.onEndProjectEdit).not.toHaveBeenCalled();
  expect(p.onUpdateObjectState).not.toHaveBeenCalled();
  expect(target().hasPointerCapture(1)).toBe(false);
  expect(target().style.getPropertyValue("--object-drag-x")).toBe("");
  view.unmount();
}, 25_000);

it.each(["stage", "parade"] as const)("A4: %s locked tools keep the touch long-press menu", async mode => {
  project.stageObjects.forEach(object => { object.locked = true; });
  const { p, view, target } = await isolatedCanvas(mode, "object");
  const objectId = project.stageObjects[0].id;
  vi.useFakeTimers();
  try {
    fireEvent.pointerDown(target(), { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 250, button: 0 });
    act(() => { vi.advanceTimersByTime(TOUCH_LONG_PRESS_DELAY_MS + 50); });
  } finally {
    vi.useRealTimers();
  }
  expect(p.onContextMenuRequest).toHaveBeenCalledWith(expect.objectContaining({ target: { type: "object", id: objectId } }));
  expect(p.onBeginProjectEdit).not.toHaveBeenCalled();
  view.unmount();
}, 25_000);

it.each([["stage", .5], ["stage", 1], ["parade", .5], ["parade", 1]] as const)("B: %s creation persists picker boundaries (diameter=%s) through actual App reload", async (mode, diameter) => {
  const view = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /追加.*新規/ }));
  fireEvent.click(screen.getByRole("button", { name: /新しく作る/ }));
  fireEvent.click(screen.getByRole("radio", { name: mode === "stage" ? /^ステージ隊列/ : /^パレード隊列/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "隊列表名（任意）" }), { target: { value: "作成境界" } });
  fireEvent.click(screen.getByRole("radio", { name: diameter === 1 ? "1.0m" : "0.5m" }));
  const fields = mode === "stage" ? { widthMeters: 1, heightMeters: 1, gridSizeMeters: .1 }
    : { paradeTotalDistance: 1, paradeWidthMeters: 1, paradeCellSizeMeters: .1 };
  for (const [name, value] of Object.entries(fields)) {
    fireEvent.change(document.querySelector(`[name="${name}"]`)!, { target: { value: String(value) } });
  }
  fireEvent.submit(screen.getByRole("dialog", { name: "新しい隊列表を作成" }));
  await waitFor(() => expect(current()?.project.title).toBe("作成境界"));
  const stage = { widthMeters: 1, depthMeters: 1, gridSizeMeters: .1, memberDiameterMeters: diameter };
  expect(current().project.stage).toMatchObject(stage);
  if (mode === "parade") expect(current().project.paradeSettings).toMatchObject({ totalDistance: 1, width: 1, cellSizeMeters: .1 });
  const id = current().project.id!;
  await waitFor(async () => expect((await repository.get(id))!.project.stage).toMatchObject(stage));
  view.unmount(); observed.canvas = null;
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "作成境界を開く" }));
  await waitFor(() => expect(current()?.project.title).toBe("作成境界"));
  expect(current().project.stage).toMatchObject(stage);
  if (mode === "parade") expect(current().project.paradeSettings).toMatchObject({ totalDistance: 1, width: 1, cellSizeMeters: .1 });
}, 25_000);

it("A6: real App unmounts roster after Escape while retaining rename/add/group drafts exactly once", async () => {
  project.memberGroups = [{ id: "g", name: "赤組", memberIds: ["m_anna"] }];
  await open();
  fireEvent.click(screen.getByRole("button", { name: "全体名簿を開く" }));
  const modal = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
  const cell = within(modal).getByRole("textbox", { name: "赤組 1行目" });
  cell.focus();
  fireEvent.change(cell, { target: { value: "新しい名前" } });
  fireEvent.change(within(modal).getByRole("textbox", { name: "赤組 2行目" }), { target: { value: "追加の名前" } });
  fireEvent.change(within(modal).getByRole("textbox", { name: "赤組のグループ名" }), { target: { value: "新しい組" } });
  fireEvent.keyDown(cell, { key: "Escape", isComposing: true });
  expect(screen.queryByRole("dialog", { name: "メンバー/道具の管理" })).not.toBeNull();
  fireEvent.keyDown(cell, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "メンバー/道具の管理" })).toBeNull());
  fireEvent.blur(cell);
  expect(current().project.members.find(m => m.id === "m_anna")!.name).toBe("新しい名前");
  expect(current().project.members.filter(m => m.name === "追加の名前")).toHaveLength(1);
  expect(current().project.memberGroups![0].name).toBe("新しい組");
  fireEvent.click(screen.getByRole("button", { name: "全体名簿を開く" }));
  const reopened = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
  expect((within(reopened).getByRole("textbox", { name: "新しい組 1行目" }) as HTMLInputElement).value).toBe("新しい名前");
  expect((within(reopened).getByRole("textbox", { name: "新しい組 2行目" }) as HTMLInputElement).value).toBe("追加の名前");
}, 25_000);

it.each([["stage", false], ["parade", false], ["stage", true], ["parade", true]] as const)("B: %s diameter actions use latest state, retain geometry, reject invalid updates and skip no-ops (Yjs=%s)", async (mode, yjs) => {
  project.mode = mode; project.stage.memberDiameterMeters = .3; useYjs = yjs;
  let editor: SharedProjectEditor | undefined;
  let coordinator: Parameters<typeof SharedProjectEditor.create>[0] | undefined;
  const originalCreate = SharedProjectEditor.create;
  vi.spyOn(SharedProjectEditor, "create").mockImplementation(async (...args) => {
    coordinator = args[0]; editor = await originalCreate(...args); return editor;
  });
  await open();
  fireEvent.click(screen.getByRole("tab", { name: "ステージ" }));
  await screen.findByText("今の値 0.30m");
  const before = current().project, positions = geometry(before);
  const update = observed.settings!.onChange;
  act(() => update({ memberDiameterMeters: .3 }));
  expect(current().project).toBe(before);
  for (const value of [NaN, Infinity, .1, 2.05]) act(() => update({ memberDiameterMeters: value }));
  expect(current().project).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "丸の直径を0.05m大きくする" }));
  expect(current().project.stage.memberDiameterMeters).toBe(.5);
  act(() => update({ memberDiameterMeters: .65 }));
  const step = () => update(latest => ({ memberDiameterMeters: Math.round(((latest.memberDiameterMeters ?? .5) + .05) * 100) / 100 }));
  act(() => { step(); step(); });
  expect(current().project.stage.memberDiameterMeters).toBe(.75);
  act(() => update({ memberDiameterMeters: 1.5 }));
  act(() => update({ showGrid: false }));
  expect(current().project.stage.memberDiameterMeters).toBe(1.5);
  if (editor) {
    const active = editor;
    const remoteBefore = current().project;
    act(() => active.doc.transact(() => {
      getModel(active.doc).settings.set("diameter", { "stage.memberDiameterMeters": 1.95, "stage.memberCircleDiameterM": 1.95 });
      getModel(active.doc).settings.set("width", { "stage.widthMeters": 19, "paradeSettings.width": 19 });
    }, REMOTE_ORIGIN));
    await act(async () => { await coordinator!.receiveCollaborationSnapshot(encodeUpdate(Y.encodeStateAsUpdate(active.doc)), [], "1"); });
    await screen.findByText("今の値 1.95m");
    expect(current().project.stage.widthMeters).toBe(19);
    expect(current().project).not.toBe(remoteBefore);
    act(step);
    expect(current().project.stage.memberDiameterMeters).toBe(2);
    expect(current().project.stage.widthMeters).toBe(19);
  }
  expect(geometry(current().project)).toEqual(positions);
  const value = current().project.stage.memberDiameterMeters;
  await act(async () => { fireEvent.click(document.querySelector(".toolbar-save-button")!); });
  await waitFor(async () => expect((await repository.get(project.id!))!.project.stage.memberDiameterMeters).toBe(value));
}, 25_000);

it.each(["stage", "parade"] as const)("2m: %s retains legacy diameter and unrelated settings, and supports Undo/Redo above 1m", async mode => {
  project.mode = mode; project.stage.memberDiameterMeters = .2;
  await open();
  expect(current().project.stage.memberDiameterMeters).toBe(.2);
  fireEvent.click(screen.getByRole("tab", { name: "ステージ" }));
  const update = observed.settings!.onChange;
  expect(current().project.stage.memberDiameterMeters).toBe(.2);
  const positions = geometry(current().project);
  act(() => update({ memberDiameterMeters: 1.5 }));
  act(() => update({ showCenterLine: false }));
  expect(current().project.stage.memberDiameterMeters).toBe(1.5);
  // Existing stage edits coalesce for 1200ms; separate this user action in time.
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
  act(() => update({ widthMeters: 18, memberDiameterMeters: 2 }));
  clock.mockRestore();
  expect(current().project.stage.memberDiameterMeters).toBe(2);
  act(() => current().onUndo());
  expect(current().project.stage.memberDiameterMeters).toBe(1.5);
  expect(current().project.stage.showCenterLine).toBe(false);
  act(() => current().onRedo());
  expect(current().project.stage.memberDiameterMeters).toBe(2);
  expect(geometry(current().project)).toEqual(positions);
}, 25_000);

it("B: playback disables the picker and a retained update callback cannot edit", async () => {
  project.audio = { id: "song", name: "曲", type: "audio/mpeg", size: 1, duration: 20 };
  await open();
  fireEvent.click(screen.getByRole("tab", { name: "ステージ" }));
  await screen.findByRole("group", { name: "メンバーの丸の大きさ（直径）" });
  const update = observed.settings!.onChange;
  await act(async () => { await observed.stage!.onTogglePlayback(); });
  expect(observed.settings!.memberDiameterDisabled).toBe(true);
  const before = current().project;
  act(() => update({ memberDiameterMeters: .8 }));
  expect(current().project).toBe(before);
}, 25_000);

const importFile = async (value: unknown, format: "json" | "wrapped" | "zip", name = "import") => {
  let buffer: ArrayBuffer;
  if (format === "zip") {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ fileType: "tairetsu-project", formatVersion: 1, includesAudio: true }));
    zip.file("project.json", JSON.stringify(value)); zip.file("audio/audio.mp3", new Uint8Array([1]));
    buffer = await zip.generateAsync({ type: "arraybuffer" });
  } else buffer = new TextEncoder().encode(JSON.stringify(format === "wrapped" ? { project: value } : value)).buffer;
  const file = new File([buffer], name + ".json", { type: "application/json" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => buffer });
  return file;
};

it.each(["json", "wrapped", "zip"] as const)("A10/A11: %s invalid imports retain editor, selection and Undo without saving audio", async format => {
  await open();
  const load = observed.library!.onImportProjectFile;
  act(() => current().onMoveMember("m_anna", { x: 4, y: 3 }));
  act(() => current().onSelect({ type: "member", id: "m_anna" }));
  act(() => current().onSelect({ type: "member", id: "m_chika" }, { append: true }));
  const before = current().project;
  const saveAudio = vi.spyOn(audioStorage, "saveAudioBlobToIndexedDb");
  const malformed = [
    { members: [{ ...before.members[0], name: 12 }] }, { members: [null] }, { frames: [null] },
    { frames: [{ ...before.frames[0], positions: { m: { x: "x", y: 2 } } }] },
    { frames: [{ ...before.frames[0], objectAssignments: { o: [1] } }] }, { id: "../bad" },
    { audio: { id: "bad/id", name: "曲", type: "audio/mpeg", size: 1 } },
  ];
  for (const patch of malformed) {
    const file = await importFile({ ...before, ...patch }, format);
    await act(async () => { await load(file); });
    expect(current().project).toBe(before);
    expect(current().selectedFrameId).toBe("A"); expect(current().selectedMemberIds).toEqual(["m_anna", "m_chika"]);
    expect(current().canUndo).toBe(true);
    expect(screen.queryByText("画面を表示できませんでした")).toBeNull();
    expect(screen.getByText("隊列表データが壊れている可能性があります。")).toBeTruthy();
  }
  expect(saveAudio).not.toHaveBeenCalled();
  act(() => current().onUndo());
  expect(current().project.frames[0].positions.m_anna).toEqual(project.frames[0].positions.m_anna);
}, 25_000);

it.each(["CORRUPT", "INVALID_ID", "QUOTA_EXCEEDED"] as const)("A10: repository creation error %s distinguishes corrupt import from recoverable capacity", async code => {
  await open();
  const load = observed.library!.onImportProjectFile;
  const before = current().project;
  const commit = vi.spyOn(repository, "commit").mockRejectedValue(new RepositoryError(code));
  const file = await importFile({ title: "旧隊列表", extra: true }, "wrapped");
  await act(async () => { await load(file); });
  expect(commit).toHaveBeenCalled();
  if (code === "QUOTA_EXCEEDED") {
    expect(current().project.title).toBe("旧隊列表");
    expect(current().project.frames.length).toBeGreaterThan(0);
    expect(await screen.findByRole("alert", { name: "端末保存エラー" })).toBeTruthy();
  } else {
    expect(current().project).toBe(before);
    expect(screen.getByText("隊列表データが壊れている可能性があります。")).toBeTruthy();
  }
}, 25_000);

it.each(["json", "wrapped", "zip"] as const)("A10/A11: real App imports valid legacy %s with missing fields, unknown fields and over-500m distance", async format => {
  await open();
  const saveAudio = vi.spyOn(audioStorage, "saveAudioBlobToIndexedDb").mockResolvedValue({ id: "import-audio", name: "曲", type: "audio/mpeg", size: 1 });
  const file = await importFile({ title: "正常な旧データ", custom: { keep: true }, mode: "parade", paradeSettings: { totalDistance: 501 } }, format);
  await act(async () => { await observed.library!.onImportProjectFile(file); });
  expect(current().project.title).toBe("正常な旧データ");
  expect(current().project.paradeSettings!.totalDistance).toBe(501);
  expect(current().project).toMatchObject({ custom: { keep: true } });
  expect(current().project.frames.length).toBeGreaterThan(0);
  expect(saveAudio).toHaveBeenCalledTimes(format === "zip" ? 1 : 0);
  expect((await repository.get(current().project.id!))!.project.title).toBe("正常な旧データ");
}, 25_000);

it("A10: missing legacy title uses the existing imported-project fallback before normalization", async () => {
  await open();
  const file = await importFile({ stage: {}, custom: "keep" }, "wrapped");
  await act(async () => { await observed.library!.onImportProjectFile(file); });
  expect(current().project.title).toBe("読み込んだ隊列表");
  expect(current().project).toMatchObject({ custom: "keep", mode: "stage" });
  expect(current().project.members).toEqual([]);
  expect(current().project.frames.length).toBeGreaterThan(0);
}, 25_000);
