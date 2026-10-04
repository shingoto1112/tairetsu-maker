// Real Chromium only. Dynamically imported by scripts/test-indexeddb-browser.mjs;
// never part of App or the Vitest/jsdom runner.
import projects from "../fixtures/projects.json";
import commitProjects from "../fixtures/commitProjects.json";
import { runRepositoryContract } from "../runRepositoryContract";
import { runCollaborationContract, initialCollaboration, collaborationUpdates, collaborationProjection } from "../runCollaborationContract";
import { appendCollaboration, createCollaborationData } from "../../../collaboration/persistence";
import { createSharedDocument } from "../../../collaboration/model";
import { restorePreviousAsCopy } from "../../../storage/recovery";
import { SaveCoordinator } from "../../../storage/saveCoordinator";
import { createTairetsuArchive, readTairetsuArchive } from "../../../utils/tairetsuFile";
import { IndexedDbProjectRepository } from "../../indexedDbRepository";
import { PROJECT_STORES, PROJECT_DB_VERSION, encodeBody, encodeSummary, jsonIntegrity } from "../../indexedDbFormat";
import { initialMaintenance, MAINTENANCE_ID } from "../../../storage/maintenanceTypes";
import { runMigrationContract, memoryReaders } from "../../../storage/testing/migrationContract";
import { migrateLegacyStorage } from "../../../storage/migrationCoordinator";
import { LEGACY_MIGRATION_ID } from "../../../storage/migrationPlan";
import { normalizeProjectWithContext } from "../../../project/normalizeProject";
import { serializeProject } from "../../../project/codec";
import type { Project } from "../../../types";
import type { CommitRequest } from "../../types";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const nativeIndexedDb = indexedDB;
const equal = (a: unknown, b: unknown, message: string) => assert(JSON.stringify(a) === JSON.stringify(b), message);
const rejectCode = async (work: Promise<unknown>, code: string) => {
  try { await work; } catch (error) {
    assert(error && typeof error === "object" && "code" in error && error.code === code, `expected ${code}`);
    return;
  }
  throw new Error(`did not reject ${code}`);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const openDb = (name: string, version?: number): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = nativeIndexedDb.open(name, version);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("test DB unexpectedly blocked"));
});
const deleteDb = (name: string): Promise<void> => new Promise((resolve, reject) => {
  const request = nativeIndexedDb.deleteDatabase(name);
  request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("test DB cleanup blocked"));
});
const rawTransaction = async <T>(name: string, mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T>): Promise<T> => {
  const db = await openDb(name);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORES, mode);
      const request = work(tx);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
};
const snapshot = async (name: string) => {
  const db = await openDb(name);
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORES, "readonly");
      const requests = PROJECT_STORES.map(store => tx.objectStore(store).getAll());
      tx.oncomplete = () => resolve(requests.map(r => r.result));
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
};

type Probe = {
  fault?: "quota" | "abort" | "access" | "migrationLedger" | "previous" | "receipt";
  scopes: string[][];
  putSucceeded?: () => void;
  completed?: () => void;
  durability: string[];
};
/** Wrap an injected IDBFactory, leaving native IDB transactions/requests intact.
 * Failure occurs after current-body/previous writes have been queued. */
const probeFactory = (probe: Probe, audioDbName?: string): IDBFactory => new Proxy(nativeIndexedDb, {
  get(factory, key) {
    if (key !== "open") { const value = Reflect.get(factory, key, factory); return typeof value === "function" ? value.bind(factory) : value; }
    return (name: string, version?: number) => {
      if (audioDbName) assert(name === "tairetsu-maker-audio", "unexpected DB access in audio test");
      const request = factory.open(audioDbName ?? name, version);
      const wrapDb = (db: IDBDatabase) => new Proxy(db, {
        get(target, prop) {
          if (prop !== "transaction") { const value = Reflect.get(target, prop, target); return typeof value === "function" ? value.bind(target) : value; }
          return (stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) => {
            probe.scopes.push(typeof stores === "string" ? [stores] : [...stores]);
            const tx = target.transaction(stores, mode, options);
            if (mode === "readwrite") {
              probe.durability.push(tx.durability);
              tx.addEventListener("complete", () => probe.completed?.());
            }
            return new Proxy(tx, {
              get(transaction, property) {
                if (property !== "objectStore") { const value = Reflect.get(transaction, property, transaction); return typeof value === "function" ? value.bind(transaction) : value; }
                return (storeName: string) => {
                  const store = transaction.objectStore(storeName);
                  return new Proxy(store, {
                    get(objectStore, method) {
                      if (method === "get" && probe.fault === "access") return () => { throw new DOMException("injected access", "SecurityError"); };
                      if (method === "put") return (...args: Parameters<IDBObjectStore["put"]>) => {
                        if ((probe.fault === "previous" && storeName === "project_previous") || (probe.fault === "receipt" && storeName === "operation_receipts")) throw new DOMException("injected stage failure", "QuotaExceededError");
                        if (probe.fault === "quota" && storeName === "project_summaries") throw new DOMException("injected quota", "QuotaExceededError");
                        if (probe.fault === "migrationLedger" && storeName === "migration_items" && JSON.parse(args[0].json).state === "written") throw new DOMException("injected ledger failure", "QuotaExceededError");
                        const put = objectStore.put(...args);
                        if (storeName === "project_bodies" || storeName === "audio-files") {
                          put.addEventListener("success", () => {
                            probe.putSucceeded?.();
                            if (probe.fault === "abort") transaction.abort();
                          });
                        }
                        return put;
                      };
                      if (method === "delete" && probe.fault === "abort" && storeName === "project_bodies") return (id: IDBValidKey) => {
                        const deletion = objectStore.delete(id);
                        deletion.addEventListener("success", () => transaction.abort());
                        return deletion;
                      };
                      const value = Reflect.get(objectStore, method, objectStore);
                      return typeof value === "function" ? value.bind(objectStore) : value;
                    },
                  });
                };
              },
              set: (target, prop, value) => Reflect.set(target, prop, value, target),
            });
          };
        },
        set: (target, prop, value) => Reflect.set(target, prop, value, target),
      });
      let db: IDBDatabase | undefined;
      let wrapped: IDBDatabase;
      return new Proxy(request, {
        get(target, prop) {
          if (prop === "result") {
            if (db !== target.result) { db = target.result; wrapped = wrapDb(db); }
            return wrapped;
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set: (target, prop, value) => Reflect.set(target, prop, value, target),
      });
    };
  },
});

const makeRequest = (operationId: string, title = "anonymous update", revision = "2", expected: string | null = "1"): CommitRequest => ({
  project: { ...clone(commitProjects.stage), title } as Project, operationId,
  localRevision: revision, expectedRepositoryRevision: expected,
});
const percentiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50: +sorted[Math.ceil(sorted.length * .5) - 1].toFixed(2),
    p95: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) };
};

