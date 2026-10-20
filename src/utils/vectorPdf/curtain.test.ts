import { expect, it } from "vitest";
import { vectorCurtainFixture, vectorPdfFixture } from "./fixture";
import { buildScenePage, CSS_PX_MM, curtainStripes, type Drawing } from "./model";
import { buildAssignmentDrawings, type AssignmentLayout } from "./assignmentModel";

function group(nodes: Drawing[], id: string): Extract<Drawing, { kind: "group" }> {
  for (const n of nodes) if (n.kind === "group") {
    if (n.id === id) return n;
    try { return group(n.children, id); } catch { /* next sibling */ }
  }
  throw new Error(`Missing ${id}`);
}

it.each(["audience", "performer"] as const)("keeps curtain stripes in the object's rotating local axes (%s)", viewerPerspective => {
  const p = vectorCurtainFixture(), before = JSON.stringify(p);
  const scene = buildScenePage(p, "s0", { viewerPerspective }, () => []);
  for (const [id, rotation] of [["panel", 0], ["curtain90", 90], ["curtain137", 137]] as const) {
    const object = group(scene.drawings, id), stripes = group(object.children, `${id}-stripes`);
    expect(object.rotation).toBe(rotation);
    expect(stripes.rotation).toBe(0);
    const base = object.children[0];
    expect(base).toMatchObject({ fill: p.stageObjects.find(o => o.id === id)!.color, opacity: 0x24 / 255, lineWidth: CSS_PX_MM });
    if (base.kind !== "shape") throw new Error("Missing base");
    expect(stripes.clip!.x).toBeCloseTo(base.x + CSS_PX_MM / 2);
    const [first, second] = stripes.children;
    expect(first).toMatchObject({ kind: "shape", x: stripes.clip!.x, width: 8 * CSS_PX_MM, opacity: .28, fill: "#ffffff" });
    if (first.kind !== "shape" || second.kind !== "shape") throw new Error("Missing stripes");
    expect(second.x - first.x).toBeCloseTo(16 * CSS_PX_MM);
    // Name counter-rotation must never rotate the curtain pattern.
    expect(object.children.indexOf(stripes)).toBeLessThan(object.children.findIndex(n => n.kind === "group" && n.id === `${id}-clip`));
  }
  expect(JSON.stringify(p)).toBe(before);
});

it("uses the assignment border origin and clips the last stripe and rounded corners", () => {
  const r = { x: 7, y: 9, width: 10, height: 5, radius: 1 }, b = 1.4 * CSS_PX_MM;
  const stripes = group(curtainStripes("test", r, b), "test-stripes");
  expect(stripes.clip).toEqual({ x: 7 + b, y: 9 + b, width: 10 - 2 * b, height: 5 - 2 * b, radius: 1 - b });
  const last = stripes.children[stripes.children.length - 1];
  expect(last.kind).toBe("shape");
  if (last.kind === "shape") expect(last.x + last.width).toBeGreaterThan(stripes.clip!.x + stripes.clip!.width);
  expect(curtainStripes("tiny", { x: 0, y: 0, width: b, height: b }, b)).toEqual([]);
});

it.each(["line", "custom"] as const)("prints %s exactly as the existing rectangle in both surfaces", shape => {
  const p = vectorPdfFixture(), f = p.frames[0];
  const layout: AssignmentLayout = { panel: { x: 200, y: 9, width: 72, height: 140 }, gridMm: 10, emptyText: [],
    entries: [{ objectId: "panel", object: { x: 210, y: 20, width: 40, height: 10 }, name: [], members: [] }] };
  f.objectAssignments = { panel: ["m0"] };
  layout.entries[0].members = [{ memberId: "m0", rect: { x: 220, y: 40, width: 8, height: 8 }, lines: [],
    shadow: { kind: "image", dataUrl: "shadow", x: 0, y: 0, width: 1, height: 1 } }];
  const scene = buildScenePage(p, "s0", {}, () => []), assignment = buildAssignmentDrawings(p, f, layout);
  p.stageObjects[0].shape = shape;
  expect(buildScenePage(p, "s0", {}, () => [])).toEqual(scene);
  expect(buildAssignmentDrawings(p, f, layout)).toEqual(assignment);
  p.stageObjects[0].shape = "curtain";
  const curtain = group(buildAssignmentDrawings(p, f, layout), "assignment-panel");
  expect(curtain.rotation).toBe(0);
  expect(group(curtain.children, "assignment-panel-stripes").clip!.x).toBeCloseTo(210 + 1.4 * CSS_PX_MM);
  p.stageObjects[0].shape = "unknown" as typeof shape;
  expect(() => buildScenePage(p, "s0", {}, () => [])).toThrow("unknown");
  expect(() => buildAssignmentDrawings(p, f, layout)).toThrow("unknown");
});
