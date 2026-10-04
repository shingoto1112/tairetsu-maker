import { isValidStorageId } from "./ids";
import { validateAudioBindings } from "./audioBindings";
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
  if (![1, 2, 3].includes(value.schemaVersion as number) || ![1, 2].includes(value.documentSchema as number)) throw new RepositoryError("UNSUPPORTED_SCHEMA");
  const names = ["schemaVersion", "sharedDocumentId", "documentSchema", "generation", "base", "journal", "outbox", "serverCursor"];
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  if ("knownSnapshotId" in value) { names.push("knownSnapshotId"); if (!uuid(value.knownSnapshotId)) throw new RepositoryError("INVALID_ARGUMENT"); }
  if ("recoveryRequired" in value) { names.push("recoveryRequired"); if (value.recoveryRequired !== true) throw new RepositoryError("INVALID_ARGUMENT"); }
  if (value.schemaVersion === 3) {
    names.push("writer");
    const w = value.writer;
    if (!object(w) || !keys(w, ["id", "allocatedThrough", "ackThrough", "reclaimedThrough", "legacySentIds"]) || !uuid(w.id) ||
      ![w.allocatedThrough, w.ackThrough, w.reclaimedThrough].every(v => isRevision(v) && BigInt(v) <= 9223372036854775807n) ||
      compareRevisions(w.reclaimedThrough as string, w.ackThrough as string) > 0 || compareRevisions(w.ackThrough as string, w.allocatedThrough as string) > 0 ||
      !Array.isArray(w.legacySentIds) || w.legacySentIds.length > COLLABORATION_LIMITS.entries || w.legacySentIds.some(id => !isValidStorageId(id)) || new Set(w.legacySentIds).size !== w.legacySentIds.length ||
      !value.transportBinding || value.sharedDocumentId === null) throw new RepositoryError("INVALID_ARGUMENT");
  }
  if ("audioBindings" in value) {
    if (value.schemaVersion === 1) throw new RepositoryError("INVALID_ARGUMENT");
    names.push("audioBindings"); validateAudioBindings(value.audioBindings);
  }
  if ("transportBinding" in value) {
    names.push("transportBinding");
    const binding = value.transportBinding;
    if (!object(binding) || !keys(binding, ["accountId", "membershipGeneration"]) || !uuid(binding.accountId) || !uuid(binding.membershipGeneration)) throw new RepositoryError("INVALID_ARGUMENT");
  }
  if (!keys(value, names) ||
    (value.sharedDocumentId !== null && !isValidStorageId(value.sharedDocumentId)) || !isRevision(value.generation) || value.generation === "0" ||
    !isRevision(value.serverCursor) || !Array.isArray(value.journal) || !Array.isArray(value.outbox)) throw new RepositoryError("INVALID_ARGUMENT");
  if (value.journal.length > COLLABORATION_LIMITS.entries || value.outbox.length > COLLABORATION_LIMITS.entries) throw new RepositoryError("QUOTA_EXCEEDED");
  let total = base64Bytes(value.base, COLLABORATION_LIMITS.baseBytes);
  const ids = new Map<string, string>();
  const sequences = new Set<string>();
  for (const [entries, kind] of [[value.journal, "journal"], [value.outbox, "outbox"]] as const) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const entryNames = ["updateId", "bytes", kind === "journal" ? "source" : "status"];
      if (object(entry) && "writerSeq" in entry && kind === "outbox" && value.schemaVersion === 3) entryNames.push("writerSeq");
      if (!object(entry) || !keys(entry, entryNames) || !isValidStorageId(entry.updateId) ||
        seen.has(entry.updateId) || (kind === "journal" ? !["local", "remote"].includes(entry.source as string) : !["pending", "sent"].includes(entry.status as string))) throw new RepositoryError("INVALID_ARGUMENT");
      total += base64Bytes(entry.bytes, COLLABORATION_LIMITS.updateBytes);
      if (kind === "outbox" && value.schemaVersion === 3) {
        const w = value.writer as CollaborationData["writer"];
        if (w!.legacySentIds.includes(entry.updateId as string)) throw new RepositoryError("CONFLICT");
        if ("writerSeq" in entry && (!isRevision(entry.writerSeq) || sequences.has(entry.writerSeq) || compareRevisions(entry.writerSeq, w!.reclaimedThrough) <= 0 || compareRevisions(entry.writerSeq, w!.allocatedThrough) > 0 ||
          compareRevisions(entry.writerSeq, w!.ackThrough) <= 0 && entry.status !== "sent")) throw new RepositoryError("INVALID_ARGUMENT");
        if (typeof entry.writerSeq === "string") sequences.add(entry.writerSeq);
        else if (entry.status === "sent") throw new RepositoryError("INVALID_ARGUMENT");
      }
      if (ids.has(entry.updateId) && ids.get(entry.updateId) !== entry.bytes) throw new RepositoryError("CONFLICT");
      seen.add(entry.updateId); ids.set(entry.updateId, entry.bytes as string);
    }
  }
  if (total > COLLABORATION_LIMITS.totalBytes) throw new RepositoryError("QUOTA_EXCEEDED");
  if (value.schemaVersion === 3) {
    const w = value.writer as NonNullable<CollaborationData["writer"]>;
    if (BigInt(w.allocatedThrough) - BigInt(w.reclaimedThrough) !== BigInt(sequences.size)) throw new RepositoryError("INVALID_ARGUMENT");
  }
  const outbox = new Map((value.outbox as CollaborationData["outbox"]).map(e => [e.updateId, e.bytes]));
  if ((value.journal as CollaborationData["journal"]).some(e => e.source === "local" && outbox.get(e.updateId) !== e.bytes)) throw new RepositoryError("INVALID_ARGUMENT");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > COLLABORATION_LIMITS.jsonBytes) throw new RepositoryError("QUOTA_EXCEEDED");
  return JSON.parse(JSON.stringify(value)) as CollaborationData;
}

