import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { formationVerticalRange } from "./formationExportLayout";
import { getSnapshotForFrame } from "./interpolation";
import { createProjectCardPreviewModel } from "./projectCardPreviewModel";

const paradeProject = () => {
  const project = createSampleProject();
  project.mode = "parade";
  project.paradeSettings = { width: 18, totalDistance: 200, backwardDistanceMeters: 5,
    cellSizeMeters: 1, direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit",
    emphasizeEvery5m: true, emphasizeEvery10m: true };
  return project;
};

describe("project card reduced model", () => {
  it("uses the first scene in stable time order without mutating the project", () => {
    const project = createSampleProject();
    project.frames[0].timeSec = 20;
    project.frames[1].timeSec = 1;
    project.frames.push({ ...project.frames[1], id: "tie", positions: { m_anna: { x: 0, y: 0 } } });
    const before = structuredClone(project), model = createProjectCardPreviewModel(project)!;
    expect(model.points[0]).toMatchObject({ x: 2.2, y: 2.2 });
    expect(project).toEqual(before);
    expect(model).toMatchObject({ width: 12, top: 0, height: 6, gridStep: 0.5, gridOriginX: 6, radius: 0.11 });
  });

  it("uses scene sizes, including the old global-width flag, and copies all model values", () => {
    const project = createSampleProject();
    project.useGlobalStageWidth = false;
    project.frames[0].stageWidthMeters = 21;
    project.frames[0].stageDepthMeters = 9;
    project.stage.horizontalGuideMode = "centerSplit";
    const model = createProjectCardPreviewModel(project)!;
    expect(model).toMatchObject({ width: 21, height: 9, gridOriginX: 11 });
    project.frames[0].positions.m_anna.x = 100;
    project.stageObjects[0].color = "red";
    expect(model.points[0].x).toBe(3);
    expect(model.objects[0].color).toBe("#7c3aed");
    expect(JSON.stringify(model)).not.toMatch(/Anna|Intro|movementPaths|annotationLines|title/);
    project.useGlobalStageSize = true;
    expect(createProjectCardPreviewModel(project)).toMatchObject({ width: 12, height: 6 });
  });

  it("excludes globally/scene hidden and assigned people, hidden props, and resolves display colors", () => {
    const project = createSampleProject(), frame = project.frames[0];
    project.members.push({ id: "extra", name: "Anonymous", color: "red" });
    frame.positions.extra = { x: 1, y: 1 };
    project.members[0].visible = false;
    frame.memberVisibility = { m_ben: false };
    frame.objectAssignments = { o_chair: ["m_chika"] };
    frame.objectStates.o_curtain.visible = false;
    project.memberGroups = [{ id: "group", name: "Group", memberIds: ["extra"], color: "#abcdef" }];
    expect(createProjectCardPreviewModel(project)!.points).toEqual([{ x: 1, y: 1, color: "#abcdef" }]);
    frame.memberAppearanceOverrides = { extra: { color: "#123456" } };
    const model = createProjectCardPreviewModel(project)!;
    expect(model.points[0].color).toBe("#123456");
    expect(model.objects).toHaveLength(1);
  });

  it("retains prop rotation, shape, dimensions and color including default states", () => {
    const project = createSampleProject();
    project.frames[0].objectStates = {};
    project.stageObjects[1].defaultRotation = 45;
    project.stageObjects[1].shape = "circle";
    expect(createProjectCardPreviewModel(project)!.objects[1]).toEqual({
      x: 5.6, y: 4.6, width: 0.8, height: 0.8, rotation: 45, color: "#f59e0b", shape: "circle", opacity: 0.32,
    });
  });

  it("reuses parade occupied bounds including rotated props, grid origin and dot scaling", () => {
    const project = paradeProject(), frame = project.frames[0];
    frame.positions = { m_anna: { x: 3, y: 145 }, m_ben: { x: 9, y: 150 }, m_chika: { x: 12, y: 148 } };
    frame.objectStates.o_curtain.visible = false;
    frame.objectStates.o_chair = { ...frame.objectStates.o_chair, y: 140, rotation: 45 };
    frame.annotationLines = { far: { x1: 0, y1: 0, x2: 0, y2: 200, color: "red", dash: "solid" } };
    const expected = formationVerticalRange(project, { ...frame, ...getSnapshotForFrame(project, frame.id) });
    const model = createProjectCardPreviewModel(project)!;
    expect(model).toMatchObject({ width: 18, top: expected.top, height: expected.bottom - expected.top,
      gridOriginX: 9.5, gridStep: 1, radius: 0.165, pointStrokeWidth: 0.06 });
    expect(model.height).toBeLessThan(20);
    expect(model.points[0].y).toBe(145);
    project.paradeSettings!.horizontalMeasureMode = "normalMeter";
    expect(createProjectCardPreviewModel(project)!.gridOriginX).toBe(9);
  });

  it("uses short empty parade bounds and a neutral fallback for no scenes", () => {
    const project = paradeProject();
    project.members = []; project.stageObjects = [];
    expect(createProjectCardPreviewModel(project)).toMatchObject({ top: 0, height: 10, points: [], objects: [] });
    project.mode = "stage";
    expect(createProjectCardPreviewModel(project)).toMatchObject({ top: 0, height: 6, points: [], objects: [] });
    project.frames = [];
    expect(createProjectCardPreviewModel(project)).toBeNull();
  });

  it("keeps short bounds if all parade people are hidden or assigned", () => {
    const project = paradeProject();
    project.stageObjects = [];
    project.frames[0].objectAssignments = { absent: project.members.map(member => member.id) };
    expect(createProjectCardPreviewModel(project)).toMatchObject({ top: 0, height: 10, points: [] });
  });

  it("thins fine grids by a multiple and matches dense thumbnail dot sizing", () => {
    const project = paradeProject();
    project.paradeSettings!.cellSizeMeters = 0.2;
    project.members = Array.from({ length: 121 }, (_, i) => ({ id: `m${i}`, name: `Person ${i}`, color: "blue" }));
    project.frames[0].positions = Object.fromEntries(project.members.map((member, i) => [member.id, { x: i % 18, y: 80 + Math.floor(i / 18) }]));
    const model = createProjectCardPreviewModel(project)!;
    expect(model.points).toHaveLength(121);
    expect(model.gridStep).toBeCloseTo(0.6);
    expect(model.radius).toBeCloseTo(0.075 * 1.5);
    expect(model.pointStrokeWidth).toBeCloseTo(0.025 * 1.5);
  });

  it("rejects external paints and nonfinite drawing values", () => {
    const project = createSampleProject();
    project.members[0].color = "url(https://example.invalid/paint.svg)";
    project.members[1].color = "var(--external-paint)";
    project.stageObjects[0].color = "url(#foreign)";
    project.frames[0].positions.m_chika.x = NaN;
    const model = createProjectCardPreviewModel(project)!;
    expect(model.points.map(point => point.color)).toEqual(["#14b8a6", "#14b8a6"]);
    expect(model.objects[0].color).toBe("#64748b");
    project.stage.widthMeters = Infinity;
    expect(createProjectCardPreviewModel(project)).toBeNull();
  });
});
