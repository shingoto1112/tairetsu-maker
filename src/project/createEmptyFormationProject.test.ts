import { describe, expect, it } from "vitest";
import { createEmptyFormationProject } from "./createEmptyFormationProject";
import { normalizeProject } from "./normalizeProject";

const stageSettings = {
  formationMode: "stage" as const, widthMeters: 12, heightMeters: 8, useGlobalStageSize: true,
  gridSizeMeters: 0.5, horizontalGuideMode: "centerSplit" as const, memberDiameterMeters: 0.5,
};

describe("createEmptyFormationProject", () => {
  it("starts new stage formations without 上手/下手 labels and keeps the other display defaults", () => {
    const project = createEmptyFormationProject("新規", stageSettings, null);
    expect(project.stage.showStageLabels).toBe(false);
    expect(project.stage.showGrid).toBe(true);
    expect(project.stage.showCenterLine).toBe(true);
    expect(project.stage.horizontalGuideMode).toBe("centerSplit");
    expect(project.stage.gridSizeMeters).toBe(0.5);
  });

  it("does not turn labels off for existing formations that had them on", () => {
    const existing = createEmptyFormationProject("既存", stageSettings, null);
    existing.stage.showStageLabels = true;
    expect(normalizeProject(existing).stage.showStageLabels).toBe(true);
  });
});
