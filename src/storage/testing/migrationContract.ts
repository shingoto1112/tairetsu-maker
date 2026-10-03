import fixtures from "../../repositories/contract/fixtures/commitProjects.json";
import legacyFixtures from "../../repositories/contract/fixtures/projects.json";
import type { Project } from "../../types";
import { collectLegacySources, type LegacyReaderOptions } from "../legacyReaders";
import { createMigrationPlan, LEGACY_MIGRATION_ID } from "../migrationPlan";
import { migrateLegacyStorage } from "../migrationCoordinator";
import { canonicalJson, type MigrationEntry, type MigrationRepository } from "../../repositories/migrationTypes";
import { RepositoryError, type ProjectRepository } from "../../repositories/types";

type Repo = ProjectRepository & MigrationRepository;
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const stage = fixtures.stage as Project;
const newer: Project = { ...stage, title: "匿名の新しい版", updatedAt: "2026-02-01T00:00:00.000Z" };
const other: Project = { ...stage, id: "anonymous-other" };
const envelope = (projects: unknown[], savedAt: string) => JSON.stringify({ format: "tairetsu-projects-v1", projects, savedAt });
const listKey = "stageflow.projects.v1", singleKey = "stageflow.project.v1", timeKey = "stageflow.projects.updatedAt.v1";
export const memoryReaders = (values: Record<string, string> = {}, native: Record<string, string> = {}): LegacyReaderOptions => ({
  local: () => ({ getItem: key => values[key] ?? null }),
  native: { readText: async path => native[path] ?? null,
    draftNames: async () => Object.keys(native).filter(p => p.startsWith("personal-cloud-drafts/")).map(p => p.slice("personal-cloud-drafts/".length)) },
});

