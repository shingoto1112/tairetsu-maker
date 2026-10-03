/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "./types";
import { createSampleProject } from "./sampleProject";
import * as audioStorage from "./utils/audioStorage";
import { stagePointToDisplayPoint } from "./utils/coordinates";
import { MemoryProjectRepository } from "./repositories/contract/testing/MemoryProjectRepository";
import { RepositoryError } from "./repositories/types";

let testProject: Project;
let testRepository: MemoryProjectRepository;
let testCanContinue = true;
vi.mock("./storage/appRepository", async importOriginal => ({
  ...await importOriginal<typeof import("./storage/appRepository")>(),
  prepareAppRepository: async () => {
    const repository = new MemoryProjectRepository();
    testRepository = repository;
    await repository.commit({ project: testProject, localRevision: "1", expectedRepositoryRevision: null, operationId: "test-seed" });
    return { repository, result: { completed: testCanContinue, canContinue: testCanContinue, failures: testCanContinue ? [] : [{ code: "ACCESS_DENIED" }] } };
  },
}));

const canvas = vi.hoisted(() => ({ project: null as Project | null, focusMode: true, focusMemberId: "", movementPathMode: "", selectedFrameId: null as string | null, selectedMemberIds: [] as string[] }));
const canvasActions = vi.hoisted(() => ({ move: null as null | ((id: string, p: { x: number; y: number }) => void), playing: false }));
vi.mock("./components/ParadeCanvas", () => ({
  ParadeCanvas: forwardRef<HTMLDivElement, { project: Project; selectedFrameId: string | null; selectedMemberIds: string[]; isPlaying: boolean; onMoveMember: (id: string, p: { x: number; y: number }) => void }>((props, ref) => {
    canvas.project = props.project; canvas.selectedFrameId = props.selectedFrameId; canvas.selectedMemberIds = props.selectedMemberIds;
    canvasActions.move = props.onMoveMember; canvasActions.playing = props.isPlaying;
    return <div ref={ref} data-testid="parade-export-dom" />;
  }),
}));
vi.mock("./components/StageCanvas", () => ({
  StageCanvas: forwardRef<HTMLDivElement, { project: Project; focusMode: boolean; focusMemberId?: string; movementPathMode: string; selectedFrameId: string | null; selectedMemberIds: string[] }>((props, ref) => {
    canvas.project = props.project;
    canvas.focusMode = props.focusMode;
    canvas.focusMemberId = props.focusMemberId ?? "";
    canvas.movementPathMode = props.movementPathMode;
    canvas.selectedFrameId = props.selectedFrameId;
    canvas.selectedMemberIds = props.selectedMemberIds;
    return <div ref={ref} data-testid="stage-export-dom" />;
  }),
}));

import App from "./App";

// Full App renders plus the lazily loaded roster exceed the 5s default when the whole suite runs in parallel.
const INTEGRATION_TIMEOUT_MS = 20_000;

