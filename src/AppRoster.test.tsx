/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, SceneViewState } from "./types";
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
const canvasActions = vi.hoisted(() => ({ move: null as null | ((id: string, p: { x: number; y: number }) => void), view: null as null | ((id: string, view: SceneViewState) => void), playing: false }));
vi.mock("./components/ParadeCanvas", () => ({
  ParadeCanvas: forwardRef<HTMLDivElement, { project: Project; selectedFrameId: string | null; selectedMemberIds: string[]; isPlaying: boolean; onMoveMember: (id: string, p: { x: number; y: number }) => void; onFrameViewStateChange: (id: string, view: SceneViewState) => void }>((props, ref) => {
    canvas.project = props.project; canvas.selectedFrameId = props.selectedFrameId; canvas.selectedMemberIds = props.selectedMemberIds;
    canvasActions.move = props.onMoveMember; canvasActions.playing = props.isPlaying;
    canvasActions.view = props.onFrameViewStateChange;
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
  it.each(["member", "object"] as const)("edits %s coordinates through the upper card, keeps Undo and focuses with Ctrl/Cmd+1", async type => {
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    if (type === "object") fireEvent.click(await screen.findByRole("tab", { name: "道具" }));
    const picker = await screen.findByRole("region", { name: "このシーンの表示" });
    fireEvent.click(within(picker).getByRole("button", { name: type === "member" ? /^Anna/ : /^椅子/ }));
    const card = screen.getByRole("region", { name: "選択対象の位置" });
    expect(card.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "詳細" })).toBeNull();
    const before = structuredClone(canvas.project!.frames);
    const field = within(card).getByRole("spinbutton", { name: /^横（/ });
    fireEvent.change(field, { target: { value: "-1.13" } });
    expect(canvas.project!.frames).not.toEqual(before);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(canvas.project!.frames).toEqual(before);
    if (type === "object") {
      expect(screen.queryByLabelText("幅 m")).toBeNull(); expect(screen.queryByLabelText("高さ m")).toBeNull();
      fireEvent.change(within(card).getByRole("spinbutton", { name: /横幅/ }), { target: { value: ".01" } });
      expect(canvas.project!.frames[0].objectStates.o_chair.widthMeters).toBe(.01);
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(async () => expect((await testRepository.get(testProject.id!))?.project.frames[0].objectStates.o_chair.widthMeters).toBe(.01));
      fireEvent.keyDown(window, { key: "PageDown", ctrlKey: true });
      fireEvent.click(screen.getByRole("tab", { name: "シーン" }));
      fireEvent.click(await screen.findByRole("button", { name: "前シーンのメンバー・道具を反映" }));
      expect(canvas.project!.frames.find(frame => frame.id === canvas.selectedFrameId)!.objectStates.o_chair.widthMeters).toBe(.01);
    }
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      fireEvent.click(screen.getByRole("tab", { name: "音源" }));
      fireEvent.keyDown(window, { key: "1", ...modifier });
      await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole("region", { name: "選択対象の位置" })).getByRole("spinbutton", { name: /^横（/ })));
      fireEvent.blur(document.activeElement!);
    }
  }, INTEGRATION_TIMEOUT_MS);

  it("Ctrl+1 without selection opens the member tab and focuses the selection hint", async () => {
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    fireEvent.click(await screen.findByRole("tab", { name: "道具" }));
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    expect(screen.getByRole("tab", { name: "メンバー" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "選択対象の位置" })));
  }, INTEGRATION_TIMEOUT_MS);
  const selectMultiple = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "選択モード" }));
    const picker = screen.getByRole("region", { name: "このシーンの表示" });
    for (const name of [/^Anna/, /^Ben/]) fireEvent.click(within(picker).getByRole("button", { name }));
    expect(canvas.selectedMemberIds).toEqual(["m_anna", "m_ben"]);
  };
  const expectSingleSelection = () => {
    expect(screen.getByRole("button", { name: "選択モード" }).getAttribute("aria-pressed")).toBe("false");
    expect(canvas.selectedMemberIds).toEqual([]);
    const picker = screen.getByRole("region", { name: "このシーンの表示" });
    for (const name of [/^Anna/, /^Ben/]) fireEvent.click(within(picker).getByRole("button", { name }));
    expect(canvas.selectedMemberIds).toEqual([]);
    expect(within(picker).getByRole("button", { name: /^Anna/ }).getAttribute("aria-pressed")).toBe("false");
    expect(within(picker).getByRole("button", { name: /^Ben/ }).getAttribute("aria-pressed")).toBe("true");
  };
  it.each(["stage", "parade"] as const)("resets selection through home for the same and another project in %s", async mode => {
    testProject = { ...testProject, mode };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    const other = { ...createSampleProject(), id: "other-selection", title: "別の隊列表", mode };
    await act(async () => { await testRepository.commit({ project: other, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-other" }); });
    for (const title of ["削除検証", "別の隊列表"]) {
      await selectMultiple();
      fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
      fireEvent.click(await screen.findByRole("button", { name: `${title}を開く` }));
      await screen.findByRole("button", { name: "選択モード" });
      expectSingleSelection();
    }
  }, INTEGRATION_TIMEOUT_MS);
  it.each(["stage", "parade"] as const)("retains selection on scenes and failures, resets on direct reload in %s", async mode => {
    testProject = { ...testProject, mode };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    await selectMultiple();
    const first = canvas.selectedFrameId;
    fireEvent.keyDown(window, { key: "PageDown", metaKey: true });
    expect(canvas.selectedFrameId).not.toBe(first);
    expect(screen.getByRole("button", { name: "選択モード中" }).getAttribute("aria-pressed")).toBe("true");
    const commit = vi.spyOn(testRepository, "commit").mockRejectedValue(new RepositoryError("CONFLICT"));
    fireEvent.change(screen.getByRole("textbox", { name: "隊列表名" }), { target: { value: "未保存選択検証" } });
    fireEvent.click(screen.getByRole("button", { name: "隊列一覧へ戻る" }));
    await screen.findByRole("alert", { name: "端末保存エラー" });
    expect(screen.getByRole("button", { name: "選択モード中" }).getAttribute("aria-pressed")).toBe("true");
    const selection = [...canvas.selectedMemberIds];
    const get = vi.spyOn(testRepository, "get").mockRejectedValue(new RepositoryError("ACCESS_DENIED"));
    fireEvent.click(screen.getByRole("button", { name: "読み込み直す" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "隊列表を読み込み直す" })).getByRole("button", { name: "読み込み直す" }));
    await screen.findByText(/保存領域にアクセスできません/);
    expect(screen.getByRole("button", { name: "選択モード中" }).getAttribute("aria-pressed")).toBe("true");
    expect(canvas.selectedMemberIds).toEqual(selection);
    get.mockRestore(); commit.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "読み込み直す" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "隊列表を読み込み直す" })).getByRole("button", { name: "読み込み直す" }));
    await screen.findByRole("button", { name: "選択モード" });
    expectSingleSelection();
  }, INTEGRATION_TIMEOUT_MS);
  it.each(["stage", "parade"] as const)("applies the three remaining templates and saves coordinates in %s", async mode => {
    testProject = { ...createSampleProject(), id: "template-check", title: "整列検証", mode };
    const members = testProject.members.slice(0, 3);
    testProject.frames[0].objectAssignments = {};
    members.forEach((member, index) => { testProject.frames[0].positions[member.id] = { x: 5 + index, y: 4 }; });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "整列検証を開く" }));
    await screen.findByTestId(mode === "stage" ? "stage-export-dom" : "parade-export-dom");
    for (const member of members) fireEvent.click(await screen.findByRole("checkbox", { name: `${member.name} を複数選択` }));
    expect(screen.queryByText("V字")).toBeNull();
    fireEvent.click(screen.getByText("その他の整列"));
    for (const template of ["横1列", "縦1列", "斜め1列"]) {
      fireEvent.click(screen.getAllByRole("button", { name: template })[0]);
      const frame = canvas.project!.frames.find(frame => frame.id === canvas.selectedFrameId)!;
      const points = members.map(member => frame.positions[member.id]);
      if (template === "横1列") expect(new Set(points.map(point => point.y)).size).toBe(1);
      else if (template === "縦1列") expect(new Set(points.map(point => point.x)).size).toBe(1);
      else {
        expect(points[1].x - points[0].x).toBeCloseTo(points[1].y - points[0].y);
        expect(points[2].x - points[1].x).toBeCloseTo(points[2].y - points[1].y);
      }
      expect(template === "縦1列" ? points[1].y : points[1].x).toBeGreaterThan(template === "縦1列" ? points[0].y : points[0].x);
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(async () => expect((await testRepository.get("template-check"))?.project.frames[0].positions).toEqual(frame.positions));
    }
  }, INTEGRATION_TIMEOUT_MS);
  it("retains a 600% parade scene view through the app and repository save", async () => {
    testProject = { ...createSampleProject(), id: "zoom-six", title: "倍率保存検証", mode: "parade" };
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "倍率保存検証を開く" }));
    await screen.findByTestId("parade-export-dom");
    const id = canvas.selectedFrameId!;
    act(() => canvasActions.view!(id, { zoom: 6, scrollTop: 3000, scrollLeft: 100 }));
    expect(canvas.project!.frames.find(f => f.id === id)?.sceneViewState?.zoom).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(async () => expect((await testRepository.get(testProject.id!))?.project.frames.find(f => f.id === id)?.sceneViewState?.zoom).toBe(6));
  }, INTEGRATION_TIMEOUT_MS);
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
    // The audio tab loads lazily; allow for a busy machine during the full suite.
    fireEvent.click(await screen.findByRole("button", { name: "再生" }, { timeout: 5000 }));
    await waitFor(() => expect(canvasActions.playing).toBe(true));
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    const positionCard = screen.getByRole("region", { name: "選択対象の位置" });
    for (const input of within(positionCard).getAllByRole("spinbutton")) expect((input as HTMLInputElement).disabled).toBe(true);
    const before = structuredClone(canvas.project!.frames);
    fireEvent.change(within(positionCard).getByRole("spinbutton", { name: /^横位置/ }), { target: { value: "1.13" } });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    act(() => canvasActions.move!("m_anna", { x: 1, y: 2 }));
    act(() => oldMoveCallback("m_anna", { x: 1, y: 2 }));
    expect(canvas.project!.frames).toEqual(before);
    fireEvent.click(screen.getByRole("tab", { name: "音源" }));
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
    expect((await screen.findByRole("searchbox", { name: "道具名を検索" }) as HTMLInputElement).value).toBe("");
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
  const openObjectRoster = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "全体名簿を開く" }));
    const roster = await screen.findByRole("dialog", { name: "メンバー/道具の管理" });
    fireEvent.click(within(roster).getByRole("button", { name: "道具管理" }));
    return roster;
  };
  it("object roster steps create separate Undo/Redo entries, keep individual scenes, and save registration", async () => {
    testProject.frames.forEach((f, i) => { f.objectStates.o_chair.widthMeters = i === 2 ? 2 : 1.23; });
    testProject.stageObjects.find(o => o.id === "o_chair")!.widthMeters = 1.23;
    testProject.objectGroups = [{ id: "flags", name: "旗", objectIds: ["o_chair"], color: "#123456" }];
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    await waitFor(() => expect(canvas.project).not.toBeNull());
    const before = structuredClone(canvas.project!);
    const roster = await openObjectRoster();
    expect(within(roster).getByText("道具のアイコンか名前を押すと、形と大きさを設定できます")).toBeTruthy();
    fireEvent.click(within(roster).getByRole("button", { name: "椅子の形と大きさを設定" }));
    expect(document.activeElement?.tagName).not.toBe("INPUT");
    expect(within(roster).getByText("椅子（旗グループ）")).toBeTruthy();
    const plus = within(roster).getByRole("button", { name: "幅を0.10m大きくする" }); fireEvent.click(plus); fireEvent.click(plus);
    expect(canvas.project!.stageObjects.find(o => o.id === "o_chair")!.widthMeters).toBe(1.43);
    expect(canvas.project!.frames[2].objectStates.o_chair.widthMeters).toBe(2);
    fireEvent.click(within(roster).getByRole("button", { name: "隊列表へ戻る" }));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(canvas.project!.stageObjects.find(o => o.id === "o_chair")!.widthMeters).toBe(1.33);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true }); expect(canvas.project!.frames).toEqual(before.frames);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(canvas.project!.frames[0].objectStates.o_chair.widthMeters).toBe(1.33);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(async () => expect((await testRepository.get(testProject.id!))!.project.stageObjects.find(o => o.id === "o_chair")!.widthMeters).toBe(1.33));
  }, INTEGRATION_TIMEOUT_MS);
  it("name focus selects; quick add returns and selects the exact new ID with majority geometry; tabs cancel drafts", async () => {
    testProject.objectGroups = [{ id: "flags", name: "旗", objectIds: ["o_chair"], color: "#123456", defaultShape: "rectangle" }];
    testProject.stageObjects.find(o => o.id === "o_chair")!.shape = "circle";
    testProject.frames.forEach(frame => { frame.objectStates.o_chair.widthMeters = 1.23; frame.objectStates.o_chair.heightMeters = .56; });
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    const roster = await openObjectRoster();
    fireEvent.focus(within(roster).getByRole("textbox", { name: "旗 1行目" })); expect(within(roster).getByText("椅子（旗グループ）")).toBeTruthy();
    fireEvent.click(within(roster).getByRole("button", { name: "旗に道具を追加" }));
    const added = canvas.project!.stageObjects.slice(-1)[0]!;
    expect(added).toMatchObject({ shape: "circle", widthMeters: 1.23, heightMeters: .56 });
    expect(within(roster).getByText(`${added.name}（旗グループ）`)).toBeTruthy();
    expect(within(roster).getByRole("button", { name: `${added.name}の形と大きさを設定` }).getAttribute("aria-pressed")).toBe("true");
    for (const frame of canvas.project!.frames) expect(frame.objectStates[added.id]).toMatchObject({ widthMeters: 1.23, heightMeters: .56, visible: false });
    fireEvent.click(within(roster).getByRole("button", { name: /幅 .*を入力/ }));
    fireEvent.change(within(roster).getByRole("textbox", { name: "幅（m）" }), { target: { value: "2.34" } });
    fireEvent.click(within(roster).getByRole("button", { name: "メンバー管理" }));
    fireEvent.click(within(roster).getByRole("button", { name: "道具管理" })); expect(within(roster).queryByRole("textbox", { name: "幅（m）" })).toBeNull();
    expect(canvas.project!.stageObjects.slice(-1)[0]!.widthMeters).toBe(1.23);
  }, INTEGRATION_TIMEOUT_MS);
  it.each(["はい", "いいえ", "Escape"])("group move color %s is one Undo and preserves geometry; Escape retains roster", async answer => {
    testProject.objectGroups = [{ id: "flags", name: "旗", objectIds: [], color: "#123456" }];
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    fireEvent.click(await screen.findByRole("tab", { name: "道具" }));
    const membership = await screen.findByRole("combobox", { name: "椅子 の所属グループ" });
    const before = structuredClone(canvas.project!);
    const roster = answer === "Escape" ? await openObjectRoster() : null;
    fireEvent.change(membership, { target: { value: "flags" } });
    const confirm = await screen.findByRole("dialog", { name: "道具の色を変更しますか？" });
    expect(confirm.textContent).toContain("閉じても所属は変更し、色はそのままです");
    if (answer === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.click(within(confirm).getByRole("button", { name: answer }));
    await waitFor(() => expect(canvas.project!.objectGroups![0].objectIds).toEqual(["o_chair"]));
    expect(canvas.project!.frames).toEqual(before.frames);
    expect(canvas.project!.stageObjects.find(o => o.id === "o_chair")!).toEqual({ ...before.stageObjects.find(o => o.id === "o_chair")!, color: answer === "はい" ? "#123456" : before.stageObjects.find(o => o.id === "o_chair")!.color });
    if (roster) { expect(roster.isConnected).toBe(true); fireEvent.click(within(roster).getByRole("button", { name: "隊列表へ戻る" })); }
    fireEvent.keyDown(window, { key: "z", ctrlKey: true }); expect(canvas.project!.objectGroups).toEqual(before.objectGroups); expect(canvas.project!.stageObjects).toEqual(before.stageObjects);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    const color = canvas.project!.stageObjects.find(o => o.id === "o_chair")!.color;
    fireEvent.click(screen.getByRole("button", { name: "旗 を開く" }));
    fireEvent.change(screen.getByRole("combobox", { name: "椅子 の所属グループ" }), { target: { value: "" } });
    expect(screen.queryByRole("dialog", { name: "道具の色を変更しますか？" })).toBeNull();
    expect(canvas.project!.stageObjects.find(o => o.id === "o_chair")!.color).toBe(color);
  }, INTEGRATION_TIMEOUT_MS);
  it("reconfirms changed destination color instead of applying a stale yes", async () => {
    testProject.objectGroups = [{ id: "flags", name: "旗", objectIds: [], color: "#123456" }];
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    fireEvent.click(await screen.findByRole("tab", { name: "道具" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "椅子 の所属グループ" }), { target: { value: "flags" } });
    const confirm = await screen.findByRole("dialog", { name: "道具の色を変更しますか？" });
    fireEvent.click(screen.getByRole("button", { name: "旗のグループの色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("旗のグループの色を自由に選ぶ"), { target: { value: "#abcdef" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "はい" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "道具の色を変更しますか？" })).toBeTruthy());
    expect(canvas.project!.objectGroups![0].objectIds).toEqual([]);
    fireEvent.click(within(screen.getByRole("dialog", { name: "道具の色を変更しますか？" })).getByRole("button", { name: "はい" }));
    await waitFor(() => expect(canvas.project!.objectGroups![0].objectIds).toEqual(["o_chair"]));
    expect(canvas.project!.stageObjects.find(o => o.id === "o_chair")!.color).toBe("#abcdef");
  }, INTEGRATION_TIMEOUT_MS);
  it("object panel group additions share majority rules while copy/paste preserves source scene dimensions", async () => {
    testProject.objectGroups = [{ id: "flags", name: "旗", objectIds: ["o_chair", "o_curtain"], color: "#123456", defaultShape: "circle" }];
    testProject.frames.forEach(frame => { frame.objectStates.o_chair.widthMeters = 1.23; });
    render(<App />); fireEvent.click(await screen.findByRole("button", { name: "削除検証を開く" }));
    fireEvent.click(await screen.findByRole("tab", { name: "道具" }));
    const card = (await screen.findByRole("textbox", { name: "旗 のグループ名" })).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "道具" }));
    const added = canvas.project!.stageObjects.slice(-1)[0];
    expect(added).toMatchObject({ shape: "rectangle", widthMeters: 1.23, heightMeters: .8 });
    for (const frame of canvas.project!.frames) expect(frame.objectStates[added.id].widthMeters).toBe(1.23);
    const picker = screen.getByRole("region", { name: "このシーンの表示" });
    fireEvent.click(within(picker).getByRole("button", { name: /^移動幕/ }));
    const source = canvas.project!.stageObjects.find(o => o.id === "o_curtain")!;
    const states = canvas.project!.frames.map(f => f.objectStates.o_curtain);
    fireEvent.click(screen.getByRole("button", { name: "コピー" }));
    fireEvent.click(screen.getByRole("button", { name: "貼り付け" }));
    const copy = canvas.project!.stageObjects.slice(-1)[0];
    expect(copy.id).not.toBe(source.id); expect(copy.shape).toBe(source.shape);
    expect(copy.widthMeters).toBe(source.widthMeters); expect(copy.heightMeters).toBe(source.heightMeters);
    canvas.project!.frames.forEach((f, i) => {
      expect(f.objectStates[copy.id].widthMeters).toBe(states[i].widthMeters); expect(f.objectStates[copy.id].heightMeters).toBe(states[i].heightMeters);
    });
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
    if (action === "previous") await user.click(view.querySelector<HTMLButtonElement>('[data-thumbnail-frame-id="f_count8"]')!);
    const frameIndex = action === "previous" ? 1 : 0;
    const before = JSON.parse(JSON.stringify(canvas.project!.frames[frameIndex])) as Project["frames"][number];
    await user.click(within(view).getByRole("button", { name: /^椅子・/ }));
    if (action === "previous") {
      await user.click(within(view).getByRole("button", { name: "前シーンの割当を反映" }));
      const confirm = within(view).getByRole("dialog", { name: "前シーンの割当を反映" });
      expect(confirm.textContent).toContain("1個の道具の担当が変わります");
      await user.click(within(confirm).getByRole("button", { name: "反映する" }));
    } else if (action === "add") {
      // Anna is shown in this scene: the list starts with everyone (filter off), and assigning a shown member asks inline first.
      const hiddenOnly = within(view).getByRole("checkbox", { name: "このシーンで非表示の人だけ" }) as HTMLInputElement;
      expect(hiddenOnly.checked).toBe(false);
      await user.click(hiddenOnly);
      expect(within(view).queryByRole("button", { name: /^Anna 未所属/ })).toBeNull();
      await user.click(hiddenOnly);
      await user.click(within(view).getByRole("button", { name: "Anna 未所属 表示中" }));
      expect(within(view).getByRole("status").textContent).toContain("Annaさんは表示中です。");
      await user.click(within(view).getByRole("button", { name: "割り当てる" }));
    } else {
      await user.click(within(view).getByRole("button", { name: "Ben 未所属" }));
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
