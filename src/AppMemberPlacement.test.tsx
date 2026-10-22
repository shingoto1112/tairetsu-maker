// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StageCanvas } from "./components/StageCanvas";
import type { Project } from "./types";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { createSharedDocument } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";
import { SharedProjectEditor } from "./collaboration/editorSession";
import { planRecipe } from "./collaboration/recipeCommands";

type CanvasProps = ComponentProps<typeof StageCanvas>;
const observed = vi.hoisted(() => ({ canvas: null as CanvasProps | null }));
let project: Project, useYjs = false, portrait = false;
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    const repository = new MemoryProjectRepository();
    const doc = useYjs ? createSharedDocument(project) : null;
    await repository.commit({ project, ...(doc ? { collaboration: createCollaborationData(doc) } : {}),
      localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-placement" });
    doc?.destroy();
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/StageCanvas", () => ({ StageCanvas: forwardRef<HTMLDivElement, CanvasProps>((p, ref) => {
  observed.canvas = p; return <div ref={ref} data-testid="canvas" />;
}) }));
vi.mock("./components/ParadeCanvas", () => ({ ParadeCanvas: forwardRef<HTMLDivElement, CanvasProps>((p, ref) => {
  observed.canvas = p; return <div ref={ref} data-testid="canvas" />;
}) }));
import App from "./App";
beforeEach(() => {
  localStorage.clear(); useYjs = false; portrait = false; observed.canvas = null;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: portrait && query.includes("orientation: portrait"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  project = { ...createSampleProject(), id: "placement", title: "配置検証" };
  project.stage = { ...project.stage, widthMeters: 8, depthMeters: 5.3, memberDiameterMeters: .7, gridSizeMeters: .25 };
  project.memberGroups = []; project.frames.forEach(f => { f.objectAssignments = {}; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const current = () => observed.canvas!;
async function open() {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "配置検証を開く" }));
  await screen.findByTestId("canvas");
}
function separated(p: Project, frameIndex = 0) {
  const positions = p.members.map(m => p.frames[frameIndex].positions[m.id]);
  positions.forEach((a, i) => positions.slice(i + 1).forEach(b =>
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(p.stage.memberDiameterMeters! - 1e-8)));
}
const add = () => fireEvent.click(screen.getByRole("button", { name: "メンバー" }));
it.each([["stage", false], ["parade", false], ["stage", true], ["parade", true]] as const)(
  "B1: %s repeated additions use live scene positions and one Undo per addition (Yjs=%s)", async (mode, yjs) => {
    project.mode = mode; useYjs = yjs;
    project.frames.forEach((f, i) => { f.positions = { m_anna: { x: 4 + i, y: 2.65 }, m_ben: { x: 1, y: 1 }, m_chika: { x: 2, y: 1 } }; });
    await open(); const before = structuredClone(current().project);
    const edits = vi.spyOn(SharedProjectEditor.prototype, "edit");
    add(); const first = structuredClone(current().project); add(); const second = structuredClone(current().project);
    expect(second.members).toHaveLength(before.members.length + 2);
    second.frames.forEach((f, i) => {
      for (const m of before.members) expect(f.positions[m.id]).toEqual(before.frames[i].positions[m.id]);
      separated(second, i);
      for (const m of second.members.slice(-2)) expect(f.memberVisibility?.[m.id]).toBe(i === 0);
    });
    if (yjs) {
      expect(edits).toHaveBeenCalledTimes(2);
      // Replaying the captured recipe against a newer Project must keep its ID and avoid newly received members.
      const recipe = edits.mock.calls[0][0], live = structuredClone(before);
      const addedId = first.members[first.members.length - 1].id, proposed = first.frames[0].positions[addedId];
      live.members.push({ id: "remote", name: "遠隔", color: "red" }); live.frames[0].positions.remote = proposed;
      const replayed = recipe(live);
      expect(replayed.members[replayed.members.length - 1].id).toBe(addedId);
      expect(Math.hypot(replayed.frames[0].positions[addedId].x - proposed.x, replayed.frames[0].positions[addedId].y - proposed.y)).toBeGreaterThanOrEqual(.7);
    }
    act(() => current().onUndo()); expect(current().project.members).toEqual(first.members); expect(current().project.frames).toEqual(first.frames);
    act(() => current().onUndo()); expect(current().project.members).toEqual(before.members); expect(current().project.frames).toEqual(before.frames);
    expect(current().canUndo).toBe(false);
  }, 20_000);
it.each(["stage", "parade"] as const)("B1: explicit %s placement keeps the requested point and existing snap despite an occupied circle", async mode => {
  project.mode = mode;
  project.stage.horizontalGuideMode = "meters";
  project.paradeSettings = { width: 8, totalDistance: 100, cellSizeMeters: .25, direction: "up", rulerPosition: "both",
    horizontalMeasureMode: "normalMeter", emphasizeEvery5m: true, emphasizeEvery10m: true };
  project.frames[0].positions.m_anna = { x: 4, y: 2.65 };
  await open();
  act(() => current().onContextMenuRequest({ clientX: 100, clientY: 100, stagePosition: { x: 4, y: 2.65 }, target: { type: "stage" } }));
  fireEvent.click(screen.getByRole("button", { name: "メンバー追加" }));
  const id = current().project.members[current().project.members.length - 1].id;
  expect(current().project.frames[0].positions[id]).toEqual({ x: 4, y: mode === "stage" ? 2.65 : 2.75 });
});
it("B1: parade additions start at the visible viewport center", async () => {
  project.mode = "parade";
  project.paradeSettings = { width: 8, totalDistance: 100, cellSizeMeters: .25, direction: "up", rulerPosition: "both",
    horizontalMeasureMode: "normalMeter", emphasizeEvery5m: true, emphasizeEvery10m: true };
  project.frames[0].sceneViewState = { scrollTop: 1200, scrollLeft: 0, zoom: 2, viewportWidth: 600, viewportHeight: 400 };
  await open(); add();
  const pos = current().project.frames[0].positions[current().project.members[current().project.members.length - 1].id];
  // Existing viewport conversion: 32px/m, 10px top padding and 28px ruler.
  expect(pos.y).toBeCloseTo((1200 + 200 - 10 - 28) / (32 * 2), 3);
});
it("B1: no vacancy still adds a member, notifies and undoes once", async () => {
  Object.assign(project.stage, { widthMeters: 1, depthMeters: 1, memberDiameterMeters: 1 });
  project.members = [project.members[0]]; project.frames.forEach(f => { f.positions = { m_anna: { x: .5, y: .5 } }; });
  await open(); add();
  expect(screen.getByText("空きがないため一部を重ねて置きました。")).toBeTruthy();
  expect(current().project.members).toHaveLength(2);
  expect(current().project.frames[0].positions[current().project.members[1].id]).toEqual({ x: .5, y: .5 });
  act(() => current().onUndo()); expect(current().project.members).toHaveLength(1); expect(current().canUndo).toBe(false);
});
it.each([false, true])("B4: show all preserves assignees, counts real members once, restores non-assignee global visibility and undoes once (Yjs=%s)", async yjs => {
  useYjs = yjs; portrait = true;
  project.members[0].visible = false; project.members[1].visible = false;
  Object.assign(project.frames[0], { objectAssignments: { o_chair: yjs ? ["m_anna"] : ["m_anna", "m_anna", "ghost"], o_curtain: ["m_anna"] },
    memberVisibility: { m_anna: false, m_ben: false, m_chika: false } });
  await open(); const before = structuredClone(current().project);
  const edits = vi.spyOn(SharedProjectEditor.prototype, "edit");
  fireEvent.change(screen.getByRole("searchbox", { name: "メンバー名を検索" }), { target: { value: "Anna" } });
  fireEvent.click(screen.getByRole("button", { name: "すべて表示" }));
  const after = current().project;
  expect(screen.getByText("2人を表示しました。道具担当の1人は隊列外のままです。")).toBeTruthy();
  expect(after.members[0]).toEqual(before.members[0]); expect(after.members[1].visible).toBe(true);
  expect(after.frames[0].objectAssignments).toEqual(before.frames[0].objectAssignments);
  expect(after.frames[0].positions).toEqual(before.frames[0].positions);
  expect(after.frames[0].memberVisibility).toEqual({ m_anna: false, m_ben: true, m_chika: true });
  expect(after.frames.slice(1)).toEqual(before.frames.slice(1));
  if (yjs) {
    expect(edits).toHaveBeenCalledTimes(1);
    const recipe = edits.mock.calls[0][0], live = structuredClone(before);
    live.frames[0].objectAssignments!.o_chair.push("m_ben");
    const next = recipe(live);
    expect(next.frames[0].objectAssignments).toBe(live.frames[0].objectAssignments);
    expect(next.members[1]).toBe(live.members[1]); expect(next.frames[0].memberVisibility!.m_ben).toBe(false);
    const doc = createSharedDocument(live), writes = planRecipe(doc, live, next);
    expect(writes.every(w => !w.target.field.includes("objectAssignments") && !w.target.entityType.toLowerCase().includes("assignment"))).toBe(true);
    doc.destroy();
  }
  // No change on a second click: one Undo still restores the entire original operation.
  fireEvent.click(screen.getByRole("button", { name: "すべて表示" }));
  act(() => current().onUndo()); expect(current().project.members).toEqual(before.members); expect(current().project.frames).toEqual(before.frames);
  expect(current().canUndo).toBe(false);
}, 20_000);
it.each([false, true])("B4: unchanged show-all creates no history (Yjs=%s)", async yjs => {
  useYjs = yjs; project.frames[0].memberVisibility = {};
  await open(); fireEvent.click(screen.getByRole("button", { name: "すべて表示" }));
  expect(current().canUndo).toBe(false);
  expect(screen.getByText("すべてのメンバーを表示しました。")).toBeTruthy();
});
