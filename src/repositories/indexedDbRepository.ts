// Import this module dynamically at the future platform selection boundary.
// No application barrel/static import; this phase does not connect App storage.
import { serializeProject } from "../project/codec";
import { runIdbTransaction } from "../utils/idbTransaction";
import { assertStorageId } from "./ids";
import { DAY, MAINTENANCE_ID, initialMaintenance, validateMaintenance, type MaintenanceAction, type MaintenanceState, type GCResult, type MaintenanceRepository } from "../storage/maintenanceTypes";
import { withStorageWrite, withStorageMaintenance } from "../storage/maintenanceLock";
import { addAudioReference, migrationProtectsAudio } from "../storage/audioReferences";
import { canonicalJson, migrationTransition, validateMigrationEntry, type MigrationEntry, type MigrationRepository } from "./migrationTypes";
import {
  PROJECT_DB_NAME, PROJECT_DB_VERSION, PROJECT_STORES, decodeBody, decodeSummary,
  encodeBody, encodeSummary, jsonIntegrity, object, requestDigest, scalarKey, sortTime, validSummary,
  type StoredBody,
} from "./indexedDbFormat";
import {
  assertRevision, compareRevisions, incrementRevision, isRevision, RepositoryError,
  type CommitReceipt, type CommitRequest, type ListQuery, type Page, type ProjectRecord,
  type ProjectRepository, type ProjectSummary, type RemoveRequest, type RenameRequest,
} from "./types";

export const classifyIndexedDbError = (error: unknown, operationId?: string): RepositoryError => {
  if (error instanceof RepositoryError) return new RepositoryError(error.code, operationId ?? error.operationId);
  const name = object(error) ? error.name : undefined;
  const code = name === "QuotaExceededError" ? "QUOTA_EXCEEDED"
    : name === "InvalidStateError" || name === "TransactionInactiveError" ? "BUSY"
    : name === "SecurityError" || name === "NotAllowedError" ? "ACCESS_DENIED"
    : name === "VersionError" ? "UNSUPPORTED_SCHEMA"
    : name === "DataError" || name === "DataCloneError" ? "CORRUPT" : "IO_ERROR";
  return new RepositoryError(code, operationId);
};
type StoredOperation = { operationId: string; signature: string; kind: "commit" | "rename" | "remove"; receipt?: CommitReceipt };
type Mutation = { kind: "commit"; request: CommitRequest; json: string }
  | { kind: "rename"; request: RenameRequest } | { kind: "remove"; request: RemoveRequest };
const capture = <T>(input: T): T => {
  try { return JSON.parse(JSON.stringify(input)) as T; }
  catch { throw new RepositoryError("INVALID_ARGUMENT"); }
};

export class IndexedDbProjectRepository implements ProjectRepository, MigrationRepository, MaintenanceRepository {
  private db?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;
  private invalidated = false;
  private generation = 0;
  private readonly factory: IDBFactory | undefined;
  private readonly name: string;
  constructor(options: { factory?: IDBFactory; dbName?: string } = {}) {
    this.factory = options.factory ?? globalThis.indexedDB;
    this.name = options.dbName ?? PROJECT_DB_NAME;
  }

  /** Explicit lifecycle for tab shutdown and isolated tests. No DB deletion. */
  close(): void { this.generation++; this.db?.close(); this.db = undefined; }

