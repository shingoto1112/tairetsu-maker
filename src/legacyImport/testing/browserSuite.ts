import fixture from "../../../supabase/tests/fixtures/legacy-export-v1.json";
import { IndexedDbProjectRepository } from "../../repositories/indexedDbRepository";
import { LegacyCloudImporter, sourceKey } from "../importer";
import { RepositoryError } from "../../repositories/types";
import { jsonIntegrity } from "../../repositories/indexedDbFormat";
import { canonicalJson } from "../../repositories/migrationTypes";
import type { LegacyListItem } from "../api";
const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label); };
const clone = () => JSON.parse(JSON.stringify(fixture));
export const fixtureRow: LegacyListItem = { projectId: fixture.project.id, title: "試験用旧文書", mode: "stage", schemaVersion: 1, createdAt: fixture.project.created_at, hidden: false };
export const testImporter = (repository: IndexedDbProjectRepository, raw = fixture, kind = "env") => new LegacyCloudImporter(repository,
  { list: async () => { throw new Error("unused"); }, export: async () => raw }, kind, "synthetic-account", async () => null);
export async function runLegacyIndexedDbSuite() {
  if (!import.meta.env.DEV) throw new Error("DEV only");
  const checks: string[] = [], name = `11b-idb-${crypto.randomUUID()}`;
  let repository = new IndexedDbProjectRepository({ dbName: name }); await repository.initialize();
  try {
    const importer = testImporter(repository), first = await importer.importOne(fixtureRow);
    check(first.status === "imported", "initial import");
    const record = (await repository.get(first.targetId!))!;
    check(record.sync === null && !record.collaboration && !JSON.stringify(record).match(/lock_token|lease|preview|presence|outbox|transportBinding/), "independent body excludes operational state");
    const importedLedger = await repository.readMigration(await sourceKey({ environment: "env", accountId: "synthetic-account", sourceId: fixtureRow.projectId, kind: "cloud-owner" }));
    check(importedLedger?.kind === "item" && canonicalJson(record.project) === importedLedger.json, "reread matches ledger");
    repository.close(); repository = new IndexedDbProjectRepository({ dbName: name }); await repository.initialize();
    check((await testImporter(repository).importOne(fixtureRow)).status === "already", "restart replay");
    const reopened = (await repository.get(first.targetId!))!;
    await repository.commit({ project: { ...reopened.project, title: "取り込み後の編集" }, expectedRepositoryRevision: reopened.repositoryRevision, localRevision: "2", operationId: "11b-edit" });
    await testImporter(repository).importOne(fixtureRow);
    check((await repository.get(first.targetId!))!.project.title === "取り込み後の編集", "edit survives replay");
    const edited = (await repository.get(first.targetId!))!;
    await repository.remove({ id: first.targetId!, expectedRepositoryRevision: edited.repositoryRevision, operationId: "11b-delete" });
    await testImporter(repository).importOne(fixtureRow); check(!await repository.get(first.targetId!), "delete survives replay");
    checks.push("create/reopen/readback/edit/delete/idempotency");

    const original = repository.writeMigration.bind(repository); let lost = true;
    repository.writeMigration = async (entry, expected) => { const result = await original(entry, expected);
      if (lost && entry.kind === "item" && entry.state === "written") { lost = false; throw new RepositoryError("IO_ERROR"); } return result; };
    const lossImporter = testImporter(repository, fixture, "loss");
    check((await lossImporter.importOne(fixtureRow)).status === "failed", "lost response is visible");
    check((await lossImporter.importOne(fixtureRow)).status === "already", "response-loss receipt replay");
    check((await repository.list({ limit: 100 })).items.length === 1, "loss creates once"); repository.writeMigration = original;
    checks.push("response loss after atomic commit");

    for (const [namespace, failStore, errorName] of [["quota", "project_bodies", "QuotaExceededError"], ["ledger", "migration_items", "UnknownError"], ["summary", "project_summaries", "UnknownError"]]) {
      const key = await sourceKey({ environment: namespace, accountId: "synthetic-account", sourceId: fixtureRow.projectId, kind: "cloud-owner" });
      const target = `legacy-copy-${key.slice(-64)}`, savedPut = IDBObjectStore.prototype.put;
      let once = true;
      IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
        const selected = this.name === failStore && (failStore !== "migration_items" || value.id === keyId && JSON.parse(value.json).state === "written");
        if (selected && once) { once = false; throw new DOMException("injected local storage failure", errorName); }
        return key === undefined ? savedPut.call(this, value) : savedPut.call(this, value, key);
      };
      const keyId = key;
      try {
        const failed = await testImporter(repository, fixture, namespace).importOne(fixtureRow);
        check(failed.status === "failed", `${namespace} failure visible`);
        check(!await repository.get(target), `${namespace} body rolled back`);
        const ledger = await repository.readMigration(key); check(ledger?.state === "validated", `${namespace} ledger not falsely successful`);
      } finally { IDBObjectStore.prototype.put = savedPut; }
      check((await testImporter(repository, fixture, namespace).importOne(fixtureRow)).status === "imported", `${namespace} retry`);
    }
    checks.push("quota/body/summary/ledger failures atomically roll back");

    const interrupted = new AbortController();
    repository.writeMigration = async (entry, expected) => { const result = await original(entry, expected); if (entry.state === "validated") interrupted.abort(); return result; };
    try { await testImporter(repository, fixture, "interrupted").importOne(fixtureRow, interrupted.signal); check(false, "must abort"); }
    catch { /* Intentional between-stage interruption. */ }
    repository.writeMigration = original; repository.close(); repository = new IndexedDbProjectRepository({ dbName: name }); await repository.initialize();
    check((await testImporter(repository, fixture, "interrupted").importOne(fixtureRow)).status === "imported", "resume from durable validation");
    checks.push("interruption/restart resumes fixed target");

    for (const [namespace, mutation] of [
      ["missing-resource", (s: any) => s.resources.pop()], ["missing-scene", (s: any) => s.scenes = []],
      ["extra-scene", (s: any) => s.scenes.push({ ...s.scenes[0], scene_id: "extra" })],
      ["bad-ref", (s: any) => s.scenes[0].data.positions.bad = { x: 1, y: 2 }], ["bad-schema", (s: any) => s.resources[0].schema_version = 999],
    ] as const) {
      const raw = clone(); mutation(raw); check((await testImporter(repository, raw, namespace).importOne(fixtureRow)).status === "recovery", `${namespace} isolated`);
    }
    check((await testImporter(repository, fixture, "healthy-after-isolation").importOne(fixtureRow)).status === "imported", "isolation doesn't stop others");
    checks.push("five corruption/schema cases isolate independently");
    const realGet = repository.get.bind(repository);
    repository.get = async id => { const record = await realGet(id); return record ? { ...record, project: { ...record.project, title: "injected-readback-mismatch" } } : null; };
    try { check((await testImporter(repository, fixture, "bad-readback").importOne(fixtureRow)).status === "recovery", "readback mismatch isolates source"); }
    finally { repository.get = realGet; }
    check((await testImporter(repository, fixture, "healthy-after-readback").importOne(fixtureRow)).status === "imported", "readback mismatch does not stop others");
    checks.push("readback mismatch isolates without replacing original or blocking other sources");
    // One corrupt item must not block opening the storage region, healthy bodies or upgrade.
    repository.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name); request.onerror = () => reject(request.error); request.onsuccess = () => {
        const db = request.result, tx = db.transaction("migration_items", "readwrite"), json = "{}";
        tx.objectStore("migration_items").put({ id: "corrupt-one", json, ...jsonIntegrity(json) });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    });
    repository = new IndexedDbProjectRepository({ dbName: name }); check((await repository.initialize()).status === "ready", "bad item does not block open");
    check((await repository.list({ limit: 100 })).items.length > 0, "healthy docs remain available");
    let rejected = false; try { await repository.readMigration("corrupt-one"); } catch { rejected = true; } check(rejected, "bad item fails individually");
    checks.push("bad migration item is isolated at read, never at DB open");
    return checks;
  } finally { repository.close(); await new Promise<void>(resolve => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => resolve(); }); }
}
