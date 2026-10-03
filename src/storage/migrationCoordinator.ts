import { serializeProject } from "../project/codec";
import { canonicalJson, migrationIdentity, migrationStates, type MigrationRepository, type MigrationItem, type MigrationBatch } from "../repositories/migrationTypes";
import { compareRevisions, RepositoryError, type ProjectRepository, type RepositoryErrorCode } from "../repositories/types";
import { collectLegacySources, type LegacyReaderOptions } from "./legacyReaders";
import { createMigrationPlan, LEGACY_MIGRATION_ID } from "./migrationPlan";

export type StorageBootstrapResult = {
  completed: boolean; canContinue: boolean; migratedCount: number; recoveryCount: number; duplicateCount: number;
  failures: { source?: string; code: RepositoryErrorCode | "INTERRUPTED" }[];
  audioMigration: "deferred";
};
export type BootstrapOptions = {
  repository: ProjectRepository & MigrationRepository; readers?: LegacyReaderOptions;
  signal?: AbortSignal; onProgress?: (progress: { completed: number; total: number }) => void;
};
const interrupted = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error("INTERRUPTED"); };

export const migrateLegacyStorage = async ({ repository, readers, signal, onProgress }: BootstrapOptions): Promise<StorageBootstrapResult> => {
  const result: StorageBootstrapResult = { completed: false, canContinue: false, migratedCount: 0, recoveryCount: 0,
    duplicateCount: 0, failures: [], audioMigration: "deferred" };
  let initialized = false;
  try {
    const health = await repository.initialize();
    if (health.status !== "ready") throw new RepositoryError(health.errors[0] ?? "IO_ERROR");
    initialized = true;
    interrupted(signal);
    let stored = await repository.readMigration(LEGACY_MIGRATION_ID);
    if (stored && stored.kind !== "batch") throw new RepositoryError("CORRUPT");
    let batch = stored as MigrationBatch | null;
    if (batch?.state === "completed") {
      if (!batch.counts) throw new RepositoryError("CORRUPT");
      Object.assign(result, batch.counts, { completed: true, canContinue: true });
      result.failures.push(...batch.issues);
      onProgress?.({ completed: batch.itemIds.length, total: batch.itemIds.length });
      return result;
    }
    if (!batch) {
      const plan = await createMigrationPlan(await collectLegacySources(readers));
      for (const item of plan.items) {
        interrupted(signal);
        await repository.writeMigration(item, null);
      }
      // Do not seal an incomplete discovery. Readable items are still durable;
      // retry discovery after transient access/IO errors resolve.
      batch = plan.batch.issues.some(i => i.code !== "CORRUPT") ? plan.batch
        : await repository.writeMigration(plan.batch, null) as MigrationBatch;
    }
    result.failures.push(...batch.issues);
    let completed = 0;
    onProgress?.({ completed, total: batch.itemIds.length });
    for (const id of batch.itemIds) {
      interrupted(signal);
      let entry = await repository.readMigration(id);
      if (!entry || entry.kind !== "item") throw new RepositoryError("CORRUPT");
      let item: MigrationItem = entry;
      if (item.state === "discovered") {
        // Recovery payloads can be structurally invalid old projects, but must
        // remain valid JSON. Never normalize them into an empty project.
        const project = JSON.parse(item.json);
        if (item.disposition === "import") {
          const checked = serializeProject(project);
          if (!checked.ok || project.id !== item.targetId) throw new RepositoryError("CORRUPT");
        }
        item = await repository.writeMigration({ ...item, state: "validated" }, "discovered") as MigrationItem;
      }
      interrupted(signal);
      if (item.state === "validated") item = await repository.writeMigration({ ...item, state: "written",
        outcome: item.disposition === "import" ? "imported" : "recovery" }, "validated") as MigrationItem;
      interrupted(signal);
      if (item.state === "written") {
        const reread = await repository.readMigration(id);
        if (!reread || reread.kind !== "item" || migrationIdentity(reread) !== migrationIdentity(item) ||
            reread.outcome !== item.outcome || migrationStates.indexOf(reread.state) < 2) throw new RepositoryError("CORRUPT");
        item = reread; // Another bootstrap may have already verified/completed it.
        if (item.state === "written" && item.outcome !== "recovery") {
          const record = await repository.get(item.targetId);
          // A subsequent edit/delete is never undone. The atomic written
          // receipt proves the original creation; revision 1 must still match.
          if (record && record.repositoryRevision === "1" && canonicalJson(record.project) !== item.json) throw new RepositoryError("CORRUPT");
          if (record && compareRevisions(record.repositoryRevision, "1") < 0) throw new RepositoryError("CORRUPT");
        }
        if (item.state === "written") item = await repository.writeMigration({ ...item, state: "verified" }, "written") as MigrationItem;
      }
      interrupted(signal);
      if (item.state === "verified") item = await repository.writeMigration({ ...item, state: "completed" }, "verified") as MigrationItem;
      if (item.outcome === "imported") result.migratedCount++;
      else if (item.outcome === "recovery") result.recoveryCount++;
      else result.duplicateCount++;
      onProgress?.({ completed: ++completed, total: batch.itemIds.length });
    }
    interrupted(signal);
    // IO/access errors may resolve later: leave the batch unsealed and retry
    // source discovery on the next attempt, without touching committed items.
    const transient = batch.issues.some(i => i.code !== "CORRUPT");
    if (!transient) {
      await repository.writeMigration({ ...batch, state: "completed", counts: {
        migratedCount: result.migratedCount, recoveryCount: result.recoveryCount, duplicateCount: result.duplicateCount,
      } }, "discovered");
      result.completed = true;
    }
    result.canContinue = true;
  } catch (e) {
    const code = signal?.aborted ? "INTERRUPTED" : e instanceof RepositoryError ? e.code : "IO_ERROR";
    result.failures.push({ code });
    result.canContinue = initialized && !["CORRUPT", "UNSUPPORTED_SCHEMA", "ACCESS_DENIED", "DEVICE_LOCKED"].includes(code);
  }
  return result;
};
