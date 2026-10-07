import { expect, it } from "vitest";
import { autoSaveDelay } from "./autoSaveSchedule";
it("caps debounce postponement at the first-edit deadline", () => {
  expect(autoSaveDelay(1000, 1000)).toBe(800);
  expect(autoSaveDelay(1000, 5900)).toBe(100);
  expect(autoSaveDelay(1000, 6100)).toBe(0);
});
