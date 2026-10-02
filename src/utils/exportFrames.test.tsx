// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaticStagePreview } from "../components/StaticStagePreview";
import { formationExportFixture } from "./formationExportFixture";
import { createFormationSnapshot, formationVerticalRange, planFormationPages } from "./formationExportLayout";
import { getSnapshotForFrame } from "./interpolation";
import { resolveExportFrames } from "./exportFrames";
import type { ExportSource } from "./mobileExportTypes";

describe("exported scene state matches the screen", () => {
  it.each(["stage", "parade"] as const)("resolves sparse %s scenes before current/all filtering, including details (A4 keeps its original renderer)", (mode) => {
    const project = formationExportFixture();
    project.mode = mode;
    project.paradeSettings = { totalDistance: 100, width: 12, cellSizeMeters: 1, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
    project.frames[0].positions.m0 = { x: 6, y: mode === "parade" ? 50 : 6 };
    project.frames[0].objectStates.flag = { objectId: "flag", x: 4, y: 90, widthMeters: 3, heightMeters: 1, rotation: 45, visible: false, zIndex: 0 };
    project.frames[0].memberVisibility = { m0: false };
    project.frames[0].memberAppearanceOverrides = { m0: { color: "#123456" } };
    project.frames[1].positions = {};
    project.frames[1].objectStates = {};
    project.frames[1].memberVisibility = undefined;
    project.frames[1].memberAppearanceOverrides = { m1: { color: "#abcdef" } };
    const before = structuredClone(project);
    const source: ExportSource = { project, projectTitle: project.title, members: project.members, objects: project.stageObjects,
      memberGroups: [], objectGroups: [], frames: project.frames, currentFrame: project.frames[1], objectStates: {} };
    const screen = getSnapshotForFrame(project, "s1");
    // Visibility/appearance are per scene on screen; only position and object state inherit.
    expect(screen.memberVisibility.m0).toBe(true);
    expect(screen.memberAppearanceOverrides).toEqual({ m1: { color: "#abcdef" } });
    for (const scope of ["current", "all"] as const) {
      const snapshot = createFormationSnapshot(source, scope);
      const frame = snapshot.project.frames.find((item) => item.id === "s1")!;
      for (const field of ["positions", "memberVisibility", "objectStates", "memberAppearanceOverrides"] as const) expect(frame[field]).toEqual(screen[field]);
      expect(frame.objectStates.flag.visible).toBe(false);
      const range = formationVerticalRange(snapshot.project, frame);
      if (mode === "parade") { expect(range.bottom).toBe(53); expect(range.bottom).toBeLessThan(90); }
      const pages = planFormationPages(snapshot, true, () => 24);
      const blocks = pages.flatMap((page) => page.blocks).filter((block) => block.frame.id === "s1");
      expect(blocks.some((block) => block.detail)).toBe(true);
      expect(blocks.every((block) => block.frame === frame && block.fullRange.bottom === range.bottom)).toBe(true);
      const block = blocks[0];
      const html = renderToStaticMarkup(<StaticStagePreview project={snapshot.project} frame={frame} stageWidth={block.stageWidth} range={block.range} outputWidth={500} />);
      expect(html).toContain("名前1");
    }
    expect(project).toEqual(before);
  });
});