export const runIndexedDbBrowserSuite = async () => {
  const prefix = `tairetsu-repository-test-${crypto.randomUUID()}`;
  const names: string[] = [];
  const repositories: IndexedDbProjectRepository[] = [];
  const repositoryNames = new WeakMap<IndexedDbProjectRepository, string>();
  const name = () => { const n = `${prefix}-${names.length}`; names.push(n); return n; };
  const repo = (dbName = name(), factory?: IDBFactory) => {
    const r = new IndexedDbProjectRepository({ dbName, factory }); repositories.push(r); repositoryNames.set(r, dbName); return r;
  };
  const extra: string[] = [];
  const tested = (label: string) => { extra.push(label); console.log(`IndexedDB: ${label}`); };
  const performanceResults: unknown[] = [];
  try {
    const contract = await runRepositoryContract(() => repo());
    tested(`contract ${contract.scenarios} scenarios / ${contract.steps} steps`);
    await runCollaborationContract(() => repo(), old => {
      const original = old as IndexedDbProjectRepository; original.close(); return repo(repositoryNames.get(original)!);
    }, old => repo(repositoryNames.get(old as IndexedDbProjectRepository)!));
    tested("shared contract: 2 connections CAS merge / restart outbox / ACK / cursor / compaction / limits");
    {
      const writerName = name(), aRepo = repo(writerName), bRepo = repo(writerName);
      const initial = { ...initialCollaboration(), transportBinding: { accountId: "11111111-1111-4111-8111-111111111111", membershipGeneration: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } };
      await aRepo.commit({ project: commitProjects.stage as Project, collaboration: initial, operationId: "writer-initial", localRevision: "1", expectedRepositoryRevision: null });
      const a = new SaveCoordinator(aRepo, () => {}), b = new SaveCoordinator(bRepo, () => {});
      a.activate((await aRepo.get("project_a"))!); b.activate((await bRepo.get("project_a"))!);
      await a.editCollaboration([collaborationUpdates()[0]]); await b.editCollaboration([collaborationUpdates()[1]]);
      assert(await a.flush() && await b.flush(), "two writer edits commit");
      assert(await a.prepareCollaborationWriter() && await b.prepareCollaborationWriter(), "CAS writer allocation commits");
      const assigned = (await aRepo.get("project_a"))!;
      equal(assigned.collaboration!.outbox.map(e => e.writerSeq).sort(), ["1", "2"], "contiguous two-connection writer sequences");
      // Same ACK commits bytes removal, base, collection boundary and previous.
      assert(await b.markOutboxSent(assigned.collaboration!.outbox.map(e => e.updateId)), "writer ACK committed");
      const collected = (await aRepo.get("project_a"))!;
      assert(collected.collaboration!.outbox.length === 0 && collected.collaboration!.writer!.reclaimedThrough === "2", "sent bytes reclaimed with fence");
      equal((await aRepo.getPrevious("project_a"))!.collaboration, assigned.collaboration, "previous retains old writer/outbox");
      // A stale tab cannot reintroduce an old pending sequence or ACK it implicitly.
      await a.editCollaboration([]);
      assert(!await a.flush() && a.state?.error?.code === "CONFLICT", "old tab preserves ambiguous pending and reports conflict");
      await rejectCode(aRepo.commit({ project: assigned.project, collaboration: assigned.collaboration, operationId: "old-backup-reinsert", localRevision: "99",
        expectedRepositoryRevision: collected.repositoryRevision }), "CONFLICT");
      const recovered = await restorePreviousAsCopy(aRepo, "project_a");
      assert(!(await aRepo.get(recovered.id))!.collaboration, "old shared previous becomes independent copy");
      tested("9a: durable writer CAS / atomic ACK-byte collection / old tab and previous-backup fences / independent rescue");
    }
    {
      const sharedName = name(), sharedProbe: Probe = { scopes: [], durability: [] }, sharedRepo = repo(sharedName, probeFactory(sharedProbe));
      const initial = { ...initialCollaboration(), schemaVersion: 2 as const, audioBindings: [{ song: { name: "共通曲.wav", type: "audio/wav", size: 100, duration: 60 },
        audio: { id: "mapped-device-audio", name: "端末曲.wav", type: "audio/wav", size: 100, duration: 60 } }] };
      await sharedRepo.commit({ project: commitProjects.stage as Project, collaboration: initial, operationId: "shared-original", localRevision: "1", expectedRepositoryRevision: null });
      const beforeShared = await snapshot(sharedName);
      const data = appendCollaboration(initial, collaborationUpdates(), "4");
      for (const [fault, code] of [["previous", "QUOTA_EXCEEDED"], ["quota", "QUOTA_EXCEEDED"], ["receipt", "QUOTA_EXCEEDED"], ["abort", "IO_ERROR"], ["access", "ACCESS_DENIED"]] as const) {
        sharedProbe.fault = fault;
        await rejectCode(sharedRepo.commit({ project: collaborationProjection(data), collaboration: data,
          operationId: `shared-fault-${fault}`, localRevision: "2", expectedRepositoryRevision: "1" }), code);
        equal(await snapshot(sharedName), beforeShared, `shared ${fault}: projection/attachment/previous/receipt all old`);
      }
      sharedProbe.fault = undefined;
      await sharedRepo.commit({ project: collaborationProjection(data), collaboration: data, operationId: "shared-success", localRevision: "2", expectedRepositoryRevision: "1" });
      sharedRepo.close();
      const restarted = repo(sharedName), saved = (await restarted.get("project_a"))!;
      equal(saved.collaboration, data, "successful attachment persists after restart");
      equal((await restarted.getPrevious("project_a"))!.collaboration, initial, "previous keeps matching attachment");
      equal(saved.collaboration?.audioBindings, initial.audioBindings, "device mappings survive restart and previous without CRDT changes");
      const copy = await restorePreviousAsCopy(restarted, "project_a");
      assert(!(await restarted.get(copy.id))!.collaboration, "shared previous rescued as independent copy");
      const archive = await createTairetsuArchive(saved.project, { audioBlob: null });
      const imported = await readTairetsuArchive(new File([archive], "shared.zip"));
      assert(!("collaboration" in imported.project) && !(JSON.stringify(imported.project).includes("outbox")), "normal ZIP excludes attachment");
      await migrateLegacyStorage({ repository: restarted, readers: memoryReaders({}) });
      await restarted.updateMaintenance({ action: "started" });
      assert((await restarted.collectUnusedAudio()).skipped && (await restarted.readMaintenance()).gcAt === null, "shared current/previous defers audio GC");
      const raw = await rawTransaction(sharedName, "readonly", tx => tx.objectStore("project_bodies").get("project_a"));
      raw.collaboration.serverCursor = "5";
      await rawTransaction(sharedName, "readwrite", tx => tx.objectStore("project_bodies").put(raw));
      await rejectCode(restarted.get("project_a"), "CORRUPT");
      raw.collaboration = { ...data, base: "AAAA" }; raw.collaborationIntegrity = jsonIntegrity(JSON.stringify(raw.collaboration));
      await rawTransaction(sharedName, "readwrite", tx => tx.objectStore("project_bodies").put(raw));
      await rejectCode(restarted.get("project_a"), "CORRUPT");
      tested("shared atomic fault injection at previous/body/summary/receipt/access; restart and integrity");
    }

    // All anonymous Project fixtures, including old aliases/unknown fields.
    const fixturesRepo = repo();
    for (const [key, raw] of Object.entries(projects)) {
      const project = normalizeProjectWithContext(raw as unknown as Project, {
        defaultStage: (commitProjects.stage as Project).stage, now: () => "2026-01-10T00:00:00.000Z",
        createId: p => `${p}-fixture`, createProjectId: () => `project-${key}`,
      });
      project.id = `fixture-${key}`;
      await fixturesRepo.commit({ project, operationId: `fixture-op-${key}`, localRevision: "1", expectedRepositoryRevision: null });
      equal((await fixturesRepo.get(project.id))?.project, project, `fixture ${key} roundtrip`);
    }
    tested(`all ${Object.keys(projects).length} anonymous body fixtures`);

    const dbName = name();
    const probe: Probe = { scopes: [], durability: [] };
    const r = repo(dbName, probeFactory(probe));
    const first = await r.commit(makeRequest("first", "first", "1", null));
    let resolved = false;
    let succeededBeforeResolve = false;
    let completedBeforeResolve = false;
    probe.putSucceeded = () => { succeededBeforeResolve = !resolved; queueMicrotask(() => assert(!resolved, "commit resolved before transaction complete")); };
    probe.completed = () => { completedBeforeResolve = !resolved; };
    const second = await r.commit(makeRequest("second")).then(value => { resolved = true; return value; });
    assert(succeededBeforeResolve && completedBeforeResolve, "commit completion boundary");
    assert(probe.durability.every(d => d === "strict"), "Chromium strict durability");
    probe.putSucceeded = undefined; probe.completed = undefined;
    const previous = await rawTransaction(dbName, "readonly", tx => tx.objectStore("project_previous").get(first.id));
    assert(previous.repositoryRevision === "1" && JSON.parse(previous.json).title === "first", "healthy previous generation");
    const before = await snapshot(dbName);
    for (const [fault, code] of [["quota", "QUOTA_EXCEEDED"], ["abort", "IO_ERROR"]] as const) {
      probe.fault = fault;
      await rejectCode(r.commit(makeRequest(`failed-${fault}`, "failed", "3", "2")), code);
      equal(await snapshot(dbName), before, `${fault}: all stores unchanged`);
    }
    probe.fault = "quota";
    await rejectCode(r.rename({ id: first.id, title: "failed rename", updatedAt: "2026-01-11T00:00:00.000Z",
      localRevision: "3", expectedRepositoryRevision: "2", operationId: "failed-rename" }), "QUOTA_EXCEEDED");
    equal(await snapshot(dbName), before, "rename quota: all stores unchanged");
    await rejectCode(r.touchOpened(first.id, "2026-01-11T00:00:00.000Z"), "QUOTA_EXCEEDED");
    equal(await snapshot(dbName), before, "touch quota: all stores unchanged");
    probe.fault = "abort";
    await rejectCode(r.remove({ id: first.id, expectedRepositoryRevision: "2", operationId: "failed-remove" }), "IO_ERROR");
    equal(await snapshot(dbName), before, "remove late abort: all stores unchanged");
    probe.fault = undefined;
    // A failed operation left no receipt and can succeed after capacity recovers.
    await r.commit(makeRequest("failed-quota", "failed", "3", "2"));
    tested("strict completion / healthy previous / commit, rename, touch, remove rollback of all four stores");

    probe.scopes.length = 0;
    await r.list({ limit: 100 });
    equal(probe.scopes, [["project_summaries"]], "list body/previous/receipt reads forbidden");
    tested("list uses only summary store (transaction scope spy)");
    r.close();
    const reopened = repo(dbName);
    assert((await reopened.get(first.id))?.repositoryRevision === "3", "reopen persistence");
    equal(await reopened.commit(makeRequest("second")), second, "old receipt replay after reopen");
    await reopened.remove({ id: first.id, expectedRepositoryRevision: "3", operationId: "remove-persisted" });
    reopened.close();
    const afterRemove = repo(dbName);
    await afterRemove.remove({ id: first.id, expectedRepositoryRevision: "3", operationId: "remove-persisted" });
    equal(await afterRemove.commit(makeRequest("first", "first", "1", null)), first, "receipt survives deletion");
    assert(await afterRemove.get(first.id) === null, "old replay must not recreate deleted body");
    tested("reopen persistence / durable old receipt and remove replay");

    const casName = name();
    const a = repo(casName), b = repo(casName);
    await a.commit(makeRequest("cas-create", "first", "1", null));
    await b.initialize();
    const concurrent = await Promise.allSettled([a.commit(makeRequest("cas-a")), b.commit(makeRequest("cas-b"))]);
    assert(concurrent.filter(x => x.status === "fulfilled").length === 1, "CAS one winner");
    assert(concurrent.some(x => x.status === "rejected" && x.reason.code === "CONFLICT"), "CAS conflict");
    assert((await a.get("project_a"))?.repositoryRevision === "2", "CAS single increment");
    tested("CAS across two independent connections");

    const orderRepo = repo();
    // IDB UTF-16 order would put the astral character before U+E000.
    const ids = ["😀", "\ue000", "aa", "a"];
    for (const id of ids) {
      await orderRepo.commit({ ...makeRequest(`op-${id}`, "order", "1", null),
        project: { ...clone(commitProjects.stage), id } as Project });
    }
    const p1 = await orderRepo.list({ limit: 2 });
    const p2 = await orderRepo.list({ limit: 2, cursor: p1.nextCursor! });
    equal([...p1.items, ...p2.items].map(s => s.id), ["a", "aa", "\ue000", "😀"], "scalar order/cursor");
    assert(p2.nextCursor === null, "final page");
    await rejectCode(orderRepo.list({ limit: 2, cursor: p1.nextCursor!, mode: "stage" }), "INVALID_ARGUMENT");
    const filtered = await orderRepo.list({ limit: 2, mode: "stage" });
    equal((await orderRepo.list({ limit: 2, mode: "stage", cursor: filtered.nextCursor! })).items.map(s => s.id), ["\ue000", "😀"], "filtered keyset cursor");
    tested("Unicode scalar index / filtered and unfiltered keyset pagination");

    const corruptName = name();
    const corrupt = repo(corruptName);
    await corrupt.commit(makeRequest("corrupt-create", "first", "1", null));
    await corrupt.commit(makeRequest("corrupt-update"));
    const healthyBeforeCorrupt = await snapshot(corruptName);
    const healthyBody = await rawTransaction(corruptName, "readonly", tx => tx.objectStore("project_bodies").get("project_a"));
    await rawTransaction(corruptName, "readwrite", tx => tx.objectStore("project_bodies").put({ ...healthyBody, json: healthyBody.json.replace("anonymous update", "silently modified") }));
    await rejectCode(corrupt.get("project_a"), "CORRUPT");
    await rejectCode(corrupt.commit(makeRequest("corrupt-cannot-overwrite", "next", "3", "2")), "CORRUPT");
    const afterCorrupt = await snapshot(corruptName);
    equal(afterCorrupt.slice(1), healthyBeforeCorrupt.slice(1), "corrupt current must not replace healthy previous or summaries/receipts");
    assert((await corrupt.list({ limit: 100 })).items.length === 1, "list never parses corrupt body");
    await rawTransaction(corruptName, "readwrite", tx => tx.objectStore("project_bodies").put({ ...healthyBody, schemaVersion: 3 }));
    await rejectCode(corrupt.get("project_a"), "UNSUPPORTED_SCHEMA");
    await rawTransaction(corruptName, "readwrite", tx => tx.objectStore("project_bodies").put(healthyBody));
    const summary = await rawTransaction(corruptName, "readonly", tx => tx.objectStore("project_summaries").get("project_a"));
    await rawTransaction(corruptName, "readwrite", tx => tx.objectStore("project_summaries").put({ ...summary, summary: { ...summary.summary, memberCount: "bad" } }));
    await rejectCode(corrupt.list({ limit: 100 }), "CORRUPT");
    tested("corruption / unsupported body schema / healthy previous preserved / unreadable summary rejects");

    const versionName = name();
    const versionRepo = repo(versionName);
    await versionRepo.initialize();
    const upgraded = await openDb(versionName, PROJECT_DB_VERSION + 1); // triggers versionchange and closes old connection
    await rejectCode(versionRepo.get("project_a"), "BUSY");
    upgraded.close();
    await rejectCode(repo(versionName).initialize(), "UNSUPPORTED_SCHEMA");
    tested("onversionchange closes / stale instance BUSY / newer DB rejects downgrade");

    const cancelled = repo();
    const initializing = cancelled.initialize();
    cancelled.close();
    await rejectCode(initializing, "BUSY");
    await cancelled.initialize();
    tested("close during initialization cancels late connection without leaks");

    const blockedName = name();
    // Hold a native connection and route this isolated adapter's open to v2,
    // producing a REAL Chromium blocked event rather than synthesizing one.
    const blocker = await openDb(blockedName);
    let upgradeRequest: IDBOpenDBRequest;
    const nativeBlockedFactory = { open: () => {
      upgradeRequest = nativeIndexedDb.open(blockedName, 2);
      return upgradeRequest;
    } } as unknown as IDBFactory;
    await rejectCode(repo(blockedName, nativeBlockedFactory).initialize(), "BUSY");
    const abortedUpgrade = new Promise<void>((resolve, reject) => {
      upgradeRequest!.addEventListener("error", () => resolve());
      upgradeRequest!.addEventListener("success", () => { upgradeRequest!.result.close(); reject(new Error("blocked open unexpectedly upgraded")); });
    });
    blocker.close();
    await abortedUpgrade;
    const unmodified = await openDb(blockedName);
    assert(unmodified.version === 1, "blocked open must not later upgrade schema");
    unmodified.close();
    // The separate late-success path must close too, even for factories which
    // cannot cancel their pending open request.
    let lateClosed = false;
    const late = await openDb(blockedName);
    const blockedRequest = { onblocked: undefined as (() => void) | undefined,
      onsuccess: undefined as (() => void) | undefined, result: { close: () => { lateClosed = true; late.close(); } } };
    const blockedFactory = { open: () => {
      setTimeout(() => blockedRequest.onblocked?.(), 0);
      return blockedRequest;
    } } as unknown as IDBFactory;
    await rejectCode(repo(blockedName, blockedFactory).initialize(), "BUSY");
    blockedRequest.onsuccess?.();
    assert(lateClosed, "late blocked success closes connection");
    tested("native blocked maps BUSY / cancelled upgrade / late open success closes");

    // Existing audio API is exercised with its unchanged DB/key names redirected
    // by the injected browser global to a NEW isolated DB. No real audio DB open.
    const audioName = name();
    const audioProbe: Probe = { scopes: [], durability: [] };
    const originalFactory = Object.getOwnPropertyDescriptor(window, "indexedDB");
    Object.defineProperty(window, "indexedDB", { configurable: true, value: probeFactory(audioProbe, audioName) });
    try {
      const audio = await import("../../../utils/audioStorage");
      let audioResolved = false;
      let putBoundary = false;
      audioProbe.putSucceeded = () => { putBoundary = !audioResolved; queueMicrotask(() => assert(!audioResolved, "audio resolved before complete")); };
      const meta = await audio.saveAudioBlobToIndexedDb(new Blob(["anonymous audio"], { type: "audio/wav" }), { name: "anonymous.wav", duration: 1 })
        .then(value => { audioResolved = true; return value; });
      assert(putBoundary, "audio put success boundary observed");
      audioProbe.putSucceeded = undefined;
      assert(await (await audio.loadAudioBlobFromIndexedDb(meta.id))!.text() === "anonymous audio", "audio real Blob persistence");
      assert(await audio.loadAudioBlobFromIndexedDb("missing") === null, "missing audio null");
      audioProbe.fault = "abort";
      let aborted = false;
      try { await audio.saveAudioBlobToIndexedDb(new Blob(["aborted"]), { name: "abort.wav", duration: 1 }); }
      catch (error) { aborted = error instanceof DOMException && error.name === "AbortError"; }
      assert(aborted, "audio abort must reject");
      audioProbe.fault = "access";
      let denied = false;
      try { await audio.loadAudioBlobFromIndexedDb(meta.id); }
      catch (error) { denied = error instanceof DOMException && error.name === "SecurityError"; }
      assert(denied, "audio failure must not return null");
      audioProbe.fault = undefined;
      const audioDb = await openDb(audioName);
      try {
        const count = await new Promise<number>((resolve, reject) => {
          const tx = audioDb.transaction("audio-files", "readonly");
          const count = tx.objectStore("audio-files").count();
          tx.oncomplete = () => resolve(count.result); tx.onabort = tx.onerror = () => reject(tx.error);
        });
        assert(count === 1, "aborted audio write absent");
      } finally { audioDb.close(); }
      await audio.deleteAudioBlobFromIndexedDb(meta.id);
      assert(await audio.loadAudioBlobFromIndexedDb(meta.id) === null, "audio delete committed");
    } finally {
      if (originalFactory) Object.defineProperty(window, "indexedDB", originalFactory);
      else Reflect.deleteProperty(window, "indexedDB");
    }
    tested("real audio completion / abort rollback / null vs access error / unchanged keys and Blob format");

    const migration = await runMigrationContract(() => repo(), current => {
      const r = current as IndexedDbProjectRepository;
      r.close(); return repo(repositoryNames.get(r)!);
    });
    assert(migration.scenarios === 30, "all migration coordinator cases");
    tested(`migration ${migration.scenarios} scenarios / old sources read-only / durable restart / edited destination protected`);
    {
      const sameName = name(), first = repo(sameName), second = repo(sameName);
      const readers = memoryReaders({ "stageflow.projects.v1": JSON.stringify([commitProjects.stage, commitProjects.parade]) });
      const outcomes = await Promise.all([first, second].map(repository => migrateLegacyStorage({ repository, readers })));
      assert(outcomes.every(o => o.completed && o.migratedCount === 2), "concurrent bootstraps accept advanced durable states");
      assert((await first.list({ limit: 100 })).items.length === 2, "concurrent migration does not duplicate bodies");
      tested("concurrent bootstrap across independent connections is replay-safe");
    }
    for (const fault of ["quota", "abort", "migrationLedger"] as const) {
      const probe: Probe = { scopes: [], durability: [] };
      const migrationName = name(), r = repo(migrationName, probeFactory(probe));
      const write = r.writeMigration.bind(r);
      r.writeMigration = async (entry, expected) => {
        if (entry.kind === "item" && entry.state === "written") probe.fault = fault;
        return write(entry, expected);
      };
      const readers = memoryReaders({ "stageflow.projects.v1": JSON.stringify([commitProjects.stage]) });
      const first = await migrateLegacyStorage({ repository: r, readers });
      assert(!first.completed && first.failures.some(f => f.code === (fault === "abort" ? "IO_ERROR" : "QUOTA_EXCEEDED")), `migration ${fault} classified`);
      assert(await r.get("project_a") === null, `migration ${fault} body rollback`);
      const batch = await r.readMigration(LEGACY_MIGRATION_ID);
      assert(batch?.kind === "batch" && (await r.readMigration(batch.itemIds[0]))?.state === "validated", `migration ${fault} ledger rollback`);
      r.close();
      const resumed = repo(migrationName);
      assert((await migrateLegacyStorage({ repository: resumed, readers })).migratedCount === 1, `migration ${fault} reopen/resume`);
      tested(`migration ${fault} rolls back body/summary/receipt/ledger atomically, then reopens`);
    }
    // Actual 1 -> 2 upgrade preserves original schema/body/receipts.
    {
      const upgradeName = name();
      const request = nativeIndexedDb.open(upgradeName, 1);
      request.onupgradeneeded = () => {
        for (const storeName of PROJECT_STORES.filter(n => n !== "migration_items")) {
          const store = request.result.createObjectStore(storeName, { keyPath: storeName === "operation_receipts" ? "operationId" : "id" });
          if (storeName === "project_summaries") {
            store.createIndex("by_order", ["sortTime", "sortId"], { unique: true });
            store.createIndex("by_mode_order", ["summary.mode", "sortTime", "sortId"], { unique: true });
          }
        }
        request.transaction!.objectStore("operation_receipts").put({ operationId: "anonymous-upgrade-marker", marker: true });
      };
      await new Promise<void>((resolve, reject) => { request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      const upgraded = repo(upgradeName); await upgraded.initialize();
      const marker = await rawTransaction(upgradeName, "readonly", tx => tx.objectStore("operation_receipts").get("anonymous-upgrade-marker"));
      assert(marker.marker === true, "v1 receipt retained");
      assert((await upgraded.initialize()).schemaVersion === PROJECT_DB_VERSION, "v3 migration store");
      tested("schema 1 -> 3 additive upgrade preserves original stores");
    }
    {
      const upgradeName = name(), request = nativeIndexedDb.open(upgradeName, 2);
      const record = { project: commitProjects.stage as Project, repositoryRevision: "7", localRevision: "4", sync: null };
      request.onupgradeneeded = () => {
        for (const storeName of PROJECT_STORES) {
          const store = request.result.createObjectStore(storeName, { keyPath: storeName === "operation_receipts" ? "operationId" : "id" });
          if (storeName === "project_summaries") {
            store.createIndex("by_order", ["sortTime", "sortId"], { unique: true });
            store.createIndex("by_mode_order", ["summary.mode", "sortTime", "sortId"], { unique: true });
          }
        }
        const tx = request.transaction!;
        tx.objectStore("project_bodies").put(encodeBody(record)); tx.objectStore("project_previous").put(encodeBody(record));
        tx.objectStore("project_summaries").put(encodeSummary(record));
        tx.objectStore("operation_receipts").put({ operationId: "v2-marker", marker: true });
        const json = JSON.stringify(initialMaintenance()); tx.objectStore("migration_items").put({ id: MAINTENANCE_ID, json, ...jsonIntegrity(json) });
      };
      await new Promise<void>((resolve, reject) => { request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      const beforeUpgrade = await snapshot(upgradeName);
      const upgraded = repo(upgradeName); await upgraded.initialize();
      equal(await snapshot(upgradeName), beforeUpgrade, "v2 to v3 all records byte-for-byte unchanged");
      equal(await upgraded.get("project_a"), record, "v2 current unchanged"); equal(await upgraded.getPrevious("project_a"), record, "v2 previous unchanged");
      equal(await upgraded.readMaintenance(), initialMaintenance(), "v2 maintenance retained");
      tested("schema 2 -> 3 preserves current/previous/summary/receipts/migration ledger without rewriting");
    }
    {
      const upgradeName = name(), request = nativeIndexedDb.open(upgradeName, 2);
      const collaboration = { ...initialCollaboration(), sharedDocumentId: "shared-fixture", transportBinding: {
        accountId: "00000000-0000-0000-0000-000000000001", membershipGeneration: "00000000-0000-0000-0000-000000000002",
      } };
      const record = { project: commitProjects.stage as Project, repositoryRevision: "7", localRevision: "4", sync: null, collaboration };
      const legacySummary = encodeSummary(record); delete legacySummary.summary.sharing;
      const healthyBase = { ...record.project, id: "project_b" }, healthyDoc = createSharedDocument(healthyBase);
      const healthyCollaboration = { ...createCollaborationData(healthyDoc), sharedDocumentId: "shared-fixture", transportBinding: collaboration.transportBinding };
      healthyDoc.destroy();
      const healthy = { ...record, project: collaborationProjection(healthyCollaboration, healthyBase), collaboration: healthyCollaboration };
      const healthySummary = encodeSummary(healthy); delete healthySummary.summary.sharing;
      const invalidCollaboration = { ...collaboration, base: "AAAA" };
      const damagedBody = { ...encodeBody(record), collaboration: invalidCollaboration,
        collaborationIntegrity: jsonIntegrity(JSON.stringify(invalidCollaboration)) };
      request.onupgradeneeded = () => {
        for (const storeName of PROJECT_STORES) {
          const store = request.result.createObjectStore(storeName, { keyPath: storeName === "operation_receipts" ? "operationId" : "id" });
          if (storeName === "project_summaries") {
            store.createIndex("by_order", ["sortTime", "sortId"], { unique: true });
            store.createIndex("by_mode_order", ["summary.mode", "sortTime", "sortId"], { unique: true });
          }
        }
        const tx = request.transaction!;
        tx.objectStore("project_bodies").put(damagedBody); tx.objectStore("project_previous").put(encodeBody(record));
        tx.objectStore("project_bodies").put(encodeBody(healthy));
        tx.objectStore("project_summaries").put(legacySummary);
        tx.objectStore("project_summaries").put(healthySummary);
        tx.objectStore("operation_receipts").put({ operationId: "v3-shared-marker", marker: true });
      };
      await new Promise<void>((resolve, reject) => { request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      const before = await snapshot(upgradeName);
      const upgraded = repo(upgradeName); await upgraded.initialize();
      const listed = await upgraded.list({ limit: 100 });
      assert(listed.items.length === 2 && listed.items.every(item => !item.sharing), "legacy summary stays unchanged without badge");
      equal(await snapshot(upgradeName), before, "opening does not rewrite any body, summary, revision, previous or receipt");
      await rejectCode(upgraded.get("project_a"), "CORRUPT");
      equal(await upgraded.get("project_b"), healthy, "one damaged attachment does not affect another shared document");
      upgraded.close();
      const reopened = repo(upgradeName); await reopened.initialize();
      equal(await snapshot(upgradeName), before, "second open also never scans or rewrites attachments");
      equal(await reopened.getPrevious("project_a"), record, "healthy previous remains readable for individual recovery");
      await restorePreviousAsCopy(reopened, "project_a");
      const rescue = (await reopened.list({ limit: 100 })).items.find(item => !["project_a", "project_b"].includes(item.id))!;
      assert(!rescue.sharing && !(await reopened.get(rescue.id))!.collaboration, "individual rescue opens as independent copy");
      await reopened.commit({ project: healthy.project, collaboration: healthyCollaboration, localRevision: "5", expectedRepositoryRevision: "7", operationId: "normal-sharing-summary-save" });
      equal((await reopened.list({ limit: 100 })).items.find(item => item.id === "project_b")!.sharing,
        { documentId: "shared-fixture", ...collaboration.transportBinding }, "normal save atomically adds sharing summary");
      equal(await rawTransaction(upgradeName, "readonly", tx => tx.objectStore("project_bodies").get("project_a")), damagedBody, "damaged original retained after recovery");
      tested("v2 -> v3 and repeated open tolerate damaged shared attachment; legacy summaries untouched; individual previous rescue and normal-save badge work");
    }
    {
      const corruptUpgradeName = name(), request = nativeIndexedDb.open(corruptUpgradeName, 2);
      request.onupgradeneeded = () => { request.result.createObjectStore("project_summaries", { keyPath: "id" }); };
      await new Promise<void>((resolve, reject) => { request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
      await rejectCode(repo(corruptUpgradeName).initialize(), "CORRUPT");
      const unchanged = await openDb(corruptUpgradeName); assert(unchanged.version === 2 && unchanged.objectStoreNames.length === 1, "corrupt v2 never silently repaired"); unchanged.close();
      tested("schema 2 missing stores rejects CORRUPT without manufacturing empty data");
    }

    // Warm latency includes serialization, checksums, signature digest and strict
    // transaction completion. Anonymous large fixture is never a user project.
    const large = normalizeProjectWithContext(projects.large as unknown as Project, {
      defaultStage: (commitProjects.stage as Project).stage, now: () => "2026-01-10T00:00:00.000Z",
      createId: p => `${p}-large`, createProjectId: () => "large",
    });
    const encoded = serializeProject(large); assert(encoded.ok, "large fixture serialization");
    const byteLength = new TextEncoder().encode(encoded.value).length;
    for (const count of [200, 1000]) {
      const bench = repo();
      for (let i = 0; i < count; i++) {
        await bench.commit({ project: { ...large, id: `bench-${String(i).padStart(4, "0")}` },
          localRevision: "1", expectedRepositoryRevision: null, operationId: `seed-${i}` });
      }
      const times = { list: [] as number[], get: [] as number[], commit: [] as number[] };
      let revision = 1;
      for (let i = 0; i < 55; i++) {
        let start = performance.now();
        const page = await bench.list({ limit: 100 });
        if (i >= 5) times.list.push(performance.now() - start);
        assert(page.items.length === 100, "benchmark page size");
        start = performance.now();
        const record = await bench.get("bench-0000");
        if (i >= 5) times.get.push(performance.now() - start);
        assert(record?.project.members.length === 146 && record.project.frames.length === 18, "benchmark data shape");
        start = performance.now();
        await bench.commit({ project: { ...record.project, title: `anonymous benchmark ${i}` },
          localRevision: String(++revision), expectedRepositoryRevision: record.repositoryRevision, operationId: `bench-commit-${i}` });
        if (i >= 5) times.commit.push(performance.now() - start);
      }
      performanceResults.push({ count, fixtureBytes: byteLength, members: 146, scenes: 18,
        list100: percentiles(times.list), get1: percentiles(times.get), commit1: percentiles(times.commit), failures: 0 });
      tested(`benchmark ${count} projects / 50 warm samples`);
      bench.close();
    }
    return { contract, migration, extra, performance: performanceResults, userAgent: navigator.userAgent, databases: names.length };
  } finally {
    repositories.forEach(r => r.close());
    // Only names generated by this run are ever deleted.
    await Promise.all(names.map(n => { assert(n.startsWith(prefix), "cleanup prefix"); return deleteDb(n); }));
  }
};
