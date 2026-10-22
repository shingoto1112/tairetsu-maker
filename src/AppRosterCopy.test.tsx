// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { forwardRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import type { Project } from "./types";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { RepositoryError } from "./repositories/types";
import { createSharedDocument } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";

let repository: MemoryProjectRepository;
const observed = vi.hoisted(() => ({ project: null as Project | null }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    repository = new MemoryProjectRepository();
    const project = { ...createSampleProject(), id: "source-local", title: "前の大会" };
    project.memberGroups = [{ id: "group-old", name: "出演者", color: "#123456", memberIds: project.members.map(m => m.id).reverse() }];
    const doc = createSharedDocument(project);
    await repository.commit({ project, collaboration: createCollaborationData(doc), localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
    doc.destroy();
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
vi.mock("./components/StageCanvas", () => ({ StageCanvas: forwardRef<HTMLDivElement, { project: Project }>((props, ref) => {
  observed.project = props.project; return <div ref={ref} data-testid="copy-canvas" />;
}) }));
vi.mock("./components/ParadeCanvas", () => ({ ParadeCanvas: forwardRef<HTMLDivElement, { project: Project }>((props, ref) => {
  observed.project = props.project; return <div ref={ref} data-testid="copy-canvas" />;
}) }));
import App from "./App";
beforeEach(() => {
  localStorage.clear(); observed.project = null;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function startCopy() {
  fireEvent.click(await screen.findByRole("button", { name: "前の大会のメニュー" }));
  fireEvent.click(screen.getByRole("button", { name: "この名簿で新しく作る" }));
  fireEvent.change(screen.getByRole("textbox", { name: "隊列表名（任意）" }), { target: { value: "新大会" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "作成する" }).hasAttribute("disabled")).toBe(false));
}
it.each(["stage", "parade"])("creates an independent %s roster from a locally saved shared document, shows all and reloads", async mode => {
  render(<App />); await startCopy();
  fireEvent.click(screen.getByRole("radio", { name: mode === "stage" ? /^ステージ隊列/ : /^パレード隊列/ }));
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  await screen.findByTestId("copy-canvas");
  // A successful initial save keeps the normal creation notice.
  expect(await screen.findByText("新しい隊列表を作成しました。")).toBeTruthy();
  const initial = structuredClone(observed.project!); const id = initial.id!;
  expect(initial.members).toHaveLength(3); expect(initial.stageObjects).toHaveLength(2);
  expect(Object.values(initial.frames[0].memberVisibility!)).toEqual([false, false, false]);
  expect(Object.values(initial.frames[0].objectStates).every(o => !o.visible)).toBe(true);
  const record = (await repository.get(id))!;
  expect(record.sync).toBeNull(); expect(record.collaboration ?? null).toBeNull();
  expect((await repository.get("source-local"))!.collaboration).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "すべて表示" }));
  expect(initial.members.every(m => observed.project!.frames[0].memberVisibility?.[m.id] !== false)).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "道具" }));
  fireEvent.click(await screen.findByRole("button", { name: "すべて表示" }, { timeout: 10_000 }));
  expect(Object.values(observed.project!.frames[0].objectStates).every(object => object.visible)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(async () => expect((await repository.get(id))!.project.frames[0].memberVisibility).toEqual(observed.project!.frames[0].memberVisibility));
  fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
  fireEvent.click(await screen.findByRole("button", { name: "新大会を開く" }));
  await screen.findByTestId("copy-canvas");
  expect(observed.project!.id).toBe(id); expect(observed.project!.members).toEqual(initial.members);
  expect(initial.members.every(m => observed.project!.frames[0].memberVisibility?.[m.id] !== false)).toBe(true);
  expect(Object.values(observed.project!.frames[0].objectStates).every(object => object.visible)).toBe(true);
}, 20_000);
it("retains a new roster after a failed initial save and retries the same project instead of duplicating it", async () => {
  render(<App />); await startCopy();
  const commit = vi.spyOn(repository, "commit").mockRejectedValue(new RepositoryError("QUOTA_EXCEEDED"));
  fireEvent.click(screen.getByRole("button", { name: "作成する" }));
  const alert = await screen.findByRole("alert", { name: "端末保存エラー" });
  expect(observed.project!.members).toHaveLength(3); const initial = structuredClone(observed.project!);
  expect(await repository.get(initial.id!)).toBeNull(); expect(screen.queryByText("新しい隊列表を作成しました。")).toBeNull();
  commit.mockRestore(); fireEvent.click(within(alert).getByRole("button", { name: "保存を再試行" }));
  await waitFor(() => expect(screen.queryByRole("alert", { name: "端末保存エラー" })).toBeNull());
  const record = (await repository.get(initial.id!))!;
  expect(record.project.members).toEqual(initial.members); expect(record.project.frames).toEqual(initial.frames);
  expect((await repository.list({ limit: 100 })).items).toHaveLength(2);
}, 20_000);
