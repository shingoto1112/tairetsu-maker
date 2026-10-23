// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StageCanvas } from "./components/StageCanvas";
import type { ParadeCanvas } from "./components/ParadeCanvas";
import type { GroupToolsPanel } from "./components/GroupToolsPanel";
import type { Position, Project } from "./types";
import { createSampleProject } from "./sampleProject";
import { createDefaultParadeSettings } from "./project/defaults";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { createSharedDocument } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";
import App from "./App";

type CanvasProps = ComponentProps<typeof StageCanvas> | ComponentProps<typeof ParadeCanvas>;
const observed = vi.hoisted(() => ({ canvas: null as CanvasProps | null,
  panel: null as ComponentProps<typeof GroupToolsPanel> | null, scroll: vi.fn() }));
let project: Project;
let yjs: boolean;
let raf: FrameRequestCallback[];
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    const repository = new MemoryProjectRepository();
    const doc = yjs ? createSharedDocument(project) : null;
    await repository.commit({ project, ...(doc ? { collaboration: createCollaborationData(doc) } : {}),
      localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-relative-move" });
    doc?.destroy();
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/StageCanvas", () => ({
  StageCanvas: forwardRef<HTMLDivElement, CanvasProps>((p, ref) => {
    observed.canvas = p;
    return <div ref={node => {
      if (node) Object.assign(node, { scrollTargetIntoView: observed.scroll });
      if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
    }} />;
  }),
}));
vi.mock("./components/ParadeCanvas", async () => ({
  ParadeCanvas: (await import("./components/StageCanvas")).StageCanvas,
}));
vi.mock("./components/GroupToolsPanel", async original => {
  const { GroupToolsPanel: Panel } = await original<typeof import("./components/GroupToolsPanel")>();
  return { GroupToolsPanel: (p: ComponentProps<typeof GroupToolsPanel>) => {
    observed.panel = p; return <Panel {...p} />;
  } };
});

beforeEach(() => {
  localStorage.clear(); yjs = false; raf = [];
  observed.canvas = null; observed.panel = null; observed.scroll.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { raf.push(cb); return raf.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  project = { ...createSampleProject(), id: "relative-move", title: "一括移動検証", audio: null };
  project.stage = { ...project.stage, widthMeters: 9, depthMeters: 5.4, gridSizeMeters: 0.3 };
  project.members = project.members.filter(m => ["m_anna", "m_ben"].includes(m.id));
  project.frames = project.frames.slice(0, 2).map((frame, i) => ({ ...frame, id: i ? "B" : "A", timeSec: i * 8,
    positions: { m_anna: { x: 0.17, y: 0.31 }, m_ben: { x: 8.89, y: 5.27 } },
    memberVisibility: { m_anna: true, m_ben: true }, objectAssignments: {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const current = () => observed.canvas!;
const frame = () => current().project.frames.find(f => f.id === current().selectedFrameId)!;
const tick = () => act(() => { const pending = raf; raf = []; pending.forEach(cb => cb(0)); });
async function open() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "一括移動検証を開く" }));
  await waitFor(() => expect(observed.canvas).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "選択モード" }));
  const picker = screen.getByRole("region", { name: "このシーンの表示" });
  for (const name of [/^Anna/, /^Ben/]) fireEvent.click(within(picker).getByRole("button", { name }));
  expect(current().selectedMemberIds).toEqual(["m_anna", "m_ben"]);
  tick(); observed.scroll.mockClear();
}
function expectDelta(before: Record<string, Position>, delta: Position) {
  for (const id of ["m_anna", "m_ben"]) {
    expect(frame().positions[id].x - before[id].x).toBeCloseTo(delta.x, 12);
    expect(frame().positions[id].y - before[id].y).toBeCloseTo(delta.y, 12);
  }
}
const keyboard = (key: string, repeat = false) => fireEvent.keyDown(window, { key, repeat });

it.each([
  ["ArrowLeft", "左へ移動", -0.17, 0], ["ArrowRight", "右へ移動", 0.11, 0],
  ["ArrowUp", "上へ移動", 0, -0.31], ["ArrowDown", "下へ移動", 0, 0.13],
] as const)("B6: key %s and panel %s preserve offsets at the edge and Undo restores both", async (key, button, x, y) => {
  await open();
  const before = structuredClone(frame().positions);
  const other = structuredClone(current().project.frames.find(f => f.id === "B"));
  // Up uses two 0.25m presses to reach the 0.31m edge; the panel uses one 0.5m press.
  keyboard(key); if (key === "ArrowUp") keyboard(key, true);
  expectDelta(before, { x, y });
  tick();
  const diameter = current().project.stage.memberDiameterMeters ?? 0.5;
  const expectedBounds = {
    x: before.m_anna.x + x - diameter / 2, y: before.m_anna.y + y - diameter / 2,
    widthMeters: before.m_ben.x - before.m_anna.x + diameter,
    heightMeters: before.m_ben.y - before.m_anna.y + diameter,
  };
  const actualBounds = observed.scroll.mock.calls[observed.scroll.mock.calls.length - 1][0];
  for (const axis of ["x", "y", "widthMeters", "heightMeters"] as const) {
    expect(actualBounds[axis]).toBeCloseTo(expectedBounds[axis], 12);
  }
  const atEdge = current().project;
  keyboard(key, true); tick();
  expect(current().project).toBe(atEdge); // no zero-move Project/history mutation
  act(() => current().onUndo());
  expect(frame().positions).toEqual(before); expect(current().canUndo).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: button }));
  expectDelta(before, { x, y });
  const panelEdge = current().project;
  fireEvent.click(screen.getByRole("button", { name: button }));
  expect(current().project).toBe(panelEdge);
  expect(current().project.frames.find(f => f.id === "B")).toEqual(other);
  act(() => current().onUndo());
  expect(frame().positions).toEqual(before); expect(current().canUndo).toBe(false);
}, 20_000);

