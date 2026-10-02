/* @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "./types";
import { createSampleProject } from "./sampleProject";

const canvas = vi.hoisted(() => ({ project: null as Project | null, focusMode: true, focusMemberId: "", movementPathMode: "" }));
vi.mock("./components/StageCanvas", () => ({
  StageCanvas: forwardRef<HTMLDivElement, { project: Project; focusMode: boolean; focusMemberId?: string; movementPathMode: string }>((props, ref) => {
    canvas.project = props.project;
    canvas.focusMode = props.focusMode;
    canvas.focusMemberId = props.focusMemberId ?? "";
    canvas.movementPathMode = props.movementPathMode;
    return <div ref={ref} />;
  }),
}));

import App from "./App";

// Full App renders plus the lazily loaded roster exceed the 5s default when the whole suite runs in parallel.
const INTEGRATION_TIMEOUT_MS = 20_000;

describe("App roster confirmation integration", () => {
  beforeEach(() => {
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
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
