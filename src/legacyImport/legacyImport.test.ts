import { describe, it, expect } from "vitest";
import fixture from "../../supabase/tests/fixtures/legacy-export-v1.json";
import { LegacyCloudImporter, sourceKey } from "./importer";
import { validateSnapshot, snapshotProject, validateIndependentProject, LegacyImportError } from "./validation";
import { validateLegacyPage, legacyFailureMessage, legacyFailureDetail, type LegacyListItem } from "./api";
import { enumerateDrafts, draftVariant, rescueDraft } from "./drafts";
import { MemoryMigrationRepository } from "../storage/testing/MemoryMigrationRepository";

const clone = (): any => JSON.parse(JSON.stringify(fixture));
const row: LegacyListItem = { projectId: fixture.project.id, title: "試験用旧文書", mode: "stage", schemaVersion: 1, createdAt: fixture.project.created_at, hidden: false };
const mutations: [string, (s: any) => void][] = [
  ["resource欠落", s => s.resources.pop()], ["resource重複", s => s.resources.push(s.resources[0])],
  ["scene欠落", s => s.scenes = []], ["scene余剰", s => s.scenes.push({ ...s.scenes[0], scene_id: "extra" })],
  ["scene重複", s => s.scenes.push(s.scenes[0])], ["order重複", s => s.resources[3].data.frames.push(s.resources[3].data.frames[0])],
  ["schema", s => s.resources[0].schema_version = 2], ["scene schema", s => s.scenes[0].schema_version = 2],
  ["project schema", s => s.project.schema_version = 2], ["契約", s => s.contractVersion = 2],
  ["有限数", s => s.resources[4].data.stage.widthMeters = Infinity], ["型", s => s.resources[4].data.stage.showGrid = "yes"],
  ["位置欠落", s => delete s.scenes[0].data.positions], ["参照", s => s.scenes[0].data.positions.unknown = { x: 1, y: 2 }],
  ["割当参照", s => s.scenes[0].data.objectAssignments = { missing: ["missing"] }],
  ["group参照", s => s.resources[1].data.memberGroups = [{ id: "g", name: "g", memberIds: ["missing"] }]],
  ["member重複", s => s.resources[1].data.members = [{ id: "m", name: "m", color: "red" }, { id: "m", name: "m", color: "red" }]],
  ["movement参照", s => s.resources[3].data.movementPlans = [{ id: "plan", fromFrameId: "missing", toFrameId: "scene-fixture", targetType: "member", targetId: "m" }]],
  ["資格混入", s => s.project.lock_token = "excluded"], ["V2混入", s => s.resources[4].data.outbox = []],
  ["危険キー", s => s.resources.push({ ...s.resources[0], resource_key: "__proto__" })],
];
describe("11b strict export contract", () => {
  it("presents readable errors while retaining diagnostics", () => {
    for (const [code, detail] of [["INCOMPLETE", "scenes: sceneOrderが参照するsceneが欠けています"], ["INCOMPLETE", "resources: 5種類のresourceが揃っていません"], ["UNSUPPORTED_SCHEMA", "schema_version: 2"], ["INVALID_RESPONSE", "応答JSONが不正です。"], ["EXPORT_UPGRADE_REQUIRED", "migrationを適用してください"]]) {
      const error = new LegacyImportError(code, detail);
      expect(legacyFailureMessage(error)).toContain("元のデータはそのままです");
      expect(legacyFailureMessage(error)).not.toMatch(/sceneOrder|resource|schema|JSON|migration/);
      expect(legacyFailureDetail(error)).toBe(detail);
    }
    expect(legacyFailureDetail(new LegacyImportError("SOURCE_CHANGED", "内容が変わりました。"))).toBeUndefined();
    expect(legacyFailureMessage({ name: "AbortError" })).toBe("中断しました。再開できます。");
  });
  it("fixture and zero scenes are complete without defaults", () => {
    const p = snapshotProject(validateSnapshot(fixture, row.projectId), "independent");
    expect(validateIndependentProject(p)).toEqual(p); expect(p.frames[0].notes).toBe("Synthetic notes");
    const empty = clone(); empty.scenes = []; empty.resources[3].data.frames = [];
    expect(snapshotProject(validateSnapshot(empty, row.projectId), "empty").frames).toEqual([]);
  });
  for (const [label, mutate] of mutations) it(`rejects ${label} before reconstruction`, () => {
    const s = clone(); mutate(s); expect(() => validateSnapshot(s, row.projectId)).toThrow();
  });
  it("rejects a different source ID and mismatched mode", () => {
    expect(() => validateSnapshot(fixture, "another")).toThrow();
    const s = clone(); s.resources[4].data.mode = "parade"; expect(() => validateSnapshot(s, row.projectId)).toThrow();
  });
  it("list requires hidden/deadline metadata and matching cursor", () => {
    const page = { contractVersion: 1, items: [row], nextCursor: null, exportUntil: "2026-11-04T00:00:00Z" };
    expect(validateLegacyPage(page).items[0].hidden).toBe(false);
    expect(() => validateLegacyPage({ ...page, exportUntil: undefined })).toThrow();
    expect(() => validateLegacyPage({ ...page, nextCursor: { createdAt: row.createdAt, projectId: "11000000-0000-0000-0000-000000000002" } })).toThrow();
    expect(legacyFailureMessage({ code: "QUOTA_EXCEEDED" })).toContain("空き容量");
  });
});
describe("11b source ledger", () => {
  it("keys separate environment/account/kind, never include digest", async () => {
    const identity = { environment: "https://fixture.invalid", accountId: "a", sourceId: "s", kind: "cloud-owner" };
    const keys = await Promise.all([identity, { ...identity, environment: "other" }, { ...identity, accountId: "b" }, { ...identity, kind: "draft" }].map(sourceKey));
    expect(new Set(keys).size).toBe(4);
  });
  it("isolates malformed documents and continues to a healthy source", async () => {
    const repository = new MemoryMigrationRepository(); await repository.initialize();
    const bad = { ...row, projectId: "11000000-0000-0000-0000-000000000002" };
    const api = { list: async () => { throw new Error(); }, export: async (id: string) => { const s = clone(); s.project.id = id; if (id === bad.projectId) s.scenes = []; return s; } };
    const importer = new LegacyCloudImporter(repository, api, "env", "account", async () => null), results: string[] = [];
    await importer.run([bad, row], r => results.push(r.status)); expect(results).toEqual(["recovery", "imported"]);
    const result = await importer.importOne(bad);
    expect(result.message).toContain("一部のシーンが欠けている");
    expect(result.detail).toBe("scenes: sceneOrderが参照するsceneが欠けています");
    expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
  });
  it("replays after edit/delete and isolates changed successful source", async () => {
    const repository = new MemoryMigrationRepository(); await repository.initialize(); let raw = clone();
    const importer = new LegacyCloudImporter(repository, { list: async () => { throw new Error(); }, export: async () => raw }, "env", "account", async () => null);
    const first = await importer.importOne(row); expect(first.status).toBe("imported");
    const record = (await repository.get(first.targetId!))!;
    await repository.commit({ project: { ...record.project, title: "利用者の編集" }, localRevision: "2", expectedRepositoryRevision: record.repositoryRevision, operationId: "later-edit" });
    expect((await importer.importOne(row)).status).toBe("already"); expect((await repository.get(first.targetId!))!.project.title).toBe("利用者の編集");
    raw = clone(); raw.project.title = "管理者が救出した新版";
    const changed = await importer.importOne(row); expect(changed.status).toBe("recovery"); expect(changed.canRescueChanged).toBe(true);
    expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
    const rescue = await importer.importOne(row, undefined, true); expect(rescue.status).toBe("imported"); expect(rescue.targetId).not.toBe(first.targetId);
    const latest = (await repository.get(first.targetId!))!; await repository.remove({ id: first.targetId!, expectedRepositoryRevision: latest.repositoryRevision, operationId: "later-delete" });
    raw = clone(); expect((await importer.importOne(row)).status).toBe("already"); expect(await repository.get(first.targetId!)).toBeNull();
  });
  it("retains original audio provenance and only adopts confirmed device audio", async () => {
    const raw = clone(), original = { id: "old-audio", name: "匿名音源", type: "audio/wav", size: 100, duration: 1 };
    raw.resources[0].data.audio = original;
    for (const confirmed of [false, true]) {
      const repository = new MemoryMigrationRepository(); await repository.initialize();
      const mapped = { ...original, id: "verified-local-audio" };
      const importer = new LegacyCloudImporter(repository, { list: async () => { throw new Error(); }, export: async () => raw }, "env", "account", async () => confirmed ? mapped : null);
      const result = await importer.importOne(row), record = (await repository.get(result.targetId!))!;
      expect(record.project.audio?.id).toEqual(confirmed ? mapped.id : expect.stringMatching(/^missing-legacy-audio-/));
      expect(record.sync).toBeNull(); expect(record.collaboration).toBeFalsy();
      const ledger = await repository.readMigration(await sourceKey({ environment: "env", accountId: "account", sourceId: row.projectId, kind: "cloud-owner" }));
      expect(ledger?.kind === "item" && ledger.sources.some(s => s.includes('"originalAudio"') && s.includes('"old-audio"'))).toBe(true);
    }
  });
  it("wraps malformed primitive export for existing native recovery/backup readers", async () => {
    const repository = new MemoryMigrationRepository(); await repository.initialize();
    const importer = new LegacyCloudImporter(repository, { list: async () => { throw new Error(); }, export: async () => null }, "env", "account", async () => null);
    const result = await importer.importOne(row); expect(result.status).toBe("recovery");
    const item = await repository.readMigration(result.recoveryId!);
    expect(item?.kind === "item" && JSON.parse(item.json)).toEqual({ legacyExport: null });
    expect((await repository.list({limit:100})).items).toHaveLength(0);
  });
});
describe("11b login-independent draft rescue", () => {
  it("enumerates primary/pending/backup, corrupt and access denied separately", async () => {
    const p = snapshotProject(validateSnapshot(fixture, row.projectId), "old-draft");
    const raw = JSON.stringify({ project: p, cloudProjectId: "old", baseUpdatedAt: null, savedAt: p.updatedAt });
    const paths: string[] = [];
    const sources = await enumerateDrafts({ local: () => { throw new Error("must not read unrelated old library"); }, native: {
      draftNames: async () => ["old.json", "old.pending.json", "old.backup.json", "bad.json", "denied.json"],
      readText: async path => { paths.push(path); if (path.includes("denied")) throw Object.assign(new Error(), { name: "NotAllowedError" });
        return path.includes("bad") ? "{" : path.startsWith("personal-cloud-drafts/") ? raw : null; },
    } });
    expect(paths.every(p => p.startsWith("personal-cloud-drafts/"))).toBe(true);
    const candidates = sources.filter(s => s.role === "draft"); expect(candidates).toHaveLength(5);
    expect(candidates.find(s => s.source.endsWith("bad.json"))!.issue).toBe("CORRUPT");
    expect(candidates.find(s => s.source.endsWith("denied.json"))!.issue).toBe("ACCESS_DENIED");
    expect(candidates.filter(s => s.status === "ok").map(draftVariant).sort()).toEqual(["予備の下書き", "保存途中の下書き", "通常の下書き"].sort());
    const repository = new MemoryMigrationRepository(); await repository.initialize();
    for (const s of candidates.filter(s => s.status === "ok")) await rescueDraft(repository, s, async () => null);
    expect((await repository.list({ limit: 100 })).items).toHaveLength(3);
    expect((await rescueDraft(repository, candidates.find(s => s.source.endsWith("old.json"))!, async () => null)).already).toBe(true);
  });
});
