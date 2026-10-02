import { describe, expect, it, vi } from "vitest";
import type { FormationFrame } from "../types";
import { confirmAssignmentUpdate } from "./assignmentUpdate";

const before: FormationFrame = { id: "f", label: "1", timeSec: 0, objectStates: {}, positions: {}, objectAssignments: {} };
const patch = { objectAssignments: { o: ["m"] }, memberVisibility: { m: false }, positions: before.positions };

describe("assignment update confirmation", () => {
  it("does not emit a success notice when updateProject rejects the recipe", () => {
    const notice = vi.fn();
    expect(confirmAssignmentUpdate(before, before, patch, notice)).toBe(false);
    expect(notice).not.toHaveBeenCalled();
  });
  it("does not acknowledge a different or missing frame/patch", () => {
    const notice = vi.fn();
    expect(confirmAssignmentUpdate(before, undefined, patch, notice)).toBe(false);
    expect(confirmAssignmentUpdate(before, { ...before }, undefined, notice)).toBe(false);
    expect(confirmAssignmentUpdate(before, { ...before, ...patch, objectAssignments: {} }, patch, notice)).toBe(false);
    expect(notice).not.toHaveBeenCalled();
  });
  it.each<Pick<FormationFrame, "objectAssignments" | "memberVisibility" | "positions">>([
    patch,
    { objectAssignments: {}, memberVisibility: patch.memberVisibility, positions: before.positions },
    { objectAssignments: { o: ["m", "m2"] }, memberVisibility: { m: false, m2: false }, positions: before.positions },
  ])("acknowledges the exact applied assignment/removal/previous-scene patch", (expected) => {
    const notice = vi.fn();
    expect(confirmAssignmentUpdate(before, { ...before, ...expected }, expected, notice)).toBe(true);
    expect(notice).toHaveBeenCalledOnce();
  });
});
