import { expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { serializeProject, decodeProjectJson } from "./codec";
import { createTairetsuArchive, readTairetsuArchive } from "../utils/tairetsuFile";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";

it.each(["stage", "parade"] as const)("preserves extended and legacy %s diameters through ZIP, codec and repository", async mode => {
  for (const diameter of [.2, 1.5, 2]) {
    const project = createSampleProject(); project.id = "diameter-roundtrip"; project.mode = mode;
    project.audio = null; project.stage.memberDiameterMeters = diameter;
    const originalPositions = project.frames.map(f => f.positions);
    const blob = await createTairetsuArchive(project);
    const imported = await readTairetsuArchive(new File([blob], "diameter.zip", { type: "application/zip" }));
    expect(imported.project.stage.memberDiameterMeters).toBe(diameter);
    const serialized = serializeProject(imported.project);
    if (!serialized.ok) throw serialized.error;
    const result = decodeProjectJson(serialized.value);
    if (!result.ok) throw result.error;
    const decoded = result.value;
    expect(decoded.stage.memberDiameterMeters).toBe(diameter);
    const repository = new MemoryProjectRepository(); await repository.initialize();
    await repository.commit({ project: decoded, localRevision: "1", expectedRepositoryRevision: null, operationId: "diameter-save" });
    const loaded = (await repository.get(project.id))!.project;
    expect(loaded.stage.memberDiameterMeters).toBe(diameter);
    expect(loaded.frames.map(f => f.positions)).toEqual(originalPositions);
  }
});
