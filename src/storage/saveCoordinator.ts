import type { Project } from "../types";
import { createId } from "../utils/ids";
import { compareRevisions, incrementRevision, RepositoryError, type CollaborationData, type CollaborationUpdate, type CollaborationOutbox, type CommitRequest, type ProjectRecord, type ProjectRepository, type ProjectSummary, type Revision } from "../repositories/types";

export type SaveState = { id: string; localRevision: Revision; persistedRevision: Revision; dirty: boolean; saving: boolean; error: RepositoryError | null };
export type Session = SaveState & { project: Project; collaboration?: CollaborationData | null; writerAllocation?: { createdId?: string; updateIds: string[] }; audioBindingsBase?: NonNullable<CollaborationData["audioBindings"]>; repositoryRevision: Revision | null; pending?: CommitRequest; work?: Promise<boolean> };
const detached = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const repositoryError = (error: unknown): RepositoryError => error instanceof RepositoryError ? error : new RepositoryError("IO_ERROR");
export const canLeaveWithoutSaving = (state: SaveState | null): boolean => !!state?.dirty && !state.saving && !!state.error &&
  ["ACCESS_DENIED", "UNSUPPORTED_SCHEMA", "CORRUPT", "INVALID_ID", "INVALID_ARGUMENT", "NO_SPACE", "QUOTA_EXCEEDED", "IO_ERROR"].includes(state.error.code);

/** Owns fixed snapshots and CAS receipts, never mutates editor Project objects.
 * A failed request is retained for exact retry after a potentially lost reply.
 * One session per ID; an inactive session's completion cannot notify the editor.
 */
export class SaveCoordinator {
  private commitListeners = new Set<(event: { id: string; pendingUpdateIds: string[]; pendingCount: number }) => void>();
  private committedUpdates = new Map<string, Set<string>>();
  subscribeCommits(listener: (event: { id: string; pendingUpdateIds: string[]; pendingCount: number }) => void) {
    this.commitListeners.add(listener); return () => { this.commitListeners.delete(listener); };
  }
  private sessions = new Map<string, Session>();
  private active: Session | null = null;
  private sharedRuntime?: typeof import("../collaboration/saveSession");
  constructor(private repository: ProjectRepository, private changed: (state: SaveState | null) => void,
    private committed: (summary: ProjectSummary) => void = () => {}) {}

