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
import { normalizeProject } from "./project/normalizeProject";

let repository: MemoryProjectRepository;
let bridge: CollaborationUiBridge;
let service: CollaborationUiService;
let auth: ParticipantAuthState;
const startSharing = vi.fn(), createInvite = vi.fn();
const SUCCESS = "クラウドに保存しました。共有を始めた時点の独立したコピーも端末に残っています。コピーは以後の共同編集を受け取りません。";
const copies = async () => (await repository.list({ limit: 100 })).items.filter(item => !['target', 'other'].includes(item.id));
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
    const collaboration = record.collaboration ?? createCollaborationData(doc); doc.destroy();
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
it("home shares the fixed original after saving an independent copy; refreshes summaries", async () => {
  render(<App />); await save();
  await waitFor(() => expect(service.getSnapshot()).toMatchObject({ busy: false, error: null, notice: SUCCESS }), { timeout: 10_000 });
  await screen.findByText(SUCCESS, {}, { timeout: 10_000 });
  expect(startSharing).toHaveBeenCalledOnce();
  expect(startSharing.mock.calls[0].slice(0, 2)).toEqual(["target", "作成者"]);
  const copy = (await copies())[0];
  expect(await copies()).toHaveLength(1); expect(copy.title).toBe("保存する隊列");
  const record = (await repository.get(copy.id))!;
  expect(record).toMatchObject({ localRevision: "1", sync: null }); expect(record.collaboration).toBeFalsy();
  expect(record.project.frames).toEqual(normalizeProject((await repository.get("target"))!.project).frames);
  expect(createInvite).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByRole("textbox", { name: "隊列表名" }) as HTMLInputElement).value).toBe("保存する隊列");
  expect((await repository.get("other"))?.collaboration).toBeFalsy();
  fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
  await screen.findAllByRole("button", { name: "保存する隊列のメニュー" });
  fireEvent.click(screen.getAllByRole("button", { name: "保存する隊列のメニュー" }).find(button => button.closest('.formation-card')?.querySelector('.formation-card__badge')?.textContent === 'クラウド')!);
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
  await save(); await screen.findByText(/保存領域にアクセスできません/);
  expect(startSharing).not.toHaveBeenCalled(); get.mockRestore();
  expect((await repository.get("target"))!.project).toEqual(before);
  await save(); await screen.findByText(SUCCESS);
  expect(startSharing).toHaveBeenCalledOnce();
}, 20_000);
it("start failure keeps local frames intact, and a retry from home succeeds", async () => {
  startSharing.mockRejectedValueOnce(new Error("通信に失敗しました"));
  render(<App />); await screen.findByRole("button", { name: "保存する隊列のメニュー" });
  const before = (await repository.get("target"))!.project.frames;
  await save(); await screen.findByText(/コピーは保存しました.*クラウドへの保存は確認できません/);
  expect((await repository.get("target"))!.project.frames).toEqual(before);
  const beforeCopy = (await copies())[0];
  fireEvent.click(document.querySelector('[data-project-id="target"] .formation-card__open')!);
  await screen.findByRole("textbox", { name: "隊列表名" });
  await act(async () => { service.manageLocal('target'); });
  const retry = await screen.findByRole("button", { name: "共有を始める" });
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(retry); await screen.findByText(SUCCESS);
  expect(await copies()).toHaveLength(1); expect((await copies())[0].id).toBe(beforeCopy.id);
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

async function editorStart() {
  fireEvent.click(await screen.findByRole('button', { name: '保存する隊列を開く' }));
  await screen.findByRole('textbox', { name: '隊列表名' });
  await act(async () => { service.manageLocal('target'); });
  const button = await screen.findByRole('button', { name: '共有を始める' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  return button;
}
it('editor shares the original ID and keeps a same-name snapshot including unsaved edits and audio references', async () => {
  render(<App />);
  const button = await editorStart();
  fireEvent.change(screen.getByRole('textbox', { name: '隊列表名' }), { target: { value: '未保存の隊列' } });
  fireEvent.click(button);
  await screen.findByText(SUCCESS, {}, { timeout: 10_000 });
  const copy = (await copies())[0], record = (await repository.get(copy.id))!;
  expect(copy.title).toBe('未保存の隊列'); expect(record.collaboration).toBeFalsy(); expect(record.sync).toBeNull();
  expect(startSharing.mock.calls[0][0]).toBe('target');
  expect((screen.getByRole('textbox', { name: '隊列表名' }) as HTMLInputElement).value).toBe('未保存の隊列');
  expect(record.project.audio).toEqual((await repository.get('target'))!.project.audio);
  expect(record.project.members.map(m => m.id)).toEqual((await repository.get('target'))!.project.members.map(m => m.id));
  expect((screen.getByRole('button', { name: /元に戻す/ }) as HTMLButtonElement).disabled).toBe(true);
}, 20_000);
it.each(['source', 'copy'])('save failure before communication keeps the editor and Undo: %s', async failure => {
  render(<App />); const button = await editorStart();
  fireEvent.change(screen.getByRole('textbox', { name: '隊列表名' }), { target: { value: '失敗しても残る編集' } });
  const commit = repository.commit.bind(repository);
  vi.spyOn(repository, 'commit').mockImplementation(async request => {
    if (failure === 'source' ? request.project.id === 'target' : !['target', 'other'].includes(request.project.id!)) throw new RepositoryError('IO_ERROR');
    return commit(request);
  });
  fireEvent.click(button);
  await waitFor(() => expect(service.getSnapshot().error).toBeTruthy());
  expect(startSharing).not.toHaveBeenCalled(); expect(await copies()).toHaveLength(0);
  expect((screen.getByRole('textbox', { name: '隊列表名' }) as HTMLInputElement).value).toBe('失敗しても残る編集');
  expect((screen.getByRole('button', { name: /元に戻す/ }) as HTMLButtonElement).disabled).toBe(false);
}, 20_000);
it('copy write failure on home does not open the editor or communicate', async () => {
  render(<App />); await screen.findByRole('button', { name: '保存する隊列のメニュー' });
  vi.spyOn(repository, 'commit').mockRejectedValueOnce(new RepositoryError('NO_SPACE'));
  await save(); await waitFor(() => expect(service.getSnapshot().error).toContain('空き容量'));
  expect(startSharing).not.toHaveBeenCalled(); expect(await copies()).toHaveLength(0);
  expect(screen.getByRole('button', { name: '保存する隊列を開く' })).toBeTruthy();
}, 20_000);
it('edits while sharing waits remain in the original editor; the fixed copy stays unchanged', async () => {
  render(<App />); const button = await editorStart();
  const start = startSharing.getMockImplementation()!; let finish!: () => void;
  startSharing.mockImplementation(async (...args: unknown[]) => { await new Promise<void>(resolve => { finish = resolve; }); return start(...args); });
  fireEvent.click(button); await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.change(screen.getByRole('textbox', { name: '隊列表名' }), { target: { value: '通信待ち中の編集' } });
  await act(async () => { finish(); });
  await screen.findByText(SUCCESS, {}, { timeout: 10_000 });
  expect((screen.getByRole('textbox', { name: '隊列表名' }) as HTMLInputElement).value).toBe('通信待ち中の編集');
  expect((await copies())[0].title).toBe('保存する隊列');
  await bridge.options!.active()!.flush();
  expect((await repository.get('target'))!.project.title).toBe('通信待ち中の編集');
}, 20_000);
it('editing after failed sharing makes a fresh same-name copy on retry', async () => {
  startSharing.mockRejectedValueOnce(new Error('通信に失敗しました'));
  render(<App />); const button = await editorStart(); fireEvent.click(button);
  await waitFor(() => expect(service.getSnapshot().error).toContain('コピーは保存しました'));
  fireEvent.change(screen.getByRole('textbox', { name: '隊列表名' }), { target: { value: '再編集した隊列' } });
  fireEvent.click(screen.getByRole('button', { name: '共有を始める' }));
  await screen.findByText(SUCCESS, {}, { timeout: 10_000 });
  expect(await copies()).toHaveLength(2); expect((await copies()).map(item => item.title).sort()).toEqual(['保存する隊列', '再編集した隊列'].sort());
}, 20_000);
it('a real staged document failure leaves the draft editable and reuses the independent copy on retry', async () => {
  startSharing.mockImplementationOnce(async (id: string) => {
    const record = (await repository.get(id))!, doc = createSharedDocument(record.project);
    const collaboration = createCollaborationData(doc); doc.destroy();
    await repository.commit({ project: record.project, collaboration, localRevision: incrementRevision(record.localRevision), expectedRepositoryRevision: record.repositoryRevision, operationId: 'stage-before-failure' });
    throw new Error('通信に失敗しました');
  });
  render(<App />); const button = await editorStart(); fireEvent.click(button);
  await waitFor(() => expect(service.getSnapshot().error).toContain('コピーは保存しました'));
  expect(bridge.options!.active()).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '共有を始める' }));
  await screen.findByText(SUCCESS, {}, { timeout: 10_000 });
  expect(await copies()).toHaveLength(1);
  expect((await repository.get('target'))!.collaboration!.sharedDocumentId).toBeTruthy();
}, 20_000);
it('an account change while awaiting sharing preserves the copy and does not replace the editor', async () => {
  render(<App />); const button = await editorStart(); let finish!: () => void;
  startSharing.mockImplementation(async (id, _name, _signal, check) => {
    await new Promise<void>(resolve => { finish = resolve; });
    const record = (await repository.get(id))!; await check(record); return record;
  });
  fireEvent.click(button); await waitFor(() => expect(finish).toBeTypeOf('function'));
  await act(async () => { auth = { status: 'signed-in', userId: 'other-account', isGuest: false, sessionPersistence: 'existing-account' }; service.authChanged(); finish(); });
  await waitFor(() => expect(service.getSnapshot().busy).toBe(false));
  expect(service.getSnapshot().error).toContain('ログイン状態が変わりました');
  expect((screen.getByRole('textbox', { name: '隊列表名' }) as HTMLInputElement).value).toBe('保存する隊列');
  expect(await copies()).toHaveLength(1); expect((await repository.get('target'))!.collaboration).toBeFalsy();
}, 20_000);
it('replays only waiting edits without reverting a concurrent durable update after a revision guard failure', async () => {
  render(<App />); const button = await editorStart(); let finish!: () => void;
  const width = (await repository.get('target'))!.project.stage.widthMeters + 5;
  startSharing.mockImplementation(async (id, _name, _signal, check) => {
    await new Promise<void>(resolve => { finish = resolve; });
    const record = (await repository.get(id))!;
    const project = { ...record.project, stage: { ...record.project.stage, widthMeters: width } };
    const doc = createSharedDocument(project), collaboration = createCollaborationData(doc); doc.destroy();
    await repository.commit({ project, collaboration, localRevision: incrementRevision(record.localRevision),
      expectedRepositoryRevision: record.repositoryRevision, operationId: 'concurrent-durable-update' });
    const latest = (await repository.get(id))!; await check(latest); return latest;
  });
  fireEvent.click(button); await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.change(screen.getByRole('textbox', { name: '隊列表名' }), { target: { value: '待ち中に変更した名前' } });
  await act(async () => { finish(); });
  await waitFor(() => expect(service.getSnapshot().busy).toBe(false), { timeout: 10_000 });
  expect(service.getSnapshot().error).toContain('クラウドへの保存は確認できません');
  await bridge.options!.active()!.flush();
  const latest = (await repository.get('target'))!.project;
  expect(latest.title).toBe('待ち中に変更した名前'); expect(latest.stage.widthMeters).toBe(width);
  expect((await repository.get((await copies())[0].id))!.project.stage.widthMeters).toBe(width - 5);
}, 20_000);
