import { cleanupReasons, type MaintenanceRepository } from "./maintenanceTypes";
import { listRecoveryCandidates } from "./recovery";
import { listAllSummaries } from "./appRepository";

export const oldDataCleanupReasons = async (repository: MaintenanceRepository): Promise<string[]> => {
  if (repository.legacyCleanupStatus) return repository.legacyCleanupStatus();
  const state = await repository.readMaintenance(), batch = await repository.readMigration("legacy-projects-v1");
  const candidates = await listRecoveryCandidates(repository);
  let allVerified = !!batch && batch.kind === "batch";
  if (batch?.kind === "batch") for (const id of batch.itemIds) {
    const item = await repository.readMigration(id);
    if (!item || item.kind !== "item" || item.state !== "completed") allVerified = false;
  }
  const reasons = cleanupReasons({ completed: batch?.state === "completed", issues: !batch || batch.kind !== "batch" || !!batch.issues.length,
    allVerified, reviewed: candidates.every(c => c.reviewed), state, native: false, backupVerified: false });
  // Migration-time verification does not prove today's body is still readable.
  // Retain old sources if current/previous data cannot be revalidated now.
  try { for (const summary of await listAllSummaries(repository)) {
    if (!await repository.get(summary.id)) throw new Error("missing");
    await repository.getPrevious(summary.id);
  } } catch { reasons.push("現在の保存データまたは前の保存を検証できません。"); }
  return reasons;
};
export const cleanupOldData = async (repository: MaintenanceRepository) => {
  const reasons = await oldDataCleanupReasons(repository);
  if (reasons.length) throw new Error(reasons.join(" "));
  // Native rechecks conditions and verifies referenced old audio was copied before
  // deleting fixed Documents paths. No recursive path from the UI is accepted.
  if (repository.cleanupLegacyData) await repository.cleanupLegacyData();
  for (const key of ["stageflow.projects.v1", "stageflow.project.v1", "stageflow.projects.updatedAt.v1"]) localStorage.removeItem(key);
};
export const runDeviceMaintenance = async (repository: MaintenanceRepository) => {
  await repository.updateMaintenance({ action: "started" });
  // This runs before local interaction is enabled, so there is no unsaved editor.
  // Native enforces the 24h interval and free-space/verification checks itself.
  if (repository.createRecoveryBackup) {
    try { await repository.createRecoveryBackup(); } catch { console.info("[recovery backup] skipped"); }
  }
  try { await repository.collectUnusedAudio(); } catch { console.info("[audio GC] skipped: references could not be verified"); }
};
