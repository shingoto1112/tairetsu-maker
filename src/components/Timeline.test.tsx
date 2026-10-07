// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import { sortFrames } from "../utils/interpolation";
import { scrollWithinContainer } from "../utils/scrollWithinContainer";
import type { FormationFrame } from "../types";
import { createSampleProject } from "../sampleProject";
import { createSharedDocument } from "../collaboration/model";
import { CollaborationCommands } from "../collaboration/commands";
import { SharedNotesAdapter } from "../collaboration/notesAdapter";
vi.mock("../utils/scrollWithinContainer", () => ({ scrollWithinContainer: vi.fn() }));
const frames: FormationFrame[] = [
  { id: "late", label: "後", timeSec: 30, section: "サビ", positions: {}, objectStates: {} },
  { id: "early", label: "前", timeSec: 10, positions: {}, objectStates: {} },
  { id: "tie", label: "同時刻", timeSec: 10, positions: {}, objectStates: {} },
];
const props = (): ComponentProps<typeof Timeline> => ({
  frames: sortFrames(frames), selectedFrameId: "late", currentTime: 0, useGlobalStageSize: true,
  defaultStageWidth: 12, defaultStageDepth: 8, previousFrame: frames[2], canPasteFrame: false,
  onSelectFrame: vi.fn(), onAddFrame: vi.fn(), onAddFrameAtCurrentTime: vi.fn(),
  onPreviousFrame: vi.fn(), onNextFrame: vi.fn(), onSeekToFrame: vi.fn(), onUpdateFrame: vi.fn(),
  onUpdateFrameTime: vi.fn(),
  onDeleteFrame: vi.fn(), onCopyFrame: vi.fn(), onPasteFrame: vi.fn(), onPasteFrameIntoCurrent: vi.fn(),
  onApplyPreviousSceneState: vi.fn(),
});
let raf: FrameRequestCallback[];
beforeEach(() => {
  raf = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { raf.push(cb); return raf.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it("simplifies details but retains section display, per-scene sizes and deletion conditions", () => {
  const p = props(); const view = render(<Timeline {...p} />);
  expect(screen.queryByLabelText("セクション")).toBeNull(); expect(screen.getByText("サビ")).toBeTruthy();
  expect(screen.queryByText(/ステージサイズは全シーン共通/)).toBeNull();
  expect(screen.queryByRole("button", { name: "時刻順" })).toBeNull();
  expect(view.container.querySelector("[draggable]" )).toBeNull();
  const remove = screen.getByRole("button", { name: "このシーンを削除" });
  expect(remove.textContent).toBe(""); expect(remove.title).toBe("このシーンを削除");
  fireEvent.click(remove); expect(p.onDeleteFrame).toHaveBeenCalledExactlyOnceWith("late");
  const description = screen.getByText("メンバーの位置と道具の位置・大きさを、直前のシーンと同じにします。");
  expect(description.closest(".previous-scene-sync__header")).toBeNull();
  view.rerender(<Timeline {...p} frames={[frames[0]]} useGlobalStageSize={false} />);
  expect(screen.getByLabelText("このシーンの横")).toBeTruthy();
  expect((screen.getByRole("button", { name: "このシーンを削除" }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps saved order and selected ID, writes only on confirmation, then reveals details", () => {
  let saved = frames;
  function Harness() {
    const [data, setData] = useState(frames);
    return <Timeline {...props()} frames={sortFrames(data)} onUpdateFrameTime={(id, timeSec) => {
      saved = data.map(frame => frame.id === id ? { ...frame, timeSec } : frame); setData(saved);
    }} />;
  }
  const view = render(<Harness />);
  const labels = () => [...view.container.querySelectorAll(".timeline-card__top strong")].map(el => el.textContent);
  expect(labels()).toEqual(["前", "同時刻", "後"]);
  const time = screen.getByRole("button", { name: "シーンの時刻を変更（現在 0:30）" });
  time.focus(); fireEvent.click(time);
  const seconds = screen.getByRole("spinbutton", { name: "秒" });
  seconds.scrollTop = 5 * 44; fireEvent.scroll(seconds);
  act(() => { raf.splice(0).forEach(cb => cb(0)); });
  vi.mocked(scrollWithinContainer).mockClear();
  expect(labels()).toEqual(["前", "同時刻", "後"]); expect(saved[0].timeSec).toBe(30);
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(labels()).toEqual(["後", "前", "同時刻"]);
  expect(saved.map(f => f.id)).toEqual(["late", "early", "tie"]);
  expect(view.container.querySelector(".is-selected strong")?.textContent).toBe("後");
  act(() => { raf.forEach(cb => cb(0)); }); expect(scrollWithinContainer).toHaveBeenCalled();
  expect(document.activeElement).toBe(time);
});
it("preserves draft and fixed range across remote/time-duration changes without auto-scroll", () => {
  const p = { ...props(), audioDuration: 70.8 };
  const view = render(<Timeline {...p} />);
  act(() => { raf.splice(0).forEach(cb => cb(0)); });
  fireEvent.click(screen.getByRole("button", { name: /シーンの時刻を変更/ }));
  fireEvent.keyDown(screen.getByRole("spinbutton", { name: "秒" }), { key: "ArrowUp" });
  vi.mocked(scrollWithinContainer).mockClear();
  view.rerender(<Timeline {...p} audioDuration={10} frames={sortFrames(frames.map(f => f.id === "late" ? { ...f, timeSec: 5 } : f))} />);
  expect(screen.getByRole("spinbutton", { name: "分" }).getAttribute("aria-valuemax")).toBe("2");
  expect(screen.getByRole("spinbutton", { name: "秒" }).getAttribute("aria-valuenow")).toBe("31");
  act(() => { raf.splice(0).forEach(cb => cb(0)); });
  expect(scrollWithinContainer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onUpdateFrameTime).toHaveBeenCalledExactlyOnceWith("late", 31);
  expect(p.onUpdateFrame).not.toHaveBeenCalled();
});

it("unchanged confirmation preserves the latest remote time, including fractional initial values", () => {
  const p = props(); const original = frames.map(f => f.id === "late" ? { ...f, timeSec: 14.57 } : f);
  const view = render(<Timeline {...p} frames={sortFrames(original)} />);
  fireEvent.click(screen.getByRole("button", { name: "シーンの時刻を変更（現在 0:14）" }));
  act(() => { raf.splice(0).forEach(cb => cb(0)); });
  vi.mocked(scrollWithinContainer).mockClear();
  view.rerender(<Timeline {...p} frames={sortFrames(original.map(f => f.id === "late" ? { ...f, timeSec: 25.89 } : f))} />);
  act(() => { raf.splice(0).forEach(cb => cb(0)); });
  expect(scrollWithinContainer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onUpdateFrameTime).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "シーンの時刻を変更（現在 0:25）" })).toBeTruthy();
  act(() => { raf.splice(0).forEach(cb => cb(0)); });
  expect(scrollWithinContainer).toHaveBeenCalled();
});

it.each(["selection", "deletion", "permission", "unmount"])("cancels on %s without writing", reason => {
  const p = props(); const view = render(<Timeline {...p} />);
  fireEvent.click(screen.getByRole("button", { name: /シーンの時刻を変更/ }));
  fireEvent.keyDown(screen.getByRole("spinbutton", { name: "秒" }), { key: "ArrowUp" });
  if (reason === "unmount") view.unmount();
  else view.rerender(<Timeline {...p} selectedFrameId={reason === "selection" ? "early" : p.selectedFrameId}
    frames={reason === "deletion" ? frames.filter(f => f.id !== "late") : p.frames} canEditProject={reason !== "permission"} />);
  expect(screen.queryByRole("dialog")).toBeNull(); expect(p.onUpdateFrameTime).not.toHaveBeenCalled();
});

it.each([false, true])("rechecks live permissions even without a Project render (subscription=%s)", notify => {
  let allowed = true; let changed: (() => void) | undefined;
  const p = props();
  render(<Timeline {...p} canEditTime={() => allowed} subscribeTimePermission={listener => { changed = listener; return () => {}; }} />);
  fireEvent.click(screen.getByRole("button", { name: /シーンの時刻を変更/ }));
  fireEvent.click(screen.getByRole("button", { name: "秒を1増やす" }));
  allowed = false;
  if (notify) act(() => changed?.());
  else fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(p.onUpdateFrameTime).not.toHaveBeenCalled();
});

it.each([
  [undefined, 30, 60, 0], [NaN, 30, 60, 0], [Infinity, 30, 60, 0], [0, 30, 60, 0],
  [10.8, 30, 1, 10], [10, 5000.57, 83, 20], [undefined, 1000000000.5, 16666666, 40],
])("fixes range from duration %s and initial time %s", (audioDuration, timeSec, maxMinute, maxSecond) => {
  render(<Timeline {...props()} audioDuration={audioDuration} frames={[{ ...frames[0], timeSec }]} />);
  fireEvent.click(screen.getByRole("button", { name: /シーンの時刻を変更/ }));
  const minute = screen.getByRole("spinbutton", { name: "分" });
  expect(minute.getAttribute("aria-valuemax")).toBe(String(maxMinute));
  fireEvent.keyDown(minute, { key: "End" });
  expect(screen.getByRole("spinbutton", { name: "秒" }).getAttribute("aria-valuemax")).toBe(String(maxSecond));
  expect(minute.querySelectorAll(".audio-dial__row").length).toBeLessThanOrEqual(121);
});

it("edits the memo through the shared notes while co-editing (no whole-value overwrite)", () => {
  const project = createSampleProject(); project.id = "timeline-notes"; project.frames[0].notes = "abc";
  const doc = createSharedDocument(project), commands = new CollaborationCommands(doc);
  const adapter = new SharedNotesAdapter(doc, commands, project.frames[0].id);
  try {
    const p = { ...props(), frames: sortFrames(project.frames), selectedFrameId: project.frames[0].id,
      getSharedNotes: (id: string) => id === project.frames[0].id ? adapter : undefined };
    render(<Timeline {...p} />);
    const memo = screen.getByRole("textbox", { name: "シーンメモ" }) as HTMLTextAreaElement;
    expect(memo.value).toBe("abc");
    fireEvent.change(memo, { target: { value: "abcd" } });
    expect(adapter.value).toBe("abcd");
    expect(p.onUpdateFrame).not.toHaveBeenCalled();
  } finally { commands.destroy(); doc.destroy(); }
});

it("does not auto-scroll the list while typing in the scene details", () => {
  const p = props();
  const view = render(<Timeline {...p} />);
  act(() => { raf.splice(0).forEach((callback) => callback(0)); });
  vi.mocked(scrollWithinContainer).mockClear();
  (screen.getByRole("textbox", { name: "シーンメモ" }) as HTMLTextAreaElement).focus();
  // A remote time change re-sorts the list while the memo has focus.
  view.rerender(<Timeline {...p} frames={sortFrames(frames.map((frame) => frame.id === "late" ? { ...frame, timeSec: 5 } : frame))} />);
  act(() => { raf.splice(0).forEach((callback) => callback(0)); });
  expect(scrollWithinContainer).not.toHaveBeenCalled();
});
