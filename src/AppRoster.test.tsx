/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "./types";
import { createSampleProject } from "./sampleProject";
import * as audioStorage from "./utils/audioStorage";

const canvas = vi.hoisted(() => ({ project: null as Project | null, focusMode: true, focusMemberId: "", movementPathMode: "", selectedFrameId: null as string | null, selectedMemberIds: [] as string[] }));
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
  it("suspends background shortcuts in sharing/export dialogs and restores Delete and Undo after closing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "削除検証を開く" }));
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
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    localStorage.clear();
    const project = { ...createSampleProject(), id: "local-roster", title: "削除検証" };
    project.frames[0].objectAssignments = { o_chair: ["m_ben"] };
    localStorage.setItem("stageflow.projects.v1", JSON.stringify([project]));
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
      localStorage.setItem("stageflow.projects.v1", JSON.stringify([project]));
      vi.spyOn(audioStorage, "loadAudioBlobFromIndexedDb").mockResolvedValue(null);
    }
    render(<App />);
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
    localStorage.setItem("stageflow.projects.v1", JSON.stringify([project]));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "割当Undo検証を開く" }));
    await waitFor(() => expect(canvas.project).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "全体名簿を開く" }));
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
    await user.click(screen.getByRole("button", { name: "削除検証を開く" }));
    await waitFor(() => expect(canvas.project).not.toBeNull());
    expect(canvas.focusMode).toBe(false);
    expect(canvas.focusMemberId).toBe("");
    expect(canvas.movementPathMode).toBe("all");
    expect(canvas.project!.focusMemberId).toBe("m_anna");
    await user.click(screen.getByRole("button", { name: "全体名簿を開く" }));
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
