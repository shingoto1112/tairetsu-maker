// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { StageSettingsPanel } from "./StageSettingsPanel";

afterEach(cleanup);
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
