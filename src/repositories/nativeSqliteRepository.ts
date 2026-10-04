// Load dynamically at the future platform-selection boundary. No App/barrel import.
import { registerPlugin } from "@capacitor/core";
import { serializeProject, validateProjectStructure } from "../project/codec";
import type { Project } from "../types";
import { validateMaintenance, type MaintenanceRepository, type MaintenanceAction, type GCResult } from "../storage/maintenanceTypes";
import { assertStorageId } from "./ids";
import { validateCollaboration, validateCollaborationTransition } from "./collaborationData";
import { validSharingSummary } from "./sharingSummary";
import { validateMigrationEntry, type MigrationEntry, type MigrationRepository } from "./migrationTypes";
import {
  assertRevision, isRevision, RepositoryError, REPOSITORY_ERROR_MESSAGES,
  type CommitReceipt, type CommitRequest, type ListQuery, type Page, type ProjectRecord,
  type ProjectRepository, type ProjectSummary, type RemoveRequest, type RenameRequest,
  type RepositoryErrorCode, type RepositoryHealth,
} from "./types";

type JsonCall = (input: { json: string }) => Promise<{ json: string }>;
export type NativeRepositoryPlugin = Record<
  "initialize" | "listSummaries" | "readProject" | "commitProject" | "touchOpened" |
  "renameProject" | "removeProject" | "createRecoveryBackup" | "readMigration" | "writeMigration", JsonCall> & Partial<Record<
  "readCommitReceipt" | "restoreRecoveryBackup" | "readPrevious" | "readMaintenance" | "updateMaintenance" | "collectUnusedAudio" | "legacyCleanupStatus" | "cleanupLegacyData", JsonCall>>;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const validSummary = (s: unknown): s is ProjectSummary => object(s) &&
  typeof s.id === "string" && typeof s.title === "string" && ["stage", "parade"].includes(s.mode as string) &&
  typeof s.createdAt === "string" && typeof s.updatedAt === "string" &&
  (s.lastOpenedAt === undefined || typeof s.lastOpenedAt === "string") &&
  Number.isInteger(s.memberCount) && (s.memberCount as number) >= 0 &&
  Number.isInteger(s.sceneCount) && (s.sceneCount as number) >= 0 &&
  isRevision(s.repositoryRevision) && s.syncStatus === "local" &&
  (s.audioId === undefined || typeof s.audioId === "string") && validSharingSummary(s.sharing);
const summary = (value: unknown): ProjectSummary => {
  if (!validSummary(value)) throw new RepositoryError("CORRUPT");
  try { assertStorageId(value.id); if (value.audioId !== undefined) assertStorageId(value.audioId); }
  catch { throw new RepositoryError("CORRUPT"); }
  return value;
};
const receipt = (v: unknown, operationId: string, id: string): CommitReceipt => {
  if (!object(v) || v.id !== id || v.operationId !== operationId || !isRevision(v.repositoryRevision) || !isRevision(v.localRevision)) {
    throw new RepositoryError("CORRUPT", operationId);
  }
  const s = summary(v.summary);
  if (s.id !== v.id || s.repositoryRevision !== v.repositoryRevision) throw new RepositoryError("CORRUPT", operationId);
  return v as CommitReceipt;
};
export const classifyNativeRepositoryError = (e: unknown, operationId?: string): RepositoryError => {
  if (e instanceof RepositoryError) return new RepositoryError(e.code, operationId ?? e.operationId);
  const code = object(e) && typeof e.code === "string" && Object.prototype.hasOwnProperty.call(REPOSITORY_ERROR_MESSAGES, e.code)
    ? e.code as RepositoryErrorCode : "IO_ERROR";
  return new RepositoryError(code, operationId);
};

// Register once per page: Capacitor warns (and reuses the proxy) on a second registration,
// which happens when the repository is recreated (e.g. React StrictMode effects).
let defaultPlugin: NativeRepositoryPlugin | undefined;
const nativeRepositoryPlugin = () => (defaultPlugin ??= registerPlugin<NativeRepositoryPlugin>("ProjectRepository"));

export class NativeSqliteProjectRepository implements ProjectRepository, MigrationRepository, MaintenanceRepository {
  private nativeSchema: number | undefined;
  constructor(private readonly plugin: NativeRepositoryPlugin = nativeRepositoryPlugin()) {}

