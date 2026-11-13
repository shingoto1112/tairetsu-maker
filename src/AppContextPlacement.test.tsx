// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { createDefaultParadeSettings } from "./project/defaults";
import type { Project, Position, StageContextMenuTarget } from "./types";
import type { ParadeCanvas } from "./components/ParadeCanvas";

let project: Project;
const observed = vi.hoisted(() => ({ canvas: null as ComponentProps<typeof ParadeCanvas> | null }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    const repository = new MemoryProjectRepository();
    await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "context-seed" });
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/ParadeCanvas", () => ({ ParadeCanvas: forwardRef<HTMLDivElement, ComponentProps<typeof ParadeCanvas>>((p, ref) => {
  observed.canvas = p; return <div ref={ref} data-testid="canvas" />;
}) }));
vi.mock("./components/StageCanvas", () => ({ StageCanvas: forwardRef<HTMLDivElement, ComponentProps<typeof ParadeCanvas>>((p, ref) => {
  observed.canvas = p; return <div ref={ref} data-testid="canvas" />;
}) }));
import App from "./App";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  project = { ...createSampleProject(), id: "context-placement", title: "追加位置検証", mode: "parade" };
  project.stage = { ...project.stage, widthMeters: 9, depthMeters: 5.4, gridSizeMeters: .5, horizontalGuideMode: "centerSplit" };
  project.paradeSettings = createDefaultParadeSettings({ width: 9, totalDistance: 10.13, backwardDistanceMeters: 2.31, cellSizeMeters: .5, horizontalMeasureMode: "centerSplit" });
  project.frames = [project.frames[0]];
  observed.canvas = null;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = async () => {
  render(<App />); fireEvent.click(await screen.findByRole("button", { name: "追加位置検証を開く" }));
  await screen.findByTestId("canvas");
};
const contextAdd = async (point: Position, name: string) => {
  act(() => observed.canvas!.onContextMenuRequest({ clientX: 100, clientY: 100, stagePosition: point, target: { type: "stage" } }));
  fireEvent.click(await screen.findByRole("button", { name }));
};
const lattice = (value: number, step: number, origin: number) => expect((value - origin) / step).toBeCloseTo(Math.round((value - origin) / step), 7);

it("keeps mark additions as mark and removes the curtain action", async () => {
  await open();
  act(() => observed.canvas!.onContextMenuRequest({ clientX: 100, clientY: 100, stagePosition: { x: 4, y: 2 }, target: { type: "stage" } }));
  expect(screen.queryByRole("button", { name: "幕追加" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "マーク追加" }));
  expect(observed.canvas!.project.stageObjects.slice(-1)[0]!.type).toBe("mark");
});

it.each(["stage", "parade"] as const)("%s shows paste guidance only while the internal clipboard is empty", async mode => {
  project.mode = mode;
  await open();
  const hint = "メンバーや道具を長押し→「コピー」すると使えます";
  const showMenu = (target: StageContextMenuTarget) => {
    act(() => observed.canvas!.onContextMenuRequest({ clientX: 100, clientY: 100, stagePosition: { x: 4, y: 2 }, target }));
    return within(screen.getByRole("menu"));
  };
  const emptyMenu = showMenu({ type: "stage" });
  expect(emptyMenu.getByRole<HTMLButtonElement>("button", { name: "貼り付け" }).disabled).toBe(true);
  expect(emptyMenu.getByText(hint)).toBeTruthy();
  expect(emptyMenu.getByRole("button", { name: "貼り付け" }).nextElementSibling?.textContent).toBe(hint);
  for (const target of [
    { type: "member" as const, id: project.members[0].id },
    { type: "object" as const, id: project.stageObjects[0].id },
  ]) {
    const sourceMenu = showMenu(target);
    expect(sourceMenu.queryByText(hint)).toBeNull();
    fireEvent.click(sourceMenu.getByRole("button", { name: "コピー" }));
    const pasteMenu = showMenu({ type: "stage" });
    expect(pasteMenu.getByRole<HTMLButtonElement>("button", { name: "貼り付け" }).disabled).toBe(false);
    expect(pasteMenu.queryByText(hint)).toBeNull();
  }
}, 20_000);

