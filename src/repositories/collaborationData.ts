import { isValidStorageId } from "./ids";
import { compareRevisions, isRevision, RepositoryError, type CollaborationData } from "./types";

export const COLLABORATION_LIMITS = Object.freeze({ updateBytes: 256 * 1024, baseBytes: 8 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024, jsonBytes: 24 * 1024 * 1024, entries: 4096, compactEntries: 128, compactBytes: 1024 * 1024 });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(n => n in v);
export const base64Bytes = (value: unknown, max: number): number => {
  if (typeof value !== "string") throw new RepositoryError("INVALID_ARGUMENT");
  if (value.length > Math.ceil(max / 3) * 4) throw new RepositoryError("QUOTA_EXCEEDED");
  // Avoid a repeated capture group: V8 can overflow its regexp stack on MiB-sized bases.
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new RepositoryError("INVALID_ARGUMENT");
  const decoded = atob(value);
  if (btoa(decoded) !== value) throw new RepositoryError("INVALID_ARGUMENT");
  if (decoded.length > max) throw new RepositoryError("QUOTA_EXCEEDED");
  return decoded.length;
};
export function validateCollaboration(value: unknown): CollaborationData {
  if (!object(value)) throw new RepositoryError("INVALID_ARGUMENT");
  if (value.schemaVersion !== 1 || value.documentSchema !== 1) throw new RepositoryError("UNSUPPORTED_SCHEMA");
  if (!keys(value, ["schemaVersion", "sharedDocumentId", "documentSchema", "generation", "base", "journal", "outbox", "serverCursor"]) ||
    (value.sharedDocumentId !== null && !isValidStorageId(value.sharedDocumentId)) || !isRevision(value.generation) || value.generation === "0" ||
    !isRevision(value.serverCursor) || !Array.isArray(value.journal) || !Array.isArray(value.outbox)) throw new RepositoryError("INVALID_ARGUMENT");
  if (value.journal.length > COLLABORATION_LIMITS.entries || value.outbox.length > COLLABORATION_LIMITS.entries) throw new RepositoryError("QUOTA_EXCEEDED");
  let total = base64Bytes(value.base, COLLABORATION_LIMITS.baseBytes);
  const ids = new Map<string, string>();
  for (const [entries, kind] of [[value.journal, "journal"], [value.outbox, "outbox"]] as const) {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!object(entry) || !keys(entry, ["updateId", "bytes", kind === "journal" ? "source" : "status"]) || !isValidStorageId(entry.updateId) ||
        seen.has(entry.updateId) || (kind === "journal" ? !["local", "remote"].includes(entry.source as string) : !["pending", "sent"].includes(entry.status as string))) throw new RepositoryError("INVALID_ARGUMENT");
      total += base64Bytes(entry.bytes, COLLABORATION_LIMITS.updateBytes);
      if (ids.has(entry.updateId) && ids.get(entry.updateId) !== entry.bytes) throw new RepositoryError("CONFLICT");
      seen.add(entry.updateId); ids.set(entry.updateId, entry.bytes as string);
    }
  }
  if (total > COLLABORATION_LIMITS.totalBytes) throw new RepositoryError("QUOTA_EXCEEDED");
  const outbox = new Map((value.outbox as CollaborationData["outbox"]).map(e => [e.updateId, e.bytes]));
  if ((value.journal as CollaborationData["journal"]).some(e => e.source === "local" && outbox.get(e.updateId) !== e.bytes)) throw new RepositoryError("INVALID_ARGUMENT");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > COLLABORATION_LIMITS.jsonBytes) throw new RepositoryError("QUOTA_EXCEEDED");
  return JSON.parse(JSON.stringify(value)) as CollaborationData;
}

/** No implicit detach, epoch switch, cursor rollback, ID/bytes mutation or ACK rollback. */
export function validateCollaborationTransition(current: CollaborationData | null | undefined, next: CollaborationData | null | undefined) {
  if (!current) return;
  if (!next || current.generation !== next.generation || current.documentSchema !== next.documentSchema ||
    (current.sharedDocumentId !== null && current.sharedDocumentId !== next.sharedDocumentId) ||
    compareRevisions(next.serverCursor, current.serverCursor) < 0) throw new RepositoryError("CONFLICT");
  const entries = new Map(next.outbox.map(e => [e.updateId, e]));
  for (const old of current.outbox) {
    const entry = entries.get(old.updateId);
    if (!entry || old.bytes !== entry.bytes || (old.status === "sent" && entry.status !== "sent")) throw new RepositoryError("CONFLICT");
  }
}
