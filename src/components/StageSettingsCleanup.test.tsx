// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { getSnapshotForFrame } from "../utils/interpolation";
import { StageCanvas } from "./StageCanvas";

for (const frontDirection of ["bottom", "top", "left", "right"] as const)
for (const viewerPerspective of ["audience", "performer"] as const) {
  it(`${frontDirection}/${viewerPerspective}: hides saved labels and preserves both rulers and 0m`, () => {
    const project = createSampleProject();
    project.stage = { ...project.stage, widthMeters: 12, depthMeters: 5.4,
      frontDirection, audienceSide: "bottom", originMode: "audienceCenter", showStageLabels: true };
    const frame = project.frames[0], noop = vi.fn(), before = JSON.stringify(project);
    const props: ComponentProps<typeof StageCanvas> = {
      project, snapshot: getSnapshotForFrame(project, frame.id), selected: null,
      selectedFrameId: frame.id, selectedFrameLabel: frame.label, selectedFrameTime: 0,
      selectedMemberIds: [], isMemberSelectionMode: false, focusMode: false,
      isFullscreen: false, canUndo: false, canRedo: false, mode: "members", isPlaying: false,
      viewerPerspective, showMovementPaths: false, showMeterRulers: true, movementPathMode: "all",
      currentTime: 0, audioDuration: 100, audioName: null,
      onUndo: noop, onRedo: noop, onSelect: noop, onStagePointerPositionChange: noop,
      onMoveMember: noop, onUpdateObjectState: noop, onBeginProjectEdit: noop, onEndProjectEdit: noop,
      onToggleFullscreen: noop, onContextMenuRequest: noop, onTogglePlayback: noop,
      onSaveFrame: noop, onCaptureStageImage: noop, onTogglePerspective: noop, onSeekAudio: noop,
    };
    const markup = renderToStaticMarkup(<StageCanvas {...props} />);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    expect(doc.querySelector(".stage-label")).toBeNull();
    expect(doc.querySelector(".stage-surface")!.textContent).not.toMatch(/客席側|奥|上手|下手/);
    const horizontal = [...doc.querySelectorAll(".meter-ruler--horizontal .meter-ruler__tick")];
    expect(horizontal.length).toBeGreaterThan(0);
    expect(horizontal.some(tick => tick.textContent === "1")).toBe(true);
    for (const side of ["left", "right"]) {
      const ticks = [...doc.querySelectorAll<HTMLElement>(`.meter-ruler--vertical-${side} .meter-ruler__tick`)];
      expect(ticks.length).toBeGreaterThan(1);
      const zero = ticks.find(tick => Number.parseFloat(tick.textContent!) === 0)!;
      expect(zero.textContent).toBe("0m");
      expect(Number(zero.dataset.position)).toBe(frontDirection === "top" ? 0 : 5.4);
      // The 0m edge still follows the legacy origin, then the current view reflection.
      const zeroAtTop = (frontDirection === "top") === (viewerPerspective === "audience");
      expect(zero.style.top).toBe(zeroAtTop
        ? "calc(var(--stage-border-width) / 2)"
        : "calc(100% - var(--stage-border-width) / 2)");
    }
    expect(JSON.stringify(project)).toBe(before);
    // The saved toggle no longer affects rendering; its data remains intact.
    expect(renderToStaticMarkup(<StageCanvas {...props} project={{ ...project,
      stage: { ...project.stage, showStageLabels: false } }} />)).toBe(markup);
  });
}
