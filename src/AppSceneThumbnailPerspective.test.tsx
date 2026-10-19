// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import type { Project } from "./types";
import type { StageCanvas } from "./components/StageCanvas";

let project: Project;
const observed = vi.hoisted(() => ({ canvas: null as ComponentProps<typeof StageCanvas> | null }));
vi.mock("./cloud/config", () => ({ getCloudConfig: () => null, isCloudConfigured: () => false }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    const repository = new MemoryProjectRepository();
    await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "thumbnail-seed" });
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/StageCanvas", () => ({ StageCanvas: forwardRef<HTMLDivElement, ComponentProps<typeof StageCanvas>>((props, ref) => {
  observed.canvas = props;
  return <div ref={ref}>
    <button onClick={props.onTogglePerspective}>検証用の視点切替</button>
    <button onClick={props.onUndo}>検証用のUndo</button>
    <button onClick={props.onRedo}>検証用のRedo</button>
  </div>;
}) }));
import App from "./App";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network disabled in local test")));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  project = { ...createSampleProject(), id: "thumbnail-view", title: "サムネイル視点検証", mode: "stage", viewerPerspective: "audience" };
  project.stage = { ...project.stage, widthMeters: 9, depthMeters: 5.5 };
  project.frames = [project.frames[0]];
  observed.canvas = null;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the editor rail on the live canvas perspective after Undo/Redo and the roster strip on audience", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "サムネイル視点検証を開く" }));
  await screen.findByRole("button", { name: "検証用の視点切替" });
  const rail = screen.getByRole("complementary", { name: "シーンサムネイル" });
  const transform = () => rail.querySelector("svg > g")!.getAttribute("transform");
  expect(transform()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "検証用の視点切替" }));
  expect(transform()).toBe("rotate(180 4.5 2.75)");
  fireEvent.click(screen.getByRole("button", { name: "検証用のUndo" }));
  expect(observed.canvas!.project.viewerPerspective).toBe("audience");
  expect(observed.canvas!.viewerPerspective).toBe("performer");
  expect(transform()).toBe("rotate(180 4.5 2.75)");
  fireEvent.click(screen.getByRole("button", { name: "検証用のRedo" }));
  expect(observed.canvas!.project.viewerPerspective).toBe("performer");
  expect(transform()).toBe("rotate(180 4.5 2.75)");
  // The real roster modal/strip must remain audience-facing even with a stored performer view.
  fireEvent.click(screen.getByRole("button", { name: "全体名簿を開く" }));
  const roster = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
  fireEvent.click(within(roster).getByRole("button", { name: "道具管理" }));
  fireEvent.click(within(roster).getByRole("button", { name: "道具割当" }));
  const strip = await within(roster).findByRole("group", { name: "シーン" });
  expect(strip.querySelector("svg > g")).not.toBeNull();
  expect(strip.querySelector("svg > g")!.getAttribute("transform")).toBeNull();
}, 20_000);
