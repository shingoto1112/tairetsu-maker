import type { Project } from "../types";
import { createId } from "../utils/ids";
import { compareRevisions, incrementRevision, RepositoryError, type CollaborationData, type CollaborationUpdate, type CollaborationOutbox, type CommitRequest, type ProjectRecord, type ProjectRepository, type ProjectSummary, type Revision } from "../repositories/types";

export type SaveState = { id: string; localRevision: Revision; persistedRevision: Revision; dirty: boolean; saving: boolean; error: RepositoryError | null };
export type Session = SaveState & { project: Project; collaboration?: CollaborationData | null; repositoryRevision: Revision | null; pending?: CommitRequest; work?: Promise<boolean> };
const detached = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const repositoryError = (error: unknown): RepositoryError => error instanceof RepositoryError ? error : new RepositoryError("IO_ERROR");
export const canLeaveWithoutSaving = (state: SaveState | null): boolean => !!state?.dirty && !state.saving && !!state.error &&
  ["ACCESS_DENIED", "UNSUPPORTED_SCHEMA", "CORRUPT", "INVALID_ID", "INVALID_ARGUMENT", "NO_SPACE", "QUOTA_EXCEEDED", "IO_ERROR"].includes(state.error.code);

/** Owns fixed snapshots and CAS receipts, never mutates editor Project objects.
 * A failed request is retained for exact retry after a potentially lost reply.
 * One session per ID; an inactive session's completion cannot notify the editor.
 */
export class SaveCoordinator {
  private sessions = new Map<string, Session>();
  private active: Session | null = null;
  constructor(private repository: ProjectRepository, private changed: (state: SaveState | null) => void,
    private committed: (summary: ProjectSummary) => void = () => {}) {}