  private async invoke(method: keyof NativeRepositoryPlugin, input: unknown = {}, operationId?: string): Promise<unknown> {
    // Serialize before the first await: subsequent editor mutation cannot alter this snapshot.
    let json: string;
    try { json = JSON.stringify(input); } catch { throw new RepositoryError("INVALID_ARGUMENT", operationId); }
    let response: { json: string };
    try { const call = this.plugin[method]; if (!call) throw new RepositoryError("IO_ERROR"); response = await call({ json }); }
    catch (e) { throw classifyNativeRepositoryError(e, operationId); }
    try {
      if (!object(response) || typeof response.json !== "string") throw new Error();
      return JSON.parse(response.json) as unknown;
    } catch { throw new RepositoryError("CORRUPT", operationId); }
  }
  async initialize(): Promise<RepositoryHealth> {
    const v = await this.invoke("initialize");
    if (!object(v) || v.status !== "ready" || ![1, 2].includes(v.schemaVersion as number) || !Array.isArray(v.errors) || v.errors.length) throw new RepositoryError("CORRUPT");
    this.nativeSchema = v.schemaVersion as number;
    return v as RepositoryHealth;
  }
  async list(query: ListQuery): Promise<Page<ProjectSummary>> {
    const { limit, mode, cursor } = query;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (mode !== undefined && mode !== "stage" && mode !== "parade") ||
        (cursor !== undefined && typeof cursor !== "string")) throw new RepositoryError("INVALID_ARGUMENT");
    const v = await this.invoke("listSummaries", { limit, mode, cursor });
    if (!object(v) || !Array.isArray(v.items) || v.items.length > limit ||
        (v.nextCursor !== null && typeof v.nextCursor !== "string")) throw new RepositoryError("CORRUPT");
    return { items: v.items.map(summary), nextCursor: v.nextCursor as string | null };
  }
  async get(id: string): Promise<ProjectRecord | null> {
    assertStorageId(id);
    const v = await this.invoke("readProject", { id });
    return this.decodeRecord(v, id);
  }
  private async decodeRecord(v: unknown, id: string): Promise<ProjectRecord | null> {
    if (v === null) return null;
    if (!object(v) || typeof v.json !== "string" || !isRevision(v.repositoryRevision) || !isRevision(v.localRevision) || v.sync !== null) throw new RepositoryError("CORRUPT");
    if (v.collaboration != null) throw new RepositoryError("CORRUPT"); // Only the string bridge is supported.
    let project: Project;
    try {
      const checked = validateProjectStructure(JSON.parse(v.json));
      if (!checked.ok) throw checked.error;
      const encoded = serializeProject(checked.value);
      if (!encoded.ok || checked.value.id !== id) throw new Error();
      // Repository bodies are already normalized. Do not generate IDs/defaults at read time.
      project = checked.value;
    } catch { throw new RepositoryError("CORRUPT"); }
    let collaboration;
    if (v.collaborationJSON != null) {
      try {
        if (typeof v.collaborationJSON !== "string") throw new Error();
        collaboration = validateCollaboration(JSON.parse(v.collaborationJSON));
        (await import("../collaboration/persistence")).validateCollaborationProject(collaboration, project);
      } catch (e) { if (e instanceof RepositoryError && e.code === "UNSUPPORTED_SCHEMA") throw e; throw new RepositoryError("CORRUPT"); }
    }
    return { project, repositoryRevision: v.repositoryRevision, localRevision: v.localRevision, sync: null,
      ...(collaboration ? { collaboration } : {}) };
  }
  async commit(input: CommitRequest): Promise<CommitReceipt> {
    const encoded = serializeProject(input.project);
    if (!encoded.ok) throw encoded.error;
    const id = assertStorageId(input.project.id), op = assertStorageId(input.operationId);
    assertRevision(input.localRevision);
    if (input.expectedRepositoryRevision !== null) assertRevision(input.expectedRepositoryRevision);
    // Capture before any await, including lazy Yjs import and schema discovery.
    const request = { id, json: encoded.value, localRevision: input.localRevision,
      expectedRepositoryRevision: input.expectedRepositoryRevision, operationId: op,
      collaborationJSON: input.collaboration == null ? null : JSON.stringify(validateCollaboration(input.collaboration)) };
    if (request.collaborationJSON !== null) {
      if (this.nativeSchema === undefined) await this.initialize();
      if (this.nativeSchema !== 2) throw new RepositoryError("UNSUPPORTED_SCHEMA", op);
      const data = validateCollaboration(JSON.parse(request.collaborationJSON));
      const runtime = await import("../collaboration/persistence");
      runtime.validateCollaborationProject(data, JSON.parse(request.json) as Project);
      // Response-loss retries must return their receipt even if the current body
      // was later deleted, corrupted or advanced to another document state.
      const replay = await this.invoke("readCommitReceipt", request, op);
      if (replay !== null) return receipt(replay, op, id);
      const saved = await this.get(id);
      // Native rechecks CAS under BEGIN IMMEDIATE. If another writer wins after
      // this read, commit rejects and the coordinator hydrates/merges/retries.
      // A replay may legitimately refer to an older revision; native owns receipts.
      if (saved?.repositoryRevision === request.expectedRepositoryRevision) {
        validateCollaborationTransition(saved.collaboration, data);
        if (saved.collaboration) runtime.assertCollaborationExtends(saved.collaboration, data);
      }
    }
    const v = await this.invoke("commitProject", request, op);
    return receipt(v, op, id);
  }
  async touchOpened(id: string, at: string): Promise<ProjectSummary> {
    assertStorageId(id);
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new RepositoryError("INVALID_ARGUMENT");
    const s = summary(await this.invoke("touchOpened", { id, openedAt: at }));
    if (s.id !== id || s.lastOpenedAt !== at) throw new RepositoryError("CORRUPT");
    return s;
  }
  async rename(input: RenameRequest): Promise<CommitReceipt> {
    const id = assertStorageId(input.id), op = assertStorageId(input.operationId);
    assertRevision(input.localRevision); assertRevision(input.expectedRepositoryRevision);
    if (typeof input.title !== "string" || !input.title.trim() || !Number.isFinite(Date.parse(input.updatedAt))) throw new RepositoryError("INVALID_ARGUMENT", op);
    return receipt(await this.invoke("renameProject", input, op), op, id);
  }
  async remove(input: RemoveRequest): Promise<void> {
    assertStorageId(input.id); const op = assertStorageId(input.operationId); assertRevision(input.expectedRepositoryRevision);
    if (await this.invoke("removeProject", input, op) !== null) throw new RepositoryError("CORRUPT", op);
  }
  async createRecoveryBackup(): Promise<{ created: boolean }> {
    const v = await this.invoke("createRecoveryBackup", { ifDue: true });
    if (!object(v) || typeof v.created !== "boolean") throw new RepositoryError("CORRUPT");
    return { created: v.created };
  }
  async restoreRecoveryBackup(): Promise<void> {
    if (await this.invoke("restoreRecoveryBackup") !== null) throw new RepositoryError("CORRUPT");
  }
  async getPrevious(id: string): Promise<ProjectRecord | null> {
    assertStorageId(id); return this.decodeRecord(await this.invoke("readPrevious", { id }), id);
  }
  async readMaintenance() { return validateMaintenance(await this.invoke("readMaintenance")); }
  async updateMaintenance(action: MaintenanceAction) { return validateMaintenance(await this.invoke("updateMaintenance", action)); }
  async collectUnusedAudio(): Promise<GCResult> {
    const v = await this.invoke("collectUnusedAudio");
    if (!object(v) || !Number.isSafeInteger(v.count) || (v.count as number) < 0 || !Number.isSafeInteger(v.bytes) || (v.bytes as number) < 0 || typeof v.skipped !== "boolean") throw new RepositoryError("CORRUPT");
    return v as GCResult;
  }
  async legacyCleanupStatus(): Promise<string[]> {
    const v = await this.invoke("legacyCleanupStatus");
    if (!Array.isArray(v) || !v.every(x => typeof x === "string")) throw new RepositoryError("CORRUPT");
    return v as string[];
  }
  async cleanupLegacyData(): Promise<void> {
    if (await this.invoke("cleanupLegacyData") !== null) throw new RepositoryError("CORRUPT");
  }
  async readMigration(id: string): Promise<MigrationEntry | null> {
    assertStorageId(id);
    const result = await this.invoke("readMigration", { id });
    if (result === null) return null;
    let entry: MigrationEntry;
    try { entry = validateMigrationEntry(result); } catch { throw new RepositoryError("CORRUPT"); }
    if (entry.id !== id) throw new RepositoryError("CORRUPT");
    return entry;
  }
  async writeMigration(entry: MigrationEntry, expectedState: MigrationEntry["state"] | null): Promise<MigrationEntry> {
    validateMigrationEntry(entry);
    const response = await this.invoke("writeMigration", { entry, expectedState });
    let result: MigrationEntry;
    try { result = validateMigrationEntry(response); } catch { throw new RepositoryError("CORRUPT"); }
    if (result.id !== entry.id) throw new RepositoryError("CORRUPT");
    return result;
  }
}
