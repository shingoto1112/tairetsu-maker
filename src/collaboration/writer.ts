import { compareRevisions, incrementRevision, RepositoryError, type CollaborationData } from "../repositories/types";
import { validateCollaboration } from "../repositories/collaborationData";

/** Allocation is staged by SaveCoordinator and is sendable only after CAS commit.
 * A CAS loser may reallocate ONLY its never-committed allocations. */
export type WriterAllocation = { createdId?: string; updateIds: string[] };
export function prepareWriter(input: CollaborationData): { data: CollaborationData; allocation: WriterAllocation } {
  const data = validateCollaboration(input), allocation: WriterAllocation = { updateIds: [] };
  if (!data.sharedDocumentId || !data.transportBinding) throw new RepositoryError("CONFLICT");
  if (!data.writer) {
    allocation.createdId = crypto.randomUUID();
    data.schemaVersion = 3;
    data.writer = { id: allocation.createdId, allocatedThrough: "0", ackThrough: "0", reclaimedThrough: "0",
      legacySentIds: data.outbox.filter(e => e.status === "sent").map(e => e.updateId) };
    data.outbox = data.outbox.filter(e => e.status !== "sent");
  }
  for (const entry of data.outbox) if (!entry.writerSeq) {
    if (data.writer.allocatedThrough === "9223372036854775807") throw new RepositoryError("QUOTA_EXCEEDED");
    entry.writerSeq = data.writer.allocatedThrough = incrementRevision(data.writer.allocatedThrough);
    allocation.updateIds.push(entry.updateId);
  }
  return { data, allocation };
}
/** Caller compacts the complete local Y.Doc before removing bytes. */
export function reclaimSent(input: CollaborationData): CollaborationData {
  const data = validateCollaboration(input), w = data.writer;
  if (!w) return data;
  const bySequence = new Map(data.outbox.map(e => [e.writerSeq, e]));
  while (bySequence.get(incrementRevision(w.ackThrough))?.status === "sent") w.ackThrough = incrementRevision(w.ackThrough);
  w.reclaimedThrough = w.ackThrough;
  data.outbox = data.outbox.filter(e => !e.writerSeq || compareRevisions(e.writerSeq, w.reclaimedThrough) > 0);
  return data;
}

export function mergeWriterOutbox(saved: CollaborationData, local: CollaborationData, allocation?: WriterAllocation): Pick<CollaborationData, "writer" | "outbox"> {
  if (!saved.writer && !local.writer) return { outbox: mergeEntries(saved, local) };
  if (saved.writer && !local.writer) throw new RepositoryError("CONFLICT"); // old executable/tab: preserve for explicit rescue
  if (saved.writer && saved.writer.id !== local.writer!.id && allocation?.createdId !== local.writer!.id) throw new RepositoryError("CONFLICT");
  const w = structuredClone(saved.writer ?? local.writer!);
  const sameWriter = saved.writer?.id === local.writer!.id;
  if (sameWriter) {
    for (const key of ["ackThrough", "reclaimedThrough"] as const)
      if (compareRevisions(local.writer![key], w[key]) > 0) w[key] = local.writer![key];
    w.legacySentIds = [...new Set([...w.legacySentIds, ...local.writer!.legacySentIds])];
  }
  const outbox = new Map(saved.outbox.map(e => [e.updateId, { ...e }]));
  for (const entry of local.outbox) {
    const old = outbox.get(entry.updateId);
    if (old && old.bytes !== entry.bytes) throw new RepositoryError("CONFLICT");
    if (w.legacySentIds.includes(entry.updateId)) continue;
    if (saved.writer && !old?.writerSeq && allocation?.updateIds.includes(entry.updateId)) {
      // This allocation has never left durable storage for the network.
      w.allocatedThrough = incrementRevision(w.allocatedThrough);
      outbox.set(entry.updateId, { ...entry, writerSeq: w.allocatedThrough });
    } else if (entry.writerSeq && compareRevisions(entry.writerSeq, w.reclaimedThrough) <= 0) {
      // Pending old backup/tab must be confirmed, never silently ACKed/reassigned.
      if (entry.status !== "sent" && compareRevisions(entry.writerSeq, local.writer!.reclaimedThrough) > 0) throw new RepositoryError("CONFLICT");
    } else outbox.set(entry.updateId, { ...entry, ...(old?.writerSeq ? { writerSeq: old.writerSeq } : {}), status: old?.status === "sent" ? "sent" : entry.status });
  }
  return { writer: w, outbox: [...outbox.values()].filter(e => !w.legacySentIds.includes(e.updateId) && (!e.writerSeq || compareRevisions(e.writerSeq, w.reclaimedThrough) > 0)) };
}
function mergeEntries(saved: CollaborationData, local: CollaborationData) {
  const entries = new Map(saved.outbox.map(e => [e.updateId, { ...e }]));
  for (const e of local.outbox) {
    const old = entries.get(e.updateId);
    if (old && old.bytes !== e.bytes) throw new RepositoryError("CONFLICT");
    entries.set(e.updateId, { ...e, status: old?.status === "sent" ? "sent" : e.status });
  }
  return [...entries.values()];
}
