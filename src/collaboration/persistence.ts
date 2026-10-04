import * as Y from "yjs";
import type { Project } from "../types";
import { COLLABORATION_LIMITS, base64Bytes, validateCollaboration } from "../repositories/collaborationData";
import { compareRevisions, RepositoryError, type CollaborationData, type CollaborationUpdate } from "../repositories/types";
import { assertDocument, getModel } from "./model";
import { projectSharedDocument } from "./projection";
import { same } from "./projectModel";
export { projectSharedDocument } from "./projection";

export const encodeUpdate = (bytes: Uint8Array): string => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
export const decodeUpdate = (value: string): Uint8Array => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function hydrateCollaboration(data: CollaborationData): Y.Doc {
  validateCollaboration(data);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, decodeUpdate(data.base));
    for (const update of data.journal) Y.applyUpdate(doc, decodeUpdate(update.bytes));
    assertDocument(doc);
    if (getModel(doc).metadata.get("schemaVersion") !== data.documentSchema) throw new Error("Document schema mismatch");
    // Unresolved dependencies cannot be compacted or advanced past a cursor.
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error("Incomplete Yjs updates");
    return doc;
  } catch { doc.destroy(); throw new RepositoryError("INVALID_ARGUMENT"); }
}
export function createCollaborationData(doc: Y.Doc): CollaborationData {
  assertDocument(doc);
  return validateCollaboration({ schemaVersion: 1, documentSchema: getModel(doc).metadata.get("schemaVersion") as 1 | 2, sharedDocumentId: null,
    generation: "1", base: encodeUpdate(Y.encodeStateAsUpdate(doc)), journal: [], outbox: [], serverCursor: "0" });
}
export function validateCollaborationProject(data: CollaborationData, project: Project): void {
  const doc = hydrateCollaboration(data);
  try {
    const projection = projectSharedDocument(doc, project, data.sharedDocumentId);
    if (data.documentSchema === 2 && !same(projection, project)) throw new Error("Shared Project projection mismatch");
    for (let i = 0; i < project.frames.length; i++) {
      const actual = project.frames[i].positions, expected = projection.frames[i].positions;
      if (Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([id, p]) => actual[id]?.x !== p.x || actual[id]?.y !== p.y)) throw new Error();
    }
    // Outbox bytes must already be part of the durable state (including delete sets).
    const before = encodeUpdate(Y.encodeStateAsUpdate(doc));
    for (const update of data.outbox) Y.applyUpdate(doc, decodeUpdate(update.bytes));
    if (before !== encodeUpdate(Y.encodeStateAsUpdate(doc))) throw new Error();
  } catch { throw new RepositoryError("INVALID_ARGUMENT"); }
  finally { doc.destroy(); }
}
export function assertCollaborationExtends(current: CollaborationData, next: CollaborationData): void {
  const doc = hydrateCollaboration(next), old = hydrateCollaboration(current);
  try {
    const before = encodeUpdate(Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(old));
    if (before !== encodeUpdate(Y.encodeStateAsUpdate(doc))) throw new RepositoryError("CONFLICT");
  } finally { doc.destroy(); old.destroy(); }
}
export function compactCollaboration(input: CollaborationData, force = false): CollaborationData {
  const data = validateCollaboration(input);
  const size = data.journal.reduce((sum, e) => sum + base64Bytes(e.bytes, COLLABORATION_LIMITS.updateBytes), 0);
  if (!force && data.journal.length < COLLABORATION_LIMITS.compactEntries && size < COLLABORATION_LIMITS.compactBytes) return data;
  const doc = hydrateCollaboration(data);
  try { return validateCollaboration({ ...data, base: encodeUpdate(Y.encodeStateAsUpdate(doc)), journal: [] }); }
  finally { doc.destroy(); }
}
export function appendCollaboration(input: CollaborationData, updates: CollaborationUpdate[], cursor = input.serverCursor): CollaborationData {
  const data = validateCollaboration(input);
  if (compareRevisions(cursor, data.serverCursor) < 0) throw new RepositoryError("CONFLICT");
  for (const update of updates) {
    const existing = data.journal.find(e => e.updateId === update.updateId) ?? data.outbox.find(e => e.updateId === update.updateId);
    if (existing && existing.bytes !== update.bytes) throw new RepositoryError("CONFLICT");
    if (!data.journal.some(e => e.updateId === update.updateId)) data.journal.push({ ...update });
    if (update.source === "local" && !data.outbox.some(e => e.updateId === update.updateId)) data.outbox.push({ updateId: update.updateId, bytes: update.bytes, status: "pending" });
  }
  data.serverCursor = cursor;
  return compactCollaboration(data);
}
/** Rebase local state onto durable state, including its compaction and ACK tombstones. */
export function mergeCollaboration(saved: CollaborationData, local: CollaborationData, base: Project): { project: Project; collaboration: CollaborationData } {
  if (saved.generation !== local.generation || saved.documentSchema !== local.documentSchema ||
    saved.transportBinding?.accountId !== local.transportBinding?.accountId || saved.transportBinding?.membershipGeneration !== local.transportBinding?.membershipGeneration ||
    (local.sharedDocumentId !== null && saved.sharedDocumentId !== null && saved.sharedDocumentId !== local.sharedDocumentId)) throw new RepositoryError("CONFLICT");
  const doc = hydrateCollaboration(saved), mine = hydrateCollaboration(local);
  try {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(mine));
    const outbox = new Map(saved.outbox.map(e => [e.updateId, { ...e }]));
    for (const e of local.outbox) {
      const old = outbox.get(e.updateId);
      if (old && old.bytes !== e.bytes) throw new RepositoryError("CONFLICT");
      outbox.set(e.updateId, { ...e, status: old?.status === "sent" ? "sent" : e.status });
    }
    const collaboration = validateCollaboration({ ...saved, sharedDocumentId: saved.sharedDocumentId ?? local.sharedDocumentId,
      base: encodeUpdate(Y.encodeStateAsUpdate(doc)), journal: [], outbox: [...outbox.values()],
      serverCursor: compareRevisions(saved.serverCursor, local.serverCursor) >= 0 ? saved.serverCursor : local.serverCursor });
    return { project: projectSharedDocument(doc, base, collaboration.sharedDocumentId), collaboration };
  } finally { doc.destroy(); mine.destroy(); }
}
