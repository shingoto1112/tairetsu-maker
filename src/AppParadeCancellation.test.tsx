// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";

let repository: MemoryProjectRepository;
const project = { ...createSampleProject(), id: "parade-cancel", title: "取消検証", mode: "parade" as const };
project.frames = [project.frames[0]]; project.frames[0].objectAssignments = {};
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    repository = new MemoryProjectRepository();
    await repository.commit({ project: structuredClone(project), localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-cancel" });
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
import App from "./App";
const touch = (id: number, x: number) => ({ pointerId: id, pointerType: "touch", clientX: x, clientY: 250, button: 0 });
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? ""; }
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const width = parseFloat(this.style.width) || 700, height = parseFloat(this.style.height) || 500;
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("releases the real App history/autosave batch on locked second touch and saves the next drag normally", async () => {
  const view = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "取消検証を開く" }));
  await screen.findByRole("button", { name: "ピンチ拡大縮小をロック" });
  const viewport = view.container.querySelector<HTMLElement>(".parade-viewport")!;
  const member = view.container.querySelector<HTMLElement>(".parade-member")!;
  fireEvent.click(view.container.querySelector(".stage-pinch-lock-button")!);
  const commits = vi.spyOn(repository, "commit");
  vi.useFakeTimers();
  fireEvent.pointerDown(member, touch(1, 300));
  await act(async () => { fireEvent.pointerMove(member, touch(1, 360)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(commits).not.toHaveBeenCalled();
  fireEvent.pointerDown(viewport, touch(2, 500));
  fireEvent.pointerUp(viewport, touch(2, 500)); fireEvent.pointerUp(member, touch(1, 360));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(commits).toHaveBeenCalledOnce();
  const firstSaved = structuredClone((await repository.get(project.id))!.project);
  const firstStyleLeft = member.style.left;
  expect(firstSaved.frames[0].positions).not.toEqual(project.frames[0].positions);
  commits.mockClear();
  fireEvent.pointerDown(member, touch(3, 300));
  await act(async () => { fireEvent.pointerMove(member, touch(3, 390)); });
  fireEvent.pointerUp(member, touch(3, 390));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(commits).toHaveBeenCalledOnce();
  expect((await repository.get(project.id))!.project.frames[0].positions).not.toEqual(firstSaved.frames[0].positions);
  fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
  expect(view.container.querySelector<HTMLElement>(".parade-member")!.style.left).toBe(firstStyleLeft);
}, 20000);
