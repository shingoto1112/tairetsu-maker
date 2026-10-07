import * as Y from "yjs";
import { createSharedDocument } from "../collaboration/model";
import { createCollaborationData, encodeUpdate } from "../collaboration/persistence";
import { CollaborationCommands } from "../collaboration/commands";
import { describe, expect, it, vi } from "vitest";
import { paradeDistanceError } from "./paradeLimits";
import { normalizeProject } from "./normalizeProject";
import { decodeProjectJson } from "./codec";
import { createSampleProject } from "../sampleProject";
import { SaveCoordinator } from "../storage/saveCoordinator";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { createDefaultParadeSettings } from "./defaults";
import { createEmptyFormationProject } from "./createEmptyFormationProject";

describe("parade distance input policy and legacy reads", () => {
  it("accepts the boundary and rejects excess/nonfinite distances with a reason", () => {
    expect(paradeDistanceError({ totalDistance: 500, backwardDistanceMeters: 500 })).toBeNull();
    for (const value of [500.01, 1e20, Infinity, NaN, -1]) {
      expect(paradeDistanceError({ totalDistance: value })).toContain("500m");
      expect(paradeDistanceError({ backwardDistanceMeters: value })).toContain("500m");
    }
  });
  it("rejects factory creation before normalization can default invalid input", () => {
    expect(() => createEmptyFormationProject("large", { formationMode: "parade", widthMeters: 10,
      heightMeters: 501, gridSizeMeters: .5, memberDiameterMeters: .5, horizontalGuideMode: "centerSplit", useGlobalStageSize: true }, null)).toThrow("500m");
  });
  it("accepts both 500m factory boundaries and rejects an excess backward distance", () => {
    const settings = { formationMode: "parade" as const, widthMeters: 10, heightMeters: 500,
      gridSizeMeters: .5, memberDiameterMeters: .5, horizontalGuideMode: "centerSplit" as const, useGlobalStageSize: true,
      paradeSettings: createDefaultParadeSettings({ totalDistance: 500, backwardDistanceMeters: 500 }) };
    expect(createEmptyFormationProject("boundary", settings, null).paradeSettings).toMatchObject({ totalDistance: 500, backwardDistanceMeters: 500 });
    expect(() => createEmptyFormationProject("large", { ...settings, paradeSettings: { ...settings.paradeSettings, backwardDistanceMeters: 501 } }, null)).toThrow("500m");
  });
  it("opens and saves edits to a stored over-limit project without changing its distances", async () => {
    const project = normalizeProject({ ...createSampleProject(), id: "legacy-large", mode: "parade",
      paradeSettings: { totalDistance: 1e12, backwardDistanceMeters: 1e10, width: 10, cellSizeMeters: .5, direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true } });
    const decoded = decodeProjectJson(JSON.stringify(project));
    expect(decoded.ok && decoded.value.paradeSettings?.totalDistance).toBe(1e12);
    const repository = new MemoryProjectRepository(); await repository.initialize();
    await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
    const coordinator = new SaveCoordinator(repository, () => {});
    coordinator.activate((await repository.get(project.id!))!);
    expect(coordinator.projectProjection?.paradeSettings?.totalDistance).toBe(1e12);
    const commit = vi.spyOn(repository, "commit");
    coordinator.edit({ ...project, title: "edited" });
    expect(await coordinator.flush()).toBe(true); expect(commit).toHaveBeenCalledOnce();
    expect(coordinator.state?.error).toBeNull();
    expect((await repository.get(project.id!))!.project).toMatchObject({ title: "edited", paradeSettings: { totalDistance: 1e12, backwardDistanceMeters: 1e10 } });
  });
  it("persists received collaboration edits with legacy excess distances", async () => {
    const project = normalizeProject({ ...createSampleProject(), id: "remote-large", mode: "parade",
      paradeSettings: createDefaultParadeSettings({ totalDistance: 501, backwardDistanceMeters: 600 }) });
    const doc = createSharedDocument(project), commands = new CollaborationCommands(doc);
    try {
      const repository = new MemoryProjectRepository(); await repository.initialize();
      await repository.commit({ project, collaboration: createCollaborationData(doc), localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
      const coordinator = new SaveCoordinator(repository, () => {});
      coordinator.activate((await repository.get(project.id!))!);
      const vector = Y.encodeStateVector(doc);
      commands.applyRecipe(project, { ...project, title: "received edit" });
      await coordinator.editCollaboration([{ updateId: crypto.randomUUID(), bytes: encodeUpdate(Y.encodeStateAsUpdate(doc, vector)), source: "remote" }]);
      expect(await coordinator.flush()).toBe(true);
      expect(coordinator.state?.error).toBeNull();
      expect((await repository.get(project.id!))!.project).toMatchObject({ title: "received edit", paradeSettings: { totalDistance: 501, backwardDistanceMeters: 600 } });
    } finally { commands.destroy(); doc.destroy(); }
  });
});
