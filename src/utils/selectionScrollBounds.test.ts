import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { getSnapshotForFrame } from "./interpolation";
import { selectionScrollBounds } from "./selectionScrollBounds";

describe("visibility selection canvas bounds", () => {
  it("mirrors performer bounds and skips hidden/assigned people", () => {
    const project = createSampleProject(); const snapshot = getSnapshotForFrame(project, project.frames[0].id);
    const id = project.members[0].id;
    const a = selectionScrollBounds(project, snapshot, "member", id, project.stage, "audience")!;
    const p = selectionScrollBounds(project, snapshot, "member", id, project.stage, "performer")!;
    expect(p.x).toBeCloseTo(project.stage.widthMeters - a.x - a.widthMeters);
    expect(p.y).toBeCloseTo(project.stage.depthMeters - a.y - a.heightMeters);
    expect(a.minimumScroll).toBe(true);
    expect(selectionScrollBounds(project, snapshot, "member", id, project.stage, "audience", { flag: [id] })).toBeNull();
    snapshot.memberVisibility[id] = false;
    expect(selectionScrollBounds(project, snapshot, "member", id, project.stage, "audience")).toBeNull();
  });
  it("includes rotated tool extents, keeps parade origin coordinates and skips invisible objects", () => {
    const project = createSampleProject(); const snapshot = getSnapshotForFrame(project, project.frames[0].id);
    const id = project.stageObjects[0].id; snapshot.objectStates[id] = { objectId: id, x: 4, y: 80, widthMeters: 4, heightMeters: 2, rotation: 90, visible: true, zIndex: 0 };
    project.mode = "parade";
    const bounds = selectionScrollBounds(project, snapshot, "object", id, project.stage, "performer")!;
    expect(bounds.x).toBeCloseTo(5); expect(bounds.y).toBeCloseTo(79);
    expect(bounds.widthMeters).toBeCloseTo(2); expect(bounds.heightMeters).toBeCloseTo(4);
    snapshot.objectStates[id].visible = false;
    expect(selectionScrollBounds(project, snapshot, "object", id, project.stage, "audience")).toBeNull();
  });
});
