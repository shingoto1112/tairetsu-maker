/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormationFrame } from "../types";
import { formatTimeTenths, parseTimeInput } from "../utils/time";
import { AudioSceneTimeline } from "./AudioSceneTimeline";
import { AudioTimeInput } from "./AudioTimeInput";
import { AudioPanel } from "./AudioPanel";

const frames: FormationFrame[] = [
  { id: "a", label: "前奏", timeSec: 0, positions: {}, objectStates: {} },
  { id: "b", label: "Aメロ", timeSec: 30, positions: {}, objectStates: {} },
  { id: "c", label: "サビ", timeSec: 60, positions: {}, objectStates: {} },
];

beforeEach(() => {
  // A 300px-wide track over a 120s song: 1px = 0.4s.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 132, right: 300, bottom: 132, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const timeline = (overrides: Partial<Parameters<typeof AudioSceneTimeline>[0]> = {}) => {
  const props = { frames, duration: 120, currentTime: 10, selectedFrameId: "a", canEdit: true,
    onSeek: vi.fn(), onSelectScene: vi.fn(), onRetimeScene: vi.fn(), ...overrides };
  render(<AudioSceneTimeline {...props} />);
  return props;
};

describe("time text", () => {
  it("formats and reads m:ss.s", () => {
    expect(formatTimeTenths(210.845057)).toBe("3:30.8");
    expect(formatTimeTenths(59.96)).toBe("1:00.0");
    expect(parseTimeInput("3:30.8")).toBeCloseTo(210.8);
    expect(parseTimeInput("７５．５")).toBe(75.5);
    expect(parseTimeInput("1：05")).toBe(65);
    for (const bad of ["", "1:", ":5", "1:75", "abc", "1:2:3", "-3"]) expect(parseTimeInput(bad)).toBeNull();
  });

  it("commits a time field once on Enter and blur, and restores invalid text", () => {
    const onCommit = vi.fn();
    render(<AudioTimeInput ariaLabel="終了" value={210.845057} onCommit={onCommit} max={210.845057} />);
    const input = screen.getByRole("textbox", { name: "終了" }) as HTMLInputElement;
    expect(input.value).toBe("3:30.8");
    fireEvent.focus(input); fireEvent.change(input, { target: { value: "1:15" } });
    fireEvent.keyDown(input, { key: "Enter" }); fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1); expect(onCommit).toHaveBeenCalledWith(75);
    fireEvent.focus(input); fireEvent.change(input, { target: { value: "あいう" } }); fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe("song bar with scene boundaries", () => {
  it("shows each scene's length and the last one up to the end of the song", () => {
    timeline();
    expect(screen.getByRole("button", { name: /^1\. 前奏（0:00.0から 30\.0秒）を選ぶ/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^3\. サビ（1:00.0から 60\.0秒）を選ぶ/ })).toBeTruthy();
  });

  it("drags a boundary and commits the new time once on release", () => {
    const props = timeline();
    const handle = screen.getByRole("button", { name: /^2\. Aメロの区切り/ });
    fireEvent.pointerDown(handle, { button: 0, clientX: 75, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 90, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    expect(props.onRetimeScene).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 });
    fireEvent.click(handle);
    expect(props.onRetimeScene).toHaveBeenCalledTimes(1);
    expect(props.onRetimeScene).toHaveBeenCalledWith("b", 40);
    expect(props.onSelectScene).not.toHaveBeenCalled();
  });

  it("treats a tap on a boundary as selecting the scene, and a cancelled drag as nothing", () => {
    const props = timeline();
    const handle = screen.getByRole("button", { name: /^3\. サビの区切り/ });
    fireEvent.pointerDown(handle, { button: 0, clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 151, pointerId: 1 });
    fireEvent.click(handle);
    expect(props.onSelectScene).toHaveBeenCalledWith("c");
    fireEvent.pointerDown(handle, { button: 0, clientX: 150, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 2 });
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    expect(props.onRetimeScene).not.toHaveBeenCalled();
  });

  it("nudges with arrow keys and does not edit when read-only", () => {
    const props = timeline();
    fireEvent.keyDown(screen.getByRole("button", { name: /^2\. Aメロの区切り/ }), { key: "ArrowRight" });
    expect(props.onRetimeScene).toHaveBeenLastCalledWith("b", 30.1);
    fireEvent.keyDown(screen.getByRole("button", { name: /^2\. Aメロの区切り/ }), { key: "ArrowLeft", shiftKey: true });
    expect(props.onRetimeScene).toHaveBeenLastCalledWith("b", 29);
    cleanup();
    const readOnly = timeline({ canEdit: false });
    const handle = screen.getByRole("button", { name: /^2\. Aメロの区切り/ });
    fireEvent.pointerDown(handle, { button: 0, clientX: 75, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 120, pointerId: 1 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(readOnly.onRetimeScene).not.toHaveBeenCalled();
  });

  it("moves the playhead when the empty bar is tapped", () => {
    const props = timeline();
    fireEvent.click(document.querySelector(".audio-timeline__track")!, { clientX: 225 });
    expect(props.onSeek).toHaveBeenCalledWith(90);
  });
});

describe("audio tab for building formations", () => {
  const panel = (overrides: Partial<Parameters<typeof AudioPanel>[0]> = {}) => {
    const props = {
      audioName: "曲.wav", isPlaying: false, currentTime: 35, duration: 120, playbackRate: 1, loopEnabled: false,
      loopStart: 0, loopEnd: 120, sharedAudioNotice: false, onLoadAudio: vi.fn(), onTogglePlayback: vi.fn(),
      onSeek: vi.fn(), onPlaybackRateChange: vi.fn(), onLoopChange: vi.fn(),
      frames, selectedFrameId: "c", onSelectScene: vi.fn(), onRetimeScene: vi.fn(),
      onAddSceneAtPlayhead: vi.fn(), onAlignSceneToPlayhead: vi.fn(), ...overrides,
    };
    render(<AudioPanel {...props} />);
    return props;
  };

  it("shows the time and the scene playing now, and steps between scenes with the playhead", () => {
    const props = panel();
    expect(screen.getByText("いまのシーン：Aメロ（2/3）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "前のシーンへ" }));
    expect(props.onSelectScene).toHaveBeenLastCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "次のシーンへ" }));
    expect(props.onSelectScene).toHaveBeenLastCalledWith("c");
    fireEvent.click(screen.getByRole("button", { name: "5秒戻る" }));
    expect(props.onSeek).toHaveBeenLastCalledWith(30);
  });

  it("adds a scene at the playhead and aligns the selected scene to it", () => {
    const props = panel();
    fireEvent.click(screen.getByRole("button", { name: /ここにシーンを追加/ }));
    expect(props.onAddSceneAtPlayhead).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /「サビ」を今の位置に/ }));
    expect(props.onAlignSceneToPlayhead).toHaveBeenCalledWith("c");
  });

  it("keeps speed and repeat in 詳しい設定 with m:ss times", () => {
    panel({ loopEnd: 210.845057, duration: 210.845057 });
    expect((screen.getByRole("textbox", { name: "くり返しの終了（分:秒）" }) as HTMLInputElement).value).toBe("3:30.8");
    expect(screen.getByText("詳しい設定（再生の速さ・くり返し）")).toBeTruthy();
  });
});