it.each([false, true])("B6: a zero move from the outset creates no history or dirty Project (Yjs=%s)", async shared => {
  yjs = shared;
  project.frames[0].positions.m_ben.x = 9;
  await open();
  const before = current().project;
  for (let i = 0; i < 3; i++) {
    keyboard("ArrowRight", i > 0);
    fireEvent.click(screen.getByRole("button", { name: "右へ移動" }));
  }
  expect(current().project).toBe(before);
  expect(current().canUndo).toBe(false); tick(); expect(observed.scroll).not.toHaveBeenCalled();
}, 20_000);

it.each([false, true])("B6: preserves existing key repeat history and Undo (Yjs=%s)", async shared => {
  yjs = shared;
  project.frames[0].positions = { m_anna: { x: 1.173, y: 1.147 }, m_ben: { x: 3.283, y: 2.917 } };
  await open();
  const before = structuredClone(frame().positions);
  for (let i = 0; i < 4; i++) keyboard("ArrowRight", i > 0);
  expectDelta(before, { x: 1, y: 0 });
  act(() => current().onUndo());
  // Existing Yjs history has captureTimeout=0; local history coalesces by label.
  // B6 must retain both behaviors rather than introduce shared-history changes.
  if (shared) {
    expectDelta(before, { x: 0.75, y: 0 });
    expect(current().canUndo).toBe(true);
    for (let i = 0; i < 3; i++) act(() => current().onUndo());
  }
  expect(frame().positions).toEqual(before); expect(current().canUndo).toBe(false);
  for (let i = 0; i < (shared ? 4 : 1); i++) act(() => current().onRedo());
  expectDelta(before, { x: 1, y: 0 });
}, 20_000);

it("B6: panel movement preserves inherited positions without materializing unrelated coordinates", async () => {
  project.frames[0].positions.m_anna = { x: 1.173, y: 1.147 };
  delete project.frames[1].positions.m_anna;
  await open();
  fireEvent.click(document.querySelector('.scene-thumbnail-rail [data-thumbnail-frame-id="B"]')!);
  expect(current().selectedFrameId).toBe("B");
  const before = structuredClone(current().snapshot.positions);
  const firstFrame = structuredClone(current().project.frames[0]);
  fireEvent.click(screen.getByRole("button", { name: "右へ移動" }));
  expectDelta(before, { x: 0.11, y: 0 });
  expect(current().project.frames[0]).toEqual(firstFrame);
  act(() => current().onUndo());
  expect(frame().positions.m_anna).toBeUndefined();
  expect(current().snapshot.positions.m_anna).toEqual(before.m_anna);
}, 20_000);

it.each(["stage", "parade"] as const)("B6: a retained panel callback uses latest coordinates and effective dimensions in %s", async mode => {
  project.mode = mode;
  project.useGlobalStageSize = false;
  project.frames[0].stageWidthMeters = 4; project.frames[0].stageDepthMeters = 3;
  project.paradeSettings = createDefaultParadeSettings({ width: 4, totalDistance: 10.13, backwardDistanceMeters: 2.31 });
  project.frames[0].positions = { m_anna: { x: 1, y: 1 }, m_ben: { x: 3.3, y: 2.3 } };
  await open();
  const retained = observed.panel!.onNudgeSelection;
  if (mode === "parade") {
    expect(screen.getByRole("button", { name: "奥へ移動" }).title).toBe("奥へ");
    expect(screen.getByRole("button", { name: "客席へ移動" }).title).toBe("客席へ");
    expect(screen.getByRole("button", { name: "右へ移動" }).title).toBe("右へ");
  }
  // Move after capturing the callback, so its render snapshot is stale.
  act(() => current().onMoveMember("m_ben", { x: 3.9, y: mode === "parade" ? 12.3 : 2.9 }));
  const before = structuredClone(frame().positions);
  act(() => retained(0.5, 0.5));
  expectDelta(before, { x: 0.1, y: mode === "parade" ? 0.14 : 0.1 });
}, 20_000);

