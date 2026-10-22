import { describe, expect, it } from "vitest";
import { createEmptyFormationProject } from "./createEmptyFormationProject";
import { normalizeProject } from "./normalizeProject";

const stageSettings = {
  formationMode: "stage" as const, widthMeters: 12, heightMeters: 8, useGlobalStageSize: true,
  gridSizeMeters: 0.5, horizontalGuideMode: "centerSplit" as const, memberDiameterMeters: 0.5,
};

describe("createEmptyFormationProject", () => {
  it("names only new scenes in Japanese and leaves existing titles and legacy scene labels intact", () => {
    const project = createEmptyFormationProject("", stageSettings, null);
    expect(project.title).toBe("");
    expect(project.frames[0].label).toBe("シーン1");
    project.frames[0].label = "Scene 1";
    const reloaded = normalizeProject(JSON.parse(JSON.stringify(project)));
    // Preserve the existing normalizer fallback; the creation default must not leak here.
    expect(reloaded.title).toBe("隊列メーカー");
    expect(reloaded.frames[0].label).toBe("Scene 1");
  });
  it("keeps the saved showStageLabels default and other display defaults for new stages", () => {
    const project = createEmptyFormationProject("新規", stageSettings, null);
    expect(project.stage.showStageLabels).toBe(false);
    expect(project.stage.showGrid).toBe(true);
    expect(project.stage.showCenterLine).toBe(true);
    expect(project.stage.horizontalGuideMode).toBe("centerSplit");
    expect(project.stage.gridSizeMeters).toBe(0.5);
  });

  it("opens new stages in the dancers' view (最前 0m at the top); parades keep the audience view", () => {
    expect(createEmptyFormationProject("新規", stageSettings, null).viewerPerspective).toBe("performer");
    expect(createEmptyFormationProject("パレード", { ...stageSettings, formationMode: "parade" }, null).viewerPerspective).toBe("audience");
    const existing = createEmptyFormationProject("既存", stageSettings, null);
    existing.viewerPerspective = "audience";
    expect(normalizeProject(existing).viewerPerspective).toBe("audience");
  });

  it("preserves the legacy showStageLabels value during normalization", () => {
    const existing = createEmptyFormationProject("既存", stageSettings, null);
    existing.stage.showStageLabels = true;
    expect(normalizeProject(existing).stage.showStageLabels).toBe(true);
  });
});
