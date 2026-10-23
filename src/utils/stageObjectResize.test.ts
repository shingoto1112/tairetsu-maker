import { expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { ObjectState } from "../types";
import { resizeStageObject } from "./stageObjectResize";

const state: ObjectState = { objectId: "prop", x: 2, y: 1, widthMeters: 2, heightMeters: 1, rotation: 0, visible: true, zIndex: 1 };
it.each([
  ["top", "performer", { x: 1, y: .5 }, { x: 2, y: 1 }],
  ["top", "audience", { x: -1, y: -.5 }, { x: 1, y: .5 }],
  ["bottom", "performer", { x: -1, y: -.5 }, { x: 1, y: .5 }],
  ["bottom", "audience", { x: 1, y: .5 }, { x: 2, y: 1 }],
] as const)("%s/%s: visible bottom-right grows right/down and anchors the opposite corner", (frontDirection, perspective, delta, origin) => {
  const stage = { ...createSampleProject().stage, frontDirection, showGrid: false };
  expect(resizeStageObject(state, delta, stage, perspective)).toEqual({ ...origin, widthMeters: 3, heightMeters: 1.5 });
  expect(resizeStageObject(state, { x: -delta.x, y: -delta.y }, stage, perspective))
    .toEqual({ x: origin.x === 1 ? 3 : 2, y: origin.y === .5 ? 1.5 : 1, widthMeters: 1, heightMeters: .5 });
});

it.each([
  ["top", "performer", { x: -.5, y: 1 }, 1.25, 1.25],
  ["bottom", "performer", { x: .5, y: -1 }, 1.75, .25],
] as const)("%s/%s: a 90 degree prop resizes along the visible prop axes", (frontDirection, perspective, delta, x, y) => {
  const stage = { ...createSampleProject().stage, frontDirection, showGrid: false };
  expect(resizeStageObject({ ...state, rotation: 90 }, delta, stage, perspective))
    .toEqual({ x, y, widthMeters: 3, heightMeters: 1.5 });
});

it("retains dimension snapping and the minimum size", () => {
  const stage = { ...createSampleProject().stage, frontDirection: "top" as const, gridSizeMeters: .5, showGrid: true };
  expect(resizeStageObject(state, { x: .62, y: .38 }, stage, "performer"))
    .toEqual({ x: 2, y: 1, widthMeters: 2.5, heightMeters: 1.5 });
  expect(resizeStageObject(state, { x: -10, y: -10 }, stage, "performer"))
    .toEqual({ x: 2, y: 1, widthMeters: .1, heightMeters: .1 });
});
