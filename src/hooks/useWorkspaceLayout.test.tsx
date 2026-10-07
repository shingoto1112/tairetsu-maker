/* @vitest-environment jsdom */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
const runtime = vi.hoisted(() => vi.fn(() => "capacitor-ios"));
vi.mock("../platform/runtime", () => ({ getAppRuntime: runtime }));
const Harness = () => {
  const layout = useWorkspaceLayout();
  return <><input aria-label="first" /><input aria-label="second" /><output>{JSON.stringify(layout)}</output></>;
};
let viewport: EventTarget & { height: number; scale: number };
let media: EventTarget & { matches: boolean };
const flush = (ms = 25) => act(() => { vi.advanceTimersByTime(ms); });
const state = () => JSON.parse(screen.getByRole("status").textContent!);
const focus = (name = "first") => act(() => { screen.getByRole("textbox", { name }).focus(); });
const blur = () => act(() => { (document.activeElement as HTMLElement).blur(); });
const resize = (height: number) => act(() => { viewport.height = height; viewport.dispatchEvent(new Event("resize")); });
const open = () => { focus(); resize(834); flush(); expect(state()).toEqual({ isPortrait: true, height: 834, keyboardOpen: true }); };
beforeEach(() => {
  vi.useFakeTimers(); runtime.mockReturnValue("capacitor-ios");
  viewport = Object.assign(new EventTarget(), { height: 1194, scale: 1 });
  media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 1194);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("native portrait keyboard state", () => {
  it("opens and closes while input focus remains", () => {
    render(<Harness />); open(); resize(1194); flush();
    expect(state()).toEqual({ isPortrait: true, keyboardOpen: false });
  });
  it.each([1194, 834])("clears on blur without a final resize, even when height stays %i", height => {
    render(<Harness />); open(); viewport.height = height; blur(); flush(400);
    expect(state()).toEqual({ isPortrait: true, keyboardOpen: false });
    act(() => window.dispatchEvent(new Event("resize"))); flush(400);
    expect(state().keyboardOpen).toBe(false);
  });
  it("remeasures on focusin without a viewport event", () => {
    render(<Harness />); viewport.height = 834; focus(); flush(); expect(state().keyboardOpen).toBe(true);
  });
  it("keeps shrinking when focus is retained and transfers directly between inputs", () => {
    render(<Harness />); open(); blur(); flush(40); focus("second"); flush(400);
    expect(state().height).toBe(834);
    resize(834); flush(400); expect(state().keyboardOpen).toBe(true);
  });
  it("clears in landscape, then measures again when rotating to portrait", () => {
    render(<Harness />); open();
    act(() => { media.matches = false; window.dispatchEvent(new Event("orientationchange")); }); flush();
    expect(state()).toEqual({ isPortrait: false, keyboardOpen: false });
    act(() => { media.matches = true; viewport.height = 1194; media.dispatchEvent(new Event("change")); }); flush(400);
    expect(state()).toEqual({ isPortrait: true, keyboardOpen: false });
  });
  it.each(["pageshow", "visibilitychange", "resize", "orientationchange"])("recovers on %s including a late viewport recovery", event => {
    render(<Harness />); open();
    act(() => { (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event)); }); flush();
    viewport.height = 1194; flush(300); expect(state().keyboardOpen).toBe(false);
  });
  it("does not treat zoom or an unfocused viewport as a keyboard", () => {
    render(<Harness />); resize(834); flush(); expect(state().keyboardOpen).toBe(false);
    viewport.scale = 1.4; focus(); flush(); expect(state().keyboardOpen).toBe(false);
    viewport.scale = 1; resize(1035); flush(); expect(state().keyboardOpen).toBe(false);
    resize(1034); flush(); expect(state().keyboardOpen).toBe(true);
  });
  it.each(["checkbox", "range", "button", "date"])("ignores %s focus", type => {
    render(<Harness />); const element = document.createElement("input"); element.type = type; document.body.append(element);
    act(() => element.focus()); resize(834); flush(); expect(state().keyboardOpen).toBe(false); element.remove();
  });
  it.each(["text", "search", "number", "email", "password", "tel", "url", "textarea", "contenteditable"])("accepts editable %s", type => {
    render(<Harness />);
    const element = document.createElement(type === "textarea" ? "textarea" : type === "contenteditable" ? "div" : "input");
    if (element instanceof HTMLInputElement) element.type = type;
    if (type === "contenteditable") { element.tabIndex = 0; element.contentEditable = "true"; Object.defineProperty(element, "isContentEditable", { value: true }); }
    document.body.append(element); act(() => element.focus()); resize(834); flush(); expect(state().keyboardOpen).toBe(true); element.remove();
  });
  it("ignores readonly and disabled inputs", () => {
    render(<Harness />); const element = screen.getByRole("textbox", { name: "first" }) as HTMLInputElement;
    element.readOnly = true; focus(); resize(834); flush(); expect(state().keyboardOpen).toBe(false);
    element.readOnly = false; element.disabled = true; resize(834); flush(); expect(state().keyboardOpen).toBe(false);
  });
  it("cleans up pending callbacks on unmount", () => {
    const view = render(<Harness />); open(); blur(); view.unmount(); flush(1000); expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces event bursts and retains the same state object for unchanged measurements", () => {
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useWorkspaceLayout(); });
    flush(400); const initial = result.current; const count = renders;
    act(() => { for (let i = 0; i < 20; i++) window.dispatchEvent(new Event("resize")); });
    flush(400); expect(result.current).toBe(initial); expect(renders).toBe(count);
  });
});
it.each(["web", "tauri"])("%s never couples workspace height or keyboard flags to visualViewport", value => {
  runtime.mockReturnValue(value); render(<Harness />); focus(); resize(834); flush(400);
  expect(state()).toEqual({ isPortrait: true, keyboardOpen: false });
  blur(); flush(400); expect(state().keyboardOpen).toBe(false);
});
