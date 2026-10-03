// Coordinator oracle only. Atomic storage is verified separately in Chromium/Swift.
import { MemoryProjectRepository } from "../../repositories/contract/testing/MemoryProjectRepository";
import { canonicalJson, migrationTransition, validateMigrationEntry, type MigrationEntry, type MigrationRepository } from "../../repositories/migrationTypes";
import { RepositoryError } from "../../repositories/types";

export class MemoryMigrationRepository extends MemoryProjectRepository implements MigrationRepository {
  private ledger = new Map<string, MigrationEntry>();
  private imported = new Set<string>();
  async readMigration(id: string): Promise<MigrationEntry | null> {
    const e = this.ledger.get(id);
    return e ? JSON.parse(JSON.stringify(e)) as MigrationEntry : null;
  }
  async writeMigration(input: MigrationEntry, expected: MigrationEntry["state"] | null): Promise<MigrationEntry> {
    const entry = validateMigrationEntry(JSON.parse(JSON.stringify(input)));
    const current = await this.readMigration(entry.id);
    if (migrationTransition(current, entry, expected) === "replay") return current!;
    if (entry.kind === "batch" && entry.state === "completed") {
      for (const id of entry.itemIds) if ((await this.readMigration(id))?.state !== "completed") throw new RepositoryError("CONFLICT");
    }
    if (entry.kind === "item" && entry.state === "written") {
      entry.outcome = "recovery";
      if (entry.disposition === "import") {
        const project = JSON.parse(entry.json);
        const record = await this.get(entry.targetId);
        if (record) { if (canonicalJson(record.project) === canonicalJson(project)) entry.outcome = "duplicate"; }
        else if (!this.imported.has(entry.targetId)) {
          await this.commit({ project, operationId: entry.id, localRevision: "1", expectedRepositoryRevision: null });
          this.imported.add(entry.targetId); entry.outcome = "imported";
        }
      }
    }
    this.ledger.set(entry.id, entry);
    return JSON.parse(JSON.stringify(entry)) as MigrationEntry;
  }
}
