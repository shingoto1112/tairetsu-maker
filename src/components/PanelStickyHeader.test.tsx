// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PanelStickyHeader } from "./PanelStickyHeader";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("observes the panel as well as the header and cleans offsets/listeners on unmount", () => {
  let update!: ResizeObserverCallback;
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { update = callback; }
    observe = observe; disconnect = disconnect;
  });
  const { container, unmount } = render(<div className="tab-panel__content" style={{ paddingTop: 12 }}><PanelStickyHeader title="メンバー" /></div>);
  const panel = container.firstElementChild as HTMLElement;
  const header = panel.firstElementChild as HTMLElement;
  expect(observe.mock.calls.map(([node]) => node)).toEqual([header, panel]);
  header.style.position = "sticky";
  Object.defineProperty(header, "offsetHeight", { value: 55 });
  update([], {} as ResizeObserver);
  expect(header.style.top).toBe("-12px");
  expect(panel.style.getPropertyValue("--panel-sticky-height")).toBe("55px");
  panel.style.paddingTop = "14px";
  fireEvent(window, new Event("orientationchange")); expect(header.style.top).toBe("-14px");
  header.style.position = "static";
  fireEvent.resize(window); expect(header.style.top).toBe("");
  expect(panel.style.getPropertyValue("--panel-sticky-height")).toBe("0px");
  header.style.position = "sticky"; update([], {} as ResizeObserver);
  unmount(); expect(disconnect).toHaveBeenCalledOnce();
  expect(header.style.top).toBe(""); expect(panel.style.getPropertyValue("--panel-sticky-height")).toBe("");
  fireEvent.resize(window); expect(header.style.top).toBe("");
});
