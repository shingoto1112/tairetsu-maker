// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioTimeDial } from "./AudioTimeDial";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const dial = (overrides: Partial<Parameters<typeof AudioTimeDial>[0]> = {}) => {
  const props = { label: "終了", edge: "end" as const, value: 90.8, duration: 210.845057, otherTime: 0, onCommit: vi.fn(), onCancel: vi.fn(), ...overrides };
  const view = render(<AudioTimeDial {...props} />); return { ...props, view };
};
const wheel = (name: string) => screen.getByRole("spinbutton", { name });
describe("loop time dial", () => {
  it("aligns two 44px wheels without initial confirmation, with named selected values", () => {
    const p = dial();
    expect(wheel("分").scrollTop).toBe(44); expect(wheel("秒").scrollTop).toBe(30 * 44);
    expect(wheel("分").getAttribute("aria-valuenow")).toBe("1");
    expect(wheel("秒").getAttribute("aria-valuetext")).toBe("30秒");
    fireEvent.scroll(wheel("分")); fireEvent(wheel("分"), new Event("scrollend"));
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    expect(p.onCommit).toHaveBeenCalledWith(90.8);
  });
  it("supports arrows and limits seconds in the final minute", () => {
    const p = dial({ value: 179 });
    fireEvent.keyDown(wheel("分"), { key: "ArrowUp" });
    expect(wheel("分").getAttribute("aria-valuenow")).toBe("3");
    expect(wheel("秒").getAttribute("aria-valuemax")).toBe("30");
    expect(wheel("秒").getAttribute("aria-valuenow")).toBe("30");
    fireEvent.keyDown(wheel("秒"), { key: "ArrowUp" });
    fireEvent.keyDown(wheel("秒"), { key: "ArrowDown" });
    expect(wheel("秒").getAttribute("aria-valuenow")).toBe("29");
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    expect(p.onCommit).toHaveBeenCalledWith(209);
  });
  it("selects the exact fractional end, and rejects start >= end", () => {
    const p = dial(); fireEvent.click(screen.getByRole("button", { name: "曲の終わり" }));
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    expect(p.onCommit).toHaveBeenCalledWith(210.845057);
    cleanup(); const start = dial({ edge: "start", otherTime: 100 });
    fireEvent.click(screen.getByRole("button", { name: "曲の終わり" })); fireEvent.click(screen.getByRole("button", { name: "決定" }));
    expect(screen.getByRole("alert").textContent).toBe("開始は終了より前にしてください。");
    expect(start.onCommit).not.toHaveBeenCalled();
  });
  it("rejects equal endpoints and lets VoiceOver users adjust through named buttons", () => {
    const p = dial({ value: 60, otherTime: 60 });
    fireEvent.click(screen.getByRole("button", { name: "決定" })); expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "秒を1増やす" }));
    expect(wheel("秒").getAttribute("aria-valuenow")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "決定" })); expect(p.onCommit).toHaveBeenCalledWith(61);
  });
  it.each(["debounce", "scrollend", "confirm"])("settles scrolling using %s without committing until 決定", method => {
    vi.useFakeTimers(); const p = dial();
    wheel("秒").scrollTop = 35 * 44; fireEvent.scroll(wheel("秒"));
    if (method === "debounce") act(() => vi.advanceTimersByTime(150));
    if (method === "scrollend") fireEvent(wheel("秒"), new Event("scrollend"));
    if (method !== "confirm") expect(wheel("秒").getAttribute("aria-valuenow")).toBe("35");
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "決定" })); expect(p.onCommit).toHaveBeenCalledWith(95);
  });
  it("clamps wheel ranges at zero and an exact minute end; cancels without writes", () => {
    const p = dial({ value: 0, duration: 120 });
    fireEvent.keyDown(wheel("分"), { key: "ArrowDown" }); expect(wheel("分").getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(wheel("分"), { key: "End" }); expect(wheel("秒").getAttribute("aria-valuemax")).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(p.onCancel).toHaveBeenCalledOnce(); expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true })); expect(p.onCancel).toHaveBeenCalledTimes(2);
  });
});
