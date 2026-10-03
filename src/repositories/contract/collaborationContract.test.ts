import { expect, it, vi } from "vitest";
import projects from "./fixtures/commitProjects.json";
import fixture from "./fixtures/collaboration.json";
import { validateCollaborationProject } from "../../collaboration/persistence";
import { MemoryProjectRepository } from "./testing/MemoryProjectRepository";
import { collaborationUpdates, initialCollaboration, runCollaborationContract } from "./runCollaborationContract";
import { SaveCoordinator } from "../../storage/saveCoordinator";
import { RepositoryError, type CollaborationData } from "../types";
import type { Project } from "../../types";

it("runs the shared persistence contract", async () => {
  expect((await runCollaborationContract(() => new MemoryProjectRepository())).scenarios).toBe(15);
});
it("provides full shared commit/compaction/ACK JSON fixtures for the future Swift bridge", () => {
  for (const data of [fixture.committed, fixture.compacted, fixture.acknowledged]) {
    expect(() => validateCollaborationProject(data as CollaborationData, fixture.projectAfterEdits as Project)).not.toThrow();
  }
});
it("retains fixed updates after failed commit and response loss while newer edits arrive", async () => {
  const r = new MemoryProjectRepository();
  await r.commit({ project: projects.stage as Project, collaboration: initialCollaboration(), localRevision: "1", expectedRepositoryRevision: null, operationId: "create" });
  const c = new SaveCoordinator(r, () => {}); c.activate((await r.get("project_a"))!);
  await c.editCollaboration([collaborationUpdates()[0]]);
  const original = r.commit.bind(r), requests: unknown[] = [];
  vi.spyOn(r, "commit").mockImplementation(async request => { requests.push(structuredClone(request)); await original(request); throw new RepositoryError("IO_ERROR"); });
  expect(await c.flush()).toBe(false); expect(c.state?.dirty).toBe(true);
  await c.editCollaboration([collaborationUpdates()[1]]);
  vi.mocked(r.commit).mockImplementation(async request => { requests.push(structuredClone(request)); return original(request); });
  expect(await c.flush()).toBe(true); expect(requests[0]).toEqual(requests[1]);
  expect((await r.get("project_a"))?.collaboration?.outbox).toHaveLength(2);
});
it("keeps editing state on quota failure, gates unsaved ACK and binds a document before sending", async () => {
  const r = new MemoryProjectRepository();
  await r.commit({ project: projects.stage as Project, collaboration: { ...initialCollaboration(), sharedDocumentId: null },
    localRevision: "1", expectedRepositoryRevision: null, operationId: "create" });
  const c = new SaveCoordinator(r, () => {}); c.activate((await r.get("project_a"))!);
  await c.editCollaboration([collaborationUpdates()[0]]);
  await expect(c.markOutboxSent([collaborationUpdates()[0].updateId])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  const original = r.commit.bind(r);
  vi.spyOn(r, "commit").mockRejectedValueOnce(new RepositoryError("QUOTA_EXCEEDED"));
  expect(await c.flush()).toBe(false); expect(c.projectProjection?.frames[0].positions.m_001.x).toBe(10);
  expect(c.state?.dirty).toBe(true); expect(await c.getSendableOutbox()).toEqual([]);
  vi.mocked(r.commit).mockImplementation(original);
  expect(await c.bindSharedDocument("shared-registered")).toBe(true);
  expect(await c.getSendableOutbox()).toHaveLength(1);
});
