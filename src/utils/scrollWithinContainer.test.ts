// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { scrollWithinContainer } from "./scrollWithinContainer";
import { restoreAppShellScroll } from "../hooks/useAppShellScrollGuard";
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("scrolls only the nearest list, accounting for sticky padding, never document/outer owners", () => {
  document.body.innerHTML = '<div class="app-shell" style="overflow-y:auto"><div id="list" style="overflow-y:auto;scroll-padding-top:40px"><div id="target"></div></div></div>';
  const list = document.getElementById("list")!, target = document.getElementById("target")!;
  Object.defineProperties(list, { clientHeight: { value: 200 }, scrollHeight: { value: 1000 } });
  list.scrollTop = 100;
  list.getBoundingClientRect = () => ({ top: 50 } as DOMRect);
  target.getBoundingClientRect = () => ({ top: 500, bottom: 540 } as DOMRect);
  list.scrollTo = vi.fn(); const root = document.documentElement; root.scrollTo = vi.fn();
  scrollWithinContainer(target, { block: "center", behavior: "instant" });
  expect(list.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: "instant" });
  expect(root.scrollTo).not.toHaveBeenCalled();
  scrollWithinContainer(document.querySelector(".app-shell"));
  expect(root.scrollTo).not.toHaveBeenCalled();
});
it("preserves keyboard input scroll, then restores the app document on blur", () => {
  document.body.innerHTML = '<div class="app-shell"><input /></div>';
  Object.defineProperty(document, "scrollingElement", { configurable: true, value: document.documentElement });
  document.documentElement.scrollTop = 66;
  document.querySelector("input")!.focus(); restoreAppShellScroll();
  expect(document.documentElement.scrollTop).toBe(66);
  document.querySelector("input")!.blur(); restoreAppShellScroll();
  expect(document.documentElement.scrollTop).toBe(0);
});
it("waits for the keyboard viewport to recover even after the input loses focus", () => {
  document.body.innerHTML = '<div class="app-shell"></div>';
  Object.defineProperty(document, "scrollingElement", { configurable: true, value: document.documentElement });
  const viewport = { height: window.innerHeight - 200, offsetTop: 0 };
  vi.stubGlobal("visualViewport", viewport);
  document.documentElement.scrollTop = 66; document.documentElement.scrollLeft = 20;
  restoreAppShellScroll(); expect(document.documentElement.scrollTop).toBe(66);
  viewport.height = window.innerHeight;
  restoreAppShellScroll(); expect(document.documentElement.scrollTop).toBe(0); expect(document.documentElement.scrollLeft).toBe(0);
});
