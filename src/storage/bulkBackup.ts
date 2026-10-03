import { MAX_AUDIO_FILE_BYTES, MAX_PROJECT_JSON_BYTES, MAX_TAIRETSU_FILE_BYTES, MAX_ZIP_UNCOMPRESSED_BYTES } from "../config/fileLimits";
import { createTairetsuArchive, readTairetsuArchive } from "../utils/tairetsuFile";
import { loadAudioBlobFromIndexedDb, saveAudioBlobToIndexedDb } from "../utils/audioStorage";
import { decodeProjectJson } from "../project/codec";
import { createId } from "../utils/ids";
import { listAllSummaries, getRequiredProject } from "./appRepository";
import type { Project, AudioMeta } from "../types";
import type { ProjectRepository } from "../repositories/types";

export type BackupManifest = { fileType: "tairetsu-backup-set"; version: 1; createdAt: string; count: number;
  exportedCount: number; includesAudio: boolean; files: { name: string; size: number }[]; failedCount: number };
export type GeneratedBackupFile = { blob: Blob; fileName: string };
export const checkBackupBounds = (jsonBytes: number, audioBytes: number) => {
  if (jsonBytes > MAX_PROJECT_JSON_BYTES || audioBytes > MAX_AUDIO_FILE_BYTES ||
      jsonBytes + audioBytes + 4096 > MAX_ZIP_UNCOMPRESSED_BYTES) throw new Error("1件のサイズ上限を超えています。音源を含めずにバックアップしてください。");
};
export const assertBackupSize = (project: Project, audioBytes: number) => {
  const jsonBytes = new TextEncoder().encode(JSON.stringify({ ...project, ...(audioBytes ? {} : { audio: null }) }, null, 2)).byteLength;
  // Existing 1-project ZIP has at most 3 files (+ the audio directory), bounded
  // independently. Reserve 4KiB for its manifest/header instead of growing limits.
  checkBackupBounds(jsonBytes, audioBytes);
};
export const estimateBackup = async (repository: ProjectRepository) => {
  const summaries = await listAllSummaries(repository);
  let audioBytes = 0, jsonBytes = 0, unknownCount = 0;
  for (const summary of summaries) {
    try {
      const { project } = await getRequiredProject(repository, summary.id);
      audioBytes += project.audio?.size ?? 0;
      jsonBytes += new TextEncoder().encode(JSON.stringify(project, null, 2)).byteLength;
    } catch { unknownCount++; }
  }
  // Shared audio appears in each independent ZIP, so deliberately count duplicates.
  return { count: summaries.length, audioBytes, jsonBytes, unknownCount };
};
/** The consumer must finish delivering/staging one yield before requesting the next.
 * Only lightweight summary/manifest metadata grows with the number of projects. */
