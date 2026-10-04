import { describe, expect, it, vi } from "vitest";
import { runRepositoryContract } from "./contract/runRepositoryContract";
import { MemoryMigrationRepository } from "../storage/testing/MemoryMigrationRepository";
import type { MigrationEntry } from "./migrationTypes";
import { NativeSqliteProjectRepository, type NativeRepositoryPlugin } from "./nativeSqliteRepository";
import { REPOSITORY_ERROR_MESSAGES, RepositoryError, type CommitRequest, type RenameRequest, type RemoveRequest } from "./types";
import projects from "./contract/fixtures/commitProjects.json";
import type { Project } from "../types";
import { runMigrationContract } from "../storage/testing/migrationContract";
import { initialCollaboration, runCollaborationContract } from "./contract/runCollaborationContract";

// Adapter mapping oracle only. SQLite persistence is tested by the actual Swift core.
const fakePlugin = (): NativeRepositoryPlugin => {
  const memory = new MemoryMigrationRepository();
  const wrap = (fn: (input: Record<string, unknown>) => Promise<unknown>) => async ({ json }: { json: string }) => {
    try { return { json: JSON.stringify(await fn(JSON.parse(json) as Record<string, unknown>)) }; }
    catch (error) {
      if (error instanceof RepositoryError) throw { code: error.code, data: { retryable: error.retryable }, message: "native message" };
      throw error;
    }
  };
  return {
    initialize: wrap(async () => ({ ...await memory.initialize(), schemaVersion: 2 })), listSummaries: wrap(input => memory.list(input as { limit: number })),
    readProject: wrap(async input => {
      const r = await memory.get(input.id as string);
      return r ? { json: JSON.stringify(r.project), repositoryRevision: r.repositoryRevision, localRevision: r.localRevision, sync: r.sync,
        collaborationJSON: r.collaboration ? JSON.stringify(r.collaboration) : null } : null;
    }),
    commitProject: wrap(input => memory.commit({ project: JSON.parse(input.json as string),
      collaboration: input.collaborationJSON ? JSON.parse(input.collaborationJSON as string) : null,
      operationId: input.operationId, localRevision: input.localRevision, expectedRepositoryRevision: input.expectedRepositoryRevision } as CommitRequest)),
    touchOpened: wrap(input => memory.touchOpened(input.id as string, input.openedAt as string)),
    renameProject: wrap(input => memory.rename(input as RenameRequest)),
    removeProject: wrap(async input => { await memory.remove(input as RemoveRequest); return null; }),
    createRecoveryBackup: wrap(async () => ({ created: true })),
    readCommitReceipt: wrap(async () => null),
    readMigration: wrap(input => memory.readMigration(input.id as string)),
    writeMigration: wrap(input => memory.writeMigration(input.entry as MigrationEntry, input.expectedState as MigrationEntry["state"] | null)),
  };
};
describe("native SQLite adapter mapping", () => {
  it("rejects shared attachments before the schema-1 bridge can silently drop them", async () => {
    const plugin = fakePlugin(), call = vi.spyOn(plugin, "commitProject");
    plugin.initialize = async () => ({ json: '{"status":"ready","schemaVersion":1,"errors":[]}' });
    await expect(new NativeSqliteProjectRepository(plugin).commit({ project: projects.stage as Project, collaboration: initialCollaboration(),
      localRevision: "1", expectedRepositoryRevision: null, operationId: "shared-create" })).rejects.toMatchObject({ code: "UNSUPPORTED_SCHEMA" });
    expect(call).not.toHaveBeenCalled();
  });
  it("passes the collaboration contract through the string/base64 bridge", async () => {
    const plugin = fakePlugin();
    expect(await runCollaborationContract(() => new NativeSqliteProjectRepository(plugin),
      () => new NativeSqliteProjectRepository(plugin), () => new NativeSqliteProjectRepository(plugin))).toEqual({ scenarios: 15 });
  });
  it("captures shared data before awaiting and rejects corrupt attachment reads", async () => {
    const plugin = fakePlugin(), repository = new NativeSqliteProjectRepository(plugin);
    const data = initialCollaboration();
    const pending = repository.commit({ project: projects.stage as Project, collaboration: data,
      localRevision: "1", expectedRepositoryRevision: null, operationId: "capture-shared" });
    data.base = "AAAA";
    await pending;
    expect((await repository.get("project_a"))?.collaboration?.base).not.toBe("AAAA");
    const read = plugin.readProject;
    plugin.readProject = async input => {
      const raw = JSON.parse((await read(input)).json);
      raw.collaborationJSON = JSON.stringify({ ...initialCollaboration(), base: "AAAA" });
      return { json: JSON.stringify(raw) };
    };
    await expect(repository.get("project_a")).rejects.toMatchObject({ code: "CORRUPT" });
    plugin.readProject = async input => {
      const raw = JSON.parse((await read(input)).json);
      raw.collaborationJSON = JSON.stringify({ ...initialCollaboration(), documentSchema: 2 });
      return { json: JSON.stringify(raw) };
    };
    await expect(repository.get("project_a")).rejects.toMatchObject({ code: "UNSUPPORTED_SCHEMA" });
  });
  it("returns the durable shared receipt before reading a subsequently corrupt body", async () => {
    const plugin = fakePlugin(), repository = new NativeSqliteProjectRepository(plugin);
    const request: CommitRequest = { project: projects.stage as Project, collaboration: initialCollaboration(),
      localRevision: "1", expectedRepositoryRevision: null, operationId: "lost-response" };
    const saved = await repository.commit(request);
    plugin.readProject = vi.fn(async () => { throw { code: "CORRUPT" }; });
    plugin.readCommitReceipt = async () => ({ json: JSON.stringify(saved) });
    expect(await repository.commit(request)).toEqual(saved);
    expect(plugin.readProject).not.toHaveBeenCalled();
  });
  it("uses fixed recovery/maintenance operations with no paths and validates responses", async () => {
    const plugin = fakePlugin();
    plugin.restoreRecoveryBackup = vi.fn(async () => ({ json: "null" }));
    plugin.readMaintenance = async () => ({ json: JSON.stringify({ completedAt: null, successfulStarts: 0, reviewedIds: [], gcAt: null }) });
    plugin.collectUnusedAudio = async () => ({ json: '{"count":2,"bytes":10,"skipped":false}' });
    const r = new NativeSqliteProjectRepository(plugin);
    await r.restoreRecoveryBackup(); expect(plugin.restoreRecoveryBackup).toHaveBeenCalledWith({ json: "{}" });
    expect((await r.readMaintenance()).reviewedIds).toEqual([]);
    expect(await r.collectUnusedAudio()).toEqual({ count: 2, bytes: 10, skipped: false });
    plugin.collectUnusedAudio = async () => ({ json: '{"count":-1,"bytes":0,"skipped":false}' });
    await expect(r.collectUnusedAudio()).rejects.toMatchObject({ code: "CORRUPT" });
    plugin.restoreRecoveryBackup = async () => { throw { code: "BUSY", message: "private" }; };
    await expect(r.restoreRecoveryBackup()).rejects.toMatchObject({ code: "BUSY" });
  });
  it("maps the migration contract through JSON-only read/write bridge calls", async () => {
    expect((await runMigrationContract(() => new NativeSqliteProjectRepository(fakePlugin()))).scenarios).toBe(30);
  });
  it("passes the unmodified shared contract", async () => {
    expect(await runRepositoryContract(() => new NativeSqliteProjectRepository(fakePlugin()))).toEqual({ scenarios: 2, steps: 50 });
  });
  it("preserves all native codes, retryability and operation ID without leaking native messages", async () => {
    for (const code of Object.keys(REPOSITORY_ERROR_MESSAGES)) {
      const plugin = fakePlugin();
      plugin.commitProject = async () => { throw { code, data: { retryable: true }, message: "/private/body" }; };
      const pending = new NativeSqliteProjectRepository(plugin).commit({ project: projects.stage as Project,
        localRevision: "1", expectedRepositoryRevision: null, operationId: "error-test" });
      await expect(pending).rejects.toMatchObject({ code, operationId: "error-test", retryable: ["BUSY", "IO_ERROR", "DEVICE_LOCKED"].includes(code), message: REPOSITORY_ERROR_MESSAGES[code as keyof typeof REPOSITORY_ERROR_MESSAGES] });
    }
  });
  it("rejects malformed native bodies/results instead of interpreting them as absent", async () => {
    const plugin = fakePlugin();
    plugin.readProject = async () => ({ json: '{"json":"{}","repositoryRevision":"1","localRevision":"1","sync":null}' });
    await expect(new NativeSqliteProjectRepository(plugin).get("project_a")).rejects.toMatchObject({ code: "CORRUPT" });
    plugin.listSummaries = async () => ({ json: "invalid" });
    await expect(new NativeSqliteProjectRepository(plugin).list({ limit: 1 })).rejects.toMatchObject({ code: "CORRUPT" });
  });
  it("maps unknown native failures and creates a backup through the narrow API", async () => {
    const plugin = fakePlugin(), repository = new NativeSqliteProjectRepository(plugin);
    expect(await repository.createRecoveryBackup()).toEqual({ created: true });
    plugin.readProject = async () => { throw { code: "UNAVAILABLE", message: "private path" }; };
    await expect(repository.get("project_a")).rejects.toMatchObject({ code: "IO_ERROR" });
  });
  it("captures list options before the bridge await", async () => {
    const repository = new NativeSqliteProjectRepository(fakePlugin());
    await repository.commit({ project: projects.stage as Project, localRevision: "1", expectedRepositoryRevision: null, operationId: "create" });
    const query = { limit: 1 }, pending = repository.list(query);
    query.limit = 0;
    expect((await pending).items).toHaveLength(1);
  });
});
