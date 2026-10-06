import { expect, it } from "vitest";
import { copyParadeGroupState } from "./paradeGroupReflection";
import type { FormationFrame } from "../types";
it("reflects only group members at zero movement, retaining other positions, visibility, colors and assignments", () => {
  const source: FormationFrame = { id: "a", label: "", timeSec: 0,
    positions: { a: { x: 1, y: 3 }, b: { x: 2, y: 4 } }, objectStates: {},
    memberVisibility: { a: false, b: false }, memberAppearanceOverrides: { b: { color: "red" } },
    objectAssignments: { flag: ["a", "b"] } };
  const target: FormationFrame = { id: "b", label: "", timeSec: 1,
    positions: { a: { x: 10, y: 30 }, b: { x: 20, y: 40 } }, objectStates: {},
    memberVisibility: { a: true, b: true }, memberAppearanceOverrides: { a: { color: "red" }, b: { color: "blue" } },
    objectAssignments: { chair: ["a", "b"] } };
  const before = structuredClone([source, target]);
  const result = copyParadeGroupState(source, target, new Set(["a"]));
  expect(result.positions).toEqual({ a: source.positions.a, b: target.positions.b });
  expect(result.memberVisibility).toEqual({ a: false, b: true });
  expect(result.memberAppearanceOverrides).toEqual({ b: { color: "blue" } });
  expect(result.objectAssignments).toEqual({ flag: ["a"], chair: ["b"] });
  expect([source, target]).toEqual(before);
});
