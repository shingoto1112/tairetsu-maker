// Read-only by construction: injected capabilities contain no write/delete API.
import type { MigrationIssue } from "../repositories/migrationTypes";
import { validateProjectStructure } from "../project/codec";
export type LegacySource = {
  source: string; role: "list" | "single" | "backup" | "draft" | "metadata";
  status: "absent" | "unreadable" | "ok"; raw?: string; savedAt?: string;
  projects?: unknown[]; issue?: MigrationIssue["code"];
  draft?: { cloudProjectId: string; baseUpdatedAt: string | null; savedAt: string };
};
export interface LegacyNativeReader {
  readText(path: string): Promise<string | null>;
  draftNames(): Promise<string[] | null>;
}
export type LegacyReaderOptions = { local?: () => Pick<Storage, "getItem">; native?: LegacyNativeReader };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const accessCode = (e: unknown): MigrationIssue["code"] => object(e) && ["SecurityError", "NotAllowedError"].includes(e.name as string) ? "ACCESS_DENIED" : "IO_ERROR";

export const parseLegacySource = (source: string, role: LegacySource["role"], raw: string | null, cloudId?: string): LegacySource => {
  const base = { source, role };
  if (raw === null) return { ...base, status: "absent" };
  try {
    if (role === "metadata") {
      if (!date(raw)) throw new Error();
      return { ...base, status: "ok", raw, savedAt: raw };
    }
    const value: unknown = JSON.parse(raw);
    if (role === "single") {
      if (!object(value)) throw new Error();
      const valid = validateProjectStructure(value).ok;
      return { ...base, status: valid ? "ok" : "unreadable", raw, projects: [value],
        ...(valid ? {} : { issue: "CORRUPT" as const }) };
    }
    if (role === "draft") {
      if (!object(value) || value.cloudProjectId !== cloudId || !object(value.project) || !date(value.savedAt) ||
          !(value.baseUpdatedAt === null || date(value.baseUpdatedAt))) throw new Error();
      const valid = validateProjectStructure(value.project).ok;
      return { ...base, status: valid ? "ok" : "unreadable", raw, savedAt: value.savedAt, projects: [value.project],
        ...(valid ? {} : { issue: "CORRUPT" as const }),
        draft: { cloudProjectId: cloudId!, baseUpdatedAt: value.baseUpdatedAt, savedAt: value.savedAt } };
    }
    const projects = Array.isArray(value) ? value : object(value) && Array.isArray(value.projects) ? value.projects : null;
    if (!projects) throw new Error();
    if (object(value) && value.format !== undefined && value.format !== "tairetsu-projects-v1") throw new Error();
    const valid = projects.every(p => validateProjectStructure(p).ok);
    return { ...base, status: valid ? "ok" : "unreadable", raw, projects,
      ...(valid ? {} : { issue: "CORRUPT" as const }),
      ...(object(value) && date(value.savedAt) ? { savedAt: value.savedAt } : {}) };
  } catch { return { ...base, status: "unreadable", raw, issue: "CORRUPT" }; }
};

export const collectLegacySources = async (options: LegacyReaderOptions = {}): Promise<LegacySource[]> => {
  const sources: LegacySource[] = [];
  const local = options.local ?? (() => globalThis.localStorage);
  for (const [key, role] of [["stageflow.projects.v1", "list"], ["stageflow.project.v1", "single"],
    ["stageflow.projects.updatedAt.v1", "metadata"]] as const) {
    try { sources.push(parseLegacySource(key, role, local().getItem(key))); }
    catch (e) { sources.push({ source: key, role, status: "unreadable", issue: accessCode(e) }); }
  }
  const timestamp = sources.find(s => s.role === "metadata" && s.status === "ok")?.savedAt;
  if (timestamp && sources[0].projects) sources[0].savedAt = timestamp;
  if (!options.native) return sources;
  for (const [path, role] of [["projects/projects.json", "list"], ["projects/projects.pending.json", "list"],
    ["projects/projects.backup.json", "backup"]] as const) {
    try { sources.push(parseLegacySource(path, role, await options.native.readText(path))); }
    catch (e) { sources.push({ source: path, role, status: "unreadable", issue: accessCode(e) }); }
  }
  let names: string[] | null;
  try { names = await options.native.draftNames(); }
  catch (e) {
    sources.push({ source: "personal-cloud-drafts", role: "metadata", status: "unreadable", issue: accessCode(e) });
    return sources;
  }
  sources.push({ source: "personal-cloud-drafts", role: "metadata", status: names === null ? "absent" : "ok" });
  for (const name of [...new Set(names ?? [])].sort()) {
    // Only old fixed-directory JSON filenames. Never accept traversal or absolute paths.
    if (/[\\/\u0000-\u001f]/.test(name) || name.includes("..") || !name.endsWith(".json")) continue;
    const stem = name.replace(/\.(pending|backup)\.json$|\.json$/, "");
    const path = `personal-cloud-drafts/${name}`;
    let cloudId: string;
    try {
      cloudId = decodeURIComponent(stem);
      if (!cloudId || encodeURIComponent(cloudId) !== stem) throw new Error();
    } catch {
      sources.push({ source: path, role: "draft", status: "unreadable", issue: "CORRUPT" });
      continue;
    }
    try {
      sources.push(parseLegacySource(path, "draft", await options.native.readText(path), cloudId));
    } catch (e) { sources.push({ source: path, role: "draft", status: "unreadable", issue: accessCode(e) }); }
  }
  return sources;
};

export const createCapacitorLegacyReader = async (): Promise<LegacyNativeReader> => {
  const { Directory, Encoding, Filesystem } = await import("@capacitor/filesystem");
  const absent = (e: unknown) => object(e) && e.code === "OS-PLUG-FILE-0008";
  return {
    async readText(path) {
      try {
        const result = await Filesystem.readFile({ directory: Directory.Data, encoding: Encoding.UTF8, path });
        if (typeof result.data !== "string") throw new Error();
        return result.data;
      } catch (e) { if (absent(e)) return null; throw e; }
    },
    async draftNames() {
      try {
        const result = await Filesystem.readdir({ directory: Directory.Data, path: "personal-cloud-drafts" });
        return result.files.filter(f => f.type === "file").map(f => f.name);
      } catch (e) { if (absent(e)) return null; throw e; }
    },
  };
};
