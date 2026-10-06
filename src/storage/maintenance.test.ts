import { describe, expect, it, vi } from "vitest";
import { MemoryMigrationRepository } from "./testing/MemoryMigrationRepository";
import { migrateLegacyStorage } from "./migrationCoordinator";
import { listRecoveryCandidates, recoveryRequest, restoreCandidate, restorePreviousAsCopy } from "./recovery";
import { DAY, cleanupReasons, initialMaintenance, validateMaintenance, type MaintenanceAction, type MaintenanceRepository } from "./maintenanceTypes";
import { addAudioReference, migrationProtectsAudio } from "./audioReferences";
import { SaveCoordinator, canLeaveWithoutSaving } from "./saveCoordinator";
import { RepositoryError, type ProjectRecord } from "../repositories/types";
import { oldDataCleanupReasons } from "./maintenance";
import fixture from "../repositories/contract/fixtures/commitProjects.json";
import { normalizeProject } from "../project/normalizeProject";
import type { Project } from "../types";

class MemoryMaintenance extends MemoryMigrationRepository implements MaintenanceRepository {
  state = initialMaintenance(); previous: ProjectRecord | null = null;
  async readMaintenance() { return structuredClone(this.state); }
  async updateMaintenance(action: MaintenanceAction) {
    if (action.action === "reviewed") this.state.reviewedIds = [...new Set([...this.state.reviewedIds, ...action.ids])];
    return this.readMaintenance();
  }
  async getPrevious() { return this.previous; }
  async collectUnusedAudio() { return { count: 0, bytes: 0, skipped: true }; }
}
describe("device recovery and retention", () => {
  it("lists only recovery items, explains origin, copies to a fresh ID and retains original/candidate", async () => {
    const r = new MemoryMaintenance(), original = normalizeProject(fixture.stage as Project);
    await r.commit({ project: original, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed" });
    const candidate = { ...original, title: "以前の別の版" };
    const result = await migrateLegacyStorage({ repository: r, readers: { includeDrafts: false, local: () => ({ getItem: key => key === "stageflow.projects.v1" ? JSON.stringify([original]) : null }),
      native: { readText: async path => path.endsWith("backup.json") ? JSON.stringify([candidate]) : null, draftNames: async () => null } } });
    expect(result.completed).toBe(true);
    const list = await listRecoveryCandidates(r);
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ title: candidate.title, restorable: true, reviewed: false });
    expect(list[0].source).toContain("予備");
    expect((await r.list({ limit: 100 })).items).toHaveLength(1);
    const request = recoveryRequest(JSON.stringify(candidate)), receipt = await restoreCandidate(r, list[0].id, request);
    expect(receipt.id).not.toBe(original.id);
    expect(await restoreCandidate(r, list[0].id, request)).toEqual(receipt); // response-loss replay
    expect((await r.get(original.id!))?.project).toEqual(normalizeProject(original));
    expect((await r.list({ limit: 100 })).items).toHaveLength(2);
    expect((await listRecoveryCandidates(r))[0].reviewed).toBe(true);
    expect((await r.readMigration(list[0].id))?.kind).toBe("item");
  });
  it("retains a malformed recovery candidate and offers no restore", async () => {
    const r = new MemoryMaintenance();
    await migrateLegacyStorage({ repository: r, readers: { local: () => ({ getItem: key => key === "stageflow.projects.v1" ? JSON.stringify([{ title: "不正", members: "broken" }]) : null }), includeDrafts: false } });
    const list = await listRecoveryCandidates(r); expect(list).toHaveLength(1); expect(list[0].restorable).toBe(false);
    await expect(restoreCandidate(r, list[0].id)).rejects.toMatchObject({ code: "CORRUPT" });
  });
  it("rescues the previous generation as a new independent copy, leaving damaged ID alone", async () => {
    const r = new MemoryMaintenance(); r.previous = { project: fixture.stage as Project, repositoryRevision: "2", localRevision: "1", sync: null };
    const saved = await restorePreviousAsCopy(r, fixture.stage.id);
    expect(saved.id).not.toBe(fixture.stage.id); expect(await r.get(fixture.stage.id)).toBeNull();
  });
  it("protects current, previous, recovery and unfinished-import refs; aborts undecidable refs", () => {
    const refs = new Set<string>();
    for (const id of ["current", "previous", "recovery", "incomplete"]) addAudioReference({ audio: { id } }, refs);
    addAudioReference({ audio: null }, refs); expect([...refs]).toEqual(["current", "previous", "recovery", "incomplete"]);
    expect(() => addAudioReference({ audio: { name: "unknown" } }, refs)).toThrow();
    expect(() => addAudioReference(null, refs)).toThrow();
    expect(() => addAudioReference({ audio: "broken" }, refs)).toThrow();
    expect(migrationProtectsAudio({ disposition: "import", outcome: "imported", state: "completed" })).toBe(false);
    expect(migrationProtectsAudio({ disposition: "import", state: "validated" })).toBe(true);
    expect(migrationProtectsAudio({ disposition: "import", outcome: "recovery", state: "completed" })).toBe(true);
  });
  it("requires completion, verified entries, review, 30 days, healthy restarts and native verified backup", () => {
    const now = Date.now(); const input = { completed: true, issues: false, allVerified: true, reviewed: true,
      state: { ...initialMaintenance(), completedAt: now - 30 * DAY, successfulStarts: 2 }, native: true, backupVerified: true };
    expect(cleanupReasons(input, now)).toEqual([]);
    for (const patch of [{ completed: false }, { issues: true }, { allVerified: false }, { reviewed: false }, { backupVerified: false },
      { state: { ...input.state, completedAt: now - 30 * DAY + 1 } }, { state: { ...input.state, completedAt: null } },
      { state: { ...input.state, successfulStarts: 1 } }]) expect(cleanupReasons({ ...input, ...patch }, now).length).toBeGreaterThan(0);
    expect(cleanupReasons({ ...input, native: false, backupVerified: false }, now)).toEqual([]);
    expect(() => validateMaintenance({ ...initialMaintenance(), reviewedIds: ["x", "x"] })).toThrow();
  });
  it("allows explicit abandon after permanent failure, protects in-flight saves and preserves stored body", async () => {
    const r = new MemoryMaintenance(), p = fixture.stage as Project;
    await r.commit({ project: p, localRevision: "1", expectedRepositoryRevision: null, operationId: "initial" });
    const c = new SaveCoordinator(r, () => {}); c.activate((await r.get(p.id!))!);
    vi.spyOn(r, "commit").mockRejectedValue(new RepositoryError("ACCESS_DENIED"));
    c.edit({ ...p, title: "未保存" }); const work = c.flush(); expect(canLeaveWithoutSaving(c.state)).toBe(false);
    expect(await work).toBe(false); expect(canLeaveWithoutSaving(c.state)).toBe(true);
    c.discard(); expect(c.state).toBeNull(); expect((await r.get(p.id!))?.project.title).toBe(p.title);
    expect(canLeaveWithoutSaving(null)).toBe(false);
  });
  it("blocks old-source deletion when today's body is corrupt even after an old verified migration", async () => {
    const r = new MemoryMaintenance();
    await migrateLegacyStorage({ repository: r, readers: { local: () => ({ getItem: key => key === "stageflow.projects.v1" ? JSON.stringify([fixture.stage]) : null }), includeDrafts: false } });
    r.state.completedAt = Date.now() - 31 * DAY; r.state.successfulStarts = 2;
    expect(await oldDataCleanupReasons(r)).toEqual([]);
    vi.spyOn(r, "get").mockRejectedValue(new RepositoryError("CORRUPT"));
    expect(await oldDataCleanupReasons(r)).toContain("現在の保存データまたは前の保存を検証できません。");
  });
});
