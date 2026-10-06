/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormationFrame } from "../types";
import { formatTime, formatTimeTenths, parseTimeInput } from "../utils/time";
import { AudioSceneTimeline, timelineX } from "./AudioSceneTimeline";
import { AudioPanel } from "./AudioPanel";

const frames: FormationFrame[] = [
  { id: "a", label: "前奏", timeSec: 0, positions: {}, objectStates: {} },
  { id: "b", label: "Aメロ", timeSec: 30, positions: {}, objectStates: {} },
  { id: "c", label: "サビ", timeSec: 60, positions: {}, objectStates: {} },
];

beforeEach(() => {
  // A 300px viewport, default 30s: 10px = 1s.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 132, right: 300, bottom: 132, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const timeline = (overrides: Partial<Parameters<typeof AudioSceneTimeline>[0]> = {}) => {
  const props = { frames, duration: 120, currentTime: 10, selectedFrameId: "a", canEdit: true,
    onSeek: vi.fn(), onSelectScene: vi.fn(), onRetimeScene: vi.fn(), ...overrides };
  const view = render(<AudioSceneTimeline {...props} />);
  return { ...props, view };
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

  it("floors display times without changing stored precision", () => {
    expect(formatTime(59.96)).toBe("0:59");
    expect(formatTime(210.845057)).toBe("3:30");
    expect(formatTime(NaN)).toBe("0:00");
    expect(timelineX(12, 10, 300, 30)).toBe(170);
    expect(timelineX(0, 0, 300, 30)).toBe(150);
    expect(timelineX(120, 120, 300, 30)).toBe(150);
  });
});