it.each([true, false])("parade context additions snap once with T origin, including Grid %s; Undo restores stored positions", async showGrid => {
  project.stage.showGrid = showGrid;
  const step = showGrid ? .5 : .3;
  project.paradeSettings!.cellSizeMeters = step;
  await open();
  const before = structuredClone(observed.canvas!.project);
  await contextAdd({ x: 4.77, y: 1.173 }, "メンバー追加");
  const added = observed.canvas!.project.members.find(m => !before.members.some(old => old.id === m.id))!;
  expect(observed.canvas!.project.frames[0].positions[added.id]).toEqual({ x: showGrid ? 5 : 4.7, y: 1.13 });
  act(() => observed.canvas!.onUndo!());
  expect(observed.canvas!.project.frames[0].positions).toEqual(before.frames[0].positions);
  expect(observed.canvas!.project.members).toEqual(before.members);
  for (const point of [{ x: 100, y: 100 }, { x: -100, y: -100 }]) {
    await contextAdd(point, "メンバー追加");
    const member = observed.canvas!.project.members.find(m => !before.members.some(old => old.id === m.id))!;
    const position = observed.canvas!.project.frames[0].positions[member.id];
    lattice(position.x, step, 5); lattice(position.y, step, 10.13);
    expect(position.x).toBeGreaterThanOrEqual(0); expect(position.x).toBeLessThanOrEqual(9);
    expect(position.y).toBeGreaterThanOrEqual(0); expect(position.y).toBeLessThanOrEqual(12.44);
    act(() => observed.canvas!.onUndo!());
    expect(observed.canvas!.project.frames[0].positions).toEqual(before.frames[0].positions);
  }
  for (const point of [{ x: 4.77, y: 1.173 }, { x: 100, y: 100 }, { x: -100, y: -100 }]) {
    await contextAdd(point, "道具追加");
    const object = observed.canvas!.project.stageObjects.find(o => !before.stageObjects.some(old => old.id === o.id))!;
    const state = observed.canvas!.project.frames[0].objectStates[object.id];
    // Tools additionally snap to exact edges; members above retain their grid-only contract.
    if (point.x < 0) expect(state.x).toBe(0);
    else if (point.x > 9) expect(state.x).toBe(9 - state.widthMeters);
    else lattice(state.x, .25, 5);
    if (point.y < 0) expect(state.y).toBe(0);
    else if (point.y > 12.44) expect(state.y).toBeCloseTo(12.44 - state.heightMeters, 3);
    else lattice(state.y, .25, 10.13);
    expect(state.x).toBeGreaterThanOrEqual(0); expect(state.y).toBeGreaterThanOrEqual(0);
    expect(state.x + state.widthMeters).toBeLessThanOrEqual(9 + 1e-9);
    expect(state.y + state.heightMeters).toBeLessThanOrEqual(12.44 + 1e-9);
    act(() => observed.canvas!.onUndo!());
    expect(observed.canvas!.project.frames[0].objectStates).toEqual(before.frames[0].objectStates);
  }
}, 20_000);

it("stage context additions retain their unsnapped y and tool placement", async () => {
  project.mode = "stage";
  await open();
  const before = structuredClone(observed.canvas!.project);
  await contextAdd({ x: 4.77, y: 1.173 }, "メンバー追加");
  const member = observed.canvas!.project.members.find(m => !before.members.some(old => old.id === m.id))!;
  expect(observed.canvas!.project.frames[0].positions[member.id]).toEqual({ x: 5, y: 1.173 });
  await contextAdd({ x: 4.77, y: 2.173 }, "道具追加");
  const object = observed.canvas!.project.stageObjects.find(o => !before.stageObjects.some(old => old.id === o.id))!;
  const state = observed.canvas!.project.frames[0].objectStates[object.id];
  expect(state.x + state.widthMeters / 2).toBeCloseTo(4.77, 3);
  expect(state.y + state.heightMeters / 2).toBeCloseTo(2.173, 3);
}, 20_000);

it("parade default additions preserve HEAD viewport-center y instead of gaining vertical snapping", async () => {
  project.frames[0].sceneViewState = { zoom: 1, scrollTop: 100, scrollLeft: 0, viewportWidth: 900, viewportHeight: 600 };
  await open();
  const before = structuredClone(observed.canvas!.project);
  fireEvent.click(screen.getByRole("button", { name: "メンバー" }));
  await waitFor(() => expect(observed.canvas!.project.members.length).toBe(before.members.length + 1));
  const member = observed.canvas!.project.members.find(m => !before.members.some(old => old.id === m.id))!;
  // HEAD getParadeVisibleCenterPosition: (100 + 600/2 - 10 - 28) / 32.
  expect(observed.canvas!.project.frames[0].positions[member.id].y).toBe(11.313);
  fireEvent.click(screen.getByRole("tab", { name: "道具" }));
  fireEvent.click(screen.getByRole("button", { name: "道具" }));
  const object = observed.canvas!.project.stageObjects.find(o => !before.stageObjects.some(old => old.id === o.id))!;
  const state = observed.canvas!.project.frames[0].objectStates[object.id];
  expect(state.y + state.heightMeters / 2).toBeCloseTo(11.313, 3);
}, 20_000);
