/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { getSnapshotForFrame } from "../utils/interpolation";
import { StageCanvas } from "./StageCanvas";

const project = createSampleProject();
const frame = project.frames[0];
const props: ComponentProps<typeof StageCanvas> = {
  project, snapshot: getSnapshotForFrame(project, frame.id), selected: null,
  selectedFrameId: frame.id, selectedFrameLabel: frame.label, selectedFrameTime: 0,
  mode: "members", isPlaying: false, isFullscreen: false, viewerPerspective: "audience",
  showMovementPaths: false, showMeterRulers: true, movementPathMode: "all",
  selectedMemberIds: [], isMemberSelectionMode: false, focusMode: false,
  currentTime: 20, audioDuration: 100, audioName: "曲",
  canUndo: true, canRedo: true,
  onUndo: vi.fn(), onRedo: vi.fn(), onSelect: vi.fn(), onStagePointerPositionChange: vi.fn(),
  onMoveMember: vi.fn(), onUpdateObjectState: vi.fn(), onBeginProjectEdit: vi.fn(), onEndProjectEdit: vi.fn(),
  onTogglePlayback: vi.fn(), onSaveFrame: vi.fn(), onCaptureStageImage: vi.fn(), onTogglePerspective: vi.fn(),
  onToggleFullscreen: vi.fn(), onSeekAudio: vi.fn(), onContextMenuRequest: vi.fn(),
};
let resizeFit: (width: number, height: number) => void;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      if (element.classList.contains("stage-fit-area")) {
        resizeFit = (width, height) => this.callback(
          [{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver,
        );
      }
    }
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() =>
    ({ width: 760, height: 540, top: 0, left: 0, bottom: 540, right: 760, x: 0, y: 0, toJSON() {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("portrait stage controls and fit", () => {
  it("starts both portrait and landscape at 100%", () => {
    const portrait = render(<StageCanvas {...props} compact />);
    expect(screen.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("100%");
    expect(portrait.container.querySelector(".ruler-reference-labels")).toBeNull();
    portrait.unmount();
    render(<StageCanvas {...props} />);
    expect(screen.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("100%");
    expect(screen.queryByRole("button", { name: "ステージを拡大" })).toBeNull();
  });
  it("fits only on the first portrait entry, preserving later zoom across playback, panel resize and rotation", async () => {
    const view = render(<StageCanvas {...props} />);
    view.rerender(<StageCanvas {...props} compact />);
    expect(screen.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("100%");
    fireEvent.wheel(view.container.querySelector(".stage-fit-area")!, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 200 });
    expect(screen.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("114%");
    view.rerender(<StageCanvas {...props} compact isPlaying currentTime={30} />);
    const surface = view.container.querySelector<HTMLElement>(".stage-surface")!;
    const beforeHeight = surface.style.height;
    act(() => resizeFit(760, 340));
    await waitFor(() => expect(surface.style.height).not.toBe(beforeHeight));
    expect(screen.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("114%");
    view.rerender(<StageCanvas {...props} />);
    expect(screen.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("114%");
    view.rerender(<StageCanvas {...props} compact />);
    expect(screen.getByRole("button", { name: "ステージを全体表示に戻す" }).title).toContain("114%");
  });
  it("shows primary actions directly and accessible additional actions in the menu", () => {
    const { container } = render(<StageCanvas {...props} compact />);
    for (const name of ["元に戻す", "やり直し", "再生", "現在のシーンを保存", "全画面"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("slider", { name: "曲の再生位置" })).toBeTruthy();
    expect(container.querySelector(".stage-timebar__skips")).toBeNull();
    const toggle = screen.getByRole("button", { name: "その他のステージ操作" });
    expect(toggle.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(toggle);
    const menu = screen.getByRole("menu", { name: "その他のステージ操作" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(6);
    expect(within(menu).queryByRole("menuitem", { name: "ステージを拡大" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "ステージを縮小" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "5秒進む" }));
    expect(props.onSeekAudio).toHaveBeenCalledWith(25);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const lock = screen.getByRole("menuitemcheckbox", { name: "ピンチ拡大縮小をロック" });
    expect(lock.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(lock);
    fireEvent.click(toggle);
    expect(screen.getByRole("menuitemcheckbox").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });
  it("disables skips without usable audio and keeps image export available", () => {
    render(<StageCanvas {...props} compact audioName={null} />);
    fireEvent.click(screen.getByRole("button", { name: "その他のステージ操作" }));
    expect(screen.getByRole<HTMLButtonElement>("menuitem", { name: "10秒戻る" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "ステージを画像保存" }));
    expect(props.onCaptureStageImage).toHaveBeenCalledOnce();
  });
});