  activate(record: ProjectRecord) {
    const id = record.project.id!;
    const previous = this.sessions.get(id);
    if (previous?.work || previous?.dirty) throw new RepositoryError("BUSY");
    this.releaseCleanInactiveSession();
    const session: Session = { id, project: record.project, collaboration: detached(record.collaboration ?? null), audioBindingsBase: detached(record.collaboration?.audioBindings ?? []), repositoryRevision: record.repositoryRevision,
      localRevision: record.localRevision, persistedRevision: record.localRevision, dirty: false, saving: false, error: null };
    this.sessions.set(id, session); this.active = session; this.emit(session);
    this.committedUpdates.set(id, new Set(record.collaboration?.outbox.map(e => e.updateId)));
  }
  activateUnsaved(request: CommitRequest, error: RepositoryError) {
    this.releaseCleanInactiveSession();
    const session: Session = { id: request.project.id!, project: request.project, collaboration: detached(request.collaboration ?? null), audioBindingsBase: [], repositoryRevision: null,
      localRevision: request.localRevision, persistedRevision: "0", dirty: true, saving: false, error, pending: detached(request) };
    this.sessions.set(session.id, session); this.active = session; this.emit(session);
  }
  deactivate() { this.releaseCleanInactiveSession(); this.active = null; this.changed(null); }
  get state(): SaveState | null { return this.active ? this.publicState(this.active) : null; }
  /** Future UI can read a merged projection after changed() without sharing mutable state. */
  get projectProjection(): Project | null { return this.active ? detached(this.active.project) : null; }
  get collaborationProjection(): CollaborationData | null { return this.active?.collaboration ? detached(this.active.collaboration) : null; }
  /** Audio UI checks must not copy multi-MiB CRDT bytes on every render. */
  get audioBindingsProjection(): NonNullable<CollaborationData["audioBindings"]> { return detached(this.active?.collaboration?.audioBindings ?? []); }
  async prepareCollaborationEditing(): Promise<void> { this.sharedRuntime ??= await import("../collaboration/saveSession"); }
  /** Available only after the shared editor's dynamic initialization. Immediate
   * journal staging makes pagehide/flush include the operation without a race. */
  editCollaborationNow(updates: CollaborationUpdate[], localProject?: Project): Project {
    const s = this.active;
    if (!s?.collaboration || !this.sharedRuntime) throw new RepositoryError("INVALID_ARGUMENT");
    if (localProject && localProject.id !== s.id) throw new RepositoryError("INVALID_ARGUMENT");
    if (localProject) s.project = { ...s.project, audio: localProject.audio, focusMemberId: localProject.focusMemberId,
      viewerPerspective: localProject.viewerPerspective, lastOpenedAt: localProject.lastOpenedAt, updatedAt: localProject.updatedAt,
      frames: s.project.frames.map(f => ({ ...f, sceneViewState: localProject.frames.find(local => local.id === f.id)?.sceneViewState })) };
    const project = this.sharedRuntime.editSharedSession(s, detached(updates)); this.emit(s); return project;
  }
  editCollaborationLocal(project: Project): void {
    // Empty update stages only local fields, then reprojects every shared field.
    this.editCollaborationNow([], project);
  }
  setAudioBindings(bindings: NonNullable<CollaborationData["audioBindings"]>): void {
    const s = this.active;
    if (!s?.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    s.collaboration = { ...s.collaboration, schemaVersion: s.collaboration.schemaVersion === 3 ? 3 : 2, audioBindings: detached(bindings) };
    s.localRevision = incrementRevision(s.localRevision); s.dirty = true; this.emit(s);
  }
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
    await this.prepareCollaborationEditing();
    if (this.active !== s) throw new RepositoryError("BUSY");
    const project = this.sharedRuntime!.editSharedSession(s, fixed, serverCursor); this.emit(s); return project;
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
  async prepareCollaborationWriter(): Promise<boolean> {
    const s = this.active;
    if (!s?.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    const runtime = await import("../collaboration/saveSession");
    if (this.active !== s) throw new RepositoryError("BUSY");
    // Finish any lost/failed fixed commit before staging a new allocation.
    if (!await this.flush()) return false;
    runtime.prepareSharedWriter(s); this.emit(s); return this.flush();
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
  async receiveCollaborationSnapshot(bytes: string, updates: CollaborationUpdate[], cursor: Revision, snapshotId?: string): Promise<boolean> {
    const s = this.active;
    if (!s?.collaboration) throw new RepositoryError("INVALID_ARGUMENT");
    const fixed = detached(updates), runtime = await import("../collaboration/saveSession");
    if (this.active !== s) throw new RepositoryError("BUSY");
    runtime.receiveSharedSnapshot(s, bytes, fixed, cursor, snapshotId); this.emit(s); return this.flush();
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
      if (this.active !== s && !s.dirty && this.sessions.get(s.id) === s) { this.sessions.delete(s.id); this.committedUpdates.delete(s.id); }
    });
    return s.work;
  }
  /** Explicit discard is allowed only after the user confirms reload. */
  discard() {
    if (this.active?.work) throw new RepositoryError("BUSY");
    if (this.active) { this.sessions.delete(this.active.id); this.committedUpdates.delete(this.active.id); }
    this.deactivate();
  }
  private async drain(s: Session): Promise<boolean> {
    try {
      let conflicts = 0;
      while (compareRevisions(s.localRevision, s.persistedRevision) > 0) {
        s.pending ??= { project: detached(s.project), ...(s.collaboration ? { collaboration: detached(s.collaboration) } : {}), localRevision: s.localRevision,
          expectedRepositoryRevision: s.repositoryRevision, operationId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : createId("save") };
        const fixedCollaboration = s.pending.collaboration;
        let receipt;
        try { receipt = await this.repository.commit(s.pending); }
        catch (e) {
          if (repositoryError(e).code !== "CONFLICT" || !s.collaboration || ++conflicts > 8) throw e;
          const saved = await this.repository.get(s.id);
          if (!saved?.collaboration) throw e;
          const runtime = await import("../collaboration/persistence");
          const merged = runtime.mergeCollaboration(saved.collaboration, s.collaboration, { ...saved.project, audio: s.project.audio }, s.audioBindingsBase, s.writerAllocation);
          s.project = merged.project; s.collaboration = merged.collaboration;
          s.audioBindingsBase = detached(saved.collaboration.audioBindings ?? []);
          s.repositoryRevision = saved.repositoryRevision;
          s.localRevision = incrementRevision(compareRevisions(s.localRevision, saved.localRevision) > 0 ? s.localRevision : saved.localRevision);
          s.pending = undefined; continue;
        }
        s.repositoryRevision = receipt.repositoryRevision;
        s.audioBindingsBase = detached(fixedCollaboration?.audioBindings ?? []);
        s.persistedRevision = receipt.localRevision;
        s.pending = undefined; s.error = null;
        if (s.writerAllocation) {
          s.writerAllocation.updateIds = s.writerAllocation.updateIds.filter(id => !fixedCollaboration?.outbox.some(e => e.updateId === id && e.writerSeq));
          if (fixedCollaboration?.writer?.id === s.writerAllocation.createdId) delete s.writerAllocation.createdId;
        }
        s.dirty = compareRevisions(s.localRevision, s.persistedRevision) > 0;
        this.committed(receipt.summary); this.emit(s);
        const known = this.committedUpdates.get(s.id) ?? new Set<string>();
        const pendingUpdateIds = (fixedCollaboration?.outbox ?? []).filter(e => e.status === "pending" && !known.has(e.updateId)).map(e => e.updateId);
        // Collection also releases observer IDs; only the currently durable
        // queue is needed to distinguish a new pending commit from an ACK.
        this.committedUpdates.set(s.id, new Set(fixedCollaboration?.outbox.map(e => e.updateId)));
        const pendingCount = (fixedCollaboration?.outbox ?? []).filter(e => e.status === "pending").length;
        for (const listener of this.commitListeners) { try { listener({ id: s.id, pendingUpdateIds, pendingCount }); } catch { /* Observers do not invalidate durable saves. */ } }
      }
      return true;
    } catch (error) { s.error = repositoryError(error); s.dirty = true; this.emit(s); return false; }
  }
  private publicState(s: Session): SaveState {
    return { id: s.id, localRevision: s.localRevision, persistedRevision: s.persistedRevision, dirty: s.dirty, saving: s.saving, error: s.error };
  }
  private releaseCleanInactiveSession() {
    const s = this.active;
    if (s && !s.work && !s.dirty) { this.sessions.delete(s.id); this.committedUpdates.delete(s.id); }
  }
  private emit(s: Session) { if (this.active === s) this.changed(this.publicState(s)); }
}
