/* @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
const Harness = () => {
  const layout = useWorkspaceLayout();
  return <output>{JSON.stringify(layout)}</output>;
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps portrait layout while visualViewport shrinks for the keyboard", () => {
  const viewport = Object.assign(new EventTarget(), { height: 1194 });
  const media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 1194);
  render(<Harness />);
  act(() => { viewport.height = 694; viewport.dispatchEvent(new Event("resize")); });
  expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({ isPortrait: true, height: 694, keyboardOpen: true });
  act(() => { media.matches = false; media.dispatchEvent(new Event("change")); });
  expect(JSON.parse(screen.getByRole("status").textContent!).isPortrait).toBe(false);
});
