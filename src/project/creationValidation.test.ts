import { expect, it } from "vitest";
import { creationNumberError } from "./creationValidation";

it("A7: validates finite bounds without imposing a new step or rounding values", () => {
  for (const value of [NaN, Infinity, -Infinity, .199]) expect(creationNumberError(value, "直径", .2, 1)).toBeTruthy();
  expect(creationNumberError(1.001, "直径", .2, 1)).toContain("1以下");
  for (const value of [.2, .237, 1]) expect(creationNumberError(value, "直径", .2, 1)).toBeUndefined();
  expect(creationNumberError(1000, "幅", 1)).toBeUndefined();
});
