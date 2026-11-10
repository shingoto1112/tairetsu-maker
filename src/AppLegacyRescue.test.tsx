/* @vitest-environment jsdom */
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppRuntime } from "./platform/runtime";
import type { LegacyReaderOptions } from "./storage/legacyReaders";
import { MemoryMigrationRepository } from "./storage/testing/MemoryMigrationRepository";
import { createSampleProject } from "./sampleProject";

const state = vi.hoisted(() => ({
  runtime: "web" as AppRuntime,
  flags: { collaborationV2: false, nativeFileShare: false },
  preparation: undefined as Promise<void> | undefined,
}));
let repository: MemoryMigrationRepository;
vi.mock("./platform/runtime", async original => ({
  ...await original<typeof import("./platform/runtime")>(),
  getAppRuntime: () => state.runtime,
  getAppFeatureFlags: () => state.flags,
}));
vi.mock("./cloud/config", () => ({ getCloudConfig: () => null, isCloudConfigured: () => false }));
vi.mock("./storage/appRepository", async original => ({
  ...await original<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    await state.preparation;
    repository = new MemoryMigrationRepository();
    await repository.initialize();
    return { repository, result: { completed: true, canContinue: true, failures: [] } };
  },
}));
import App from "./App";

const label = "旧クラウドの下書きを救出";
const readersWindow = window as Window & { __legacyDraftReaders?: LegacyReaderOptions };
beforeEach(() => {
  state.runtime = "web"; state.flags.collaborationV2 = false; state.preparation = undefined;
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("Network disabled in local test")));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); delete readersWindow.__legacyDraftReaders; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["web", "tauri"] as const)("%s never offers draft rescue even with collaboration ON", async runtime => {
  state.runtime = runtime;
  state.flags.collaborationV2 = true;
  render(<App />);
  await waitFor(() => expect((screen.getByRole("button", { name: /^追加/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "ホームのその他の操作" }));
  expect(screen.queryByRole("button", { name: label })).toBeNull();
  expect(screen.queryByRole("dialog", { name: label })).toBeNull();
});

it("iPad waits for storage, then opens drafts directly and rescues while signed out with collaboration OFF", async () => {
  state.runtime = "capacitor-ios";
  let ready!: () => void;
  state.preparation = new Promise<void>(resolve => { ready = resolve; });
  render(<App />);
  const more = screen.getByRole("button", { name: "ホームのその他の操作" });
  fireEvent.click(more);
  expect(screen.queryByRole("button", { name: label })).toBeNull();
  await act(async () => ready());
  // Resolve the lazy component while it remains mounted, before changing openRequest.
  await act(async () => { await import("./components/LegacyRescuePanel"); });
  const project = { ...createSampleProject(), id: "synthetic-draft", title: "架空の旧下書き", audio: undefined };
  const raw = JSON.stringify({ project, cloudProjectId: "synthetic", baseUpdatedAt: null, savedAt: project.updatedAt });
  readersWindow.__legacyDraftReaders = { native: { draftNames: async () => ["synthetic.json"], readText: async () => raw } };
  fireEvent.click(await screen.findByRole("button", { name: label }));
  const dialog = await screen.findByRole("dialog", { name: label });
  expect(within(dialog).queryByRole("button", { name: "戻る" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "一覧を取得" })).toBeNull();
  expect(dialog.textContent).toContain("ログインせずに救出できます。");
  fireEvent.click(within(dialog).getByRole("button", { name: "端末の下書きを調べる" }));
  const rescue = await within(dialog).findByRole("button", { name: "この下書きを独立コピーとして救出" });
  fireEvent.click(rescue); fireEvent.click(rescue);
  await within(dialog).findByText("独立コピーを保存しました。元ファイルは残っています。");
  expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
  await waitFor(() => expect((rescue as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(rescue);
  await within(dialog).findByText("救出済みです。編集・削除した文書は戻しません。");
  expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: label })).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(fetch).not.toHaveBeenCalled();
});
