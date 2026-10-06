// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StaticStagePreview } from "../components/StaticStagePreview";
import { formationExportFixture } from "./formationExportFixture";
import { formationSize, formationVerticalRange } from "./formationExportLayout";
import { getSnapshotForFrame } from "./interpolation";
import { resolveExportFrames } from "./exportFrames";

describe("exported scene state matches the screen", () => {
  it.each(["stage", "parade"] as const)("resolves sparse %s scenes before current/all filtering, for shared static previews (A4 keeps its original renderer)", (mode) => {
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
    const screen = getSnapshotForFrame(project, "s1");
    // Visibility/appearance are per scene on screen; only position and object state inherit.
    expect(screen.memberVisibility.m0).toBe(true);
    expect(screen.memberAppearanceOverrides).toEqual({ m1: { color: "#abcdef" } });
    for (const scope of ["current", "all"] as const) {
      const snapshot = { project: { ...structuredClone(project), frames: resolveExportFrames(project).filter(f => scope === "all" || f.id === "s1") } };
      const frame = snapshot.project.frames.find((item) => item.id === "s1")!;
      for (const field of ["positions", "memberVisibility", "objectStates", "memberAppearanceOverrides"] as const) expect(frame[field]).toEqual(screen[field]);
      expect(frame.objectStates.flag.visible).toBe(false);
      const range = formationVerticalRange(snapshot.project, frame);
      if (mode === "parade") { expect(range.bottom).toBe(53); expect(range.bottom).toBeLessThan(90); }
      const width = formationSize(snapshot.project, frame).width;
      const html = renderToStaticMarkup(<StaticStagePreview project={snapshot.project} frame={frame} stageWidth={width} range={{ left: 0, right: width, ...range }} outputWidth={500} />);
      expect(html).toContain("名前1");
    }
    expect(project).toEqual(before);
  });
});