/** No implicit detach, epoch switch, cursor rollback, ID/bytes mutation or ACK rollback. */
export function validateCollaborationTransition(current: CollaborationData | null | undefined, next: CollaborationData | null | undefined) {
  if (!current) return;
  if (!next || current.schemaVersion > next.schemaVersion || current.generation !== next.generation || current.documentSchema !== next.documentSchema ||
    ((current.transportBinding || current.sharedDocumentId !== null) &&
      (current.transportBinding?.accountId !== next.transportBinding?.accountId || current.transportBinding?.membershipGeneration !== next.transportBinding?.membershipGeneration)) ||
    (current.sharedDocumentId !== null && current.sharedDocumentId !== next.sharedDocumentId) ||
    compareRevisions(next.serverCursor, current.serverCursor) < 0) throw new RepositoryError("CONFLICT");
  if (current.knownSnapshotId && !next.knownSnapshotId) throw new RepositoryError("CONFLICT");
  if (current.recoveryRequired && !next.recoveryRequired) throw new RepositoryError("CONFLICT");
  if (current.writer && (!next.writer || current.writer.id !== next.writer.id ||
    ["allocatedThrough", "ackThrough", "reclaimedThrough"].some(k => compareRevisions(next.writer![k as "ackThrough"], current.writer![k as "ackThrough"]) < 0) ||
    current.writer.legacySentIds.some(id => !next.writer!.legacySentIds.includes(id)))) throw new RepositoryError("CONFLICT");
  const entries = new Map(next.outbox.map(e => [e.updateId, e]));
  for (const old of current.outbox) {
    const entry = entries.get(old.updateId);
    const reclaimed = next.writer && (old.writerSeq ? compareRevisions(old.writerSeq, next.writer.reclaimedThrough) <= 0 : old.status === "sent" && next.writer.legacySentIds.includes(old.updateId));
    if (!entry && reclaimed) continue;
    if (!entry || old.bytes !== entry.bytes || old.writerSeq && old.writerSeq !== entry.writerSeq || (old.status === "sent" && entry.status !== "sent")) throw new RepositoryError("CONFLICT");
  }
  // Every advance must cover a contiguous set of previously allocated entries.
  if (next.writer && current.writer && compareRevisions(next.writer.ackThrough, current.writer.ackThrough) > 0) {
    const covered = current.outbox.filter(e => e.writerSeq && compareRevisions(e.writerSeq, current.writer!.ackThrough) > 0 && compareRevisions(e.writerSeq, next.writer!.ackThrough) <= 0);
    if (BigInt(covered.length) !== BigInt(next.writer.ackThrough) - BigInt(current.writer.ackThrough)) throw new RepositoryError("CONFLICT");
  }
}