export async function* generateBulkBackup(repository: ProjectRepository, includeAudio: boolean,
  progress: (completed: number, total: number) => void = () => {}): AsyncGenerator<GeneratedBackupFile> {
  const summaries = await listAllSummaries(repository), prefix = createId("backup");
  const manifest: BackupManifest = { fileType: "tairetsu-backup-set", version: 1, createdAt: new Date().toISOString(),
    count: summaries.length, exportedCount: 0, includesAudio: includeAudio, files: [], failedCount: 0 };
  for (const [index, summary] of summaries.entries()) {
    let output: GeneratedBackupFile | undefined;
    try {
      const { project } = await getRequiredProject(repository, summary.id);
      assertBackupSize(project, includeAudio ? project.audio?.size ?? 0 : 0);
      const audioBlob = includeAudio && project.audio ? await loadAudioBlobFromIndexedDb(project.audio.id, project.audio) : null;
      if (includeAudio && project.audio && (!audioBlob || audioBlob.size !== project.audio.size)) throw new Error("音源を読み込めません。");
      const blob = await createTairetsuArchive(project, { audioBlob });
      if (blob.size > MAX_TAIRETSU_FILE_BYTES) throw new Error("ZIPのサイズ上限を超えています。");
      const fileName = `${prefix}-${String(index + 1).padStart(6, "0")}.zip`;
      manifest.files.push({ name: fileName, size: blob.size }); manifest.exportedCount++;
      output = { blob, fileName };
    } catch { manifest.failedCount++; }
    if (output) yield output;
    progress(index + 1, summaries.length);
  }
  yield { fileName: `${prefix}.manifest.json`, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }) };
}
export const parseBackupManifest = async (file: File): Promise<BackupManifest> => {
  if (file.size > 1024 * 1024) throw new Error("バックアップ一覧が大きすぎます。");
  const m = JSON.parse(await file.text()) as BackupManifest;
  if (m.fileType !== "tairetsu-backup-set" || m.version !== 1 || !Number.isSafeInteger(m.count) || m.count < 0 ||
      !Number.isSafeInteger(m.exportedCount) || m.exportedCount < 0 || !Number.isSafeInteger(m.failedCount) || m.failedCount < 0 ||
      m.exportedCount + m.failedCount !== m.count || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.includesAudio !== "boolean" ||
      !Array.isArray(m.files) || m.files.length !== m.exportedCount || new Set(m.files.map(f => f.name)).size !== m.files.length ||
      !m.files.every(f => typeof f.name === "string" && /^[A-Za-z0-9_-]+\.zip$/.test(f.name) && Number.isSafeInteger(f.size) && f.size > 0 && f.size <= MAX_TAIRETSU_FILE_BYTES)) throw new Error("バックアップ一覧の形式が不正です。");
  return m;
};
export type ImportReport = { imported: number; failed: number; missing: number; errors: string[]; cancelled?: boolean };
export const importBackupFiles = async (repository: ProjectRepository, files: File[],
  options: { confirmManifest?: (manifest: BackupManifest, missing: number) => Promise<boolean>; importOne?: (file: File) => Promise<void> } = {}): Promise<ImportReport> => {
  const report: ImportReport = { imported: 0, failed: 0, missing: 0, errors: [] };
  const manifests = files.filter(f => f.name.endsWith(".manifest.json"));
  if (manifests.length > 1) throw new Error("バックアップ一覧は1つずつ選択してください。");
  let archives = files.filter(f => !manifests.includes(f));
  if (manifests.length) {
    const manifest = await parseBackupManifest(manifests[0]);
    const byName = new Map(archives.map(f => [f.name, f]));
    if (byName.size !== archives.length) throw new Error("同じ名前のファイルが複数あります。");
    report.missing = manifest.files.filter(f => !byName.has(f.name)).length;
    if (options.confirmManifest && !await options.confirmManifest(manifest, report.missing)) return { ...report, cancelled: true };
    archives = manifest.files.flatMap(entry => {
      const file = byName.get(entry.name);
      if (!file) return [];
      if (file.size !== entry.size) { report.failed++; report.errors.push("一覧とファイルのサイズが一致しない項目があります。"); return []; }
      return [file];
    });
  }
  for (const file of archives) {
    try {
      if (options.importOne) await options.importOne(file);
      else {
        const imported = await readTairetsuArchive(file);
        const decoded = decodeProjectJson(JSON.stringify(imported.project));
        if (!decoded.ok) throw decoded.error;
        let audio: AudioMeta | null = null;
        if (imported.audioBlob) audio = await saveAudioBlobToIndexedDb(imported.audioBlob, {
          duration: imported.project.audio?.duration, name: imported.project.audio?.name ?? imported.audioFileName ?? "audio",
          type: imported.project.audio?.type || imported.audioBlob.type || "audio/mpeg" });
        const now = new Date().toISOString();
        await repository.commit({ project: { ...decoded.value, audio, id: createId("imported"), createdAt: now, updatedAt: now, lastOpenedAt: now },
          localRevision: "1", expectedRepositoryRevision: null, operationId: createId("import") });
      }
      report.imported++;
    } catch { report.failed++; if (report.errors.length < 5) report.errors.push("読み込めない項目がありました。元のファイルは残っています。"); }
  }
  return report;
};
