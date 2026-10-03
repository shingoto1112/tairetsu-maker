import fixture from "./fixtures/collaboration.json";
import projects from "./fixtures/commitProjects.json";
import type { Project } from "../../types";
import { SaveCoordinator } from "../../storage/saveCoordinator";
import { appendCollaboration, compactCollaboration, hydrateCollaboration, projectSharedDocument } from "../../collaboration/persistence";
import { COLLABORATION_LIMITS } from "../collaborationData";
import { RepositoryError, type CollaborationData, type CollaborationUpdate, type ProjectRepository } from "../types";

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const rejection = async (work: Promise<unknown>, code: string) => {
  try { await work; } catch (e) { assert(e instanceof RepositoryError && e.code === code, `Expected ${code}: ${e}`); return; }
  throw new Error(`Expected rejection ${code}`);
};
export const initialCollaboration = () => structuredClone(fixture.initial) as CollaborationData;
export const collaborationUpdates = () => structuredClone(fixture.updates) as CollaborationUpdate[];
export const collaborationProjection = (data: CollaborationData, project = projects.stage as Project) => {
  const doc = hydrateCollaboration(data);
  try { return projectSharedDocument(doc, project); } finally { doc.destroy(); }
};

/** Same JSON contract and scenarios in Vitest and real IndexedDB. */
export async function runCollaborationContract(create: () => ProjectRepository, reopen: (r: ProjectRepository) => ProjectRepository = r => r,
  sibling?: (r: ProjectRepository) => ProjectRepository) {
  let r = create(); await r.initialize();
  const initial = initialCollaboration(), updates = collaborationUpdates();
  await r.commit({ project: projects.stage as Project, collaboration: initial, operationId: "collab-create", localRevision: "1", expectedRepositoryRevision: null });
  const a = new SaveCoordinator(r, () => {});
  const record = (await r.get("project_a"))!;
  a.activate(record);
  const second = new SaveCoordinator(sibling?.(r) ?? r, () => {}); second.activate(record);
  await a.editCollaboration([updates[0]], "3"); await second.editCollaboration([updates[1]]);
  assert((await a.getSendableOutbox()).length === 0, "No send before commit");
  assert(await a.flush(), "First edit saves"); assert(await second.flush(), "CAS loser merges");
  r = reopen(r); await r.initialize();
  const merged = (await r.get("project_a"))!;
  assert(merged.project.frames[0].positions.m_001.x === 10 && merged.project.frames[0].positions.m_002.x === 11, "Both updates survive CAS");
  assert(merged.collaboration!.outbox.length === 2 && merged.collaboration!.serverCursor === "3", "Outbox and cursor survive restart");
  const restarted = new SaveCoordinator(r, () => {}); restarted.activate(merged);
  assert((await restarted.getSendableOutbox()).length === 2, "Restart sends durable pending entries");
  assert(await restarted.markOutboxSent([updates[0].updateId]), "ACK commits");
  assert((await restarted.getSendableOutbox()).map(e => e.updateId).join() === updates[1].updateId, "ACK not emitted twice");
  // Stale tab still has pending status; merge must preserve the durable ACK.
  await second.editCollaboration([{ ...updates[1], updateId: "duplicate-yjs-update" }]);
  assert(await second.flush(), "Stale ACK merge saves");
  assert(!(await second.getSendableOutbox()).some(e => e.updateId === updates[0].updateId), "Sent cannot become pending again");
  const current = (await r.get("project_a"))!, data = current.collaboration!;
  const commit = (collaboration: CollaborationData | null, operationId: string, project = current.project) => r.commit({ project, collaboration,
    localRevision: "99", expectedRepositoryRevision: current.repositoryRevision, operationId });
  await rejection(commit({ ...data, serverCursor: "2" }, "cursor-rollback"), "CONFLICT");
  await rejection(commit(null, "implicit-detach"), "CONFLICT");
  await rejection(commit({ ...data, outbox: data.outbox.slice(1) }, "outbox-drop"), "CONFLICT");
  await rejection(commit({ ...data, base: "AAAA" }, "bad-yjs"), "INVALID_ARGUMENT");
  await rejection(commit({ ...data, documentSchema: 2 } as unknown as CollaborationData, "future-schema"), "UNSUPPORTED_SCHEMA");
  await rejection(commit({ ...data, journal: [{ updateId: "huge", source: "remote", bytes: "AAAA".repeat(Math.ceil(COLLABORATION_LIMITS.updateBytes / 3) + 1) }] }, "too-large"), "QUOTA_EXCEEDED");
  const compacted = compactCollaboration(data, true);
  assert(compacted.journal.length === 0 && JSON.stringify(compacted.outbox) === JSON.stringify(data.outbox), "Compaction retains outbox");
  assert(JSON.stringify(collaborationProjection(compacted, current.project)) === JSON.stringify(current.project), "Compacted projection unchanged");
  await commit(compacted, "compact");
  // Automatic threshold uses multiple fixed IDs without regenerating bytes.
  const many = Array.from({ length: 128 }, (_, i) => ({ ...updates[0], updateId: `threshold-${i}`, source: "remote" as const }));
  assert(appendCollaboration(initial, many).journal.length === 0, "Automatic local compaction");
  return { scenarios: 15 };
}
