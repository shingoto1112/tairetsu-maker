// All shared-session implementation stays behind SaveCoordinator's dynamic imports.
import type { Session } from "../storage/saveCoordinator";
import { assertStorageId } from "../repositories/ids";
import { incrementRevision, RepositoryError, type CollaborationOutbox, type CollaborationUpdate, type ProjectRepository, type Revision } from "../repositories/types";
import { appendCollaboration, hydrateCollaboration, projectSharedDocument } from "./persistence";

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
export function bindSharedSession(s: Session, sharedDocumentId: string) {
  assertStorageId(sharedDocumentId);
  if (!s.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
  if (s.collaboration.sharedDocumentId !== null && s.collaboration.sharedDocumentId !== sharedDocumentId) throw new RepositoryError("CONFLICT");
  s.collaboration = { ...s.collaboration, sharedDocumentId };
  s.localRevision = incrementRevision(s.localRevision); s.dirty = true;
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
