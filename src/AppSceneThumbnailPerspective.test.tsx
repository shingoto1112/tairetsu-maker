// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import type { Project } from "./types";
import type { StageCanvas } from "./components/StageCanvas";
import { createSharedDocument, getModel, REMOTE_ORIGIN } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";
import { SharedProjectEditor } from "./collaboration/editorSession";
import * as Y from "yjs";

let project: Project;
let repository: MemoryProjectRepository;
let useYjs = false;
const observed = vi.hoisted(() => ({ canvas: null as ComponentProps<typeof StageCanvas> | null }));
vi.mock("./cloud/config", () => ({ getCloudConfig: () => null, isCloudConfigured: () => false }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    repository = new MemoryProjectRepository();
    const doc = useYjs ? createSharedDocument(project) : null;
    await repository.commit({ project, ...(doc ? { collaboration: createCollaborationData(doc) } : {}), localRevision: "1", expectedRepositoryRevision: null, operationId: "thumbnail-seed" });
    doc?.destroy();
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
  useYjs = false;
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

it("keeps the editor rail and roster previews on the live canvas perspective after Undo/Redo", async () => {
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
  expect(observed.canvas!.viewerPerspective).toBe("audience");
  expect(transform()).toBeNull();
  expect(observed.canvas!.canUndo).toBe(false);
  fireEvent.click(screen.getByTitle("変更を保存"));
  await waitFor(async () => expect((await repository.get(project.id!))!.project.viewerPerspective).toBe("audience"));
  fireEvent.click(screen.getByRole("button", { name: "検証用のRedo" }));
  expect(observed.canvas!.project.viewerPerspective).toBe("performer");
  expect(observed.canvas!.viewerPerspective).toBe("performer");
  expect(transform()).toBe("rotate(180 4.5 2.75)");
  expect(observed.canvas!.canRedo).toBe(false);
  fireEvent.click(screen.getByTitle("変更を保存"));
  await waitFor(async () => expect((await repository.get(project.id!))!.project.viewerPerspective).toBe("performer"));
  fireEvent.click(screen.getByRole("button", { name: "検証用のUndo" }));
  expect(observed.canvas!.project.viewerPerspective).toBe("audience");
  expect(observed.canvas!.viewerPerspective).toBe("audience");
  // A8: local Undo now restores the live view with its Project metadata.
  // Rail and roster must agree with that restored view.
  fireEvent.click(screen.getByRole("button", { name: "全体名簿を開く" }));
  const roster = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
  fireEvent.click(within(roster).getByRole("button", { name: "道具管理" }));
  fireEvent.click(within(roster).getByRole("button", { name: "道具割当" }));
  const strip = await within(roster).findByRole("group", { name: "シーン" });
  expect(strip.querySelector("svg > g")).not.toBeNull();
  expect(strip.querySelector("svg > g")!.getAttribute("transform")).toBeNull();
}, 20_000);

it("A8: remote changes and shared Undo/Redo preserve this device's perspective without sharing it", async () => {
  useYjs = true;
  const create = vi.spyOn(SharedProjectEditor, "create");
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "サムネイル視点検証を開く" }));
  await screen.findByRole("button", { name: "検証用の視点切替" });
  const editor = await create.mock.results[0].value as SharedProjectEditor;
  fireEvent.click(screen.getByRole("button", { name: "検証用の視点切替" }));
  expect(observed.canvas!.viewerPerspective).toBe("performer");
  expect(observed.canvas!.canUndo).toBe(false); // Local view does not enter shared history.
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(editor.doc));
  const vector = Y.encodeStateVector(editor.doc);
  getModel(remote).settings.set("title", { title: "遠隔の変更" });
  act(() => Y.applyUpdate(editor.doc, Y.encodeStateAsUpdate(remote, vector), REMOTE_ORIGIN));
  expect(observed.canvas!.project.title).toBe("遠隔の変更");
  expect(observed.canvas!.viewerPerspective).toBe("performer");
  expect(observed.canvas!.project.viewerPerspective).toBe("performer");
  // A shared content edit still supports Undo/Redo, with the device view retained.
  act(() => editor.edit(previous => ({ ...previous, title: "端末の変更" })));
  fireEvent.click(screen.getByRole("button", { name: "検証用のUndo" }));
  expect(observed.canvas!.project.title).toBe("遠隔の変更");
  expect(observed.canvas!.viewerPerspective).toBe("performer");
  fireEvent.click(screen.getByRole("button", { name: "検証用のRedo" }));
  expect(observed.canvas!.project.title).toBe("端末の変更");
  expect(observed.canvas!.viewerPerspective).toBe("performer");
  remote.destroy();
}, 20_000);
