// All shared-session implementation stays behind SaveCoordinator's dynamic imports.
import type { Session } from "../storage/saveCoordinator";
import { assertStorageId } from "../repositories/ids";
import { incrementRevision, RepositoryError, type CollaborationOutbox, type CollaborationUpdate, type ProjectRepository, type Revision } from "../repositories/types";
import * as Y from "yjs";
import { validateCollaboration, base64Bytes, COLLABORATION_LIMITS } from "../repositories/collaborationData";
import { compareRevisions } from "../repositories/types";
import { appendCollaboration, hydrateCollaboration, projectSharedDocument, decodeUpdate, encodeUpdate } from "./persistence";

export function editSharedSession(s: Session, updates: CollaborationUpdate[], cursor?: Revision) {
  if (!s.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
  const collaboration = appendCollaboration(s.collaboration, updates, cursor ?? s.collaboration.serverCursor);
  const doc = hydrateCollaboration(collaboration);
  try { s.project = projectSharedDocument(doc, s.project); } finally { doc.destroy(); }
  s.collaboration = collaboration; s.localRevision = incrementRevision(s.localRevision); s.dirty = true;
  return JSON.parse(JSON.stringify(s.project)) as Session["project"];
}
export async function readSendableOutbox(repository: ProjectRepository, id?: string): Promise<CollaborationOutbox[]> {
  if (!id) return [];
  const record = await repository.get(id);
  if (!record?.collaboration?.sharedDocumentId) return [];
  return record.collaboration.outbox.filter(e => e.status === "pending").map(e => ({ ...e }));
}
export function bindSharedSession(s: Session, sharedDocumentId: string, binding?: NonNullable<Session["collaboration"]>["transportBinding"]) {
  assertStorageId(sharedDocumentId);
  if (!s.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
  if (s.collaboration.sharedDocumentId !== null && s.collaboration.sharedDocumentId !== sharedDocumentId) throw new RepositoryError("CONFLICT");
  if (binding && s.collaboration.sharedDocumentId !== null &&
    (s.collaboration.transportBinding?.accountId !== binding.accountId || s.collaboration.transportBinding?.membershipGeneration !== binding.membershipGeneration)) throw new RepositoryError("CONFLICT");
  s.collaboration = validateCollaboration({ ...s.collaboration, sharedDocumentId, ...(binding ? { transportBinding: binding } : {}) });
  s.localRevision = incrementRevision(s.localRevision); s.dirty = true;
}
export function receiveSharedSnapshot(s: Session, bytes: string, updates: CollaborationUpdate[], cursor: string) {
  if (!s.collaboration || compareRevisions(cursor, s.collaboration.serverCursor) < 0 || updates.some(u => u.source !== "remote")) throw new RepositoryError("CONFLICT");
  base64Bytes(bytes, COLLABORATION_LIMITS.baseBytes);
  for (const update of updates) {
    const old = s.collaboration.outbox.find(u => u.updateId === update.updateId) ?? s.collaboration.journal.find(u => u.updateId === update.updateId);
    if (old && old.bytes !== update.bytes) throw new RepositoryError("CONFLICT");
  }
  const doc = hydrateCollaboration(s.collaboration);
  try {
    const before = encodeUpdate(Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(doc, decodeUpdate(bytes));
    for (const update of updates) { base64Bytes(update.bytes, COLLABORATION_LIMITS.updateBytes); Y.applyUpdate(doc, decodeUpdate(update.bytes)); }
    const collaboration = validateCollaboration({ ...s.collaboration, base: encodeUpdate(Y.encodeStateAsUpdate(doc)), journal: [], serverCursor: cursor });
    const checked = hydrateCollaboration(collaboration); checked.destroy();
    if (collaboration.base === before && cursor === s.collaboration.serverCursor) return;
    const project = projectSharedDocument(doc, s.project);
    s.project = project; s.collaboration = collaboration; s.localRevision = incrementRevision(s.localRevision); s.dirty = true;
  } finally { doc.destroy(); }
}
export async function acknowledgeSharedSession(s: Session, repository: ProjectRepository, updateIds: string[], isActive: () => boolean) {
  if (!s.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
  const ids = new Set(updateIds); [...ids].forEach(assertStorageId);
  const saved = await repository.get(s.id);
  if (!isActive()) throw new RepositoryError("BUSY");
  if (!saved?.collaboration || saved.collaboration.sharedDocumentId !== s.collaboration.sharedDocumentId ||
    [...ids].some(id => !saved.collaboration!.outbox.some(e => e.updateId === id && s.collaboration!.outbox.some(local => local.updateId === id && local.bytes === e.bytes)))) throw new RepositoryError("INVALID_ARGUMENT");
  s.collaboration = { ...s.collaboration, outbox: s.collaboration.outbox.map(e => ids.has(e.updateId) ? { ...e, status: "sent" } : e) };
  s.localRevision = incrementRevision(s.localRevision); s.dirty = true;
}
