import { decodeProjectJson } from "../project/codec";
import { createId } from "../utils/ids";
import { RepositoryError, type CommitRequest } from "../repositories/types";
import type { MigrationItem } from "../repositories/migrationTypes";
import type { MaintenanceRepository } from "./maintenanceTypes";
import { deviceAudioProject } from "./deviceAudioProject";

export type RecoveryCandidate = { id: string; title: string; updatedAt: string | null; memberCount: number | null;
  sceneCount: number | null; source: string; restorable: boolean; reviewed: boolean };
export const sourceExplanation = (sources: string[]): string => {
  const descriptions = new Set(sources.map(source => source.includes("backup") ? "以前の予備の保存"
    : source.includes("pending") ? "保存の途中に残ったデータ"
    : source.includes("localStorage") || source.includes("stageflow") ? "以前のブラウザの保存"
    : source.includes("draft") ? "以前の端末の下書き" : "以前の端末の保存"));
  return [...descriptions].join("・") + "（現在の一覧に自動追加しなかったデータ）";
};
export const recoveryItem = async (repository: MaintenanceRepository, id: string): Promise<MigrationItem> => {
  const batch = await repository.readMigration("legacy-projects-v1");
  if (!batch || batch.kind !== "batch" || !batch.itemIds.includes(id)) throw new RepositoryError("NOT_FOUND");
  const item = await repository.readMigration(id);
  if (!item || item.kind !== "item" || !(item.disposition === "recovery" || item.outcome === "recovery")) throw new RepositoryError("NOT_FOUND");
  return item;
};
export const listRecoveryCandidates = async (repository: MaintenanceRepository): Promise<RecoveryCandidate[]> => {
  const batch = await repository.readMigration("legacy-projects-v1");
  if (!batch || batch.kind !== "batch") return [];
  const state = await repository.readMaintenance(), candidates: RecoveryCandidate[] = [];
  for (const id of batch.itemIds) {
    const item = await repository.readMigration(id);
    if (!item || item.kind !== "item") throw new RepositoryError("CORRUPT");
    if (!(item.disposition === "recovery" || item.outcome === "recovery")) continue;
    const decoded = decodeProjectJson(item.json);
    let raw: Record<string, unknown> = {};
    try { const parsed: unknown = JSON.parse(item.json); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>; } catch { /* Inspection ZIP only. */ }
    candidates.push({ id, title: typeof raw.title === "string" ? raw.title : "名称を読み取れない隊列表",
      updatedAt: typeof raw.updatedAt === "string" && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : null,
      memberCount: Array.isArray(raw.members) ? raw.members.length : null, sceneCount: Array.isArray(raw.frames) ? raw.frames.length : null,
      source: sourceExplanation(item.sources), restorable: decoded.ok, reviewed: state.reviewedIds.includes(id) });
  }
  return candidates;
};
export const recoveryRequest = (json: string): CommitRequest => {
  const decoded = decodeProjectJson(json);
  if (!decoded.ok) throw decoded.error;
  const now = new Date().toISOString();
  return { project: { ...decoded.value, id: createId("restored"), createdAt: now, updatedAt: now, lastOpenedAt: now },
    expectedRepositoryRevision: null, localRevision: "1", operationId: createId("recovery") };
};
export const restoreCandidate = async (repository: MaintenanceRepository, id: string, request?: CommitRequest) => {
  const item = await recoveryItem(repository, id);
  const commit = request ?? recoveryRequest(item.json);
  const receipt = await repository.commit(commit);
  await repository.updateMaintenance({ action: "reviewed", ids: [id] });
  return receipt;
};
export const inspectCandidateZip = async (repository: MaintenanceRepository, id: string): Promise<Blob> => {
  const item = await recoveryItem(repository, id);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("recovery.json", item.json);
  zip.file("README.txt", "構造を読み取れない復元候補です。調査用の原文であり、通常の隊列表ZIPとしては読み込めません。");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
};
export const restorePreviousAsCopy = async (repository: MaintenanceRepository, id: string) => {
  const previous = await repository.getPrevious(id);
  if (!previous) throw new RepositoryError("NOT_FOUND");
  // Keep the damaged original and its previous generation intact.
  return repository.commit(recoveryRequest(JSON.stringify(await deviceAudioProject(previous))));
};
