import type { Project } from "../types";
import { assertStorageId } from "./ids";
import { RepositoryError } from "./types";

export const migrationStates = ["discovered", "validated", "written", "verified", "completed"] as const;
export type MigrationState = typeof migrationStates[number];
export type MigrationIssue = { source: string; code: "CORRUPT" | "ACCESS_DENIED" | "IO_ERROR" };
export type MigrationItem = {
  kind: "item"; id: string; state: MigrationState; sourceHash: string;
  sources: string[]; targetId: string; json: string;
  disposition: "import" | "recovery"; reason: string;
  draft?: { cloudProjectId: string; baseUpdatedAt: string | null; savedAt: string; status: "pending" };
  outcome?: "imported" | "duplicate" | "recovery";
};
export type MigrationBatch = {
  kind: "batch"; id: string; state: "discovered" | "completed"; itemIds: string[];
  sources: { source: string; status: "absent" | "unreadable" | "ok"; hash?: string }[];
  issues: MigrationIssue[];
  counts?: { migratedCount: number; recoveryCount: number; duplicateCount: number };
};
export type MigrationEntry = MigrationItem | MigrationBatch;
export interface MigrationRepository {
  readMigration(id: string): Promise<MigrationEntry | null>;
  /** Only predefined migration records/transitions; no generic KV, SQL or path API.
   * written + create-only body/summary is one transaction. The immutable item
   * and its durable state act as the response-loss receipt.
   */
  writeMigration(entry: MigrationEntry, expectedState: MigrationEntry["state"] | null): Promise<MigrationEntry>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
export const validateMigrationEntry = (v: unknown): MigrationEntry => {
  if (!object(v)) throw new RepositoryError("CORRUPT");
  assertStorageId(v.id);
  if (v.kind === "item") {
    assertStorageId(v.targetId);
    if (!migrationStates.includes(v.state as MigrationState) || typeof v.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(v.sourceHash) ||
        !strings(v.sources) || !v.sources.length || typeof v.json !== "string" || typeof v.reason !== "string" ||
        !["import", "recovery"].includes(v.disposition as string) ||
        (v.outcome !== undefined && !["imported", "duplicate", "recovery"].includes(v.outcome as string)) ||
        (migrationStates.indexOf(v.state as MigrationState) >= 2) !== (v.outcome !== undefined)) throw new RepositoryError("CORRUPT");
    if (v.draft !== undefined && (!object(v.draft) || typeof v.draft.cloudProjectId !== "string" || !v.draft.cloudProjectId ||
        !(v.draft.baseUpdatedAt === null || typeof v.draft.baseUpdatedAt === "string") || typeof v.draft.savedAt !== "string" || v.draft.status !== "pending")) throw new RepositoryError("CORRUPT");
  } else if (v.kind === "batch") {
    if (!["discovered", "completed"].includes(v.state as string) || !strings(v.itemIds) || new Set(v.itemIds).size !== v.itemIds.length ||
        !Array.isArray(v.sources) || !v.sources.every(s => object(s) && typeof s.source === "string" &&
          ["absent", "unreadable", "ok"].includes(s.status as string) && (s.hash === undefined || (typeof s.hash === "string" && /^[a-f0-9]{64}$/.test(s.hash)))) ||
        !Array.isArray(v.issues) || !v.issues.every(s => object(s) && typeof s.source === "string" && ["CORRUPT", "ACCESS_DENIED", "IO_ERROR"].includes(s.code as string))) throw new RepositoryError("CORRUPT");
    v.itemIds.forEach(assertStorageId);
    const counts = v.counts;
    if (counts !== undefined && (!object(counts) || v.state !== "completed" ||
        !["migratedCount", "recoveryCount", "duplicateCount"].every(k => Number.isInteger(counts[k]) && (counts[k] as number) >= 0))) throw new RepositoryError("CORRUPT");
  } else throw new RepositoryError("CORRUPT");
  return v as MigrationEntry;
};
/** JSON key order independent, arrays retain order. All inputs are JSON values. */
export const canonicalJson = (v: unknown): string => {
  const sort = (x: unknown): unknown => Array.isArray(x) ? x.map(sort) : object(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
  return JSON.stringify(sort(v));
};
export const migrationIdentity = (e: MigrationEntry): string => {
  const { state: _state, ...rest } = e;
  if (rest.kind === "item") { const { outcome: _outcome, ...identity } = rest; return canonicalJson(identity); }
  const { counts: _counts, ...identity } = rest;
  return canonicalJson(identity);
};
export const migrationTransition = (current: MigrationEntry | null, next: MigrationEntry, expected: MigrationEntry["state"] | null): "replay" | "write" => {
  validateMigrationEntry(next);
  const states: readonly string[] = next.kind === "batch" ? ["discovered", "completed"] : migrationStates;
  if (expected !== null && !states.includes(expected)) throw new RepositoryError("INVALID_ARGUMENT");
  if (!current) {
    if (expected !== null || next.state !== "discovered") throw new RepositoryError("CONFLICT");
    return "write";
  }
  validateMigrationEntry(current);
  if (migrationIdentity(current) !== migrationIdentity(next)) throw new RepositoryError("CONFLICT");
  const oldIndex = states.indexOf(current.state), newIndex = states.indexOf(next.state);
  if (current.kind === "item" && next.kind === "item" && newIndex > 2 && current.outcome !== next.outcome) throw new RepositoryError("CONFLICT");
  if (oldIndex >= newIndex) return "replay";
  if (current.state !== expected || newIndex !== oldIndex + 1) throw new RepositoryError("CONFLICT");
  return "write";
};
export const migrationProject = (item: MigrationItem): Project => JSON.parse(item.json) as Project;
