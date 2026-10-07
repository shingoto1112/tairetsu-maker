// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { startApplication } from "./startup";
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; localStorage.clear(); });
it("catches import/initialization rejection before React and renders a safe Japanese reload screen", async () => {
  await expect(startApplication(async () => { throw new Error("secret-token-url"); })).resolves.toBeUndefined();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("起動できませんでした");
  expect(document.querySelector("button")?.textContent).toBe("再読み込み");
  expect(document.body.textContent).not.toContain("secret-token-url");
  expect(localStorage.getItem("tairetsu.diagnostics.v1")).toContain("runtime");
});
it("does not show a fallback on success", async () => {
  const mount = vi.fn().mockResolvedValue(undefined); await startApplication(mount);
  expect(mount).toHaveBeenCalledOnce(); expect(document.querySelector("button")).toBeNull();
});
