// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import { SceneTimeInput } from "./SceneTimeInput";
import { sortFrames } from "../utils/interpolation";
import { scrollWithinContainer } from "../utils/scrollWithinContainer";
import type { FormationFrame } from "../types";
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
it("keeps the saved order and selected ID while reordering only on blur/Enter, then reveals details", () => {
  let saved = frames;
  function Harness() {
    const [data, setData] = useState(frames);
    return <Timeline {...props()} frames={sortFrames(data)} onUpdateFrame={(id, patch) => {
      saved = data.map(frame => frame.id === id ? { ...frame, ...patch } : frame); setData(saved);
    }} />;
  }
  const view = render(<Harness />);
  const labels = () => [...view.container.querySelectorAll(".timeline-card__top strong")].map(el => el.textContent);
  expect(labels()).toEqual(["前", "同時刻", "後"]);
  const time = screen.getByLabelText("時刻（秒）") as HTMLInputElement;
  time.focus(); fireEvent.change(time, { target: { value: "5" } });
  expect(labels()).toEqual(["前", "同時刻", "後"]); expect(saved[0].timeSec).toBe(30);
  fireEvent.keyDown(time, { key: "Enter" });
  expect(labels()).toEqual(["後", "前", "同時刻"]);
  expect(saved.map(f => f.id)).toEqual(["late", "early", "tie"]);
  expect(view.container.querySelector(".is-selected strong")?.textContent).toBe("後");
  act(() => { raf.forEach(cb => cb(0)); }); expect(scrollWithinContainer).toHaveBeenCalled();
  time.focus(); fireEvent.change(time, { target: { value: "40" } }); fireEvent.blur(time);
  expect(labels()).toEqual(["前", "同時刻", "後"]);
});
it("holds a local draft across remote updates and commits last-writer wins once", () => {
  const commit = vi.fn(); const view = render(<SceneTimeInput value={10} onCommit={commit} />);
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  input.focus(); fireEvent.change(input, { target: { value: "25.5" } });
  view.rerender(<SceneTimeInput value={18} onCommit={commit} />);
  expect(input.value).toBe("25.5"); fireEvent.keyDown(input, { key: "Enter" }); fireEvent.blur(input);
  expect(commit).toHaveBeenCalledExactlyOnceWith(25.5);
  view.rerender(<SceneTimeInput value={25.5} onCommit={commit} />);
  input.focus(); fireEvent.change(input, { target: { value: "" } }); fireEvent.blur(input);
  expect(input.value).toBe("25.5"); expect(commit).toHaveBeenCalledTimes(1);
});
