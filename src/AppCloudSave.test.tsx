/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSampleProject } from "./sampleProject";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { CollaborationUiService } from "./collaboration/uiService";
import type { CollaborationUiBridge } from "./collaboration/uiTypes";
import { createSharedDocument } from "./collaboration/model";
import { createCollaborationData } from "./collaboration/persistence";
import { incrementRevision, RepositoryError } from "./repositories/types";
import type { ParticipantAuthState } from "./collaboration/guestAuth";

let repository: MemoryProjectRepository;
let bridge: CollaborationUiBridge;
let service: CollaborationUiService;
let auth: ParticipantAuthState;
const startSharing = vi.fn(), createInvite = vi.fn();
vi.mock("./cloud/config", () => ({ getCloudConfig: () => null, isCloudConfigured: () => false }));
vi.mock("./platform/runtime", async original => ({
  ...await original<typeof import("./platform/runtime")>(),
  getAppFeatureFlags: () => ({ collaborationV2: true, nativeFileShare: false }),
}));
vi.mock("./hooks/useCollaborationUi", () => ({ useCollaborationUi: () => bridge }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    repository = new MemoryProjectRepository();
    for (const id of ["target", "other"]) {
      const project = { ...createSampleProject(), id, title: id === "target" ? "保存する隊列" : "別の隊列" };
      await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: `seed-${id}` });
    }
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
import App from "./App";

beforeEach(() => {
  localStorage.clear(); startSharing.mockReset(); createInvite.mockReset();
  auth = { status: "signed-in", userId: "owner", isGuest: false, displayName: "作成者", sessionPersistence: "existing-account" };
  service = new CollaborationUiService(() => bridge.options!);
  bridge = { options: null, get: async () => service };
  Object.assign(service, { auth: { state: () => auth }, api: { startSharing, createInvite } });
  vi.spyOn(service, "initialize").mockImplementation(async () => { service.authChanged(); });
  vi.spyOn(service, "refresh").mockResolvedValue();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("Network disabled in local test")));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  startSharing.mockImplementation(async (id: string) => {
    const record = (await repository.get(id))!;
    const doc = createSharedDocument(record.project);
    const collaboration = createCollaborationData(doc); doc.destroy();
    collaboration.sharedDocumentId = "11111111-1111-4111-8111-111111111111";
    await repository.commit({ project: record.project, collaboration, localRevision: incrementRevision(record.localRevision),
      expectedRepositoryRevision: record.repositoryRevision, operationId: "mock-cloud-save" });
    return (await repository.get(id))!;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function save() {
  fireEvent.click(await screen.findByRole("button", { name: "保存する隊列のメニュー" }));
  fireEvent.click(screen.getByRole("button", { name: "クラウドに保存" }));
}
it("home opens the fixed target then starts sharing with no management/invite; refreshes summaries", async () => {
  render(<App />); await save();
  await waitFor(() => expect(service.getSnapshot()).toMatchObject({ busy: false, error: null, notice: "クラウドに保存しました。別の端末でも開けます。" }), { timeout: 10_000 });
  await screen.findByText("クラウドに保存しました。別の端末でも開けます。", {}, { timeout: 10_000 });
  expect(startSharing).toHaveBeenCalledExactlyOnceWith("target", "作成者");
  expect(createInvite).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByRole("textbox", { name: "隊列表名" }) as HTMLInputElement).value).toBe("保存する隊列");
  expect((await repository.get("other"))?.collaboration).toBeFalsy();
  fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
  fireEvent.click(await screen.findByRole("button", { name: "保存する隊列のメニュー" }));
  expect(screen.queryByRole("button", { name: "クラウドに保存" })).toBeNull();
}, 20_000);
it.each([false, true])("signed out/guest remains on home and gets login guidance; guest=%s", async guest => {
  auth = guest ? { status: "signed-in", userId: "guest", isGuest: true, sessionPersistence: "browser-data" }
    : { status: "signed-out", guestRecovery: "new-invite-required" };
  render(<App />); await save();
  await screen.findByRole("dialog", { name: "アカウント" }, { timeout: 10_000 });
  expect(screen.getByText(/クラウドに保存するにはログインしてください/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "保存する隊列を開く" })).toBeTruthy();
  expect(startSharing).not.toHaveBeenCalled(); expect(createInvite).not.toHaveBeenCalled();
}, 20_000);
it("read failure keeps the local content and permits retry", async () => {
  render(<App />); await screen.findByRole("button", { name: "保存する隊列のメニュー" });
  const before = (await repository.get("target"))!.project;
  const get = vi.spyOn(repository, "get").mockRejectedValueOnce(new RepositoryError("ACCESS_DENIED"));
  await save(); await screen.findByText(/隊列表を開けませんでした/);
  expect(startSharing).not.toHaveBeenCalled(); get.mockRestore();
  expect((await repository.get("target"))!.project).toEqual(before);
  await save(); await screen.findByText("クラウドに保存しました。別の端末でも開けます。");
  expect(startSharing).toHaveBeenCalledOnce();
}, 20_000);
it("start failure keeps local frames intact, and a retry from home succeeds", async () => {
  startSharing.mockRejectedValueOnce(new Error("通信に失敗しました"));
  render(<App />); await screen.findByRole("button", { name: "保存する隊列のメニュー" });
  const before = (await repository.get("target"))!.project.frames;
  await save(); await screen.findByText("通信に失敗しました");
  expect((await repository.get("target"))!.project.frames).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
  await save(); await screen.findByText("クラウドに保存しました。別の端末でも開けます。");
  expect(createInvite).not.toHaveBeenCalled();
}, 20_000);
it("blocks a second click while opening and cancels a stale generation without saving a different project", async () => {
  render(<App />); await screen.findByRole("button", { name: "保存する隊列のメニュー" });
  const get = repository.get.bind(repository); let finish!: () => void;
  const read = vi.spyOn(repository, "get").mockImplementationOnce(async id => {
    await new Promise<void>(resolve => { finish = resolve; }); return get(id);
  });
  await save(); await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "保存する隊列のメニュー" }));
  expect((screen.getByRole("button", { name: "クラウドに保存" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "別の隊列を開く" }));
  await screen.findByRole("textbox", { name: "隊列表名" });
  await act(async () => { finish(); });
  await waitFor(() => expect(service.getSnapshot().busy).toBe(false)); read.mockRestore();
  expect(startSharing).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox", { name: "隊列表名" }) as HTMLInputElement).value).toBe("別の隊列");
  expect(createInvite).not.toHaveBeenCalled();
}, 20_000);
