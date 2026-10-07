// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TimeDial, type TimeDialProps } from "./TimeDial";

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
});
const dial = (override: Partial<TimeDialProps> = {}) => {
  const props = { label: "シーン", value: 14.57, maxSeconds: 130.8, onCommit: vi.fn(), onCancel: vi.fn(), ...override };
  return { ...props, view: render(<TimeDial {...props} />) };
};
const wheel = (name: string) => screen.getByRole("spinbutton", { name });

it.each([14.5, 14.57, 0, 60.99, 5000000000.99])("retains fractional value %s after moving away and back", value => {
  const p = dial({ value, maxSeconds: Math.max(3600, value) });
  const seconds = wheel("秒");
  fireEvent.keyDown(seconds, { key: "ArrowDown" });
  if (value % 60 >= 1) fireEvent.keyDown(seconds, { key: "ArrowUp" });
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onCommit).toHaveBeenCalledExactlyOnceWith(value, { changed: false });
});

it("uses named +/- and Home/End, clamps the last minute, and commits integer seconds", () => {
  const p = dial({ value: 119.8 });
  expect(screen.getByText("1:59")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "分を1増やす" }));
  expect(wheel("秒").getAttribute("aria-valuemax")).toBe("10");
  expect(wheel("秒").getAttribute("aria-valuenow")).toBe("10");
  fireEvent.keyDown(wheel("秒"), { key: "Home" });
  fireEvent.keyDown(wheel("秒"), { key: "End" });
  fireEvent.click(screen.getByRole("button", { name: "秒を1減らす" }));
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onCommit).toHaveBeenCalledExactlyOnceWith(129, { changed: true });
});

it.each(["debounce", "scrollend", "confirm"])("reads visible pending wheels on %s", method => {
  vi.useFakeTimers(); const p = dial();
  wheel("分").scrollTop = 2 * 44; fireEvent.scroll(wheel("分"));
  wheel("秒").scrollTop = 50 * 44; fireEvent.scroll(wheel("秒"));
  if (method === "debounce") act(() => vi.advanceTimersByTime(150));
  if (method === "scrollend") fireEvent(wheel("分"), new Event("scrollend"));
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onCommit).toHaveBeenCalledExactlyOnceWith(130, { changed: true });
});

it("keeps a bounded moving window for huge minutes, including End/Home and scrolling", () => {
  const p = dial({ value: 6000000000.57, maxSeconds: 6000000120.8 });
  expect(wheel("分").querySelectorAll(".audio-dial__row").length).toBeLessThanOrEqual(61);
  fireEvent.keyDown(wheel("分"), { key: "Home" });
  wheel("分").scrollTop = 60 * 44; fireEvent.scroll(wheel("分"));
  fireEvent(wheel("分"), new Event("scrollend"));
  expect(wheel("分").getAttribute("aria-valuenow")).toBe("60");
  expect(wheel("分").scrollTop).toBe(30 * 44);
  fireEvent.keyDown(wheel("分"), { key: "End" });
  expect(wheel("分").getAttribute("aria-valuenow")).toBe("100000002");
  expect(wheel("秒").getAttribute("aria-valuemax")).toBe("0");
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onCommit).toHaveBeenCalledExactlyOnceWith(6000000120, { changed: true });
});

it("holds the original value/range across prop updates, even when confirming unchanged", () => {
  const p = dial();
  p.view.rerender(<TimeDial {...p} value={100} maxSeconds={5} />);
  expect(wheel("秒").getAttribute("aria-valuenow")).toBe("14");
  expect(wheel("分").getAttribute("aria-valuemax")).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onCommit).toHaveBeenCalledExactlyOnceWith(14.57, { changed: false });
});

it("validates without committing, then supports a fractional shortcut", () => {
  const p = dial({ validate: value => value < 100 ? "100秒以上にしてください。" : null,
    shortcut: { label: "曲の終わり", seconds: 130.8 } });
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(screen.getByRole("alert").textContent).toBe("100秒以上にしてください。"); expect(p.onCommit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "曲の終わり" }));
  fireEvent.click(screen.getByRole("button", { name: "決定" }));
  expect(p.onCommit).toHaveBeenCalledExactlyOnceWith(130.8, { changed: true });
});

it.each(["fallback", "native"])("blocks background/Tab and restores focus on %s", mode => {
  if (mode === "native") {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
  } else Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: undefined });
  const background = document.createElement("button"); const clicked = vi.fn(); background.onclick = clicked;
  document.body.append(background); background.focus();
  const p = dial();
  expect(background.inert).toBe(true); expect(document.activeElement).toBe(wheel("分"));
  fireEvent.click(background); expect(clicked).not.toHaveBeenCalled();
  fireEvent.keyDown(wheel("分"), { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "決定" }));
  fireEvent.keyDown(document.activeElement!, { key: "Tab" }); expect(document.activeElement).toBe(wheel("分"));
  fireEvent.keyDown(wheel("分"), { key: "Escape" }); expect(p.onCancel).toHaveBeenCalledOnce(); expect(p.onCommit).not.toHaveBeenCalled();
  p.view.unmount(); expect(document.activeElement).toBe(background); expect(background.inert).not.toBe(true); background.remove();
});
