/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelResizeHandle } from "../components/PanelResizeHandle";
import { PORTRAIT_PANEL_KEY, portraitPanelBounds, readPortraitPanelRatio, usePortraitPanelHeight } from "./usePortraitPanelHeight";

const Harness = ({ portrait = true, keyboard = false }) => {
  const ref = useRef<HTMLElement>(null);
  const control = usePortraitPanelHeight(ref, portrait, keyboard);
  return <div className="workspace"><aside ref={ref}><PanelResizeHandle control={control} /></aside></div>;
};
const height = () => parseFloat(document.querySelector("aside")!.style.getPropertyValue("--portrait-panel-height"));
const pointer = (kind: "down" | "move" | "up" | "cancel", y: number, id = 1) => {
  const element = screen.getByRole("separator");
  const event = new MouseEvent(`pointer${kind}`, { bubbles: true, button: 0, clientY: y, clientX: 10 });
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: id === 1 } });
  fireEvent(element, event);
  act(() => vi.advanceTimersByTime(20));
};

describe("portrait panel height", () => {
  beforeEach(() => {
    vi.useFakeTimers(); localStorage.clear();
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: vi.fn(() => true) });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it.each([200, 500, 800, 2000])("preserves stage minimum and height boundaries for H=%s", (h) => {
    const limits = portraitPanelBounds(h, 8);
    expect(limits.max).toBeLessThanOrEqual(h * 0.65);
    expect(limits.max).toBeLessThanOrEqual(h - 8 - Math.min(320, h * 0.35));
    expect(limits.min).toBe(Math.min(280, limits.max));
    expect(limits.defaultHeight).toBeGreaterThanOrEqual(limits.min);
    expect(limits.defaultHeight).toBeLessThanOrEqual(Math.min(460, limits.max));
  });
  it.each([[200, 122], [500, 317], [800, 320], [1008, 403.2], [1061, 424.4], [1108, 443.2], [1138, 455.2], [1294, 460], [1304, 460], [2000, 460]])(
    "uses the bounded 0.40 initial height for workspace H=%s", (h, expected) => {
      expect(portraitPanelBounds(h, 8).defaultHeight).toBeCloseTo(expected);
    },
  );
  it.each([null, 'broken', '{"version":2,"ratio":0.4}', '{"version":1,"ratio":"0.4"}', '{"version":1,"ratio":0}', '{"version":1,"ratio":0.8}', '{"version":1,"ratio":1e999}'])("rejects invalid storage %s", (raw) => {
    if (raw !== null) localStorage.setItem(PORTRAIT_PANEL_KEY, raw);
    expect(readPortraitPanelRatio()).toBeNull();
  });
  it("prioritizes a saved height below the new default until explicitly reset", () => {
    localStorage.setItem(PORTRAIT_PANEL_KEY, '{"version":1,"ratio":0.36}');
    render(<Harness />); expect(height()).toBe(288);
    fireEvent.click(screen.getByRole("button", { name: "パネル高さを既定に戻す" }));
    expect(height()).toBe(320); expect(readPortraitPanelRatio()).toBeNull();
  });
  it("reads a valid ratio, clamps during drag, saves only on end and reloads", () => {
    localStorage.setItem(PORTRAIT_PANEL_KEY, '{"version":1,"ratio":0.5}');
    const view = render(<Harness />); expect(height()).toBe(400);
    pointer("down", 400); pointer("move", -500); expect(height()).toBe(512);
    expect(readPortraitPanelRatio()).toBe(0.5);
    pointer("up", -500); expect(readPortraitPanelRatio()).toBe(0.64);
    view.unmount(); render(<Harness />); expect(height()).toBe(512);
    pointer("down", 400); pointer("move", 900); expect(height()).toBe(280);
    pointer("up", 900); expect(readPortraitPanelRatio()).toBe(0.35);
  });
  it.each(["cancel", "lost", "second", "rotation"])("rolls back uncommitted movement for %s", (reason) => {
    render(<Harness />); const initial = height();
    pointer("down", 400); pointer("move", 300); expect(height()).toBe(initial + 100);
    if (reason === "cancel") pointer("cancel", 300);
    if (reason === "lost") fireEvent.lostPointerCapture(screen.getByRole("separator"));
    if (reason === "second") pointer("down", 300, 2);
    if (reason === "rotation") fireEvent(window, new Event("orientationchange"));
    expect(height()).toBe(initial); expect(localStorage.getItem(PORTRAIT_PANEL_KEY)).toBeNull();
    pointer("up", 300); expect(height()).toBe(initial);
  });
  it("implements separator arrows, Home/End, Enter and the explicit reset", () => {
    render(<Harness />); const separator = screen.getByRole("separator");
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(separator.getAttribute("aria-orientation")).toBe("horizontal"); expect(separator.tabIndex).toBe(0);
    fireEvent.keyDown(separator, { key: "ArrowUp" }); expect(height()).toBe(336);
    fireEvent.keyDown(separator, { key: "ArrowDown" }); expect(height()).toBe(320);
    expect(write).not.toHaveBeenCalled();
    fireEvent.keyDown(separator, { key: "End" }); expect(height()).toBe(512);
    fireEvent.keyDown(separator, { key: "Home" }); expect(height()).toBe(280);
    fireEvent.keyDown(separator, { key: "End" }); fireEvent.keyDown(separator, { key: "Enter" });
    expect(height()).toBe(320); expect(localStorage.getItem(PORTRAIT_PANEL_KEY)).toBeNull();
    fireEvent.keyDown(separator, { key: "End" }); fireEvent.click(screen.getByRole("button", { name: "パネル高さを既定に戻す" }));
    expect(height()).toBe(320); expect(separator.getAttribute("aria-valuenow")).toBe("320");
  });
  it("resets after two short nearby taps but retains the default ceiling only for default height", () => {
    render(<Harness />); fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    pointer("down", 400); pointer("up", 400); pointer("down", 402); pointer("up", 402);
    expect(height()).toBe(320); expect(readPortraitPanelRatio()).toBeNull();
    expect(portraitPanelBounds(2000, 8).max).toBeGreaterThan(460);
  });
  it("does not save keyboard values, suspends outside portrait and reapplies/clamps on return", () => {
    localStorage.setItem(PORTRAIT_PANEL_KEY, '{"version":1,"ratio":0.5}');
    const view = render(<Harness keyboard />);
    pointer("down", 400); pointer("move", 300); pointer("up", 300);
    expect(height()).toBe(500); expect(readPortraitPanelRatio()).toBe(0.5);
    fireEvent.click(screen.getByRole("button", { name: "パネル高さを既定に戻す" })); expect(readPortraitPanelRatio()).toBe(0.5);
    view.rerender(<Harness portrait={false} />); expect(Number.isNaN(height())).toBe(true);
    view.rerender(<Harness />); expect(height()).toBe(400);
  });
  it("falls back when storage access throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("unavailable"); });
    expect(readPortraitPanelRatio()).toBeNull(); render(<Harness />); expect(height()).toBe(320);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("unavailable"); });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" }); expect(height()).toBe(512);
  });
});
