// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { SceneThumbnailPreview } from "./SceneThumbnailPreview";
import type { Position, Project, ViewerPerspective } from "../types";

// jsdom has no SVG getCTM: evaluate every emitted rotation from child to parent.
const displayedPoint = (element: Element, point: Position): Position => {
  for (let node: Element | null = element; node?.tagName.toLowerCase() !== "svg" && node; node = node.parentElement) {
    const transform = node.getAttribute("transform");
    if (!transform) continue;
    const match = /^rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)$/.exec(transform);
    expect(match).not.toBeNull();
    const [angle, cx, cy] = match!.slice(1).map(Number);
    const radians = angle * Math.PI / 180, dx = point.x - cx, dy = point.y - cy;
    point = { x: cx + dx * Math.cos(radians) - dy * Math.sin(radians), y: cy + dx * Math.sin(radians) + dy * Math.cos(radians) };
  }
  return point;
};
const expectPoint = (actual: Position, expected: Position) => {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
};
const asymmetricProject = (): Project => {
  const project = createSampleProject();
  project.stage = { ...project.stage, widthMeters: 9, depthMeters: 5.5 };
  project.members = [{ id: "member", name: "架空", color: "#112233" }];
  project.memberGroups = [];
  const object = project.stageObjects[0];
  project.stageObjects = [{ ...object, id: "prop", color: "#456789", shape: "rectangle" }];
  project.frames = [{ ...project.frames[0], positions: { member: { x: 1.25, y: .75 } }, memberVisibility: {}, objectAssignments: {},
    objectStates: { prop: { objectId: "prop", x: -1.239, y: 2, widthMeters: 3, heightMeters: .5, rotation: 90.41, visible: true, zIndex: 1 } },
    annotationLines: { diagonal: { x1: 1, y1: .5, x2: 3, y2: 2, color: "red", dash: "dashed" } } }];
  return project;
};

