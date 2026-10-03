import { describe, expect, it, vi } from "vitest";
import { SaveCoordinator } from "./saveCoordinator";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { RepositoryError, type CommitRequest } from "../repositories/types";
import projects from "../repositories/contract/fixtures/commitProjects.json";
import type { Project } from "../types";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const setup = async () => {
  const repository = new MemoryProjectRepository();
  const project = projects.stage as Project;
  await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
  const changed = vi.fn(); const coordinator = new SaveCoordinator(repository, changed);
  coordinator.activate((await repository.get(project.id!))!);
  return { repository, coordinator, project, changed };
};
describe("local save coordinator", () => {
  it("opens clean, serializes concurrent flushes, fixes r snapshots and drains r+1", async () => {
    const { repository, coordinator, project, changed } = await setup();
    expect(coordinator.state?.dirty).toBe(false);
    const gate = deferred(), started = deferred(); const original = repository.commit.bind(repository);
    let active = 0, max = 0; const seen: CommitRequest[] = [];
    vi.spyOn(repository, "commit").mockImplementation(async request => {
      active++; max = Math.max(max, active); seen.push(request); started.resolve();
      if (seen.length === 1) await gate.promise;
      const receipt = await original(request); active--; return receipt;
    });
    coordinator.edit({ ...project, title: "revision r" });
    const flush = coordinator.flush(); expect(coordinator.flush()).toBe(flush);
    await started.promise;
    coordinator.edit({ ...project, title: "revision r+1" });
    expect(seen[0].project.title).toBe("revision r"); expect(coordinator.state?.dirty).toBe(true);
    gate.resolve(); expect(await flush).toBe(true);
    expect(max).toBe(1); expect(seen.map(s => s.localRevision)).toEqual(["2", "3"]);
    expect(changed.mock.calls.some(([state]) => state?.persistedRevision === "2" && state.localRevision === "3" && state.dirty)).toBe(true);
    expect((await repository.get(project.id!))?.project.title).toBe("revision r+1");
    expect(coordinator.state).toMatchObject({ localRevision: "3", persistedRevision: "3", dirty: false });
  });
  it("keeps failed edits dirty and retries the identical operation before newer edits", async () => {
    const { repository, coordinator, project } = await setup(); const original = repository.commit.bind(repository);
    const requests: CommitRequest[] = [];
    vi.spyOn(repository, "commit").mockImplementation(async request => {
      requests.push(request);
      if (requests.length === 1) { await original(request); throw new RepositoryError("IO_ERROR"); }
      return original(request);
    });
    coordinator.edit({ ...project, title: "reply lost" }); expect(await coordinator.flush()).toBe(false);
    expect(coordinator.state).toMatchObject({ dirty: true, persistedRevision: "1", error: { code: "IO_ERROR" } });
    coordinator.edit({ ...project, title: "newer" }); expect(await coordinator.flush()).toBe(true);
    expect(requests[1]).toEqual(requests[0]); expect(requests[2].localRevision).toBe("3");
  });
  it("retains quota failures until flush succeeds", async () => {
    const { repository, coordinator, project } = await setup();
    vi.spyOn(repository, "commit").mockRejectedValueOnce(new RepositoryError("QUOTA_EXCEEDED"));
    coordinator.edit({ ...project, title: "retained" }); expect(await coordinator.flush()).toBe(false);
    expect(coordinator.state?.dirty).toBe(true); expect((await repository.get(project.id!))?.project.title).toBe(project.title);
    expect(await coordinator.flush()).toBe(true); expect(coordinator.state?.error).toBeNull();
  });
  it("never applies an inactive save completion to the newly opened project", async () => {
    const { repository, coordinator, project, changed } = await setup(); const gate = deferred();
    const original = repository.commit.bind(repository);
    vi.spyOn(repository, "commit").mockImplementation(async request => { await gate.promise; return original(request); });
    coordinator.edit({ ...project, title: "old" }); const work = coordinator.flush();
    coordinator.activate({ project: { ...project, id: "second" }, repositoryRevision: "1", localRevision: "1", sync: null });
    changed.mockClear(); gate.resolve(); await work;
    expect(changed).not.toHaveBeenCalled(); expect(coordinator.state?.id).toBe("second");
  });
  it("blocks conflict retries and preserves both stored and edited data until explicit resolution", async () => {
    const { repository, coordinator, project } = await setup();
    await repository.commit({ project: { ...project, title: "other window" }, localRevision: "2", expectedRepositoryRevision: "1", operationId: "other" });
    const commit = vi.spyOn(repository, "commit"); coordinator.edit({ ...project, title: "my edit" });
    expect(await coordinator.flush()).toBe(false); expect(coordinator.state?.error?.code).toBe("CONFLICT");
    expect(await coordinator.flush()).toBe(false); expect(commit).toHaveBeenCalledTimes(1);
    expect((await repository.get(project.id!))?.project.title).toBe("other window");
    coordinator.discard(); coordinator.activate((await repository.get(project.id!))!); expect(coordinator.state?.dirty).toBe(false);
  });
  it("retains a failed create and allows later edits to be flushed", async () => {
    const { repository, project } = await setup(); const coordinator = new SaveCoordinator(repository, vi.fn());
    const creation = { project: { ...project, id: "new" }, localRevision: "1", expectedRepositoryRevision: null, operationId: "create-new" };
    coordinator.activateUnsaved(creation, new RepositoryError("NO_SPACE"));
    coordinator.edit({ ...creation.project, title: "edited after failed create" });
    expect(await coordinator.flush()).toBe(true); expect((await repository.get("new"))?.project.title).toBe("edited after failed create");
  });
});
