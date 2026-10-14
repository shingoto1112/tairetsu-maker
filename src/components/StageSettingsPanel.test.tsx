// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { StageSettingsPanel } from "./StageSettingsPanel";

afterEach(cleanup);
describe("stage tab detailed settings", () => {
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
