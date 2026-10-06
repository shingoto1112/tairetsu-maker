// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import type { Project, FormationFrame } from "./types";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import type { ParadeCanvas } from "./components/ParadeCanvas";
let project: Project;
let repository: MemoryProjectRepository;
const observed = vi.hoisted(() => ({ canvas: null as ComponentProps<typeof ParadeCanvas> | null, rosterFrames: [] as FormationFrame[] }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    repository = new MemoryProjectRepository();
    await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-build26" });
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
it("App keeps its saved order while timeline, navigation, numbering and roster use the same time order", async () => {
  const view = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "順序検証を開く" }));
  await screen.findByTestId("canvas");
  expect(view.container.querySelectorAll(".member-manager .panel-sticky-header")).toHaveLength(1);
  fireEvent.click(await screen.findByRole("button", { name: "全体名簿を開く" }));
  await screen.findByTestId("roster");
  expect(observed.rosterFrames.map(f => f.id)).toEqual(["early", "tie", "late"]);
  fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
  const input = await screen.findByLabelText("時刻（秒）") as HTMLInputElement;
  const labels = () => [...view.container.querySelectorAll(".timeline-card__top strong")].map(el => el.textContent);
  expect(labels()).toEqual(["前", "同時刻", "後"]);
  const savedIds = () => observed.canvas!.project.frames.map(f => f.id);
  expect(savedIds()).toEqual(["late", "early", "tie"]);
  expect(observed.canvas!.selectedFrameId).toBe("late");
  input.focus(); fireEvent.change(input, { target: { value: "5" } });
  expect(labels()).toEqual(["前", "同時刻", "後"]);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(labels()).toEqual(["後", "前", "同時刻"]);
  expect(observed.canvas!.selectedFrameId).toBe("late"); expect(savedIds()).toEqual(["late", "early", "tie"]);
  fireEvent.click(screen.getByRole("button", { name: "次へ" })); expect(observed.canvas!.selectedFrameId).toBe("early");
  // The scene details (which now hold the memo) use the same numbering.
  await screen.findByText(/^Scene 2 \/ /);
  expect((screen.getByLabelText("ラベル") as HTMLInputElement).value).toBe("前");
  fireEvent.click(screen.getByRole("tab", { name: "メンバー" }));
  fireEvent.click(await screen.findByRole("button", { name: "全体名簿を開く" }));
  await screen.findByTestId("roster"); expect(observed.rosterFrames.map(f => f.id)).toEqual(["late", "early", "tie"]);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(async () => expect((await repository.get("build26"))?.project.frames.map(f => [f.id, f.timeSec])).toEqual([["late", 5], ["early", 10], ["tie", 10]]));
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
