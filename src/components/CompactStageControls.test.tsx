// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { getSnapshotForFrame } from "../utils/interpolation";
import { CompactStageControls } from "./CompactStageControls";
import { ParadeCanvas } from "./ParadeCanvas";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const makeProps = (): ComponentProps<typeof CompactStageControls> => ({
  currentTime: 0, duration: 100, audioName: null, sceneLabel: "シーン1",
  isPlaying: false, isFullscreen: false, isReadOnly: false,
  canUndo: false, canRedo: false, zoom: 1, pinchLocked: false, viewerPerspective: "performer",
  onUndo: vi.fn(), onRedo: vi.fn(), onPlay: vi.fn(), onSaveProject: vi.fn(), saveDisabled: false,
  onSeek: vi.fn(), onZoom: vi.fn(), onCapture: vi.fn(), onPerspective: vi.fn(), onFullscreen: vi.fn(), onPinchLock: vi.fn(),
});

it.each(["performer", "audience"] as const)("shows the current %s perspective from props and keeps the existing action", viewerPerspective => {
  const props = { ...makeProps(), viewerPerspective };
  const view = render(<CompactStageControls {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "その他のステージ操作" }));
  const label = `視点を切り替え（現在：${viewerPerspective === "performer" ? "踊る人側" : "観客側"}）`;
  expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
  expect(props.onPerspective).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  expect(props.onPerspective).toHaveBeenCalledOnce();
  // Clicking does not invent local perspective state; the parent supplies the next value.
  fireEvent.click(screen.getByRole("button", { name: "その他のステージ操作" }));
  expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
  view.rerender(<CompactStageControls {...props} viewerPerspective={viewerPerspective === "performer" ? "audience" : "performer"} />);
  expect(screen.getByRole("menuitem", { name: `視点を切り替え（現在：${viewerPerspective === "performer" ? "観客側" : "踊る人側"}）` })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: label })).toBeNull();
});

it("keeps perspective switching out of the parade controls", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const project = { ...createSampleProject(), mode: "parade" as const };
  const frame = project.frames[0], noop = vi.fn();
  render(<ParadeCanvas project={project} snapshot={getSnapshotForFrame(project, frame.id)}
    selected={null} selectedFrameId={frame.id} selectedFrameLabel={frame.label}
    selectedMemberIds={[]} isMemberSelectionMode={false} focusMode={false}
    isFullscreen={false} canUndo={false} canRedo={false}
    onUndo={noop} onRedo={noop} onSelect={noop} onStagePointerPositionChange={noop}
    onMoveMember={noop} onUpdateObjectState={noop} onBeginProjectEdit={noop} onEndProjectEdit={noop}
    onToggleFullscreen={noop} onContextMenuRequest={noop} onReflectPreviousFrame={noop} onFrameViewStateChange={noop} />);
  expect(screen.getByRole("button", { name: "全画面" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "その他のステージ操作" })).toBeNull();
  expect(screen.queryByText(/視点|踊る人側|観客側/)).toBeNull();
});