/** Same coordinator cases run against memory mapping oracle and real Chromium IDB. */
export const runMigrationContract = async (create: () => Repo, reopen: (r: Repo) => Repo = r => r): Promise<{ scenarios: number }> => {
  let scenarios = 0;
  const run = async (readers: LegacyReaderOptions, expect: { imported: number; recovery: number }, verify?: (r: Repo) => Promise<void>) => {
    const r = create();
    const before = canonicalJson(await collectLegacySources(readers));
    const progress: number[] = [];
    const result = await migrateLegacyStorage({ repository: r, readers, onProgress: p => progress.push(p.completed) });
    assert(result.completed && result.canContinue, "expected completed migration");
    assert(result.migratedCount === expect.imported && result.recoveryCount === expect.recovery, `counts: ${canonicalJson(result)}`);
    assert(before === canonicalJson(await collectLegacySources(readers)), "readers must never write/delete old sources");
    assert(progress.every((v, i) => !i || v >= progress[i - 1]), "monotone progress");
    const retry = await migrateLegacyStorage({ repository: r, readers: { local: () => { throw new Error("must not reread completed sources"); } } });
    assert(canonicalJson(retry) === canonicalJson(result), "completed bootstrap is stable without old-source reads");
    await verify?.(r); scenarios++;
  };
  await run(memoryReaders({ [listKey]: "broken", [singleKey]: JSON.stringify(stage) }), { imported: 1, recovery: 0 });
  await run(memoryReaders({ [singleKey]: JSON.stringify(stage) }), { imported: 1, recovery: 0 });
  await run(memoryReaders({}, { "projects/projects.json": envelope([stage], "2026-01-01T00:00:00Z") }), { imported: 1, recovery: 0 });
  await run(memoryReaders({}, { "projects/projects.pending.json": envelope([stage], "2026-01-01T00:00:00Z") }), { imported: 1, recovery: 0 });
  await run(memoryReaders({ [listKey]: "[]", [timeKey]: "2026-03-01T00:00:00Z" }, {
    "projects/projects.backup.json": envelope([stage, other], "2026-01-01T00:00:00Z"),
  }), { imported: 0, recovery: 2 }, async r => { assert((await r.list({ limit: 100 })).items.length === 0, "empty is not corrupt"); });
  await run(memoryReaders({}, { "projects/projects.backup.json": JSON.stringify([stage]) }), { imported: 0, recovery: 1 });
  await run(memoryReaders({ [listKey]: JSON.stringify([stage]), [singleKey]: JSON.stringify(newer) }), { imported: 1, recovery: 1 }, async r => {
    assert((await r.get(stage.id!))?.project.title === newer.title, "new single is partial-save evidence");
  });
  await run(memoryReaders({ [listKey]: "[]", [timeKey]: "2026-01-01T00:00:00Z", [singleKey]: JSON.stringify(newer) }), { imported: 1, recovery: 0 });
  await run(memoryReaders({ [listKey]: "[]", [timeKey]: "2026-03-01T00:00:00Z", [singleKey]: JSON.stringify(stage) }), { imported: 0, recovery: 1 });
  await run(memoryReaders({ [listKey]: JSON.stringify([stage]), [singleKey]: JSON.stringify({ ...stage, title: "匿名の時刻不明差分" }) }), { imported: 1, recovery: 1 });
  await run(memoryReaders({ [listKey]: JSON.stringify([stage]), [singleKey]: JSON.stringify(stage) }), { imported: 1, recovery: 0 });
  await run(memoryReaders({ [listKey]: JSON.stringify([stage, { ...stage, title: "同一スナップショットの曖昧な重複" }]) }), { imported: 0, recovery: 2 });
  const { id: _id, ...noId } = stage;
  await run(memoryReaders({ [listKey]: JSON.stringify([noId]), [singleKey]: JSON.stringify(noId) }), { imported: 1, recovery: 0 }, async r => {
    assert((await r.list({ limit: 100 })).items[0].id.startsWith("legacy-"), "stable ID assigned");
  });
  const cloudId = "anonymous-cloud", cloudPath = `personal-cloud-drafts/${cloudId}.pending.json`;
  const draft = { project: newer, cloudProjectId: cloudId, baseUpdatedAt: stage.updatedAt, savedAt: newer.updatedAt };
  await run(memoryReaders({}, { [cloudPath]: JSON.stringify(draft) }), { imported: 1, recovery: 0 }, async r => {
    const batch = await r.readMigration(LEGACY_MIGRATION_ID);
    const item = batch?.kind === "batch" ? await r.readMigration(batch.itemIds[0]) : null;
    assert(item?.kind === "item" && item.draft?.status === "pending" && item.draft.baseUpdatedAt === stage.updatedAt, "draft provenance, never synced");
    assert(item?.kind === "item" && (await r.get(item.targetId))?.sync === null, "no invented server revision/account");
  });
  await run(memoryReaders({ [listKey]: JSON.stringify([stage, { title: "壊れた匿名データ", members: "invalid" }]) }), { imported: 1, recovery: 1 });
  await run(memoryReaders({ [listKey]: JSON.stringify([stage]), [timeKey]: "2026-01-01T00:00:00Z" }, {
    "projects/projects.pending.json": envelope([], "2026-03-01T00:00:00Z"),
  }), { imported: 0, recovery: 1 });
  await run(memoryReaders({}, { "projects/projects.json": "broken", "projects/projects.pending.json": envelope([stage], "2026-01-01T00:00:00Z") }), { imported: 1, recovery: 0 });
  const oldSparse = legacyFixtures.sparse;
  await run(memoryReaders({ [listKey]: JSON.stringify([oldSparse]) }), { imported: 1, recovery: 0 }, async r => {
    const record = await r.get((await r.list({ limit: 100 })).items[0].id);
    assert(record?.project.frames[0].id.startsWith("f-") && record.project.mode === "stage", "stable generated frame and legacy stage defaults");
  });

  // Stop after every durable phase, reopen the same storage and resume. No
  // duplicate body, source deletion, or random ID on ID-less legacy data.
  for (const stop of ["discovered", "validated", "written", "verified", "completed"] as const) {
    let r = create(); const readers = memoryReaders({ [listKey]: JSON.stringify([noId, other]) });
    const write = r.writeMigration.bind(r);
    const abort = new AbortController();
    r.writeMigration = async (e, expected) => {
      const result = await write(e, expected);
      if (e.kind === "item" && result.state === stop) abort.abort();
      return result;
    };
    const first = await migrateLegacyStorage({ repository: r, readers, signal: abort.signal });
    assert(!first.completed && first.failures.some(e => e.code === "INTERRUPTED"), `stop ${stop}`);
    r.writeMigration = write;
    r = reopen(r);
    const retry = await migrateLegacyStorage({ repository: r, readers });
    assert(retry.completed && retry.migratedCount === 2 && (await r.list({ limit: 100 })).items.length === 2, `resume ${stop}`);
    scenarios++;
  }
  for (const stop of ["written", "verified", "completed"] as const) {
    let r = create(); const readers = memoryReaders({ [listKey]: JSON.stringify([stage]) });
    const write = r.writeMigration.bind(r);
    let failed = false;
    r.writeMigration = async (e, expected) => {
      const result = await write(e, expected);
      if (!failed && e.kind === "item" && result.state === stop) { failed = true; throw new RepositoryError("IO_ERROR"); }
      return result;
    };
    assert(!(await migrateLegacyStorage({ repository: r, readers })).completed, "response loss injection");
    r.writeMigration = write;
    r = reopen(r);
    await r.rename({ id: stage.id!, title: "移行後に編集", updatedAt: newer.updatedAt, localRevision: "2", expectedRepositoryRevision: "1", operationId: `edit-after-${stop}` });
    assert((await migrateLegacyStorage({ repository: r, readers })).completed, "resume after edit");
    assert((await r.get(stage.id!))?.project.title === "移行後に編集", "must never overwrite newer edit");
    scenarios++;
  }
  {
    const r = create(), readers = memoryReaders({ [listKey]: JSON.stringify([stage, other]) });
    const write = r.writeMigration.bind(r);
    let writes = 0;
    r.writeMigration = async (e, expected) => {
      if (e.kind === "item" && e.state === "written" && ++writes === 2) throw new RepositoryError("QUOTA_EXCEEDED");
      return write(e, expected);
    };
    const first = await migrateLegacyStorage({ repository: r, readers });
    assert(!first.completed && first.migratedCount === 1 && first.failures.some(e => e.code === "QUOTA_EXCEEDED"), "quota preserves completed items");
    r.writeMigration = write;
    assert((await migrateLegacyStorage({ repository: r, readers })).migratedCount === 2, "resume quota"); scenarios++;
  }
  {
    const r = create(), values = { [listKey]: JSON.stringify([stage]) };
    const readers = memoryReaders(values);
    readers.native = { readText: async () => { throw new Error("access failure"); }, draftNames: async () => { throw new Error("access failure"); } };
    const first = await migrateLegacyStorage({ repository: r, readers });
    assert(!first.completed && first.migratedCount === 1 && first.canContinue, "partial readable data usable");
    await r.remove({ id: stage.id!, expectedRepositoryRevision: "1", operationId: "delete-during-discovery" });
    const retry = await migrateLegacyStorage({ repository: r, readers: memoryReaders(values, { "projects/projects.json": envelope([stage], "2026-01-01T00:00:00Z") }) });
    assert(retry.completed && !(await r.get(stage.id!)), "resolved access failures must not resurrect later-deleted body"); scenarios++;
  }
  {
    const r = create();
    await r.commit({ project: newer, localRevision: "1", expectedRepositoryRevision: null, operationId: "existing-before-migration" });
    const result = await migrateLegacyStorage({ repository: r, readers: memoryReaders({ [listKey]: JSON.stringify([stage]) }) });
    assert(result.recoveryCount === 1 && (await r.get(stage.id!))?.project.title === newer.title, "existing destination always wins"); scenarios++;
  }
  // Transition misuse must leave the persisted ledger unchanged.
  {
    const r = create(); await r.initialize();
    const plan = await createMigrationPlan(await collectLegacySources(memoryReaders({ [listKey]: JSON.stringify([stage]) })));
    const item = plan.items[0];
    await r.writeMigration(item, null);
    let code = "";
    try { await r.writeMigration({ ...item, state: "completed", outcome: "imported" }, "discovered"); }
    catch (e) { code = e instanceof RepositoryError ? e.code : ""; }
    assert(code === "CONFLICT" && (await r.readMigration(item.id))?.state === "discovered", "no skipped phase");
    try { await r.writeMigration({ ...item, json: "{}" }, null); throw new Error("missing conflict"); }
    catch (e) { assert(e instanceof RepositoryError && e.code === "CONFLICT", "immutable identity"); }
    scenarios++;
  }
  return { scenarios };
};