afterEach(cleanup);
describe("scene preview rendering", () => {
  it.each(["audience", "performer"] as ViewerPerspective[])("applies both nested transforms in %s view without changing stored coordinates", perspective => {
    const project = asymmetricProject(), frame = project.frames[0];
    const before = structuredClone(project);
    const { container } = render(<SceneThumbnailPreview project={project} frame={frame} visible viewerPerspective={perspective} />);
    const group = container.querySelector("svg > g")!;
    expect(group.getAttribute("transform")).toBe(perspective === "performer" ? "rotate(180 4.5 2.75)" : null);
    const member = container.querySelector("circle")!;
    const prop = container.querySelector('rect[fill="#456789"]')!;
    const line = container.querySelector("[data-annotation-line]")!;
    const display = (p: Position) => perspective === "performer" ? { x: 9 - p.x, y: 5.5 - p.y } : p;
    expect(prop.getAttribute("x")).toBe("-1.239");
    const rotation = prop.getAttribute("transform")!.slice(7, -1).split(" ").map(Number);
    expect(rotation[0]).toBe(90.41);
    expect(rotation[1]).toBeCloseTo(.261, 8);
    expect(rotation[2]).toBe(2.25);
    expect(member.parentElement).toBe(group);
    expectPoint(displayedPoint(member, { x: 1.25, y: .75 }), display({ x: 1.25, y: .75 }));
    expectPoint(displayedPoint(prop, { x: .261, y: 2.25 }), display({ x: .261, y: 2.25 }));
    // Evaluate an off-centre corner too: checking only the centre would miss the prop rotation.
    const r = 90.41 * Math.PI / 180;
    expectPoint(displayedPoint(prop, { x: -1.239, y: 2 }), display({ x: .261 - 1.5 * Math.cos(r) + .25 * Math.sin(r), y: 2.25 - 1.5 * Math.sin(r) - .25 * Math.cos(r) }));
    expect(line.getAttribute("x1")).toBe("1");
    expect(line.getAttribute("y1")).toBe("0.5");
    expectPoint(displayedPoint(line, { x: 1, y: .5 }), display({ x: 1, y: .5 }));
    expectPoint(displayedPoint(line, { x: 3, y: 2 }), display({ x: 3, y: 2 }));
    expect(project).toEqual(before);
  });
  it("redraws a memoized preview when only the perspective prop changes", () => {
    const project = asymmetricProject(), frame = project.frames[0];
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible viewerPerspective="audience" />);
    view.rerender(<SceneThumbnailPreview project={project} frame={frame} visible viewerPerspective="performer" />);
    expectPoint(displayedPoint(view.container.querySelector("circle")!, { x: 1.25, y: .75 }), { x: 7.75, y: 4.75 });
    view.rerender(<SceneThumbnailPreview project={project} frame={frame} visible viewerPerspective="audience" />);
    expect(view.container.querySelector("svg > g")!.getAttribute("transform")).toBeNull();
  });
  it("keeps legacy missing mode/perspective audience-facing and honours scene-specific dimensions", () => {
    const project = asymmetricProject(), frame = project.frames[0];
    delete project.mode; delete project.viewerPerspective;
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible />);
    expect(view.container.querySelector("svg > g")!.getAttribute("transform")).toBeNull();
    project.useGlobalStageSize = false;
    const resizedFrame = { ...frame, stageWidthMeters: 11, stageDepthMeters: 7 };
    view.rerender(<SceneThumbnailPreview project={{ ...project, frames: [resizedFrame] }} frame={resizedFrame} visible viewerPerspective="performer" />);
    expect(view.container.querySelector("svg > g")!.getAttribute("transform")).toBe("rotate(180 5.5 3.5)");
  });
  it("leaves parade contents unchanged when performer is requested", () => {
    const project = asymmetricProject(), frame = project.frames[0];
    project.mode = "parade";
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible viewerPerspective="audience" />);
    const audience = view.container.innerHTML;
    view.rerender(<SceneThumbnailPreview project={project} frame={frame} visible viewerPerspective="performer" />);
    expect(view.container.innerHTML).toBe(audience);
  });
  it.each([-0.3, 37.5])("draws a %s degree prop from its default state and preserves circular rounding", rotation => {
    const project = asymmetricProject(), frame = project.frames[0];
    frame.objectStates = {};
    project.stageObjects[0] = { ...project.stageObjects[0], defaultX: 8.5, defaultY: .75, widthMeters: .5, heightMeters: 3, defaultRotation: rotation, shape: "circle" };
    const { container } = render(<SceneThumbnailPreview project={project} frame={frame} visible />);
    const prop = container.querySelector('rect[fill="#456789"]')!;
    expect(prop.getAttribute("transform")).toBe(`rotate(${rotation} 8.75 2.25)`);
    expect(prop.getAttribute("rx")).toBe("0.25");
  });
  it("shows distant parade lines without inheriting deleted lines", () => {
    const project = createSampleProject();
    project.mode = "parade";
    project.paradeSettings = { width: 18, totalDistance: 120, backwardDistanceMeters: 5,
      cellSizeMeters: 1, direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit",
      emphasizeEvery5m: true, emphasizeEvery10m: true };
    const frame = { ...project.frames[0], annotationLines: {
      distant: { x1: 2, y1: 110, x2: 16, y2: 115, color: "red" as const, dash: "dashed" as const },
    } };
    project.frames = [frame, { ...project.frames[1], annotationLines: {} }];
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible />);
    // Parade thumbnails show only the span people occupy (like exports), not the 125m route.
    const [left, top, width, height] = view.container.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect([left, width]).toEqual([0, 18]);
    expect(height).toBeLessThan(125);
    const ys = [...view.container.querySelectorAll("circle")].map((circle) => Number(circle.getAttribute("cy")));
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(top);
    expect(Math.max(...ys)).toBeLessThanOrEqual(top + height);
    // A line far from everyone stays in the drawing data even when it falls outside the cropped view.
    expect(view.container.querySelector('[stroke-dasharray="8 6"]')!.getAttribute("y1")).toBe("110");
    view.rerender(<SceneThumbnailPreview project={project} frame={project.frames[1]} visible />);
    expect(view.container.querySelector('[stroke-dasharray="8 6"]')).toBeNull();
  });
  it("keeps inherited positions fresh after an earlier scene is edited", () => {
    const project = createSampleProject();
    const id = project.members[0].id;
    project.frames[1] = { ...project.frames[1], positions: {} };
    const frame = project.frames[1];
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible />);
    const x = view.container.querySelector("circle")!.getAttribute("cx");
    const changed = { ...project, frames: project.frames.map((f,i) => i === 0 ? { ...f, positions: { ...f.positions, [id]: {x:7.25,y:3} } } : f) };
    view.rerender(<SceneThumbnailPreview project={changed} frame={frame} visible />);
    expect(view.container.querySelector("circle")!.getAttribute("cx")).toBe("7.25");
    expect(x).not.toBe("7.25");
  });
  it("shows current edits when an offscreen preview becomes visible", () => {
    const project = createSampleProject(), frame = project.frames[0], id = project.members[0].id;
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible={false} />);
    expect(view.container.querySelector("svg")).not.toBeNull();
    expect(view.container.querySelector("circle")).toBeNull();
    const changedFrame = { ...frame, memberAppearanceOverrides: { [id]: { color: "#123456" } } };
    const changed = { ...project, frames: [changedFrame,...project.frames.slice(1)] };
    view.rerender(<SceneThumbnailPreview project={changed} frame={changedFrame} visible />);
    expect(view.container.querySelector("circle")!.getAttribute("fill")).toBe("#123456");
    view.rerender(<SceneThumbnailPreview project={changed} frame={changedFrame} visible={false} />);
    expect(view.container.querySelector("circle")).toBeNull();
  });
  it("preserves stage dimensions, assignments and group colors", () => {
    const project = createSampleProject(), id = project.members[0].id;
    const object = project.stageObjects[0];
    const frame = { ...project.frames[0], stageWidthMeters:21, stageDepthMeters:9,
      objectAssignments:{[object.id]:[id]} };
    project.useGlobalStageSize = false;
    project.frames = [frame];
    project.memberGroups = [{id:"anonymous-group",name:"匿名組",memberIds:[project.members[1].id],color:"#abcdef"}];
    const view=render(<SceneThumbnailPreview project={project} frame={frame} visible />);
    expect(view.container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 21 9");
    expect(view.container.querySelectorAll("circle")).toHaveLength(project.members.length-1);
    expect(view.container.querySelector("circle")!.getAttribute("fill")).toBe("#abcdef");
  });
});