  activate(record: ProjectRecord) {
    const id = record.project.id!;
    const previous = this.sessions.get(id);
    if (previous?.work || previous?.dirty) throw new RepositoryError("BUSY");
    this.releaseCleanInactiveSession();
    const session: Session = { id, project: record.project, collaboration: detached(record.collaboration ?? null), repositoryRevision: record.repositoryRevision,
      localRevision: record.localRevision, persistedRevision: record.localRevision, dirty: false, saving: false, error: null };
    this.sessions.set(id, session); this.active = session; this.emit(session);
  }
  activateUnsaved(request: CommitRequest, error: RepositoryError) {
    this.releaseCleanInactiveSession();
    const session: Session = { id: request.project.id!, project: request.project, collaboration: detached(request.collaboration ?? null), repositoryRevision: null,
      localRevision: request.localRevision, persistedRevision: "0", dirty: true, saving: false, error, pending: detached(request) };
    this.sessions.set(session.id, session); this.active = session; this.emit(session);
  }
  deactivate() { this.releaseCleanInactiveSession(); this.active = null; this.changed(null); }
  get state(): SaveState | null { return this.active ? this.publicState(this.active) : null; }
  /** Future UI can read a merged projection after changed() without sharing mutable state. */
  get projectProjection(): Project | null { return this.active ? detached(this.active.project) : null; }
  edit(project: Project) {
    const s = this.active;
    if (!s || s.id !== project.id || s.project === project) return;
    if (s.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    s.project = project; s.localRevision = incrementRevision(s.localRevision); s.dirty = true; this.emit(s);
  }
  /** Shared edits enter as fixed Yjs updates. Returned projection is for the future UI. */
  async editCollaboration(updates: CollaborationUpdate[], serverCursor?: Revision): Promise<Project> {
    const s = this.active;
    if (!s?.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    const fixed = detached(updates);
    const runtime = await import("../collaboration/saveSession");
    if (this.active !== s) throw new RepositoryError("BUSY");
    const project = runtime.editSharedSession(s, fixed, serverCursor); this.emit(s); return project;
  }
  /** Reads ONLY committed updates, including after restart. Provider supplies auth/epoch checks. */
  async getSendableOutbox(id = this.active?.id): Promise<CollaborationOutbox[]> {
    return (await import("../collaboration/saveSession")).readSendableOutbox(this.repository, id);
  }
  /** Provider reads durable cursor/identity, never a dirty in-memory attachment. */
  async getCommittedCollaboration(): Promise<CollaborationData | null> {
    const s = this.active;
    if (!s) return null;
    const record = await this.repository.get(s.id);
    if (this.active !== s) throw new RepositoryError("BUSY");
    return detached(record?.collaboration ?? null);
  }
  /** Persist the ID returned by server create before exposing the initial outbox. */
  async bindSharedDocument(sharedDocumentId: string, binding?: CollaborationData["transportBinding"]): Promise<boolean> {
    const s = this.active;
    if (!s?.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    const runtime = await import("../collaboration/saveSession");
    if (this.active !== s) throw new RepositoryError("BUSY");
    runtime.bindSharedSession(s, sharedDocumentId, binding); this.emit(s);
    return this.flush();
  }
  /** Full server state can exceed the per-update journal limit; merge into base. */
  async receiveCollaborationSnapshot(bytes: string, updates: CollaborationUpdate[], cursor: Revision): Promise<boolean> {
    const s = this.active;
    if (!s?.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    const fixed = detached(updates), runtime = await import("../collaboration/saveSession");
    if (this.active !== s) throw new RepositoryError("BUSY");
    runtime.receiveSharedSnapshot(s, bytes, fixed, cursor); this.emit(s); return this.flush();
  }
  /** Call after durable server ACK; ACK state itself must commit before disappearing. */
  async markOutboxSent(updateIds: string[]): Promise<boolean> {
    const s = this.active;
    if (!s?.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    const fixed = [...updateIds], runtime = await import("../collaboration/saveSession");
    if (this.active !== s) throw new RepositoryError("BUSY");
    await runtime.acknowledgeSharedSession(s, this.repository, fixed, () => this.active === s); this.emit(s);
    return this.flush();
  }
  flush(): Promise<boolean> {
    const s = this.active;
    if (!s) return Promise.resolve(true);
    if (s.work) return s.work;
    if (s.error?.code === "CONFLICT" && !s.collaboration) return Promise.resolve(false);
    if (!s.dirty) return Promise.resolve(true);
    s.saving = true; this.emit(s);
    // Assign the promise before any asynchronous repository completion.
    s.work = this.drain(s).finally(() => {
      s.work = undefined; s.saving = false; this.emit(s);
      if (this.active !== s && !s.dirty && this.sessions.get(s.id) === s) this.sessions.delete(s.id);
    });
    return s.work;
  }
  /** Explicit discard is allowed only after the user confirms reload. */
  discard() {
    if (this.active?.work) throw new RepositoryError("BUSY");
    if (this.active) this.sessions.delete(this.active.id);
    this.deactivate();
  }
  private async drain(s: Session): Promise<boolean> {
    try {
      let conflicts = 0;
      while (compareRevisions(s.localRevision, s.persistedRevision) > 0) {
        s.pending ??= { project: detached(s.project), ...(s.collaboration ? { collaboration: detached(s.collaboration) } : {}), localRevision: s.localRevision,
          expectedRepositoryRevision: s.repositoryRevision, operationId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : createId("save") };
        let receipt;
        try { receipt = await this.repository.commit(s.pending); }
        catch (e) {
          if (repositoryError(e).code !== "CONFLICT" || !s.collaboration || ++conflicts > 8) throw e;
          const saved = await this.repository.get(s.id);
          if (!saved?.collaboration) throw e;
          const runtime = await import("../collaboration/persistence");
          const merged = runtime.mergeCollaboration(saved.collaboration, s.collaboration, saved.project);
          s.project = merged.project; s.collaboration = merged.collaboration;
          s.repositoryRevision = saved.repositoryRevision;
          s.localRevision = incrementRevision(compareRevisions(s.localRevision, saved.localRevision) > 0 ? s.localRevision : saved.localRevision);
          s.pending = undefined; continue;
        }
        s.repositoryRevision = receipt.repositoryRevision;
        s.persistedRevision = receipt.localRevision;
        s.pending = undefined; s.error = null;
        s.dirty = compareRevisions(s.localRevision, s.persistedRevision) > 0;
        this.committed(receipt.summary); this.emit(s);
      }
      return true;
    } catch (error) { s.error = repositoryError(error); s.dirty = true; this.emit(s); return false; }
  }
  private publicState(s: Session): SaveState {
    return { id: s.id, localRevision: s.localRevision, persistedRevision: s.persistedRevision, dirty: s.dirty, saving: s.saving, error: s.error };
  }
  private releaseCleanInactiveSession() {
    const s = this.active;
    if (s && !s.work && !s.dirty) this.sessions.delete(s.id);
  }
  private emit(s: Session) { if (this.active === s) this.changed(this.publicState(s)); }
}
