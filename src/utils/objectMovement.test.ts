import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { ObjectState } from "../types";
import { constrainObjectCenterPosition, constrainObjectPosition } from "./coordinates";
import { isObjectOutsideStage, rotatedObjectHalfExtents } from "./objectGeometry";
import { alignedObjectPosition, constrainObjectMovePatch, snapObjectAxis, snapObjectPosition } from "./objectMovement";
import { rotatedObjectBounds } from "./formationExportLayout";
import { snapPastedObjectPosition } from "./placementGrid";
import { snapPositionInBounds } from "./positionGrid";
import { normalizeProject } from "../project/normalizeProject";
import { decodeProjectJson, serializeProject } from "../project/codec";
import { createSharedDocument } from "../collaboration/model";
import { assertFullState } from "../collaboration/serverSchema2";
import { applyObjectAppearance } from "../project/objectAppearance";

const stage = { ...createSampleProject().stage, widthMeters: 9, depthMeters: 5.5,
  originMode: "center" as const, horizontalGuideMode: "centerSplit" as const, gridSizeMeters: 0.5, showGrid: true };
const tool = (patch: Partial<ObjectState> = {}): ObjectState => ({ objectId: "o_test", x: 0, y: 2,
  widthMeters: 3, heightMeters: 0.5, rotation: 90.41, visible: true, zIndex: 10, ...patch });
const edge = (state: ObjectState, position: { x: number; y: number }, axis: "left" | "right" | "top" | "bottom", expected: number) =>
  expect(Math.abs(rotatedObjectBounds({ ...state, ...position })[axis] - expected)).toBeLessThanOrEqual(0.001);

