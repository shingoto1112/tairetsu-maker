// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { StageSettingsPanel } from "./StageSettingsPanel";

afterEach(cleanup);

describe("B10 stage size presentation", () => {
  const explanation = "シーンごとの大きさが未設定のシーンで使います。各シーンの大きさはシーンの詳細で変えられます。";

  it.each([true, false])("labels the existing global/base fields and shows one summary (fixed=%s)", fixed => {
    const stage = { ...createSampleProject().stage, widthMeters: 19, depthMeters: 18 };
    const before = JSON.stringify(stage), onChange = vi.fn(), onToggle = vi.fn();
    const props = { stage, useGlobalStageSize: fixed, onChange, onUseGlobalStageSizeChange: onToggle };
    const view = render(<StageSettingsPanel {...props} />);
    const summary = fixed ? "現在: 全シーン共通 横19m × 縦18m" : "シーン別サイズを使用／基準：横19m × 縦18m";
    expect(screen.getAllByText(summary)).toHaveLength(1);
    const header = view.container.querySelector<HTMLElement>(".panel-sticky-header")!;
    expect(within(header).getByText(summary)).toBeTruthy();
    expect(header.querySelector("input, select")).toBeNull();
    expect(view.container.textContent?.match(/横19m/g)).toHaveLength(1);
    expect(screen.queryByText(explanation) !== null).toBe(!fixed);
    expect(screen.queryByText(/デフォルトの|全シーン固定ON/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "固定" })).toBeNull();
    const toggle = screen.getByRole<HTMLInputElement>("checkbox", { name: "全シーンで同じ大きさにする" });
    expect(toggle.checked).toBe(fixed);
    expect(header.contains(toggle)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    for (const [label, patch] of [
      [`${fixed ? "ステージ" : "基準"}の横幅（m）`, { widthMeters: 20 }],
      [`${fixed ? "ステージ" : "基準"}の縦幅（m）`, { depthMeters: 20 }],
      ["グリッド間隔（m）", { gridSizeMeters: 20 }],
      ["メンバー円の直径（m）", { memberDiameterMeters: 1 }],
    ] as const) {
      fireEvent.change(screen.getByRole("spinbutton", { name: label }), { target: { value: "20" } });
      expect(onChange).toHaveBeenLastCalledWith(patch);
    }
    // OFF still edits the base stage config, never a scene-specific field.
    expect(onChange).toHaveBeenCalledTimes(4);
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(!fixed);
    view.rerender(<StageSettingsPanel {...props} useGlobalStageSize={!fixed} />);
    expect(screen.getByRole("spinbutton", { name: `${fixed ? "基準" : "ステージ"}の横幅（m）` })).toBeTruthy();
    expect(screen.queryByText(explanation) !== null).toBe(fixed);
    expect(JSON.stringify(stage)).toBe(before);
  });

  it("keeps the checkbox and dimensions disabled in read-only settings", async () => {
    const onChange = vi.fn(), onToggle = vi.fn();
    render(<StageSettingsPanel stage={createSampleProject().stage} useGlobalStageSize disabled
      onChange={onChange} onUseGlobalStageSizeChange={onToggle} />);
    const toggle = screen.getByRole<HTMLInputElement>("checkbox", { name: "全シーンで同じ大きさにする" });
    expect(toggle.disabled).toBe(true);
    await userEvent.setup().click(toggle);
    for (const input of screen.getAllByRole<HTMLInputElement>("spinbutton")) expect(input.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("uses metre labels and a single parade summary without adding stage-size controls", () => {
    const stage = { ...createSampleProject().stage, widthMeters: 19, depthMeters: 18 };
    const onChange = vi.fn(), onParadeSettingsChange = vi.fn();
    const { container } = render(<StageSettingsPanel mode="parade" stage={stage} useGlobalStageSize
      onChange={onChange} onParadeSettingsChange={onParadeSettingsChange} onUseGlobalStageSizeChange={vi.fn()} />);
    expect(screen.getAllByText("現在: 全体距離18m / 後方0m / 横幅19m")).toHaveLength(1);
    expect(container.querySelector(".panel-sticky-meta")?.textContent).toContain("全体距離18m");
    expect(screen.queryByRole("checkbox", { name: "全シーンで同じ大きさにする" })).toBeNull();
    for (const [label, key] of [["全体距離（m）", "totalDistance"], ["後方表示距離（m）", "backwardDistanceMeters"],
      ["横幅（m）", "width"], ["1マスあたりの距離（m）", "cellSizeMeters"]] as const) {
      fireEvent.change(screen.getByRole("spinbutton", { name: label }), { target: { value: "21" } });
      expect(onParadeSettingsChange).toHaveBeenLastCalledWith({ [key]: 21 });
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("stage tab detailed settings", () => {
  it("omits legacy direction, origin and label controls without writing saved values", () => {
    const stage = { ...createSampleProject().stage, frontDirection: "top" as const,
      audienceSide: "bottom" as const, originMode: "topLeft" as const, showStageLabels: true };
    const before = JSON.stringify(stage), onChange = vi.fn();
    render(<StageSettingsPanel stage={stage} useGlobalStageSize onChange={onChange} onUseGlobalStageSizeChange={vi.fn()} />);
    for (const name of [/正面方向/, /0m基準位置/, /ステージラベル|上手|下手/]) {
      expect(screen.queryByText(name)).toBeNull();
      expect(screen.queryByLabelText(name)).toBeNull();
    }
    expect(screen.getByRole("checkbox", { name: "メートル目盛り" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "中央線表示" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "グリッド表示" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ showGrid: !stage.showGrid });
    expect(JSON.stringify(stage)).toBe(before);
  });

  it.each(["stage", "parade"] as const)("%s starts open, can close, and resets on remount", mode => {
    const props = { mode, stage: createSampleProject().stage, useGlobalStageSize: true, onChange: vi.fn(), onUseGlobalStageSizeChange: vi.fn() };
    const view = render(<StageSettingsPanel {...props} />);
    const details = screen.getByText("詳しい設定", { exact: true }).closest("details")!;
    expect(details.open).toBe(true);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(false);
    // Uncontrolled DOM open state survives a regular rerender; no stored preference.
    view.rerender(<StageSettingsPanel {...props} stage={{ ...props.stage, showGrid: false }} />);
    expect(details.open).toBe(false);
    view.unmount();
    render(<StageSettingsPanel {...props} />);
    expect(screen.getByText("詳しい設定", { exact: true }).closest("details")!.open).toBe(true);
  });
});
