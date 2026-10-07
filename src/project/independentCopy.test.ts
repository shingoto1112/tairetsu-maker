import { expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { prepareIndependentProjectCopy } from "./independentCopy";

it("persists a detached same-name copy with the original audio/internal references, without attachments", async () => {
  const repository = new MemoryProjectRepository();
  const source = { ...createSampleProject(), id: "original", audio: { id: "audio-original", name: "架空音源.wav", type: "audio/wav", size: 12 } };
  const request = prepareIndependentProjectCopy(source);
  expect(request.project.id).not.toBe(source.id);
  expect(request).toMatchObject({ localRevision: "1", expectedRepositoryRevision: null, collaboration: null });
  expect(request.project).toMatchObject({ title: source.title, audio: source.audio, members: source.members, frames: source.frames });
  expect(request.project.members).not.toBe(source.members);
  expect(request.project.createdAt).toBe(request.project.updatedAt);
  expect(request.project.lastOpenedAt).toBe(request.project.createdAt);
  await repository.commit(request);
  await repository.commit(request); // exact idempotent retry
  expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
  expect(await repository.get(request.project.id!)).toMatchObject({ localRevision: "1", sync: null });
  expect((await repository.get(request.project.id!))?.collaboration).toBeFalsy();
  expect(prepareIndependentProjectCopy(source, source.title + " のコピー").project.title).toBe(source.title + " のコピー");
});
