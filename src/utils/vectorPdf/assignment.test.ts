import { expect, it } from "vitest";
import { vectorAssignmentFixture } from "./fixture";
import { buildScenePage, visibleTextLines } from "./model";
import { isPrintMemberVisible } from "../printLayout";

it.each([[19, 18, 18], [10, 20, 2], [30, 12, 2]])("keeps the assignment regression fixture realistic (%s×%s)", (width, depth, count) => {
  const p = vectorAssignmentFixture(width, depth, count);
  expect(p.stage).toMatchObject({ widthMeters: width, depthMeters: depth, frontDirection: "top", gridSizeMeters: .5, horizontalGuideMode: "centerSplit" });
  expect(p.useGlobalStageSize).toBe(true);
  expect(p.members).toHaveLength(146);
  expect(p.members.filter(m => m.name.includes("🔥"))).toHaveLength(1);
  expect(p.stageObjects).toHaveLength(18);
  expect(p.stageObjects.every(o => o.widthMeters === 1.2 && o.heightMeters === .8)).toBe(true);
  expect(p.stageObjects.filter(o => o.shape === "line")).toHaveLength(1);
  expect(p.frames).toHaveLength(count);
  expect(p.frames.filter(f => Object.keys(f.objectAssignments ?? {}).length)).toHaveLength(1);
  expect(p.frames[0].objectAssignments).toEqual({ o0: ["m1", "m2"] });
  expect(p.frames.every(f => Object.keys(f.positions).length === 146 && f.stageWidthMeters === undefined && f.stageDepthMeters === undefined)).toBe(true);
  for (const viewerPerspective of ["audience", "performer"] as const) {
    const page = buildScenePage(p, p.frames[0].id, { viewerPerspective }, () => []);
    const stage = page.drawings.find(d => d.kind === "group" && d.id === "stage");
    if (stage?.kind !== "group") throw new Error("Missing stage");
    for (const m of p.members.filter(member => isPrintMemberVisible(p.frames[0], member))) {
      const node = stage.children.find(d => d.kind === "group" && d.id === m.id);
      if (node?.kind !== "group") throw new Error("Missing member");
      expect(visibleTextLines(node.children).every(line => line.x === 0)).toBe(true);
    }
  }
});
