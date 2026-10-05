import { Capacitor } from "@capacitor/core";
import { collectLegacySources, createCapacitorLegacyReader, type LegacyReaderOptions, type LegacySource } from "../storage/legacyReaders";
import { canonicalJson } from "../repositories/migrationTypes";
import { requestDigest } from "../repositories/indexedDbFormat";
import { validateIndependentProject, LegacyImportError } from "./validation";
import { saveIndependentCopy, deviceAudioResolver, type ImportRepository } from "./importer";
export const enumerateDrafts = async (readers?: LegacyReaderOptions): Promise<LegacySource[]> => {
  const injected = import.meta.env.DEV && typeof window !== "undefined"
    ? (window as Window & { __legacyDraftReaders?: LegacyReaderOptions }).__legacyDraftReaders : undefined;
  const options = readers ?? injected ?? (Capacitor.isNativePlatform() ? { native: await createCapacitorLegacyReader() } : {});
  if (!options.native) return [];
  const native = options.native;
  // Reuse the read-only enumerator/error classification without allocating old
  // whole-library snapshots just to inspect the separate draft directory.
  return (await collectLegacySources({ local: () => ({ getItem: () => null }), includeDrafts: true,
    native: { draftNames: () => native.draftNames(), readText: path => path.startsWith("personal-cloud-drafts/") ? native.readText(path) : Promise.resolve(null) },
  })).filter(s => s.role === "draft" || s.source === "personal-cloud-drafts");
};
export const draftVariant = (source: LegacySource): string => source.source.endsWith(".pending.json") ? "保存途中の下書き"
  : source.source.endsWith(".backup.json") ? "予備の下書き" : source.role === "draft" ? "通常の下書き" : "下書きフォルダ";
export async function rescueDraft(repository: ImportRepository, source: LegacySource, resolveAudio = deviceAudioResolver(repository), signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (source.status !== "ok" || !source.projects?.[0] || !source.draft) throw new LegacyImportError("UNREADABLE", "この候補は読めません。元ファイルはそのまま残っています。");
  // No ownership/freshness inference and no sign-in/network dependency.
  const project = validateIndependentProject(source.projects[0]);
  const digest = await requestDigest(source.raw ?? canonicalJson(project));
  const audio = await resolveAudio(project.audio);
  const copy = { ...project, ...(project.audio ? { audio: audio ?? { ...project.audio, id: `missing-legacy-audio-${await requestDigest(canonicalJson(project.audio))}` } } : {}) };
  return saveIndependentCopy(repository, { environment: "device-files", accountId: "unattributed", sourceId: source.source,
    kind: `draft-explicit-${digest}` }, digest, copy, [canonicalJson({ ...source.draft, originalAudio: project.audio ?? null })], signal);
}