describe("App roster confirmation integration", () => {
  it("confirms before returning without saving after access denial and retains the stored version", async () => {
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    const title = await screen.findByRole("textbox", { name: "隊列表名" });
    vi.spyOn(testRepository, "commit").mockRejectedValue(new RepositoryError("ACCESS_DENIED"));
    fireEvent.change(title, { target: { value: "退避が必要な未保存" } });
    fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
    const leave = await screen.findByRole("button", { name: "保存せずに一覧へ戻る" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(leave); expect(screen.getByRole("textbox", { name: "隊列表名" })).toBeTruthy();
    confirm.mockReturnValue(true); fireEvent.click(leave);
    await screen.findByRole("button", { name: "削除検証を開く" });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("ZIP"));
    expect((await testRepository.get(testProject.id!))?.project.title).toBe("削除検証");
  }, INTEGRATION_TIMEOUT_MS);
  it("flushes edits on hidden visibility and leaves the old project keys untouched", async () => {
    const old = "read-only sentinel"; localStorage.setItem("stageflow.projects.v1", old);
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    const title = await screen.findByRole("textbox", { name: "隊列表名" });
    fireEvent.change(title, { target: { value: "背景化保存" } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(async () => expect((await testRepository.get(testProject.id!))?.project.title).toBe("背景化保存"));
    expect(localStorage.getItem("stageflow.projects.v1")).toBe(old);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  }, INTEGRATION_TIMEOUT_MS);

  it("retains quota edits with a persistent ZIP escape and prevents returning until retry succeeds", async () => {
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    const title = await screen.findByRole("textbox", { name: "隊列表名" });
    const commit = vi.spyOn(testRepository, "commit").mockRejectedValue(new RepositoryError("QUOTA_EXCEEDED"));
    fireEvent.change(title, { target: { value: "保持する編集" } });
    fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
    const alert = await screen.findByRole("alert", { name: "端末保存エラー" });
    expect(within(alert).getByText(/空き容量/)).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "編集中のデータを ZIP で書き出す" })).toBeTruthy();
    expect((title as HTMLInputElement).value).toBe("保持する編集");
    expect((await testRepository.get(testProject.id!))?.project.title).toBe("削除検証");
    commit.mockRestore(); fireEvent.click(within(alert).getByRole("button", { name: "保存を再試行" }));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "端末保存エラー" })).toBeNull());
    expect((await testRepository.get(testProject.id!))?.project.title).toBe("保持する編集");
  }, INTEGRATION_TIMEOUT_MS);

  it("keeps local actions gated after a bootstrap access failure", async () => {
    testCanContinue = false; render(<App />);
    await screen.findByText(/保存領域にアクセスできません/);
    expect((screen.getByRole("button", { name: /追加/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "削除検証を開く" })).toBeNull();
  });
  it.each(["stage", "parade"] as const)("moves right in screen space for both perspectives in %s", async mode => {
    for (const viewerPerspective of ["audience", "performer"] as const) {
      const project = { ...createSampleProject(), id: `${mode}-${viewerPerspective}`, title: "矢印検証", mode, viewerPerspective };
      const id = "m_anna";
      testProject = project;
      const user = userEvent.setup(); const view = render(<App />);
      await user.click(await screen.findByRole("button", { name: "矢印検証を開く" }));
      const picker = screen.getByRole("region", { name: "このシーンの表示" });
      await user.click(within(picker).getByRole("button", { name: /^Anna/ }));
      const frameId = canvas.selectedFrameId!;
      const before = canvas.project!.frames.find(f => f.id === frameId)!.positions[id];
      fireEvent.keyDown(window, { key: "ArrowRight" });
      const after = canvas.project!.frames.find(f => f.id === frameId)!.positions[id];
      const perspective = mode === "parade" ? "audience" : viewerPerspective;
      expect(stagePointToDisplayPoint(after, project.stage, perspective).x - stagePointToDisplayPoint(before, project.stage, perspective).x).toBeCloseTo(.25);
      view.unmount();
    }
  }, INTEGRATION_TIMEOUT_MS);

  it("blocks parade keyboard moves and the parent's move callback during playback", async () => {
    const project = { ...createSampleProject(), id: "playing", title: "再生検証", mode: "parade" as const };
    testProject = project;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const user = userEvent.setup(); const view = render(<App />);
    await user.click(await screen.findByRole("button", { name: "再生検証を開く" }));
    await user.click(within(screen.getByRole("region", { name: "このシーンの表示" })).getByRole("button", { name: /^Anna/ }));
    await user.click(screen.getByRole("tab", { name: "音源" }));
    const audio = view.container.querySelector("audio")!; audio.src = "blob:local-test";
    const oldMoveCallback = canvasActions.move!;
    fireEvent.click(screen.getByRole("button", { name: "再生" }));
    await waitFor(() => expect(canvasActions.playing).toBe(true));
    const before = structuredClone(canvas.project!.frames);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    act(() => canvasActions.move!("m_anna", { x: 1, y: 2 }));
    act(() => oldMoveCallback("m_anna", { x: 1, y: 2 }));
    expect(canvas.project!.frames).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() => expect(canvasActions.playing).toBe(false));
    act(() => canvasActions.move!("m_anna", { x: 1, y: 2 }));
    expect(canvas.project!.frames).not.toEqual(before);
  }, INTEGRATION_TIMEOUT_MS);

  it.each([false, true])("restores assigned/globally hidden members in a single Undo; portrait=%s", async (portrait) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: portrait, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const project = { ...createSampleProject(), id: "visibility-undo", title: "表示Undo検証" };
    project.members = project.members.map((member) => member.id === "m_ben" ? { ...member, visible: false } : member);
    project.frames[0].objectAssignments = { o_chair: ["m_ben"] };
    project.frames[0].memberVisibility = { m_ben: false };
    delete project.frames[0].positions.m_ben;
    testProject = project;
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: "表示Undo検証を開く" }));
    const beforeMembers = structuredClone(canvas.project!.members);
    const beforeFrames = structuredClone(canvas.project!.frames);
    await user.click(screen.getByRole("checkbox", { name: "Benをこのシーンに表示" }));
    expect(canvas.project!.members.find((member) => member.id === "m_ben")?.visible).toBe(true);
    expect(canvas.project!.frames[0].memberVisibility?.m_ben).toBe(true);
    expect(Object.values(canvas.project!.frames[0].objectAssignments ?? {}).flat()).not.toContain("m_ben");
    expect(canvas.project!.frames[0].positions.m_ben).toBeDefined();
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await waitFor(() => expect(canvas.project!.frames).toEqual(beforeFrames));
    expect(canvas.project!.members).toEqual(beforeMembers);
  }, INTEGRATION_TIMEOUT_MS);

  it("keeps portrait name selection separate, toggles only in selection mode and clears multiple selection for single select", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    const before = structuredClone(canvas.project!.frames);
    const picker = screen.getByRole("region", { name: "このシーンの表示" });
    await user.click(within(picker).getByRole("button", { name: /^Ben/ }));
    expect(within(picker).getByRole("button", { name: /^Ben/ }).getAttribute("aria-pressed")).toBe("true");
    expect(canvas.selectedMemberIds).toEqual([]);
    await user.click(screen.getByRole("button", { name: "選択モード" }));
    await user.click(within(picker).getByRole("button", { name: /^Anna/ }));
    await user.click(within(picker).getByRole("button", { name: /^Ben/ }));
    expect(canvas.selectedMemberIds).toEqual(["m_anna", "m_ben"]);
    await user.click(within(picker).getByRole("button", { name: /^Ben/ }));
    expect(canvas.selectedMemberIds).toEqual(["m_anna"]);
    await user.click(screen.getByRole("button", { name: "選択モード中" }));
    await user.click(within(picker).getByRole("button", { name: /^Ben/ }));
    expect(canvas.selectedMemberIds).toEqual([]); expect(canvas.project!.frames).toEqual(before);
    expect(screen.getByRole("tab", { name: "メンバー" }).getAttribute("aria-selected")).toBe("true");
    const input = within(picker).getByRole("searchbox"); fireEvent.change(input, { target: { value: "Ben" } });
    await user.click(screen.getByRole("tab", { name: "道具" }));
    expect((screen.getByRole("searchbox", { name: "道具名を検索" }) as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("tab", { name: "メンバー" }));
    expect((screen.getByRole("searchbox", { name: "メンバー名を検索" }) as HTMLInputElement).value).toBe("Ben");
  }, INTEGRATION_TIMEOUT_MS);

  it("suspends background shortcuts in sharing/export dialogs and restores Delete and Undo after closing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    const before = structuredClone(canvas.project);
    const beforeSelection = [...canvas.selectedMemberIds];
    const beforeFrameId = canvas.selectedFrameId;
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const share = await screen.findByRole("dialog", { name: "共有と書き出し" });
    for (const key of ["Delete", "ArrowRight", "ArrowUp", "z", "y", "a", "v", "PageDown", "Home", "End"]) {
      fireEvent.keyDown(share, { key, metaKey: !key.startsWith("Arrow") && key !== "Delete" });
    }
    expect(canvas.project).toEqual(before);
    expect(canvas.selectedMemberIds).toEqual(beforeSelection);
    expect(canvas.selectedFrameId).toBe(beforeFrameId);
    await user.click(screen.getByRole("button", { name: "共有と書き出しを閉じる" }));
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(canvas.project!.frames[0].memberVisibility).not.toEqual(before!.frames[0].memberVisibility));
    const deleted = structuredClone(canvas.project);
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    const reopened = await screen.findByRole("dialog", { name: "共有と書き出し" });
    fireEvent.keyDown(reopened, { key: "z", metaKey: true });
    expect(canvas.project).toEqual(deleted);
    await user.click(screen.getByRole("button", { name: "共有と書き出しを閉じる" }));
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await waitFor(() => expect(canvas.project!.frames).toEqual(before!.frames));
  }, INTEGRATION_TIMEOUT_MS);
  beforeEach(() => {
    testCanContinue = true;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    localStorage.clear();
    const project = { ...createSampleProject(), id: "local-roster", title: "削除検証" };
    project.frames[0].objectAssignments = { o_chair: ["m_ben"] };
    testProject = project;
    canvas.project = null;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([false, true])("opens the project with an overlay; missing audio=%s preserves the error instead of a success", async (missingAudio) => {
    vi.useFakeTimers();
    if (missingAudio) {
      const project = { ...createSampleProject(), id: "missing-audio", title: "削除検証",
        audio: { id: "missing", name: "曲.mp3", type: "audio/mpeg", size: 100 } };
      testProject = project;
      vi.spyOn(audioStorage, "resolveAudioPlaybackURL").mockResolvedValue(null);
    }
    render(<App />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "削除検証を開く" })); });
    const overlay = screen.getByRole("region", { name: "お知らせ" });
    const message = missingAudio
      ? "保存済み音源が見つかりませんでした。必要なら音源を読み込み直してください。"
      : "隊列表を開きました。";
    expect(within(overlay).getByText(message)).toBeTruthy();
    expect(overlay.parentElement?.classList.contains("stage-fullscreen-host")).toBe(true);
    expect(screen.getByTestId("stage-export-dom").contains(overlay)).toBe(false);
    act(() => vi.advanceTimersByTime(3000));
    expect(Boolean(within(overlay).queryByText(message))).toBe(missingAudio);
    if (missingAudio) {
      fireEvent.click(within(overlay).getByRole("button", { name: "お知らせを閉じる" }));
      expect(within(overlay).queryByText(message)).toBeNull();
    }
  }, INTEGRATION_TIMEOUT_MS);

  it.each(["add", "remove", "previous"] as const)("undoes %s assignments with the original scene visibility and positions", async (action) => {
    const project = { ...createSampleProject(), id: "undo-roster", title: "割当Undo検証" };
    project.frames[0].objectAssignments = { o_chair: ["m_ben"] };
    project.frames[0].memberVisibility = { m_ben: false, m_anna: true };
    project.frames[1].objectAssignments = { o_chair: ["m_anna"] };
    project.frames[1].memberVisibility = { m_ben: true, m_anna: false };
    testProject = project;
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "割当Undo検証を開く" }));
    await waitFor(() => expect(canvas.project).not.toBeNull());
    await user.click(await screen.findByRole("button", { name: "全体名簿を開く" }));
    const roster = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
    await user.click(within(roster).getByRole("button", { name: "道具管理" }));
    await user.click(within(roster).getByRole("button", { name: "道具割当" }));
    const view = await within(roster).findByLabelText("道具名簿の割当");
    if (action === "previous") await user.selectOptions(within(view).getByRole("combobox"), "f_count8");
    const frameIndex = action === "previous" ? 1 : 0;
    const before = JSON.parse(JSON.stringify(canvas.project!.frames[frameIndex])) as Project["frames"][number];
    await user.click(within(view).getByRole("button", { name: /^椅子・/ }));
    if (action === "previous") {
      await user.click(within(view).getByRole("button", { name: "前シーンの割当を反映" }));
      const confirm = within(view).getByRole("dialog", { name: "前シーンの割当を反映" });
      expect(confirm.textContent).toContain("1個の道具の担当が変わります");
      await user.click(within(confirm).getByRole("button", { name: "反映する" }));
    } else {
      await user.click(within(view).getByRole("button", { name: action === "add" ? "Anna 未所属" : "Ben 未所属" }));
    }
    await waitFor(() => expect(canvas.project!.frames[frameIndex].objectAssignments).not.toEqual(before.objectAssignments));
    expect(canvas.project!.frames[frameIndex].memberVisibility?.[action === "add" ? "m_anna" : "m_ben"]).toBe(false);
    await user.click(within(view).getByRole("button", { name: "元に戻す" }));
    await waitFor(() => expect(canvas.project!.frames[frameIndex]).toEqual(before));
    expect(within(view).getByRole("button", { name: action === "previous" ? "Anna 未所属" : "Ben 未所属" }).getAttribute("aria-pressed")).toBe("true");
  }, INTEGRATION_TIMEOUT_MS);

  it.each(["members", "objects"] as const)("cancels then confirms × deletion and removes %s from every scene", async (mode) => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    await waitFor(() => expect(canvas.project).not.toBeNull());
    expect(canvas.focusMode).toBe(false);
    expect(canvas.focusMemberId).toBe("");
    expect(canvas.movementPathMode).toBe("all");
    expect(canvas.project!.focusMemberId).toBe("m_anna");
    await user.click(await screen.findByRole("button", { name: "全体名簿を開く" }));
    const roster = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
    if (mode === "objects") await user.click(within(roster).getByRole("button", { name: "道具管理" }));
    const id = mode === "members" ? "m_ben" : "o_chair";
    const name = mode === "members" ? "Ben" : "椅子";
    await user.click(within(roster).getByRole("button", { name: `${name}を名簿から削除` }));
    const confirm = screen.getByRole("dialog", { name: "名簿から削除" });
    expect(within(confirm).getByText(/全シーンの配置と道具割当/)).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "キャンセル" }));
    expect(within(roster).getByRole("button", { name: `${name}を名簿から削除` })).toBeTruthy();
    await user.click(within(roster).getByRole("button", { name: `${name}を名簿から削除` }));
    await user.click(within(screen.getByRole("dialog", { name: "名簿から削除" })).getByRole("button", { name: "名簿から削除" }));
    await waitFor(() => expect(within(roster).queryByRole("button", { name: `${name}を名簿から削除` })).toBeNull());
    for (const frame of canvas.project!.frames) {
      if (mode === "members") {
        expect(frame.positions[id]).toBeUndefined();
        expect(Object.values(frame.objectAssignments ?? {}).flat()).not.toContain(id);
      } else {
        expect(frame.objectStates[id]).toBeUndefined();
        expect(frame.objectAssignments?.[id]).toBeUndefined();
      }
    }
    expect(canvas.project!.focusMemberId).toBe("m_anna");
  }, INTEGRATION_TIMEOUT_MS);
});