  private connection(): Promise<IDBDatabase> {
    if (this.invalidated) return Promise.reject(new RepositoryError("BUSY"));
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;
    const generation = this.generation;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.factory) { reject(new RepositoryError("ACCESS_DENIED")); return; }
      let rejected = false;
      const fail = (error: unknown) => { rejected = true; reject(classifyIndexedDbError(error)); };
      let request: IDBOpenDBRequest;
      try { request = this.factory.open(this.name, PROJECT_DB_VERSION); }
      catch (error) { fail(error); return; }
      request.onblocked = () => fail(new RepositoryError("BUSY"));
      request.onupgradeneeded = event => {
        if (rejected || generation !== this.generation) {
          fail(new RepositoryError("BUSY")); request.transaction!.abort(); return;
        }
        try {
          if (event.oldVersion > 1) throw new RepositoryError("UNSUPPORTED_SCHEMA");
          for (const name of PROJECT_STORES) {
            if (event.oldVersion === 1 && name !== "migration_items") continue;
            const store = request.result.createObjectStore(name, { keyPath: name === "operation_receipts" ? "operationId" : "id" });
            if (name === "project_summaries") {
              store.createIndex("by_order", ["sortTime", "sortId"], { unique: true });
              store.createIndex("by_mode_order", ["summary.mode", "sortTime", "sortId"], { unique: true });
            }
          }
        } catch (error) { fail(error); request.transaction!.abort(); }
      };
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (rejected || this.invalidated || generation !== this.generation) {
          db.close(); fail(new RepositoryError("BUSY")); return;
        }
        db.onversionchange = () => { this.invalidated = true; this.close(); };
        db.onclose = () => { this.invalidated = true; this.db = undefined; };
        try {
          if (db.version !== PROJECT_DB_VERSION) throw new RepositoryError("UNSUPPORTED_SCHEMA");
          const tx = db.transaction(PROJECT_STORES, "readonly");
          for (const name of PROJECT_STORES) {
            if (tx.objectStore(name).keyPath !== (name === "operation_receipts" ? "operationId" : "id")) throw new RepositoryError("CORRUPT");
          }
          const summaries = tx.objectStore("project_summaries");
          for (const [name, keys] of [["by_order", ["sortTime", "sortId"]], ["by_mode_order", ["summary.mode", "sortTime", "sortId"]]] as const) {
            const index = summaries.index(name);
            if (!index.unique || JSON.stringify(index.keyPath) !== JSON.stringify(keys)) throw new RepositoryError("CORRUPT");
          }
          // Wait for schema inspection too; an externally closed DB must not
          // report healthy merely because open() succeeded.
          tx.oncomplete = () => {
            if (this.invalidated || generation !== this.generation) { db.close(); fail(new RepositoryError("BUSY")); return; }
            this.db = db; resolve(db);
          };
          tx.onabort = tx.onerror = () => { db.close(); fail(tx.error); };
        } catch (error) {
          db.close();
          fail(object(error) && error.name === "NotFoundError" ? new RepositoryError("CORRUPT") : error);
        }
      };
    });
    this.opening = opening;
    void opening.then(() => { this.opening = undefined; }, () => { this.opening = undefined; });
    return opening;
  }

  async initialize() {
    await this.connection();
    return { status: "ready" as const, schemaVersion: PROJECT_DB_VERSION, errors: [] };
  }

  private async transaction<T>(stores: string[], mode: IDBTransactionMode,
    work: Parameters<typeof runIdbTransaction<T>>[3], operationId?: string, unlocked = false): Promise<T> {
    try {
      const db = await this.connection();
      const run = () => runIdbTransaction(db, stores, mode, work, error => classifyIndexedDbError(error, operationId));
      return await (mode === "readwrite" && !unlocked ? withStorageWrite(run) : run());
    } catch (error) { throw classifyIndexedDbError(error, operationId); }
  }

  async getPrevious(id: string): Promise<ProjectRecord | null> {
    assertStorageId(id);
    return this.transaction(["project_previous"], "readonly", (tx, result, fail) => {
      const read = tx.objectStore("project_previous").get(id);
      read.onsuccess = () => { try { result(read.result === undefined ? null : decodeBody(read.result, id)); } catch (e) { fail(e); } };
    });
  }
  private decodeMaintenance(raw: unknown): MaintenanceState {
    if (raw === undefined) return initialMaintenance();
    if (!object(raw) || raw.id !== MAINTENANCE_ID || typeof raw.json !== "string") throw new RepositoryError("CORRUPT");
    const check = jsonIntegrity(raw.json);
    if (raw.byteLength !== check.byteLength || raw.crc32 !== check.crc32) throw new RepositoryError("CORRUPT");
    try { return validateMaintenance(JSON.parse(raw.json)); } catch { throw new RepositoryError("CORRUPT"); }
  }
  async readMaintenance(): Promise<MaintenanceState> {
    return this.transaction(["migration_items"], "readonly", (tx, result, fail) => {
      const read = tx.objectStore("migration_items").get(MAINTENANCE_ID);
      read.onsuccess = () => { try { result(this.decodeMaintenance(read.result)); } catch (e) { fail(e); } };
    });
  }
  async updateMaintenance(input: MaintenanceAction): Promise<MaintenanceState> {
    const action = capture(input);
    if (!["started", "reviewed"].includes(action.action)) throw new RepositoryError("INVALID_ARGUMENT");
    if (action.action === "reviewed") action.ids.forEach(assertStorageId);
    return this.transaction(["migration_items"], "readwrite", (tx, result, fail) => {
      const store = tx.objectStore("migration_items"), read = store.get(MAINTENANCE_ID);
      read.onsuccess = () => { try {
        const state = this.decodeMaintenance(read.result);
        const batchRead = store.get("legacy-projects-v1");
        batchRead.onsuccess = () => { try {
          const batch = batchRead.result === undefined ? null : this.decodeMigration(batchRead.result, "legacy-projects-v1");
          if (action.action === "started" && batch?.state === "completed") {
            state.completedAt ??= Date.now(); state.successfulStarts++;
          } else if (action.action === "reviewed") {
            if (!batch || batch.kind !== "batch" || action.ids.some(id => !batch.itemIds.includes(id))) throw new RepositoryError("INVALID_ARGUMENT");
            state.reviewedIds = [...new Set([...state.reviewedIds, ...action.ids])];
          }
          const json = JSON.stringify(validateMaintenance(state));
          store.put({ id: MAINTENANCE_ID, json, ...jsonIntegrity(json) }); result(state);
        } catch (e) { fail(e); } };
      } catch (e) { fail(e); } };
    });
  }
  async collectUnusedAudio(): Promise<GCResult> {
    const skipped: GCResult = { count: 0, bytes: 0, skipped: true };
    return withStorageMaintenance(async () => {
      const state = await this.readMaintenance();
      if (!state.completedAt || (state.gcAt !== null && Date.now() - state.gcAt < DAY)) return skipped;
      const batch = await this.readMigration("legacy-projects-v1");
      if (batch?.state !== "completed") return skipped;
      // One verified body at a time; no summary-only shortcuts and no getAll bodies.
      const references = await this.transaction<Set<string>>(["project_bodies", "project_previous", "migration_items"], "readonly", (tx, result, fail) => {
        const ids = new Set<string>(); let remaining = 3;
        for (const name of ["project_bodies", "project_previous", "migration_items"]) {
          const read = tx.objectStore(name).openCursor();
          read.onsuccess = () => { try {
            const cursor = read.result;
            if (!cursor) { if (!--remaining) result(ids); return; }
            if (name === "migration_items") {
              if (cursor.key === MAINTENANCE_ID) this.decodeMaintenance(cursor.value);
              else {
                const entry = this.decodeMigration(cursor.value, String(cursor.key));
                if (entry.kind === "item" && migrationProtectsAudio(entry)) addAudioReference(JSON.parse(entry.json), ids);
              }
            } else addAudioReference(decodeBody(cursor.value, String(cursor.key)).project, ids);
            cursor.continue();
          } catch (e) { fail(e); } };
        }
      });
      const stats = await (await import("../utils/audioStorage")).collectWebAudio(references);
      await this.transaction(["migration_items"], "readwrite", (tx, result, fail) => {
        const store = tx.objectStore("migration_items"), read = store.get(MAINTENANCE_ID);
        read.onsuccess = () => { try {
          const current = this.decodeMaintenance(read.result); current.gcAt = Date.now();
          const json = JSON.stringify(current); store.put({ id: MAINTENANCE_ID, json, ...jsonIntegrity(json) }); result(undefined);
        } catch (e) { fail(e); } };
      }, undefined, true);
      console.info("[audio GC]", { count: stats.count, bytes: stats.bytes });
      return stats;
    }, skipped);
  }

  async get(id: string): Promise<ProjectRecord | null> {
    assertStorageId(id);
    return this.transaction(["project_bodies"], "readonly", (tx, result, fail) => {
      const request = tx.objectStore("project_bodies").get(id);
      request.onsuccess = () => {
        try { result(request.result === undefined ? null : decodeBody(request.result, id)); }
        catch (error) { fail(error); }
      };
    });
  }

  async readMigration(id: string): Promise<MigrationEntry | null> {
    assertStorageId(id);
    return this.transaction(["migration_items"], "readonly", (tx, result, fail) => {
      const request = tx.objectStore("migration_items").get(id);
      request.onsuccess = () => {
        try { result(request.result === undefined ? null : this.decodeMigration(request.result, id)); }
        catch (e) { fail(e); }
      };
    });
  }
  private decodeMigration(raw: unknown, id: string): MigrationEntry {
    if (!object(raw) || raw.id !== id || typeof raw.json !== "string") throw new RepositoryError("CORRUPT");
    const integrity = jsonIntegrity(raw.json);
    if (raw.byteLength !== integrity.byteLength || raw.crc32 !== integrity.crc32) throw new RepositoryError("CORRUPT");
    try {
      const entry = validateMigrationEntry(JSON.parse(raw.json));
      if (entry.id !== id) throw new RepositoryError("CORRUPT");
      return entry;
    } catch { throw new RepositoryError("CORRUPT"); }
  }
  async writeMigration(input: MigrationEntry, expectedState: MigrationEntry["state"] | null): Promise<MigrationEntry> {
    const entry = validateMigrationEntry(capture(input));
    const claim = entry.kind === "item" ? `legacy-target-${await requestDigest(entry.targetId)}` : "";
    return this.transaction(["migration_items", "project_bodies", "project_summaries", "operation_receipts"], "readwrite", (tx, result, fail) => {
      const ledger = tx.objectStore("migration_items");
      const request = ledger.get(entry.id);
      const persist = () => {
        const json = JSON.stringify(entry);
        ledger.put({ id: entry.id, json, ...jsonIntegrity(json) }); result(entry);
      };
      request.onsuccess = () => {
        try {
          const current = request.result === undefined ? null : this.decodeMigration(request.result, entry.id);
          if (migrationTransition(current, entry, expectedState) === "replay") { result(current!); return; }
          if (entry.kind === "batch" && entry.state === "completed") {
            let remaining = entry.itemIds.length;
            if (!remaining) { persist(); return; }
            for (const id of entry.itemIds) {
              const read = ledger.get(id);
              read.onsuccess = () => {
                try {
                  if (this.decodeMigration(read.result, id).state !== "completed") throw new RepositoryError("CONFLICT");
                  if (!--remaining) persist();
                } catch (e) { fail(e); }
              };
            }
            return;
          }
          if (entry.kind === "item" && entry.state === "validated" && entry.disposition === "import") {
            const project = JSON.parse(entry.json);
            const encoded = serializeProject(project);
            if (!encoded.ok || project.id !== entry.targetId) throw new RepositoryError("CORRUPT");
          }
          if (entry.kind !== "item" || entry.state !== "written") { persist(); return; }
          if (entry.disposition === "recovery") { entry.outcome = "recovery"; persist(); return; }
          const project = JSON.parse(entry.json);
          const encoded = serializeProject(project);
          if (!encoded.ok || project.id !== entry.targetId) throw new RepositoryError("CORRUPT");
          const bodies = tx.objectStore("project_bodies");
          const read = bodies.get(entry.targetId);
          read.onsuccess = () => {
            try {
              if (read.result !== undefined) {
                const stored = decodeBody(read.result, entry.targetId);
                entry.outcome = canonicalJson(stored.project) === canonicalJson(project) ? "duplicate" : "recovery";
                persist();
              } else {
                const operations = tx.objectStore("operation_receipts");
                const seen = operations.get(claim);
                seen.onsuccess = () => {
                  try {
                    // A prior migration created this ID and it was since
                    // deleted. Retained receipt prevents accidental revival.
                    if (seen.result !== undefined) { entry.outcome = "recovery"; persist(); return; }
                    const record: ProjectRecord = { project, repositoryRevision: "1", localRevision: "1", sync: null };
                    const summary = encodeSummary(record);
                    bodies.put(encodeBody(record)); tx.objectStore("project_summaries").put(summary);
                    const receipt: CommitReceipt = { id: entry.targetId, operationId: claim,
                      repositoryRevision: "1", localRevision: "1", summary: summary.summary };
                    operations.put({ operationId: claim, signature: entry.sourceHash, kind: "commit", receipt } satisfies StoredOperation);
                    entry.outcome = "imported";
                    persist();
                  } catch (e) { fail(e); }
                };
              }
            } catch (e) { fail(e); }
          };
        } catch (e) { fail(e); }
      };
    });
  }

  async list(query: ListQuery): Promise<Page<ProjectSummary>> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100 ||
        (query.mode !== undefined && query.mode !== "stage" && query.mode !== "parade")) throw new RepositoryError("INVALID_ARGUMENT");
    // Capture before the asynchronous connection boundary.
    const { mode, limit, cursor } = query;
    let after: [number, string] | undefined;
    if (cursor !== undefined) {
      try {
        const parsed: unknown = JSON.parse(cursor);
        if (!object(parsed) || parsed.version !== 1 || parsed.mode !== mode || typeof parsed.time !== "number" ||
            !Number.isFinite(parsed.time) || !Number.isInteger(parsed.time) || Math.abs(parsed.time) > 8640000000000000) throw new Error();
        after = [-parsed.time, scalarKey(assertStorageId(parsed.id))];
      } catch { throw new RepositoryError("INVALID_ARGUMENT"); }
    }
    const range = mode ? IDBKeyRange.bound(after ? [mode, ...after] : [mode], [mode, []], !!after, true)
      : after ? IDBKeyRange.lowerBound(after, true) : undefined;
    return this.transaction(["project_summaries"], "readonly", (tx, result, fail) => {
      const request = tx.objectStore("project_summaries").index(mode ? "by_mode_order" : "by_order").getAll(range, limit + 1);
      request.onsuccess = () => {
        try {
          const all = request.result.map(decodeSummary);
          const items = all.slice(0, limit);
          const last = items[items.length - 1];
          result({ items, nextCursor: all.length > limit ? JSON.stringify({ version: 1, ...(mode ? { mode } : {}), time: sortTime(last), id: last.id }) : null });
        } catch (error) { fail(error); }
      };
    });
  }

  async commit(input: CommitRequest): Promise<CommitReceipt> {
    const encoded = serializeProject(input.project);
    if (!encoded.ok) throw encoded.error;
    const request = capture(input);
    assertStorageId(request.project.id);
    assertStorageId(request.operationId);
    assertRevision(request.localRevision);
    if (request.expectedRepositoryRevision !== null) assertRevision(request.expectedRepositoryRevision);
    const receipt = (await this.mutate({ kind: "commit", request, json: encoded.value }))!;
    if (receipt.summary.audioId) {
      try { await (await import("../utils/audioStorage")).confirmWebAudioReference(receipt.summary.audioId); }
      catch { console.info("[audio publication] pending marker retained"); }
    }
    return receipt;
  }

  async rename(input: RenameRequest): Promise<CommitReceipt> {
    const request = capture(input);
    assertStorageId(request.id); assertStorageId(request.operationId);
    assertRevision(request.localRevision); assertRevision(request.expectedRepositoryRevision);
    if (typeof request.title !== "string" || !request.title.trim() || !Number.isFinite(Date.parse(request.updatedAt))) throw new RepositoryError("INVALID_ARGUMENT", request.operationId);
    return (await this.mutate({ kind: "rename", request }))!;
  }

  async remove(input: RemoveRequest): Promise<void> {
    const request = capture(input);
    assertStorageId(request.id); assertStorageId(request.operationId); assertRevision(request.expectedRepositoryRevision);
    await this.mutate({ kind: "remove", request });
  }

  private async mutate(mutation: Mutation): Promise<CommitReceipt | undefined> {
    const { kind, request } = mutation;
    const id = mutation.kind === "commit" ? mutation.request.project.id! : mutation.request.id;
    const operationId = request.operationId;
    // Async crypto finishes BEFORE starting the transaction. No payload copy
    // per receipt; exact request bytes are fingerprinted by SHA-256.
    let signature: string;
    try { signature = await requestDigest(JSON.stringify({ kind, request })); }
    catch (error) { throw classifyIndexedDbError(error, operationId); }
    const prepared = kind === "commit" ? encodeBody({ project: mutation.request.project,
      repositoryRevision: "1", localRevision: mutation.request.localRevision, sync: null }, mutation.json) : undefined;
    return this.transaction(PROJECT_STORES, "readwrite", (tx, result, fail) => {
      const operations = tx.objectStore("operation_receipts");
      const replay = operations.get(operationId);
      replay.onsuccess = () => {
        try {
          if (replay.result !== undefined) {
            const op: unknown = replay.result;
            if (!object(op) || op.operationId !== operationId || typeof op.signature !== "string" || !/^[a-f0-9]{64}$/.test(op.signature) ||
                !["commit", "rename", "remove"].includes(op.kind as string)) throw new RepositoryError("CORRUPT");
            if (op.signature !== signature || op.kind !== kind) throw new RepositoryError("CONFLICT");
            if (kind !== "remove") {
              const r = op.receipt;
              if (!object(r) || r.id !== id || r.operationId !== operationId || !isRevision(r.repositoryRevision) || !isRevision(r.localRevision) ||
                  !validSummary(r.summary) || r.summary.id !== id || r.summary.repositoryRevision !== r.repositoryRevision ||
                  r.localRevision !== (request as CommitRequest | RenameRequest).localRevision) throw new RepositoryError("CORRUPT");
              result(r as CommitReceipt);
            } else {
              if (op.receipt !== undefined) throw new RepositoryError("CORRUPT");
              result(undefined);
            }
            return;
          }
          const bodies = tx.objectStore("project_bodies");
          const read = bodies.get(id);
          read.onsuccess = () => {
            try {
              const raw: StoredBody | undefined = read.result;
              const current = raw === undefined ? null : decodeBody(raw, id);
              if (request.expectedRepositoryRevision === null) {
                if (current) throw new RepositoryError("CONFLICT");
              } else {
                if (!current) throw new RepositoryError("NOT_FOUND");
                if (current.repositoryRevision !== request.expectedRepositoryRevision) throw new RepositoryError("CONFLICT");
              }
              if (kind !== "remove" && current && compareRevisions((request as CommitRequest | RenameRequest).localRevision, current.localRevision) <= 0) throw new RepositoryError("CONFLICT");
              const summaries = tx.objectStore("project_summaries");
              const previous = tx.objectStore("project_previous");
              if (kind === "remove") {
                bodies.delete(id); summaries.delete(id); previous.delete(id);
                operations.put({ operationId, signature, kind } satisfies StoredOperation);
                result(undefined);
                return;
              }
              const record: ProjectRecord = kind === "commit" ? {
                project: mutation.request.project, localRevision: mutation.request.localRevision,
                repositoryRevision: current ? incrementRevision(current.repositoryRevision) : "1", sync: current?.sync ?? null,
              } : { ...current!, project: { ...current!.project, title: mutation.request.title, updatedAt: mutation.request.updatedAt },
                localRevision: mutation.request.localRevision, repositoryRevision: incrementRevision(current!.repositoryRevision) };
              const body = prepared ? { ...prepared, repositoryRevision: record.repositoryRevision, sync: record.sync } : encodeBody(record);
              const summary = encodeSummary(record);
              const receipt: CommitReceipt = { id, operationId, repositoryRevision: record.repositoryRevision,
                localRevision: record.localRevision, summary: summary.summary };
              if (raw) previous.put(raw); // Only verified healthy current becomes previous.
              else previous.delete(id);
              bodies.put(body); summaries.put(summary);
              operations.put({ operationId, signature, kind, receipt } satisfies StoredOperation);
              result(receipt);
            } catch (error) { fail(error); }
          };
        } catch (error) { fail(error); }
      };
    }, operationId);
  }

  async touchOpened(id: string, at: string): Promise<ProjectSummary> {
    assertStorageId(id);
    if (!Number.isFinite(Date.parse(at))) throw new RepositoryError("INVALID_ARGUMENT");
    return this.transaction(["project_bodies", "project_summaries", "project_previous"], "readwrite", (tx, result, fail) => {
      const bodies = tx.objectStore("project_bodies");
      const read = bodies.get(id);
      read.onsuccess = () => {
        try {
          if (read.result === undefined) throw new RepositoryError("NOT_FOUND");
          const current = decodeBody(read.result, id);
          const record = { ...current, project: { ...current.project, lastOpenedAt: at }, repositoryRevision: incrementRevision(current.repositoryRevision) };
          const summary = encodeSummary(record);
          tx.objectStore("project_previous").put(read.result);
          bodies.put(encodeBody(record));
          tx.objectStore("project_summaries").put(summary);
          result(summary.summary);
        } catch (error) { fail(error); }
      };
    });
  }
}