describe("song bar with scene boundaries", () => {
  it("shows each scene's length and the last one up to the end of the song", () => {
    timeline();
    expect(screen.getByRole("button", { name: /^1\. 前奏（0:00から 30秒）を選ぶ/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^3\. サビ（1:00から 60秒）を選ぶ/ })).toBeTruthy();
  });

  it("drags a boundary and commits the new time once on release", () => {
    const props = timeline();
    const handle = screen.getByRole("button", { name: /^2\. Aメロの区切り/ });
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 75, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 90, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    expect(props.onRetimeScene).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 });
    fireEvent.click(handle);
    expect(props.onRetimeScene).toHaveBeenCalledTimes(1);
    expect(props.onRetimeScene).toHaveBeenCalledWith("b", 32.5);
    expect(props.onSelectScene).not.toHaveBeenCalled();
  });

  it("treats a tap on a boundary as selecting the scene, and a cancelled drag as nothing", () => {
    const props = timeline();
    const handle = screen.getByRole("button", { name: /^3\. サビの区切り/ });
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 151, pointerId: 1 });
    fireEvent.click(handle);
    expect(props.onSelectScene).toHaveBeenCalledWith("c");
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 150, pointerId: 2 });
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
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 75, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 120, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 120, pointerId: 1 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(readOnly.onRetimeScene).not.toHaveBeenCalled();
  });

  it("moves the playhead when the empty bar is tapped", () => {
    const props = timeline();
    fireEvent.click(document.querySelector(".audio-timeline__viewport")!, { clientX: 225 });
    expect(props.onSeek).toHaveBeenCalledWith(17.5);
    fireEvent.click(screen.getByRole("slider", { name: "曲全体の再生位置" }), { clientX: 225 });
    expect(props.onSeek).toHaveBeenLastCalledWith(90);
  });

  it("keeps the line centered and changes only the track transform during playback", () => {
    const props = timeline();
    const track = document.querySelector<HTMLElement>(".audio-timeline__track")!;
    const scene = document.querySelector(".audio-timeline__scene");
    expect(track.style.transform).toBe("translate3d(50px,0,0)");
    props.view.rerender(<AudioSceneTimeline {...props} currentTime={11} />);
    expect(track.style.transform).toBe("translate3d(40px,0,0)");
    expect(document.querySelector(".audio-timeline__scene")).toBe(scene);
    fireEvent.click(screen.getByRole("button", { name: "10秒" }));
    expect(track.style.transform).toBe("translate3d(-180px,0,0)");
    expect(screen.getByRole("button", { name: "10秒" }).getAttribute("aria-pressed")).toBe("true");
  });

  it.each([true, false])("scrubs left to advance, pauses once, and resumes only when previously playing (%s)", playing => {
    const props = timeline({ onPausePlayback: vi.fn(() => playing), onResumePlayback: vi.fn() });
    const wave = document.querySelector(".audio-timeline__viewport")!;
    fireEvent.pointerDown(wave, { button: 0, isPrimary: true, clientX: 150, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 145, clientY: 60, pointerId: 1 });
    expect(props.onPausePlayback).not.toHaveBeenCalled();
    fireEvent.pointerMove(wave, { clientX: 120, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 100, clientY: 60, pointerId: 1 });
    expect(props.onSeek).toHaveBeenLastCalledWith(15);
    expect(props.onPausePlayback).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(wave, { pointerId: 1 }); fireEvent.click(wave, { clientX: 100 });
    expect(props.onResumePlayback).toHaveBeenCalledTimes(playing ? 1 : 0);
    expect(props.onSeek).toHaveBeenCalledTimes(2);
    expect(props.onRetimeScene).not.toHaveBeenCalled();
  });

  it("allows vertical panel scrolling and ignores unrelated pointers", () => {
    const props = timeline({ onPausePlayback: vi.fn(() => true) });
    const wave = document.querySelector(".audio-timeline__viewport")!;
    fireEvent.pointerDown(wave, { button: 0, isPrimary: true, clientX: 150, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 100, clientY: 60, pointerId: 2 });
    fireEvent.pointerMove(wave, { clientX: 148, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(wave, { pointerId: 1 });
    expect(props.onSeek).not.toHaveBeenCalled(); expect(props.onPausePlayback).not.toHaveBeenCalled();
  });

  it("scrubs right to rewind and clamps edits to a tenth within fractional song duration", () => {
    const props = timeline({ duration: 60.86 });
    const wave = document.querySelector(".audio-timeline__viewport")!;
    fireEvent.pointerDown(wave, { button: 0, isPrimary: true, clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 180, pointerId: 1 }); expect(props.onSeek).toHaveBeenLastCalledWith(7);
    fireEvent.pointerMove(wave, { clientX: 500, pointerId: 1 }); expect(props.onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.pointerUp(wave, { pointerId: 1 });
    const handle = screen.getByRole("button", { name: /^3\. サビの区切り/ });
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 150, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 2 }); fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(props.onRetimeScene).toHaveBeenCalledWith("c", 60.8);
  });

  it.each(["cancel", "escape", "song", "unmount", "lost"])("cancels seeking without restarting audio: %s", action => {
    const props = timeline({ audioKey: "old", onPausePlayback: vi.fn(() => true), onResumePlayback: vi.fn() });
    const wave = document.querySelector(".audio-timeline__viewport")!;
    fireEvent.pointerDown(wave, { button: 0, isPrimary: true, clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 100, pointerId: 1 });
    if (action === "cancel") fireEvent.pointerCancel(wave, { pointerId: 1 });
    if (action === "escape") fireEvent.keyDown(window, { key: "Escape" });
    if (action === "song") props.view.rerender(<AudioSceneTimeline {...props} audioKey="new" />);
    if (action === "unmount") props.view.unmount();
    if (action === "lost") fireEvent.lostPointerCapture(wave, { pointerId: 1 });
    fireEvent.pointerUp(wave, { pointerId: 1 });
    expect(props.onResumePlayback).not.toHaveBeenCalled(); expect(props.onRetimeScene).not.toHaveBeenCalled();
  });

  it("keeps scene drags exclusive and cancels drafts on song replacement", () => {
    const props = timeline({ audioKey: "old", onPausePlayback: vi.fn(() => true) });
    const handle = screen.getByRole("button", { name: /^2\. Aメロの区切り/ });
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    expect(screen.getByRole("status").textContent).toBe("0:35");
    expect(props.onSeek).not.toHaveBeenCalled(); expect(props.onPausePlayback).not.toHaveBeenCalled();
    props.view.rerender(<AudioSceneTimeline {...props} audioKey="new" />);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(props.onRetimeScene).not.toHaveBeenCalled();
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
    expect(document.querySelector(".audio-now__time")?.textContent).toBe("0:35 -1:25");
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
    expect(screen.getByRole("button", { name: "終了 3:30" })).toBeTruthy();
    expect(screen.getByText("詳しい設定（再生の速さ・くり返し）")).toBeTruthy();
  });
  it("disables the time dials when duration is unknown", () => {
    panel({ duration: NaN });
    expect((screen.getByRole("button", { name: "開始 0:00" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "終了 2:00" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
