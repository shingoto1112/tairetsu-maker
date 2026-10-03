import { RepositoryError, type ProjectRecord, type ProjectRepository } from "../repositories/types";
import type { MigrationRepository } from "../repositories/migrationTypes";

export const MAINTENANCE_ID = "device-maintenance-v1";
export const DAY = 86_400_000;
export type MaintenanceState = {
  completedAt: number | null;
  successfulStarts: number;
  reviewedIds: string[];
  gcAt: number | null;
};
export type MaintenanceAction = { action: "started" } | { action: "reviewed"; ids: string[] };
export type GCResult = { count: number; bytes: number; skipped: boolean };
export interface MaintenanceRepository extends ProjectRepository, MigrationRepository {
  readMaintenance(): Promise<MaintenanceState>;
  updateMaintenance(action: MaintenanceAction): Promise<MaintenanceState>;
  getPrevious(id: string): Promise<ProjectRecord | null>;
  collectUnusedAudio(): Promise<GCResult>;
  createRecoveryBackup?: () => Promise<{ created: boolean }>;
  restoreRecoveryBackup?: () => Promise<void>;
  legacyCleanupStatus?: () => Promise<string[]>;
  cleanupLegacyData?: () => Promise<void>;
}
export const initialMaintenance = (): MaintenanceState => ({ completedAt: null, successfulStarts: 0, reviewedIds: [], gcAt: null });
export const validateMaintenance = (value: unknown): MaintenanceState => {
  const v = value as MaintenanceState | null;
  if (!v || ![v.completedAt, v.gcAt].every(t => t === null || (typeof t === "number" && Number.isSafeInteger(t) && t > 0)) ||
      !Number.isSafeInteger(v.successfulStarts) || v.successfulStarts < 0 || !Array.isArray(v.reviewedIds) ||
      !v.reviewedIds.every(id => typeof id === "string" && id.length > 0) || new Set(v.reviewedIds).size !== v.reviewedIds.length) throw new RepositoryError("CORRUPT");
  return v;
};
export const cleanupReasons = (input: { completed: boolean; issues: boolean; allVerified: boolean; reviewed: boolean;
  state: MaintenanceState; native: boolean; backupVerified: boolean }, now = Date.now()): string[] => {
  const reasons: string[] = [];
  if (!input.completed) reasons.push("古いデータの移行が完了していません。");
  if (input.issues || !input.allVerified) reasons.push("移行元または移行結果に、確認できていないデータがあります。");
  if (!input.reviewed) reasons.push("復元候補をすべて確認してください。");
  if (input.state.completedAt === null || now - input.state.completedAt < 30 * DAY) reasons.push("移行完了の確認から30日以上必要です。");
  if (input.state.successfulStarts < 2) reasons.push("移行後にもう一度正常に起動してください。");
  if (input.native && !input.backupVerified) reasons.push("検証済みの端末バックアップがありません。");
  return reasons;
};
