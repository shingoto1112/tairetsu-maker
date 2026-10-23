import { expect, it } from "vitest";
import type { AnnotationLine, ObjectState, StageConfig } from "../types";
import { createSampleProject } from "../sampleProject";
import { isStageViewRotated180 } from "./stageOrientation";
import { clientPointToMeters, displayPointToStagePoint, stagePointToDisplayPoint } from "./coordinates";
import { getKeyboardNudgeDelta } from "./keyboardNudge";
import { createStageExportView } from "./stageExportView";
import { horizontalRulerSide } from "./verticalGrid";
import { selectionScrollBounds } from "./selectionScrollBounds";

// Hand-calculated for a 10 x 6 stage and internal point (2, 1).
export const orientationCases = [
  ["top", undefined, "performer", false, 2, 1, "top", .25],
  ["top", undefined, "audience", true, 8, 5, "bottom", -.25],
  ["bottom", undefined, "performer", true, 8, 5, "top", -.25],
  ["bottom", undefined, "audience", false, 2, 1, "bottom", .25],
  ["left", "top", "performer", true, 8, 5, "top", -.25],
  ["left", "top", "audience", false, 2, 1, "bottom", .25],
  ["right", "top", "performer", true, 8, 5, "top", -.25],
  ["right", "top", "audience", false, 2, 1, "bottom", .25],
  [undefined, "top", "performer", false, 2, 1, "top", .25],
  [undefined, "top", "audience", true, 8, 5, "bottom", -.25],
  [undefined, undefined, "performer", true, 8, 5, "top", -.25],
  [undefined, undefined, "audience", false, 2, 1, "bottom", .25],
  ["top", "bottom", "performer", false, 2, 1, "top", .25],
  ["top", "bottom", "audience", true, 8, 5, "bottom", -.25],
  ["bottom", "top", "performer", true, 8, 5, "top", -.25],
  ["bottom", "top", "audience", false, 2, 1, "bottom", .25],
] as const;

it.each(orientationCases)("front=%s fallback=%s view=%s: independent positions, zero and round trips", (frontDirection, audienceSide, perspective, rotated, x, y, side, deltaX) => {
  const p = createSampleProject();
  // Cast represents legacy JSON whose required modern audienceSide may be absent.
  const stage = { ...p.stage, widthMeters: 10, depthMeters: 6, memberDiameterMeters: .5, frontDirection, audienceSide } as StageConfig;
  const point = { x: 2, y: 1 }, expected = { x, y };
  const original = structuredClone(stage);
  expect(isStageViewRotated180(stage, perspective)).toBe(rotated);
  expect(stagePointToDisplayPoint(point, stage, perspective)).toEqual(expected);
  expect(displayPointToStagePoint(expected, stage, perspective)).toEqual(point);
  expect(displayPointToStagePoint(stagePointToDisplayPoint(point, stage, perspective), stage, perspective)).toEqual(point);
  const view = createStageExportView(stage, stage, perspective);
  expect(view.point(point)).toEqual(expected);
  expect(view.verticalLabels.find(l => l.label === "0m")?.positionMeters).toBe(side === "top" ? 0 : 6);
  expect(horizontalRulerSide(stage, perspective)).toBe(side);
  const state: ObjectState = { objectId: "prop", x: 2, y: 1, widthMeters: 2, heightMeters: 1, rotation: 37, visible: true, zIndex: 3 };
  const rectangle = view.object(state);
  expect(rectangle).toEqual({ ...state, x: rotated ? 6 : 2, y: rotated ? 4 : 1 });
  expect(view.object(rectangle)).toEqual(state);
  const lines: Record<string, AnnotationLine> = { a: { x1: 2, y1: 1, x2: 4, y2: 3, color: "red", dash: "solid" } };
  expect(view.annotations(view.annotations(lines))).toEqual(lines);
  const delta = getKeyboardNudgeDelta({ key: "ArrowRight" } as KeyboardEvent, perspective, .5, stage)!;
  expect(delta.x).toBe(deltaX);
  const moved = stagePointToDisplayPoint({ x: point.x + delta.x, y: point.y + delta.y }, stage, perspective);
  expect({ x: moved.x - expected.x, y: moved.y - expected.y }).toEqual({ x: .25, y: 0 });
  // The same rotation is its inverse for a displacement.
  const reverseDelta = getKeyboardNudgeDelta({ key: delta.x > 0 ? "ArrowRight" : "ArrowLeft" } as KeyboardEvent, perspective, .5, stage)!;
  expect(reverseDelta.x).toBe(.25);
  const element = { getBoundingClientRect: () => ({ left: 100, top: 200, width: 1000, height: 600 }) } as HTMLElement;
  expect(clientPointToMeters(100 + x * 100, 200 + y * 100, element, stage, perspective)).toEqual(point);
  p.stage = stage; p.frames[0].objectStates.prop = state;
  const square = { ...state, rotation: 0 };
  expect(selectionScrollBounds(p, { positions: {}, objectStates: { prop: square }, memberVisibility: {}, memberAppearanceOverrides: {} }, "object", "prop", stage, perspective))
    .toEqual({ x: rotated ? 6 : 2, y: rotated ? 4 : 1, widthMeters: 2, heightMeters: 1, minimumScroll: true });
  expect(stage).toEqual(original);
});

it.each(orientationCases)("parade never rotates (%s/%s/%s)", (frontDirection, audienceSide, perspective) => {
  const stage = { ...createSampleProject().stage, widthMeters: 10, depthMeters: 6, frontDirection, audienceSide } as StageConfig;
  expect(isStageViewRotated180(stage, perspective, true)).toBe(false);
  expect(createStageExportView(stage, stage, perspective, true).point({ x: 2, y: 1 })).toEqual({ x: 2, y: 1 });
  expect(horizontalRulerSide(stage, perspective, true)).toBe("top");
  expect(getKeyboardNudgeDelta({ key: "ArrowRight" } as KeyboardEvent, perspective, .5, stage, true)?.x).toBe(.25);
});
