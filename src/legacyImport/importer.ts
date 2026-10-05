import type { Project, AudioMeta } from "../types";
import type { ProjectRepository } from "../repositories/types";
import { RepositoryError } from "../repositories/types";
import { canonicalJson, migrationIdentity, migrationStates, type MigrationRepository, type MigrationItem } from "../repositories/migrationTypes";
import { requestDigest } from "../repositories/indexedDbFormat";
import { LegacyImportError, validateSnapshot, snapshotProject } from "./validation";
import { legacyFailureMessage, type LegacyExportApi, type LegacyListItem } from "./api";

export type ImportRepository = ProjectRepository & MigrationRepository;
export type ImportResult = { sourceId: string; title: string; status: "imported" | "already" | "recovery" | "failed";
  message: string; targetId?: string; recoveryId?: string; canRescueChanged?: boolean };
export type ImportIdentity = { environment: string; accountId: string; sourceId: string; kind: string };
export const sourceKey = async (identity: ImportIdentity) => `legacy-rescue-v1-${await requestDigest(canonicalJson(identity))}`;
const abort = (signal?: AbortSignal) => { signal?.throwIfAborted(); };
/** Unchanged TS/Swift ledger format. Namespace/batch never touches legacy-projects-v1. */
export async function saveIndependentCopy(repository: ImportRepository, identity: ImportIdentity, sourceHash: string,
  project: Project, provenance: string[], signal?: AbortSignal): Promise<{ item: MigrationItem; already: boolean }> {
  const key = await sourceKey(identity), targetId = `legacy-copy-${key.slice(-64)}`;
  let stored = await repository.readMigration(key), already = stored?.kind === "item" && migrationStates.indexOf(stored.state) >= 2;
  if (stored && stored.kind !== "item") throw new RepositoryError("CORRUPT");
  if (stored && stored.sourceHash !== sourceHash) throw new LegacyImportError("SOURCE_CHANGED", "この出典は以前の取り込みと内容が異なります。自動では追加しません。救出候補を確認してください。");
  abort(signal);
  if (!stored) {
    const initial: MigrationItem = { kind: "item", id: key, state: "discovered", targetId, sourceHash,
      sources: [canonicalJson(identity), ...provenance], json: canonicalJson({ ...project, id: targetId }), disposition: "import", reason: "利用者が選んだ旧データの独立コピー" };
    try { stored = await repository.writeMigration(initial, null); }
    catch (e) { stored = await repository.readMigration(key); if (!stored) throw e; }
    if (stored.kind !== "item" || stored.sourceHash !== sourceHash) throw new LegacyImportError("SOURCE_CHANGED", "別の画面で異なる内容を取り込みました。救出候補を確認してください。");
  }
  let item = stored as MigrationItem;
  // One source's sealed identity wins even if device audio choices changed in another tab.
  const batchId = `${key}-batch`;
  if (!await repository.readMigration(batchId)) await repository.writeMigration({ kind: "batch", id: batchId, state: "discovered",
    itemIds: [key], sources: [{ source: canonicalJson(identity), status: "ok", hash: sourceHash }], issues: [] }, null);
  for (const state of ["validated", "written", "verified", "completed"] as const) {
    abort(signal);
    if (migrationStates.indexOf(item.state) >= migrationStates.indexOf(state)) continue;
    if (state === "verified") {
      const reread = await repository.readMigration(key);
      if (!reread || reread.kind !== "item" || migrationIdentity(reread) !== migrationIdentity(item) || reread.outcome !== item.outcome ||
        migrationStates.indexOf(reread.state) < 2) throw new RepositoryError("CORRUPT");
      const record = await repository.get(targetId);
      // Atomic written receipt survives later edit/delete. Never restore their original body.
      if (item.outcome !== "recovery" && record?.repositoryRevision === "1" && (canonicalJson(record.project) !== item.json || record.sync || record.collaboration)) throw new RepositoryError("CORRUPT");
      if (!already && item.outcome === "imported" && !record) {
        // Concurrent deletion is permitted only once durable creation is proved above.
        already = true;
      }
    }
    item = await repository.writeMigration({ ...item, state, ...(state === "written" ? { outcome: "imported" as const } : {}) }, item.state) as MigrationItem;
  }
  const batch = await repository.readMigration(batchId);
  if (!batch || batch.kind !== "batch") throw new RepositoryError("CORRUPT");
  if (batch.state !== "completed") await repository.writeMigration({ ...batch, state: "completed", counts: {
    migratedCount: item.outcome === "imported" ? 1 : 0, recoveryCount: item.outcome === "recovery" ? 1 : 0, duplicateCount: item.outcome === "duplicate" ? 1 : 0 } }, "discovered");
  return { item, already: !!already };
}
export async function quarantine(repository: ImportRepository, identity: ImportIdentity, raw: unknown, reason: string) {
  // Recovery JSON stays an object for existing native backup/audio-GC readers,
  // including malformed primitive/array responses. This is not a Project.
  const sourceHash = await requestDigest(canonicalJson(raw)), json = canonicalJson({ legacyExport: raw }),
    id = `legacy-isolated-v1-${await requestDigest(canonicalJson({ identity, sourceHash, reason }))}`;
  const initial: MigrationItem = { kind: "item", id, targetId: `isolated-${id.slice(-64)}`, sourceHash, state: "discovered",
    sources: [canonicalJson(identity)], json, disposition: "recovery", reason };
  let item = await repository.readMigration(id) as MigrationItem | null;
  item ??= await repository.writeMigration(initial, null) as MigrationItem;
  for (const state of ["validated", "written", "verified", "completed"] as const) if (migrationStates.indexOf(item.state) < migrationStates.indexOf(state)) {
    item = await repository.writeMigration({ ...item, state, ...(state === "written" ? { outcome: "recovery" as const } : {}) }, item.state) as MigrationItem;
  }
  return id;
}
/** Default audio lookup follows 8b's device binding table and verifies local bytes. */
export function deviceAudioResolver(repository: ProjectRepository) {
  let catalog: Promise<{ bindings: import("../repositories/audioBindings").AudioBinding[]; candidates: AudioMeta[] }> | undefined;
  return async (audio: AudioMeta | null | undefined): Promise<AudioMeta | null> => {
    if (!audio) return null;
    const runtime = await import("../collaboration/deviceAudio");
    catalog ??= (async () => {
      const bindings: import("../repositories/audioBindings").AudioBinding[] = [];
      const summaries = await (await import("../storage/appRepository")).listAllSummaries(repository);
      for (const summary of summaries) if (summary.sharing) {
        try { bindings.push(...(await repository.get(summary.id))?.collaboration?.audioBindings ?? []); } catch { /* Isolate one bad body. */ }
      }
      return { bindings, candidates: await runtime.deviceAudioCandidates(repository, bindings, audio) };
    })();
    const { bindings, candidates } = await catalog;
    return runtime.chooseDeviceAudio(audio, bindings, candidates);
  };
}
export class LegacyCloudImporter {
  constructor(readonly repository: ImportRepository, readonly api: LegacyExportApi, readonly environment: string, readonly accountId: string,
    readonly resolveAudio = deviceAudioResolver(repository)) {}
  async importOne(row: LegacyListItem, signal?: AbortSignal, rescueChanged = false): Promise<ImportResult> {
    const identity = { environment: this.environment, accountId: this.accountId, sourceId: row.projectId, kind: "cloud-owner" };
    let raw: unknown;
    try {
      abort(signal); raw = await this.api.export(row.projectId, signal); abort(signal);
      const snapshot = validateSnapshot(raw, row.projectId), digest = await requestDigest(canonicalJson(snapshot));
      const project = snapshotProject(snapshot, "preparing-independent-copy");
      const mapped = await this.resolveAudio(project.audio);
      if (project.audio) project.audio = mapped ?? { ...project.audio, id: `missing-legacy-audio-${await requestDigest(canonicalJson(project.audio))}` };
      const provenance = canonicalJson({ projectRevision: snapshot.project.updated_at, legacyProjectId: snapshot.project.legacy_project_id,
        originalAudio: snapshot.resources.find(r => r.resource_key === "audio")!.data.audio,
        resources: snapshot.resources.map(r => [r.resource_key, r.version]), scenes: snapshot.scenes.map(s => [s.scene_id, s.version]) });
      const saved = await saveIndependentCopy(this.repository, rescueChanged ? { ...identity, kind: `cloud-explicit-rescue-${digest}` } : identity,
        digest, project, [provenance], signal);
      return { sourceId: row.projectId, title: row.title, status: saved.item.outcome === "recovery" ? "recovery" : saved.already ? "already" : "imported",
        targetId: saved.item.targetId, message: saved.item.outcome === "recovery" ? "保存先が競合したため隔離しました。" : saved.already ? "取り込み済みです。編集・削除した文書は戻しません。"
          : `端末に独立コピーを保存しました。${project.audio && !mapped ? "音源情報は保持しました。本体は音源タブで選び直してください。" : ""}` };
    } catch (e) {
      if (signal?.aborted) throw e;
      const message = legacyFailureMessage(e);
      if (raw !== undefined && ((e instanceof LegacyImportError && ["INCOMPLETE", "UNSUPPORTED_SCHEMA", "SOURCE_CHANGED"].includes(e.code)) ||
        (e instanceof RepositoryError && e.code === "CORRUPT"))) {
        try { const recoveryId = await quarantine(this.repository, identity, raw, message);
          return { sourceId: row.projectId, title: row.title, status: "recovery", message, recoveryId,
            canRescueChanged: e instanceof LegacyImportError && e.code === "SOURCE_CHANGED" }; }
        catch (saveError) { return { sourceId: row.projectId, title: row.title, status: "failed", message: `${message} 隔離保存にも失敗しました。${legacyFailureMessage(saveError)}` }; }
      }
      return { sourceId: row.projectId, title: row.title, status: "failed", message };
    }
  }
  async run(rows: LegacyListItem[], onResult: (result: ImportResult, completed: number) => void, signal?: AbortSignal) {
    for (const [i, row] of rows.entries()) { abort(signal); onResult(await this.importOne(row, signal), i + 1); }
  }
}
