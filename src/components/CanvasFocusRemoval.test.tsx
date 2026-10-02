/* @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { getSnapshotForFrame } from "../utils/interpolation";
import { StageCanvas } from "./StageCanvas";
import { ParadeCanvas } from "./ParadeCanvas";

const project = createSampleProject();
const frame = project.frames[0];
project.movementPlans = [
  ...project.members.map((member) => ({ targetType: "member" as const, targetId: member.id })),
  ...project.stageObjects.map((object) => ({ targetType: "object" as const, targetId: object.id })),
].map((target, index) => ({
  ...target, id: `path-${index}`, fromFrameId: frame.id, toFrameId: project.frames[1].id,
  pathType: "straight", enabled: true,
}));
const common = {
  project, snapshot: getSnapshotForFrame(project, frame.id), selected: null,
  selectedFrameId: frame.id, selectedFrameLabel: frame.label,
  selectedMemberIds: [], isMemberSelectionMode: false,
  focusMode: false, focusMemberId: undefined, isFullscreen: false,
  canUndo: false, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn(),
  onSelect: vi.fn(), onStagePointerPositionChange: vi.fn(), onMoveMember: vi.fn(),
  onUpdateObjectState: vi.fn(), onBeginProjectEdit: vi.fn(), onEndProjectEdit: vi.fn(),
  onToggleFullscreen: vi.fn(), onContextMenuRequest: vi.fn(),
};
const stageProps: ComponentProps<typeof StageCanvas> = {
  ...common, selectedFrameTime: 0, mode: "members", isPlaying: false,
  viewerPerspective: "audience", showMovementPaths: true, showMeterRulers: true,
  movementPathMode: "all", currentTime: 0, audioDuration: 100, audioName: null,
  onTogglePlayback: vi.fn(), onSaveFrame: vi.fn(), onCaptureStageImage: vi.fn(),
  onTogglePerspective: vi.fn(), onSeekAudio: vi.fn(),
};

describe("focus-free canvas display with legacy saved focusMemberId", () => {
  it("shows no focus or dimming in StageCanvas while retaining the saved field", () => {
    expect(project.focusMemberId).toBeTruthy();
    const markup = renderToStaticMarkup(<StageCanvas {...stageProps} />);
    expect(markup).toContain("member-token");
    expect(markup).not.toMatch(/is-focus|is-dimmed/);
    expect(project.focusMemberId).toBe("m_anna");
  });

  it("treats focus paths like all paths, including object paths, and preserves selected mode", () => {
    const all = renderToStaticMarkup(<StageCanvas {...stageProps} />);
    const legacy = renderToStaticMarkup(<StageCanvas {...stageProps} movementPathMode="focus" />);
    expect(legacy).toBe(all);
    expect(all).toContain('class="movement-path is-object');
    const selected = renderToStaticMarkup(<StageCanvas {...stageProps} movementPathMode="selected" selectedMemberIds={["m_anna"]} />);
    expect(selected).not.toBe(all);
    expect((selected.match(/class="movement-path /g) ?? [])).toHaveLength(1);
  });

  it("shows no focus in ParadeCanvas with a saved focusMemberId", () => {
    const props: ComponentProps<typeof ParadeCanvas> = {
      ...common, project: { ...project, mode: "parade" },
      onFrameViewStateChange: vi.fn(), onReflectPreviousFrame: vi.fn(),
    };
    const markup = renderToStaticMarkup(<ParadeCanvas {...props} />);
    expect(markup).toContain("parade-member");
    expect(markup).not.toMatch(/is-focus|is-dimmed/);
    expect(props.project.focusMemberId).toBe("m_anna");
  });
});
