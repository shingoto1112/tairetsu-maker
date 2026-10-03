import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { estimateBackup, generateBulkBackup, importBackupFiles, parseBackupManifest, checkBackupBounds, type BackupManifest } from "./bulkBackup";
import { MAX_AUDIO_FILE_BYTES, MAX_PROJECT_JSON_BYTES, MAX_ZIP_UNCOMPRESSED_BYTES } from "../config/fileLimits";
import fixture from "../repositories/contract/fixtures/commitProjects.json";
import { createTairetsuArchive, readTairetsuArchive } from "../utils/tairetsuFile";
import { loadAudioBlobFromIndexedDb } from "../utils/audioStorage";
import type { Project } from "../types";
import { initialCollaboration } from "../repositories/contract/runCollaborationContract";

vi.mock("../utils/tairetsuFile", () => ({ createTairetsuArchive: vi.fn(async () => new Blob(["ZIP"], { type: "application/zip" })),
  readTairetsuArchive: vi.fn(async () => ({ project: fixture.stage, audioBlob: null, audioFileName: null })) }));
vi.mock("../utils/audioStorage", () => ({ loadAudioBlobFromIndexedDb: vi.fn(), saveAudioBlobToIndexedDb: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const seed = async (count: number, audio = false) => {
  const r = new MemoryProjectRepository();
  for (let i = 0; i < count; i++) await r.commit({ project: { ...fixture.stage, id: `source-${i}`, audio: audio ? { id: "same-audio", name: "a.wav", type: "audio/wav", size: 10 } : null } as Project,
    localRevision: "1", expectedRepositoryRevision: null, operationId: `seed-${i}` });
  return r;
};
describe("manual independent ZIP backup sets", () => {
  it("exports a shared project's Project only and imports independent copies", async () => {
    const r = new MemoryProjectRepository();
    await r.commit({ project: fixture.stage as Project, collaboration: initialCollaboration(), localRevision: "1", expectedRepositoryRevision: null, operationId: "share" });
    for await (const _file of generateBulkBackup(r, false)) { /* consume the independent archives */ }
    expect(vi.mocked(createTairetsuArchive).mock.calls[0][0]).toEqual(fixture.stage);
    expect(JSON.stringify(vi.mocked(createTairetsuArchive).mock.calls)).not.toContain("outbox");
    await importBackupFiles(r, [new File(["ZIP"], "shared.zip")]);
    for (const summary of (await r.list({ limit: 100 })).items.filter(s => s.id !== fixture.stage.id)) {
      expect((await r.get(summary.id))?.collaboration ?? null).toBeNull();
    }
  });
  it("streams 1000 independent ZIPs plus manifest, crosses 64 safely and does not pre-generate next payload", async () => {
    const r = await seed(1000), stream = generateBulkBackup(r, false);
    const first = await stream.next(); expect(first.value?.fileName).toMatch(/-000001\.zip$/);
    expect(createTairetsuArchive).toHaveBeenCalledTimes(1);
    const names = [first.value!.fileName]; let manifest: BackupManifest | undefined;
    for await (const file of stream) {
      if (file.fileName.endsWith(".manifest.json")) manifest = JSON.parse(await file.blob.text()) as BackupManifest;
      else names.push(file.fileName);
    }
    expect(names).toHaveLength(1000); expect(new Set(names).size).toBe(1000);
    expect(manifest).toMatchObject({ count: 1000, exportedCount: 1000, failedCount: 0, includesAudio: false });
    expect(manifest!.files.map(f => f.name)).toEqual(names);
    expect(manifest!.files.every(f => f.size === 3)).toBe(true);
    const file = new File([JSON.stringify(manifest)], "backup.manifest.json"); expect(await parseBackupManifest(file)).toEqual(manifest);
  }, 30000);
  it("respects JSON/audio/expanded boundaries without allocating 224MiB fixtures", () => {
    expect(() => checkBackupBounds(MAX_PROJECT_JSON_BYTES, 0)).not.toThrow();
    expect(() => checkBackupBounds(MAX_PROJECT_JSON_BYTES + 1, 0)).toThrow();
    expect(() => checkBackupBounds(10, MAX_AUDIO_FILE_BYTES)).not.toThrow();
    expect(() => checkBackupBounds(10, MAX_AUDIO_FILE_BYTES + 1)).toThrow();
    expect(() => checkBackupBounds(MAX_ZIP_UNCOMPRESSED_BYTES - MAX_AUDIO_FILE_BYTES - 4096, MAX_AUDIO_FILE_BYTES)).not.toThrow();
    expect(() => checkBackupBounds(MAX_ZIP_UNCOMPRESSED_BYTES - MAX_AUDIO_FILE_BYTES - 4095, MAX_AUDIO_FILE_BYTES)).toThrow();
  });
  it("emits a valid manifest for an empty library and keeps healthy items exportable when estimation fails", async () => {
    const empty = await seed(0), files = [];
    for await (const file of generateBulkBackup(empty, false)) files.push(file);
    expect(files).toHaveLength(1); expect(JSON.parse(await files[0].blob.text())).toMatchObject({ count: 0, exportedCount: 0, failedCount: 0 });
    const r = await seed(2);
    vi.spyOn(r, "get").mockRejectedValueOnce(new Error("corrupt"));
    expect(await estimateBackup(r)).toMatchObject({ count: 2, unknownCount: 1 });
  });
  it("estimates repeated shared audio in each ZIP and records missing-audio failures truthfully", async () => {
    const r = await seed(2, true); expect((await estimateBackup(r)).audioBytes).toBe(20);
    vi.mocked(loadAudioBlobFromIndexedDb).mockResolvedValue(null);
    const files = []; for await (const f of generateBulkBackup(r, true)) files.push(f);
    expect(files).toHaveLength(1); expect(JSON.parse(await files[0].blob.text())).toMatchObject({ exportedCount: 0, count: 2, failedCount: 2 });
  });
  it("continues after an invalid file, creates new IDs and preserves existing records", async () => {
    const r = await seed(1); const before = await r.get("source-0");
    vi.mocked(readTairetsuArchive).mockRejectedValueOnce(new Error("corrupt"));
    const report = await importBackupFiles(r, [new File(["broken"], "bad.zip"), new File(["ZIP"], "a.zip"), new File(["ZIP"], "b.zip")]);
    expect(report).toMatchObject({ imported: 2, failed: 1 }); expect(await r.get("source-0")).toEqual(before);
    const list = await r.list({ limit: 100 }); expect(list.items).toHaveLength(3);
    expect(list.items.filter(p => p.id !== "source-0").every(p => p.id !== fixture.stage.id)).toBe(true);
  });
  it("checks manifest counts/sizes/missing files, confirmation and cancel before importing", async () => {
    const r = await seed(0), importOne = vi.fn();
    const m: BackupManifest = { fileType: "tairetsu-backup-set", version: 1, count: 3, exportedCount: 3, failedCount: 0,
      createdAt: new Date().toISOString(), includesAudio: false, files: ["a.zip", "b.zip", "c.zip"].map(name => ({ name, size: 3 })) };
    const files = [new File([JSON.stringify(m)], "set.manifest.json"), new File(["ZIP"], "a.zip"), new File(["badsize"], "b.zip")];
    const confirmManifest = vi.fn(async () => true);
    expect(await importBackupFiles(r, files, { importOne, confirmManifest })).toMatchObject({ imported: 1, failed: 1, missing: 1 });
    expect(confirmManifest).toHaveBeenCalledWith(m, 1); expect(importOne).toHaveBeenCalledTimes(1);
    importOne.mockClear(); await importBackupFiles(r, files, { importOne, confirmManifest: async () => false }); expect(importOne).not.toHaveBeenCalled();
    await expect(parseBackupManifest(new File([JSON.stringify({ ...m, count: 4 })], "invalid.manifest.json"))).rejects.toThrow();
  });
});
