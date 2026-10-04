import type { Project } from "../types";
import { createProjectSummary, serializeProject } from "../project/codec";
import { isValidStorageId } from "./ids";
import { validateCollaboration } from "./collaborationData";
import { validSharingSummary } from "./sharingSummary";
import { isRevision, RepositoryError, type ProjectRecord, type ProjectSummary } from "./types";

export const PROJECT_DB_NAME = "tairetsu-maker-projects";
export const PROJECT_DB_VERSION = 3;
export const PROJECT_STORES = ["project_bodies", "project_summaries", "project_previous", "operation_receipts", "migration_items"];
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// CRC-32/ISO-HDLC over UTF-8. Accidental corruption detection, not authentication.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export const jsonIntegrity = (json: string) => {
  const bytes = new TextEncoder().encode(json);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return { byteLength: bytes.length, crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0") };
};
export const requestDigest = async (signature: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
};

export const scalarKey = (id: string) => Array.from(id, c => c.codePointAt(0)!.toString(16).padStart(6, "0")).join("");
export const sortTime = (s: ProjectSummary) => {
  const time = Date.parse(s.lastOpenedAt ?? s.updatedAt ?? s.createdAt);
  return Number.isFinite(time) ? time : 0;
};
export type StoredBody = Omit<ProjectRecord, "project"> & {
  schemaVersion: number; id: string; json: string; byteLength: number; crc32: string;
};
export type StoredSummary = { id: string; summary: ProjectSummary; sortTime: number; sortId: string };
export const encodeBody = (record: ProjectRecord, json?: string): StoredBody => {
  if (json === undefined) {
    const encoded = serializeProject(record.project);
    if (!encoded.ok) throw encoded.error;
    json = encoded.value;
  }
  const collaboration = record.collaboration ? validateCollaboration(record.collaboration) : null;
  const attachment = collaboration ? JSON.stringify(collaboration) : undefined;
  return { schemaVersion: collaboration ? 2 : 1, id: record.project.id!, json, ...jsonIntegrity(json),
    ...(attachment ? { collaboration, collaborationIntegrity: jsonIntegrity(attachment) } : {}),
    repositoryRevision: record.repositoryRevision, localRevision: record.localRevision, sync: record.sync };
};
export const encodeSummary = (record: ProjectRecord): StoredSummary => {
  const summary = createProjectSummary(record.project, record.repositoryRevision, record.sync, record.collaboration);
  return { id: summary.id, summary, sortTime: -sortTime(summary), sortId: scalarKey(summary.id) };
};
export const decodeBody = (raw: unknown, id: string): ProjectRecord => {
  if (!object(raw)) throw new RepositoryError("CORRUPT");
  if (Number.isInteger(raw.schemaVersion) && (raw.schemaVersion as number) > 2) throw new RepositoryError("UNSUPPORTED_SCHEMA");
  if (![1, 2].includes(raw.schemaVersion as number) || raw.id !== id || typeof raw.json !== "string" ||
      !isRevision(raw.repositoryRevision) || !isRevision(raw.localRevision) || raw.sync !== null) {
    // Sync writes are not exposed in this phase. Future sync schema must add
    // explicit validation, never trust arbitrary structured-clone objects.
    throw new RepositoryError("CORRUPT");
  }
  const integrity = jsonIntegrity(raw.json);
  if (raw.byteLength !== integrity.byteLength || raw.crc32 !== integrity.crc32) throw new RepositoryError("CORRUPT");
  let project: Project;
  try { project = JSON.parse(raw.json) as Project; }
  catch { throw new RepositoryError("CORRUPT"); }
  const checked = serializeProject(project);
  if (!checked.ok || project.id !== id) throw new RepositoryError("CORRUPT");
  if (raw.schemaVersion === 1) {
    if (raw.collaboration !== undefined && raw.collaboration !== null) throw new RepositoryError("CORRUPT");
    return { project, repositoryRevision: raw.repositoryRevision, localRevision: raw.localRevision, sync: null };
  }
  try {
    const collaboration = validateCollaboration(raw.collaboration);
    const check = jsonIntegrity(JSON.stringify(raw.collaboration));
    if (!object(raw.collaborationIntegrity) || raw.collaborationIntegrity.byteLength !== check.byteLength || raw.collaborationIntegrity.crc32 !== check.crc32) throw new Error();
    return { project, repositoryRevision: raw.repositoryRevision, localRevision: raw.localRevision, sync: null, collaboration };
  } catch (e) { if (e instanceof RepositoryError && e.code === "UNSUPPORTED_SCHEMA") throw e; throw new RepositoryError("CORRUPT"); }
};
export const validSummary = (s: unknown): s is ProjectSummary => object(s) &&
  isValidStorageId(s.id) && typeof s.title === "string" && (s.mode === "stage" || s.mode === "parade") &&
  typeof s.createdAt === "string" && typeof s.updatedAt === "string" &&
  (s.lastOpenedAt === undefined || typeof s.lastOpenedAt === "string") &&
  Number.isInteger(s.memberCount) && (s.memberCount as number) >= 0 &&
  Number.isInteger(s.sceneCount) && (s.sceneCount as number) >= 0 &&
  (s.audioId === undefined || isValidStorageId(s.audioId)) && isRevision(s.repositoryRevision) &&
  ["local", "pending", "synced", "conflict", "error"].includes(s.syncStatus as string) && validSharingSummary(s.sharing);

export const decodeSummary = (raw: unknown): ProjectSummary => {
  if (!object(raw) || !validSummary(raw.summary) || raw.id !== raw.summary.id ||
      raw.sortTime !== -sortTime(raw.summary) || raw.sortId !== scalarKey(raw.summary.id)) throw new RepositoryError("CORRUPT");
  return raw.summary;
};