it.each(["stage", "parade"] as const)("B6: keyboard uses effective bounds in %s", async mode => {
  project.mode = mode; project.useGlobalStageSize = false;
  project.frames[0].stageWidthMeters = 4; project.frames[0].stageDepthMeters = 3;
  project.paradeSettings = createDefaultParadeSettings({ width: 4, totalDistance: 10.13, backwardDistanceMeters: 2.31 });
  project.frames[0].positions = { m_anna: { x: 1, y: 1 }, m_ben: { x: 3.9, y: mode === "parade" ? 12.3 : 2.9 } };
  await open(); const before = structuredClone(frame().positions);
  keyboard("ArrowRight"); keyboard("ArrowDown");
  expectDelta(before, { x: 0.1, y: mode === "parade" ? 0.14 : 0.1 });
}, 20_000);

it.each([
  ["bottom", "performer", -0.5], ["bottom", "audience", 0.5],
  ["top", "performer", 0.5], ["top", "audience", -0.5],
] as const)("screen directions for front=%s view=%s", async (front, perspective, delta) => {
  project.stage.frontDirection = front; project.viewerPerspective = perspective;
  project.stage.widthMeters = 10; project.stage.depthMeters = 6;
  project.frames[0].positions = { m_anna: { x: 2, y: 1 }, m_ben: { x: 6, y: 4 } };
  project.frames[0].objectStates.o_chair = { objectId: "o_chair", x: 2, y: 1, widthMeters: 2, heightMeters: 1, rotation: 0, visible: true, zIndex: 10 };
  await open(); const before = structuredClone(frame().positions);
  // Both physical coordinate values remain unchanged across the two screen perspectives.
  fireEvent.click(screen.getByRole("button", { name: "選択解除" }));
  act(() => current().onSelect({ type: "member", id: "m_anna" }));
  expect((screen.getByRole("spinbutton", { name: /^横（/ }) as HTMLInputElement).value).toBe(front === "top" ? "-3" : "3");
  expect((screen.getByRole("spinbutton", { name: /^縦（/ }) as HTMLInputElement).value).toBe(front === "top" ? "1" : "5");
  act(() => current().onSelect({ type: "member", id: "m_ben" }, { append: true }));
  keyboard("ArrowRight"); expectDelta(before, { x: delta / 2, y: 0 });
  act(() => current().onUndo());
  for (const [button, x, y] of [
    ["右へ移動", delta, 0], ["左へ移動", -delta, 0],
    ["下へ移動", 0, delta], ["上へ移動", 0, -delta],
  ] as const) {
    const target = screen.getByRole("button", { name: button });
    expect(target.title).toBe(button);
    fireEvent.click(target); expectDelta(before, { x, y });
    act(() => current().onUndo()); expect(frame().positions).toEqual(before);
  }
  const edges = delta < 0 ? [["left", "x", 6], ["right", "x", 2], ["top", "y", 4], ["bottom", "y", 1]] as const
    : [["left", "x", 2], ["right", "x", 6], ["top", "y", 1], ["bottom", "y", 4]] as const;
  for (const [action, axis, expected] of edges) {
    act(() => observed.panel!.onAlignSelection(action));
    for (const id of ["m_anna", "m_ben"]) expect(frame().positions[id][axis]).toBe(expected);
    act(() => current().onUndo()); expect(frame().positions).toEqual(before);
  }
  fireEvent.click(screen.getByRole("tab", { name: "道具" }));
  await screen.findByText("整列・配置", { selector: "strong" });
  act(() => current().onSelect({ type: "object", id: "o_chair" }));
  const propEdges = delta < 0 ? [["左端", "x", 8], ["右端", "x", 0], ["上端", "y", 5], ["下端", "y", 0]] as const
    : [["左端", "x", 0], ["右端", "x", 8], ["上端", "y", 0], ["下端", "y", 5]] as const;
  for (const [button, axis, expected] of propEdges) {
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(frame().objectStates.o_chair[axis]).toBe(expected);
    act(() => current().onUndo());
    expect(frame().objectStates.o_chair).toEqual(project.frames[0].objectStates.o_chair);
  }
}, 20_000);

it("B6: oversized selection stays intact with one notice, without blocking the other axis", async () => {
  project.frames[0].positions = { m_anna: { x: 0, y: 1 }, m_ben: { x: 10, y: 2 } };
  await open(); const before = current().project;
  for (let i = 0; i < 3; i++) {
    keyboard("ArrowRight", i > 0); fireEvent.click(screen.getByRole("button", { name: "左へ移動" }));
  }
  expect(current().project).toBe(before); expect(current().canUndo).toBe(false);
  const notice = screen.getByRole("region", { name: "お知らせ" });
  expect(within(notice).getAllByText("隊形がステージより大きいため、この向きには動かせません。")).toHaveLength(1);
  keyboard("ArrowDown"); expectDelta(before.frames[0].positions, { x: 0, y: 0.25 });
}, 20_000);