describe("rotated tool geometry and movement", () => {
  it.each([
    [0, 1.5, .25], [90, .25, 1.5], [90.41, .260727276, 1.50175048],
    [45, 1.237436867, 1.237436867], [180, 1.5, .25], [-90, .25, 1.5], [450, .25, 1.5],
  ])("half extents at %s degrees", (rotation, halfWidth, halfHeight) => {
    const result = rotatedObjectHalfExtents(tool({ rotation }));
    expect(result.halfWidth).toBeCloseTo(halfWidth, 6);
    expect(result.halfHeight).toBeCloseTo(halfHeight, 6);
  });
  it.each([NaN, Infinity, -Infinity])("never throws on malformed saved geometry (render paths): %s", bad => {
    expect(rotatedObjectHalfExtents(tool({ rotation: bad }))).toEqual(rotatedObjectHalfExtents(tool({ rotation: 0 })));
    for (const key of ["widthMeters", "heightMeters"] as const) {
      const { halfWidth, halfHeight } = rotatedObjectHalfExtents(tool({ [key]: bad }));
      expect(Number.isFinite(halfWidth) && Number.isFinite(halfHeight)).toBe(true);
    }
    expect(() => constrainObjectPosition({ x: bad, y: 0 }, tool(), stage)).not.toThrow();
    const { x, y } = constrainObjectMovePatch(tool(), { x: 1, rotation: bad }, stage);
    const zero = constrainObjectMovePatch(tool(), { x: 1, rotation: 0 }, stage);
    expect({ x, y }).toEqual({ x: zero.x, y: zero.y });
  });
  it("keeps valid positions, rounds to mm and remains idempotent including exact edges", () => {
    expect(constrainObjectPosition({ x: -1, y: 2.12345 }, tool(), stage)).toEqual({ x: -1, y: 2.123 });
    for (const rotation of [0, 90, 90.41, 45, 180, -90, 450]) {
      for (const widthMeters of [1.2, 3, 20, 1.2345]) for (const x of [-100, -1, .12345, 100]) {
        const state = tool({ rotation, widthMeters });
        const p = constrainObjectPosition({ x, y: x }, state, stage);
        expect(constrainObjectPosition(p, state, stage)).toEqual(p);
        const center = { x: p.x + widthMeters / 2, y: p.y + state.heightMeters / 2 };
        const c = constrainObjectCenterPosition(center, state, stage);
        expect(constrainObjectCenterPosition(c, state, stage)).toEqual(c);
      }
    }
  });
  it.each([0, 45, 90])("aligns oversized axes to the left/top at %s degrees", rotation => {
    const state = tool({ widthMeters: 30, heightMeters: 20, rotation });
    for (const n of [-100, 100]) {
      const p = constrainObjectPosition({ x: n, y: n }, state, stage);
      edge(state, p, "left", 0); edge(state, p, "top", 0);
    }
  });
  it.each([
    tool(), tool({ widthMeters: .5, heightMeters: 3, rotation: -.335, x: 8.5, y: .75 }),
    tool({ widthMeters: 1.2, heightMeters: .5, rotation: 0 }),
  ])("reported regression and fractional unrotated size reach all four edges: %j", state => {
    for (const [axis, x, y, expected] of [["left", -100, 2, 0], ["right", 100, 2, 9],
      ["top", 2, -100, 0], ["bottom", 2, 100, 5.5]] as const) {
      const p = snapObjectPosition({ x, y }, state, stage, .25, { x: 5, y: 5.5 }, "center");
      edge(state, p, axis, expected);
      expect(constrainObjectPosition(p, state, stage)).toEqual(p);
    }
  });
  it("chooses the nearest tool edge or grid candidate while member snapping stays unchanged", () => {
    expect(snapObjectAxis(.02, .25, .13, 0, 1.64)).toBe(0);
    expect(snapObjectAxis(.14, .25, .13, 0, 1.64)).toBe(.13);
    expect(snapObjectAxis(100, .25, .13, 0, 1.64)).toBe(1.64);
    expect(snapObjectAxis(.07, .25, .13, 0, .1)).toBe(.1);
    expect(snapObjectAxis(.071, NaN, .13, 0, .1)).toBe(.071);
    expect(snapPositionInBounds(-100, .25, .13, 0, 1.64)).toBe(.13);
    expect(snapPositionInBounds(100, .25, .13, 0, 1.64)).toBe(1.63);
  });
  it("parade dragging and pasting use top-left lattice, rotation and backward distance", () => {
    const parade = { ...createSampleProject().paradeSettings!, width: 9, totalDistance: 10.13, backwardDistanceMeters: 2.31 };
    const limits = { ...stage, depthMeters: 12.44 };
    const state = tool();
    for (const [axis, x, y, expected] of [["left", -100, 2, 0], ["right", 100, 2, 9],
      ["top", 2, -100, 0], ["bottom", 2, 100, 12.44]] as const) {
      edge(state, snapObjectPosition({ x, y }, state, limits, .25, { x: 5, y: 10.13 }, "topLeft"), axis, expected);
      edge(state, snapPastedObjectPosition({ x, y }, state, limits, parade), axis, expected);
    }
    expect(snapObjectPosition({ x: 2.12, y: 3.25 }, state, limits, .25, { x: 5, y: 10.13 }, "topLeft"))
      .toEqual({ x: 2, y: 3.13 });
  });
  it("aligns rotated outer edges and preserves center alignment", () => {
    const state = tool();
    for (const [action, axis, n] of [["objectLeft", "left", 0], ["objectRight", "right", 9],
      ["objectTop", "top", 0], ["objectBottom", "bottom", 5.5]] as const)
      edge(state, alignedObjectPosition(state, action, stage), axis, n);
    expect(alignedObjectPosition(state, "objectStageCenter", stage)).toEqual({ x: 3, y: 2.5 });
  });
  it("preserves compound move patches and does not constrain rotation-only or dimension-only changes", () => {
    const patch = { x: -100, y: 100, widthMeters: 4, heightMeters: .8, rotation: 90, visible: false, zIndex: 42 };
    const next = constrainObjectMovePatch(tool(), patch, stage);
    expect(next).toEqual({ ...patch, x: -1.6, y: 3.1 });
    expect(constrainObjectMovePatch(tool(), { x: -100, rotation: undefined }, stage).x).toBe(-1.239);
    const outside = tool({ x: -9, y: -8 });
    expect(constrainObjectMovePatch(outside, { rotation: 45 }, stage)).toEqual({ rotation: 45 });
    expect(constrainObjectMovePatch(outside, { widthMeters: 2 }, stage)).toEqual({ widthMeters: 2 });
  });
  it("roster resize keeps the center anchor and admits negative corner coordinates", () => {
    const p = createSampleProject(), id = p.stageObjects[0].id;
    p.frames = [{ ...p.frames[0], objectStates: { [id]: tool({ objectId: id, rotation: 90, x: -1, widthMeters: 3 }) } }];
    const next = applyObjectAppearance(p, id, { widthMeters: 4 });
    expect(next.frames[0].objectStates[id].x).toBe(-1.5);
  });
  it("negative saved corners pass the unchanged codec, normalization and collaboration schema", () => {
    const p = createSampleProject(), id = p.stageObjects[0].id;
    p.stage = stage;
    p.frames[0].objectStates[id] = tool({ objectId: id, x: -1.239, y: -1.25, rotation: 90 });
    const normalized = normalizeProject(p);
    expect(normalized.frames[0].objectStates[id]).toEqual(p.frames[0].objectStates[id]);
    const encoded = serializeProject(normalized); expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw encoded.error;
    const decoded = decodeProjectJson(encoded.value); expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw decoded.error;
    expect(decoded.value.frames[0].objectStates[id]).toEqual(p.frames[0].objectStates[id]);
    const doc = createSharedDocument(normalized);
    try { expect(() => assertFullState(doc)).not.toThrow(); } finally { doc.destroy(); }
  });
  it("does not warn about valid negative or millimeter-rounded corners, but detects real rotated overflow", () => {
    const state = tool();
    for (const x of [-100, 100]) {
      const moved = { ...state, ...constrainObjectPosition({ x, y: 2 }, state, stage) };
      expect(isObjectOutsideStage(moved, stage)).toBe(false);
    }
    expect(isObjectOutsideStage({ ...state, x: -1.26 }, stage)).toBe(true);
    // The reported tool A overhangs ~9mm from its -0.335° hand rotation: invisible, so not warned (under 1cm).
    expect(isObjectOutsideStage(tool({ widthMeters: .5, heightMeters: 3, rotation: -.335, x: 8.5, y: .75 }), stage)).toBe(false);
    expect(isObjectOutsideStage(tool({ widthMeters: .5, heightMeters: 3, rotation: -.335, x: 8.52, y: .75 }), stage)).toBe(true);
  });
});
