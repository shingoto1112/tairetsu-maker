import { describe, expect, it, vi } from "vitest";
import { getRequiredProject, listAllSummaries, readOpenedProject } from "./appRepository";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import projects from "../repositories/contract/fixtures/commitProjects.json";
import type { Project } from "../types";
describe("App repository reads", () => {
  it("gets all cursor pages without fetching bodies", async () => {
    const repository = new MemoryProjectRepository();
    for (let i = 0; i < 205; i++) await repository.commit({ project: { ...projects.stage, id: `item-${i}` } as Project, localRevision: "1", expectedRepositoryRevision: null, operationId: `create-${i}` });
    const get = vi.spyOn(repository, "get"), list = vi.spyOn(repository, "list");
    expect(await listAllSummaries(repository)).toHaveLength(205); expect(list).toHaveBeenCalledTimes(3); expect(get).not.toHaveBeenCalled();
  });
  it("re-reads one body if a concurrent edit happened between get and touch", async () => {
    const repository = new MemoryProjectRepository(); const project = projects.stage as Project;
    await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
    const touch = repository.touchOpened.bind(repository);
    vi.spyOn(repository, "touchOpened").mockImplementation(async (id, at) => {
      await repository.commit({ project: { ...project, title: "concurrent edit" }, localRevision: "2", expectedRepositoryRevision: "1", operationId: "edit" });
      return touch(id, at);
    });
    const record = await readOpenedProject(repository, project.id!);
    expect(record.project.title).toBe("concurrent edit"); expect(record.repositoryRevision).toBe("3"); expect(record.localRevision).toBe("2");
    await expect(getRequiredProject(repository, "absent")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
