import type { Project } from "../types";
import { createId } from "../utils/ids";
import { compareRevisions, incrementRevision, RepositoryError, type CommitRequest, type ProjectRecord, type ProjectRepository, type ProjectSummary, type Revision } from "../repositories/types";

export type SaveState = { id: string; localRevision: Revision; persistedRevision: Revision; dirty: boolean; saving: boolean; error: RepositoryError | null };
type Session = SaveState & { project: Project; repositoryRevision: Revision | null; pending?: CommitRequest; work?: Promise<boolean> };
const detached = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const repositoryError = (error: unknown): RepositoryError => error instanceof RepositoryError ? error : new RepositoryError("IO_ERROR");

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
    const session: Session = { id, project: record.project, repositoryRevision: record.repositoryRevision,
      localRevision: record.localRevision, persistedRevision: record.localRevision, dirty: false, saving: false, error: null };
    this.sessions.set(id, session); this.active = session; this.emit(session);
  }
  activateUnsaved(request: CommitRequest, error: RepositoryError) {
    this.releaseCleanInactiveSession();
    const session: Session = { id: request.project.id!, project: request.project, repositoryRevision: null,
      localRevision: request.localRevision, persistedRevision: "0", dirty: true, saving: false, error, pending: detached(request) };
    this.sessions.set(session.id, session); this.active = session; this.emit(session);
  }
  deactivate() { this.releaseCleanInactiveSession(); this.active = null; this.changed(null); }
  get state(): SaveState | null { return this.active ? this.publicState(this.active) : null; }
  edit(project: Project) {
    const s = this.active;
    if (!s || s.id !== project.id || s.project === project) return;
    s.project = project; s.localRevision = incrementRevision(s.localRevision); s.dirty = true; this.emit(s);
  }
  flush(): Promise<boolean> {
    const s = this.active;
    if (!s) return Promise.resolve(true);
    if (s.work) return s.work;
    if (s.error?.code === "CONFLICT") return Promise.resolve(false);
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
      while (compareRevisions(s.localRevision, s.persistedRevision) > 0) {
        s.pending ??= { project: detached(s.project), localRevision: s.localRevision,
          expectedRepositoryRevision: s.repositoryRevision, operationId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : createId("save") };
        const receipt = await this.repository.commit(s.pending);
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
