// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import * as audioStorage from "./utils/audioStorage";
import type { Project, FormationFrame } from "./types";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { createSharedDocument } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";
import { SharedProjectEditor } from "./collaboration/editorSession";
import { SaveCoordinator } from "./storage/saveCoordinator";
import type { ParadeCanvas } from "./components/ParadeCanvas";
let useYjs = false;
let project: Project;
let repository: MemoryProjectRepository;
const observed = vi.hoisted(() => ({ canvas: null as ComponentProps<typeof ParadeCanvas> | null, rosterFrames: [] as FormationFrame[] }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    repository = new MemoryProjectRepository();
    const doc = useYjs ? createSharedDocument(project) : null;
    await repository.commit({ project, ...(doc ? { collaboration: createCollaborationData(doc) } : {}), localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-build26" });
    doc?.destroy();
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/ParadeCanvas", () => ({ ParadeCanvas: forwardRef<HTMLDivElement, ComponentProps<typeof ParadeCanvas>>((p, ref) => {
  observed.canvas = p; return <div ref={ref} data-testid="canvas" />;
}) }));
vi.mock("./components/RosterManagementModal", () => ({ RosterManagementModal: (p: { frames: FormationFrame[] }) => {
  observed.rosterFrames = p.frames; return <div data-testid="roster" />;
} }));
import App from "./App";
beforeEach(() => {
  useYjs = false;
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  project = { ...createSampleProject(), id: "build26", title: "順序検証", mode: "parade" };
  const frame = project.frames[0];
  project.frames = [
    { ...frame, id: "late", label: "後", timeSec: 30 },
    { ...frame, id: "early", label: "前", timeSec: 10 },
    { ...frame, id: "tie", label: "同時刻", timeSec: 10 },
  ];
  observed.canvas = null; observed.rosterFrames = [];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("opens a saved over-limit parade, rejects excess settings without changing them, and accepts the boundary", async () => {
  project.paradeSettings = { totalDistance: 501, backwardDistanceMeters: 501, width: 10, cellSizeMeters: .5,
    direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true };
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  expect(observed.canvas!.project.paradeSettings!.totalDistance).toBe(501);
  const memberId = observed.canvas!.project.members[0].id;
  act(() => observed.canvas!.onMoveMember(memberId, { x: 2, y: 2 }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(async () => expect((await repository.get("build26"))?.project).toMatchObject({ paradeSettings: { totalDistance: 501, backwardDistanceMeters: 501 } }));
  await waitFor(async () => expect((await repository.get("build26"))?.project.frames.find(f => f.id === "late")!.positions[memberId]).toEqual({ x: 2, y: 2 }));
  fireEvent.click(screen.getByRole("tab", { name: "ステージ" }));
  const distance = await screen.findByRole("spinbutton", { name: "全体距離" });
  fireEvent.change(distance, { target: { value: "502" } });
  expect(observed.canvas!.project.paradeSettings!.totalDistance).toBe(501);
  expect(await screen.findByText(/全体距離は1〜500m/)).toBeTruthy();
  fireEvent.change(distance, { target: { value: "500" } });
  const backward = screen.getByRole("spinbutton", { name: "後方表示距離" });
  fireEvent.change(backward, { target: { value: "502" } });
  expect(observed.canvas!.project.paradeSettings!.backwardDistanceMeters).toBe(501);
  fireEvent.change(backward, { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(async () => expect((await repository.get("build26"))?.project.paradeSettings).toMatchObject({ totalDistance: 500, backwardDistanceMeters: 500 }));
}, 20_000);

it.each([false, true])("saves continuous non-batch edits at the first edit's five-second deadline (Yjs=%s)", async yjs => {
  useYjs = yjs;
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  const memberId = observed.canvas!.project.members[0].id;
  const commits = vi.spyOn(repository, "commit");
  vi.useFakeTimers();
  try {
    for (let i = 0; i < 12; i++) {
      act(() => observed.canvas!.onMoveMember(memberId, { x: 1 + i / 50, y: 2 }));
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
    expect(commits).not.toHaveBeenCalled();
    act(() => observed.canvas!.onMoveMember(memberId, { x: 2, y: 2 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(commits).toHaveBeenCalledOnce();
    expect((await repository.get("build26"))!.project.frames.find(f => f.id === "late")!.positions[memberId]).toEqual({ x: 2, y: 2 });
  } finally { vi.useRealTimers(); }
}, 20_000);
it.each([false, true])("re-queues the pending save after a gesture that wrote nothing (Yjs=%s)", async yjs => {
  useYjs = yjs;
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  const memberId = observed.canvas!.project.members[0].id;
  const commits = vi.spyOn(repository, "commit");
  vi.useFakeTimers();
  try {
    act(() => observed.canvas!.onMoveMember(memberId, { x: 1.5, y: 2 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    // Pointer-down cancels the queued save; pointer-up without movement must queue it again.
    act(() => { observed.canvas!.onBeginProjectEdit("移動", { id: memberId, type: "member-position" }); });
    act(() => observed.canvas!.onEndProjectEdit());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(commits).toHaveBeenCalledOnce();
    expect((await repository.get("build26"))!.project.frames.find(f => f.id === "late")!.positions[memberId]).toEqual({ x: 1.5, y: 2 });
  } finally { vi.useRealTimers(); }
}, 20_000);
it.each([[false, false], [false, true], [true, false], [true, true]])("defers timer/drag races until a long drag ends and undoes the whole gesture (Yjs=%s, queued=%s)", async (yjs, queued) => {
  useYjs = yjs;
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  const memberId = observed.canvas!.project.members[0].id;
  const move = (x: number) => act(() => observed.canvas!.onMoveMember(memberId, { x, y: 2 }));
  const original = observed.canvas!.project.frames.find(f => f.id === "late")!.positions[memberId];
  const commits = vi.spyOn(repository, "commit");
  vi.useFakeTimers();
  const fakeSetTimeout = window.setTimeout;
  let scheduled: (() => void) | undefined;
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 800 && typeof handler === "function") scheduled = handler as () => void;
    return fakeSetTimeout(handler, delay, ...args);
  }) as typeof window.setTimeout;
  const ends = vi.spyOn(SharedProjectEditor.prototype, "end");
  const stages = vi.spyOn(SharedProjectEditor.prototype, "stagePending");
  try {
    move(1);
    expect(scheduled).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(799); });
    act(() => { observed.canvas!.onBeginProjectEdit("長い移動", { id: memberId, type: "member-position" }); });
    // Model a callback already dequeued before clearTimeout: it must still guard the batch.
    ends.mockClear(); stages.mockClear();
    if (queued) act(() => { scheduled!(); });
    for (let i = 0; i < 15; i++) {
      move(Number((2 + i / 50).toFixed(2)));
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
    expect(commits).not.toHaveBeenCalled();
    expect(ends).not.toHaveBeenCalled(); expect(stages).not.toHaveBeenCalled();
    act(() => observed.canvas!.onEndProjectEdit());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(commits).toHaveBeenCalledOnce();
    expect((await repository.get("build26"))!.project.frames.find(f => f.id === "late")!.positions[memberId]).toEqual({ x: 2.28, y: 2 });
    act(() => observed.canvas!.onUndo());
    expect(observed.canvas!.project.frames.find(f => f.id === "late")!.positions[memberId]).toEqual({ x: 1, y: 2 });
    act(() => observed.canvas!.onUndo());
    expect(observed.canvas!.project.frames.find(f => f.id === "late")!.positions[memberId]).toEqual(original);
  } finally { window.setTimeout = fakeSetTimeout; vi.useRealTimers(); }
}, 20_000);
it("catches a lifecycle save rejection and keeps a Japanese retry message", async () => {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  vi.spyOn(SaveCoordinator.prototype, "flush").mockRejectedValue(new Error("private-error"));
  fireEvent(window, new Event("pagehide"));
  expect(await screen.findByText("編集内容を保存できませんでした。画面の内容を確認し、保存を再試行してください。")).toBeTruthy();
  expect(document.body.textContent).not.toContain("private-error");
}, 20_000);
it("App keeps its saved order while timeline, navigation, numbering and roster use the same time order", async () => {
  const view = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  expect(view.container.querySelectorAll(".member-manager .panel-sticky-header")).toHaveLength(1);
  fireEvent.click(await screen.findByRole("button", { name: "全体名簿を開く" }));
  await screen.findByTestId("roster");
  expect(observed.rosterFrames.map(f => f.id)).toEqual(["early", "tie", "late"]);
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  const input = await screen.findByRole("button", { name: "シーンの時刻を変更（現在 0:30）" });
  const labels = () => [...view.container.querySelectorAll(".timeline-card__top strong")].map(el => el.textContent);
  expect(labels()).toEqual(["前", "同時刻", "後"]);
  const savedIds = () => observed.canvas!.project.frames.map(f => f.id);
  expect(savedIds()).toEqual(["late", "early", "tie"]);
  expect(observed.canvas!.selectedFrameId).toBe("late");
  input.focus(); fireEvent.click(input);
  const seconds = screen.getByRole("spinbutton", { name: "秒" });
  seconds.scrollTop = 5 * 44; fireEvent.scroll(seconds);
  expect(labels()).toEqual(["前", "同時刻", "後"]);
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(labels()).toEqual(["後", "前", "同時刻"]);
  expect(observed.canvas!.selectedFrameId).toBe("late"); expect(savedIds()).toEqual(["late", "early", "tie"]);
  fireEvent.click(screen.getByRole("button", { name: "次へ" })); expect(observed.canvas!.selectedFrameId).toBe("early");
  // The scene details (which now hold the memo) use the same numbering.
  await screen.findByText(/^シーン2 \/ /);
  expect((screen.getByLabelText("ラベル") as HTMLInputElement).value).toBe("前");
  fireEvent.click(screen.getByRole("tab", { name: "メンバー" }));
  fireEvent.click(await screen.findByRole("button", { name: "全体名簿を開く" }));
  await screen.findByTestId("roster"); expect(observed.rosterFrames.map(f => f.id)).toEqual(["late", "early", "tie"]);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(async () => expect((await repository.get("build26"))?.project.frames.map(f => [f.id, f.timeSec])).toEqual([["late", 5], ["early", 10], ["tie", 10]]));
}, 20_000);

it("each scene dial confirmation is one Undo, unchanged/cancelled choices create no history", async () => {
  project.frames[0].timeSec = 14.57;
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas"); fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  const open = () => fireEvent.click(screen.getByRole("button", { name: /シーンの時刻を変更/ }));
  const increment = () => fireEvent.click(screen.getByRole("button", { name: "秒を1増やす" }));
  const confirm = () => fireEvent.click(screen.getByRole("button", { name: "決定" }));
  const time = () => observed.canvas!.project.frames.find(f => f.id === "late")!.timeSec;
  open(); increment(); fireEvent.click(screen.getByRole("button", { name: "秒を1減らす" })); confirm();
  expect(time()).toBe(14.57); expect(observed.canvas!.canUndo).toBe(false);
  open(); increment(); fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(time()).toBe(14.57); expect(observed.canvas!.canUndo).toBe(false);
  open(); increment(); confirm(); expect(time()).toBe(15);
  open(); increment(); confirm(); expect(time()).toBe(16);
  act(() => observed.canvas!.onUndo!()); expect(time()).toBe(15);
  act(() => observed.canvas!.onUndo!()); expect(time()).toBe(14.57); expect(observed.canvas!.canUndo).toBe(false);
  act(() => observed.canvas!.onRedo!()); expect(time()).toBe(15);
  expect(observed.canvas!.selectedFrameId).toBe("late");
}, 20_000);

it("fixes the dial target during playback and cancels when playback selects another scene", async () => {
  project.audio = { id: "fake-song", name: "架空音源", type: "audio/wav", size: 0, duration: 100 };
  vi.spyOn(audioStorage, "resolveAudioPlaybackURL").mockResolvedValue("blob:fake-song");
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const raf = new Map<number, FrameRequestCallback>(); let serial = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { raf.set(++serial, cb); return serial; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { raf.delete(id); });
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  const audio = document.querySelector("audio")!;
  await waitFor(() => expect(audio.src).toBe("blob:fake-song"));
  audio.currentTime = 35;
  fireEvent.click(screen.getByRole("tab", { name: "音源" }));
  fireEvent.click((await screen.findAllByRole("button", { name: "再生" }))[0]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: "停止" }).length).toBeGreaterThan(0));
  const tick = () => act(() => { const pending = [...raf.values()]; raf.clear(); pending.forEach(cb => cb(0)); });
  tick();
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  fireEvent.click(screen.getByRole("button", { name: "シーンの時刻を変更（現在 0:30）" }));
  fireEvent.click(screen.getByRole("button", { name: "秒を1増やす" }));
  audio.currentTime = 36; tick();
  expect(screen.getByRole("dialog", { name: /^シーン[0-9]+「.*」の時刻$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(observed.canvas!.project.frames.map(f => f.timeSec)).toEqual([31, 10, 10]);
  fireEvent.click(screen.getByRole("button", { name: /シーンの時刻を変更/ }));
  fireEvent.click(screen.getByRole("button", { name: "秒を1増やす" }));
  audio.currentTime = 20; tick();
  expect(screen.queryByRole("dialog", { name: /^シーン[0-9]+「.*」の時刻$/ })).toBeNull();
  expect(observed.canvas!.project.frames.map(f => f.timeSec)).toEqual([31, 10, 10]);
  act(() => observed.canvas!.onUndo!());
  expect(observed.canvas!.project.frames.map(f => f.timeSec)).toEqual([30, 10, 10]);
  expect(observed.canvas!.canUndo).toBe(false);
}, 20_000);
it("App reflects only the selected group at zero movement and preserves other member state", async () => {
  project.memberGroups = [{ id: "red", name: "赤", memberIds: ["m_anna"] }];
  const source = project.frames[1];
  source.positions = { m_anna: { x: 3, y: 2 }, m_ben: { x: 4, y: 3 } };
  const target = project.frames[0];
  target.positions = { m_anna: { x: 7, y: 8 }, m_ben: { x: 9, y: 10 } };
  // The immediately preceding tie scene is the source in the display order.
  project.frames[2] = { ...source, id: "tie" };
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  act(() => observed.canvas!.onReflectPreviousFrame({ target: "group", groupId: "red", direction: "forward", moveMeters: 0, moveObjects: true }));
  expect(observed.canvas!.project.frames.find(f => f.id === "late")!.positions).toEqual({ m_anna: { x: 3, y: 2 }, m_ben: { x: 9, y: 10 } });
  expect(observed.canvas!.project.frames.map(f => f.id)).toEqual(["late", "early", "tie"]);
}, 20_000);

it("audio boundary drag commits once and one Undo restores it; waveform seek does not create history", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 154, right: 300, bottom: 154, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  fireEvent.click(screen.getByRole("tab", { name: "音源" }));
  const handle = await screen.findByRole("button", { name: /^1\. 前の区切り/ });
  const times = () => observed.canvas!.project.frames.map(f => f.timeSec);
  fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 150, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 170, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
  expect(times()).toEqual([30, 10, 10]);
  fireEvent.pointerUp(handle, { pointerId: 1 }); fireEvent.click(handle);
  expect(times()).toEqual([30, 15, 10]);
  const wave = document.querySelector(".audio-timeline__viewport")!;
  fireEvent.pointerDown(wave, { button: 0, isPrimary: true, clientX: 150, pointerId: 2 });
  fireEvent.pointerMove(wave, { clientX: 100, pointerId: 2 }); fireEvent.pointerUp(wave, { pointerId: 2 });
  expect(times()).toEqual([30, 15, 10]);
  expect(observed.canvas!.canUndo).toBe(true);
  act(() => observed.canvas!.onUndo!());
  expect(times()).toEqual([30, 10, 10]);
  act(() => observed.canvas!.onRedo!());
  expect(times()).toEqual([30, 15, 10]);
  // Switching tabs discards an in-progress retime without another history entry.
  const again = screen.getByRole("button", { name: /^2\. 前の区切り/ });
  fireEvent.pointerDown(again, { button: 0, isPrimary: true, clientX: 150, pointerId: 3 });
  fireEvent.pointerMove(again, { clientX: 220, pointerId: 3 });
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  fireEvent.pointerUp(again, { pointerId: 3 });
  expect(times()).toEqual([30, 15, 10]);
}, 20_000);
