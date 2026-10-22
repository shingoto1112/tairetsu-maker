import type { ProjectRecord, ProjectRepository, CollaborationData } from '../repositories/types';
import { validateProjectStructure } from '../project/codec';
import { CollaborationHistory, newRestoreRequest, parseRestoreReceipt, type CheckpointCursor, type CheckpointSummary } from './historyApi';
import { validateCheckpointDTO } from './checkpoint';
import { observeRestore, type RestoreState } from './restore';
import { hydrateCollaboration } from './persistence';
import { TransportError, uuid } from './transport';
import { createHistoryJournal, type HistoryJournal, type HistoryOperation } from './historyJournal';

export const historyError = (error: unknown): string => {
  const code = (error as { code?: string }).code;
  if (error instanceof TransportError && error.kind === 'rate-limit' || ['RATE_LIMIT', 'BUSY', 'WORKER_BUSY', 'VALIDATION_BUDGET'].includes(code ?? '')) return '少し時間をおいてから、もう一度お試しください。';
  if (code === 'DOCUMENT_QUOTA_EXCEEDED') return '自分が作成した共有隊列表は20件までです。不要な共有を終了してから、もう一度お試しください。端末のコピーを削除しても共有の枠は空きません。';
  if (code === 'DOCUMENT_DELETED') return 'この隊列表の共有は終了しています。端末に残っているコピーをご利用ください。';
  // History keeps its actionable capacity guidance; the sharing screens explain quota codes in their own words.
  if (['CHECKPOINT_QUOTA_EXCEEDED', 'QUOTA_EXCEEDED', 'PROJECT_QUOTA_EXCEEDED', 'DEFERRED_CAPACITY', 'RESTORE_REQUEST_LIMIT'].includes(code ?? '')) return '容量がいっぱいのため完了できませんでした。「新しい隊列表として開く」をお試しください。';
  if (['RESTORE_UPDATE_TOO_LARGE', 'RESTORE_TOPOLOGY_MISMATCH'].includes(code ?? '')) return 'この控えは共有中の隊列表に戻せません。「新しい隊列表として開く」をお試しください。';
  if (code === 'LEGACY_CHECKPOINT_REQUIRES_BASE_PROJECT') return '古い形式の控えです。元の隊列表を開いて、独立した隊列表として保存してください。';
  if (code === 'CHECKPOINT_PROTECTED') return '戻す処理で使われているため、この控えは削除できません。処理が終わってからお試しください。';
  if (['NOT_MEMBER', 'MEMBERSHIP_CHANGED', 'CREATOR_ONLY', 'ACCOUNT_CHANGED', 'AUTH_REQUIRED'].includes(code ?? '')) return '参加資格を確認できません。ログインと共有の状態を確認してください。';
  if (code === 'CHECKPOINT_NOT_FOUND') return 'この控えは削除されています。一覧を更新してください。';
  if (code === 'CORRUPT') return 'この端末の操作記録を読み込めませんでした。二重に戻すことを防ぐため、戻す操作を保留しています。';
  if (['NO_SPACE', 'IO_ERROR', 'CONFLICT', 'UNSUPPORTED_SCHEMA'].includes(code ?? '')) return 'この端末に操作記録を保存できませんでした。編集内容は残っています。保存領域を確認して再試行してください。';
  return error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message) ? error.message : '通信を確認して、もう一度お試しください。操作は同じ要求で確認します。';
};
type State = { loaded: boolean; busy: boolean; items: CheckpointSummary[]; cursor: CheckpointCursor | null; error: string | null; notice: string | null; restore: RestoreState | null; retry: boolean };
type Options = { localId: string; repository: ProjectRepository; history: CollaborationHistory; identity: CollaborationData;
  valid: () => boolean; wake: () => void; journal?: HistoryJournal };
const rejectedBeforeCommit = ['RESTORE_UPDATE_TOO_LARGE', 'RESTORE_TOPOLOGY_MISMATCH', 'QUOTA_EXCEEDED', 'CHECKPOINT_QUOTA_EXCEEDED', 'PROJECT_QUOTA_EXCEEDED', 'DOCUMENT_QUOTA_EXCEEDED'];
/** Session-owned, survives dialog close. Observe only repository.get (durable),
 * never the live editor Doc or a provider's in-memory cursor. */
export class HistoryController {
  private state: State = { loaded: false, busy: false, items: [], cursor: null, error: null, notice: null, restore: null, retry: false };
  private listeners = new Set<() => void>();
  private operation: HistoryOperation | null = null;
  private journal: HistoryJournal;
  private ready?: Promise<void>;
  private stopped = false;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private key: string;
  private queued = false;
  private observedRevision?: string;
  constructor(private options: Options) {
    const d = options.identity, b = d.transportBinding!;
    this.key = JSON.stringify([options.localId, d.sharedDocumentId, d.generation, b.accountId, b.membershipGeneration]);
    this.journal = options.journal ?? createHistoryJournal();
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(value: Partial<State>) { if (this.stopped) return; this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  private identity() {
    if (this.stopped || !this.options.valid()) throw new TransportError('auth', 'ACCOUNT_CHANGED');
    const d = this.options.identity;
    return { documentId: d.sharedDocumentId!, generation: d.generation, membershipGeneration: d.transportBinding!.membershipGeneration };
  }
  private async initialize() {
    return this.ready ??= (async () => {
      const op = await this.journal.read(this.key), identity = this.identity();
      if (op?.restore) {
        const r = op.restore, request = r.request;
        if (!request || request.documentId !== identity.documentId || request.generation !== identity.generation || request.membershipGeneration !== identity.membershipGeneration ||
          !uuid(request.requestId) || !uuid(request.checkpointId) || request.action !== 'restore' || typeof r.confirmed !== 'boolean' ||
          r.state?.requestId !== request.requestId || !['requesting', 'accepted', 'committed', 'applied'].includes(r.state.phase) || r.failed && !rejectedBeforeCommit.includes(r.failed)) throw new TransportError('validation', 'CORRUPT');
        r.target = await validateCheckpointDTO(r.target);
        if (r.target.documentId !== identity.documentId || r.target.generation !== identity.generation) throw new TransportError('validation', 'CORRUPT');
        if (r.state.receipt) {
          const receipt = parseRestoreReceipt(r.state.receipt, request);
          if (receipt.targetDigest !== r.target.digest || receipt.targetSeq !== r.target.confirmedSeq) throw new TransportError('validation', 'CORRUPT');
        } else if (r.confirmed || r.state.phase === 'committed' || r.state.phase === 'applied') throw new TransportError('validation', 'CORRUPT');
      }
      if (op?.copy && (!uuid(op.copy.checkpointId) || !uuid(op.copy.request?.operationId) || op.copy.request.collaboration !== null ||
        op.copy.request.expectedRepositoryRevision !== null || typeof op.copy.saved !== 'boolean' || op.copy.opened !== undefined && typeof op.copy.opened !== 'boolean' ||
        typeof op.copy.message !== 'string' || !validateProjectStructure(op.copy.request.project).ok)) throw new TransportError('validation', 'CORRUPT');
      this.operation = op; this.patch({ restore: op?.restore?.failed ? null : op?.restore?.state ?? null, retry: !!op?.restore && !op.restore.confirmed && !op.restore.failed,
        ...(op?.restore?.failed ? { error: historyError({ code: op.restore.failed }) } : {}) });
    })().catch(error => { this.ready = undefined; throw error; });
  }
  private async persist(value: Omit<HistoryOperation, 'version' | 'revision'>) {
    this.identity();
    const revision = this.operation?.revision ?? 0, next: HistoryOperation = { ...value, version: 1, revision: revision + 1 };
    try { await this.journal.write(this.key, revision, next); }
    catch (error) {
      if ((error as { code?: string }).code === 'CONFLICT') { this.ready = undefined; this.operation = null; }
      throw error;
    }
    this.operation = next;
  }
  async run(work: () => Promise<void>, background = false) {
    if (this.state.busy || this.stopped) return;
    this.patch({ busy: true, ...(background ? {} : { error: null, notice: null }) });
    try { await this.initialize(); this.identity(); await work(); if (background && this.operation?.restore?.confirmed) this.patch({ error: null }); }
    catch (error) { this.patch({ error: historyError(error), retry: !!this.operation?.restore && !this.operation.restore.confirmed && !this.operation.restore.failed }); }
    finally { this.patch({ busy: false }); if (this.queued) { this.queued = false; this.wake(); } }
  }
  async list(more = false) {
    const identity = this.identity(), page = await this.options.history.list(identity.documentId, 16, more ? this.state.cursor : null, this.abort.signal);
    this.identity();
    this.patch({ items: more ? [...this.state.items, ...page.items.filter(item => !this.state.items.some(old => old.id === item.id))] : page.items, cursor: page.nextCursor, loaded: true });
  }
  async manual() {
    try { await this.options.history.manual(this.identity(), this.abort.signal); }
    catch (error) {
      if (error instanceof TransportError && error.kind === 'capacity') throw new Error('容量がいっぱいのため控えを残せませんでした。');
      if (error instanceof TransportError && error.kind === 'rate-limit') throw new Error('少し時間をおいてから残してください。');
      throw error;
    }
    this.identity();
    this.patch({ notice: '控えを残しました。共有に届いている内容が対象です。' }); await this.list();
  }
  async remove(id: string) { await this.options.history.remove(this.identity().documentId, id, this.abort.signal); this.identity(); await this.list(); this.patch({ notice: '控えを削除しました。' }); }
  async copy(id: string, open: (record: ProjectRecord, message: string) => Promise<boolean>) {
    const identity = this.identity();
    if (!this.operation?.copy || this.operation.copy.checkpointId !== id || this.operation.copy.opened) {
      if (this.operation?.copy && !this.operation.copy.saved) throw new Error('保存待ちのコピーがあります。先に同じ控えの保存を再試行してください。');
      const target = await this.options.history.get(identity.documentId, id, this.abort.signal); this.identity();
      const bindings = (await this.options.repository.get(this.options.localId))?.collaboration?.audioBindings ?? [];
      const prepared = await this.options.history.prepareIndependentCopy(target, bindings); this.identity();
      await this.persist({ ...this.operation, copy: { checkpointId: id, request: prepared.request, message: prepared.message, saved: false } });
    }
    const fixed = this.operation!.copy!; this.identity();
    if (!fixed.saved) await this.options.history.saveIndependentCopy(fixed.request); this.identity();
    if (!fixed.saved) await this.persist({ ...this.operation, copy: { ...fixed, saved: true } });
    const record = await this.options.repository.get(fixed.request.project.id!);
    if (!record) throw new Error('保存結果を確認できませんでした。同じ控えの保存を再試行してください。');
    if (!await open(record, fixed.message)) throw new Error('コピーを保存しました。編集中の内容を保存してから、同じ控えを開き直してください。');
    // Opening can dispose this session. Complete ONLY its local journal; no
    // network/active-editor access is allowed after that boundary. A lost write
    // leaves the same saved copy for retry, rather than creating another one.
    const current = this.operation!;
    const completed: HistoryOperation = { ...current, revision: current.revision + 1, copy: { ...current.copy!, opened: true } };
    await this.journal.write(this.key, current.revision, completed); this.operation = completed;
    this.patch({ notice: fixed.message });
  }
  async restore(id?: string) {
    const identity = this.identity();
    if (id && (!this.operation?.restore || this.operation.restore.confirmed || this.operation.restore.failed && id !== this.operation.restore.request.checkpointId)) {
      const target = await this.options.history.get(identity.documentId, id, this.abort.signal); this.identity();
      const request = newRestoreRequest(identity.documentId, identity.generation, identity.membershipGeneration, id);
      await this.persist({ ...this.operation, restore: { request, target, confirmed: false, state: { phase: 'requesting', requestId: request.requestId, message: '戻す要求を保存しました' } } });
    }
    const fixed = this.operation?.restore;
    if (!fixed || id && fixed.request.checkpointId !== id) throw new Error('確認待ちの戻す操作があります。先にその操作の結果を確認してください。');
    if (fixed.failed && !id) return;
    if (fixed.confirmed) return this.observe();
    if (!fixed.state.receipt) {
      this.identity();
      let state: RestoreState;
      try { state = await this.options.history.restore(fixed.request, state => this.patch({ restore: state }), this.abort.signal); }
      catch (error) {
        if (error instanceof TransportError && rejectedBeforeCommit.includes(error.code)) {
          await this.persist({ ...this.operation, restore: { ...fixed, failed: error.code } });
          this.patch({ restore: null });
        }
        throw error;
      }
      this.identity(); await this.persist({ ...this.operation, restore: { request: fixed.request, target: fixed.target, confirmed: false, state } });
      this.patch({ restore: state, retry: true }); this.options.wake(); await this.list();
    }
    await this.observe();
  }
  private async observe() {
    const fixed = this.operation?.restore;
    if (!fixed?.state.receipt) return;
    const record = await this.options.repository.get(this.options.localId); this.identity();
    if (fixed.confirmed && record?.repositoryRevision === this.observedRevision) return;
    const data = record?.collaboration, b = data?.transportBinding;
    if (!data || !b || b.accountId !== this.options.identity.transportBinding!.accountId || b.membershipGeneration !== fixed.request.membershipGeneration) return;
    const doc = hydrateCollaboration(data);
    let state: RestoreState;
    try { state = observeRestore(fixed.state, { documentId: data.sharedDocumentId!, generation: data.generation, cursor: data.serverCursor, doc,
      pending: data.outbox.filter(e => e.status === 'pending').length }, fixed.target); } finally { doc.destroy(); }
    if (state.phase !== 'applied') return;
    // Persist observation before confirm. A failed write retains the old request.
    if (JSON.stringify(state) !== JSON.stringify(fixed.state)) await this.persist({ ...this.operation, restore: { ...fixed, state } });
    this.patch({ restore: state });
    if (!fixed.confirmed) {
      this.identity(); await this.options.history.confirmApplied(fixed.request, state, this.abort.signal); this.identity();
      await this.persist({ ...this.operation, restore: { ...fixed, state, confirmed: true } });
    }
    this.patch({ retry: false });
    this.observedRevision = record?.repositoryRevision;
  }
  /** Called after receive/save, online or restart. Single worker never replaces
   * a request ID; errors leave an explicit retry and a bounded background retry. */
  wake() {
    if (this.stopped || !this.options.valid()) return;
    if (this.operation?.restore?.failed) return;
    if (this.ready && !this.operation?.restore) return;
    if (this.retryTimer && !this.operation?.restore?.state.receipt) return;
    // A durable save/provider event should observe immediately, rather than
    // waiting behind the network retry delay left by a previous failure.
    clearTimeout(this.retryTimer); this.retryTimer = undefined;
    if (this.state.busy) { this.queued = true; return; }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run(async () => { if (this.operation?.restore && !this.operation.restore.failed) await this.restore(); }, true).then(() => {
        if (this.operation?.restore && !this.operation.restore.confirmed && !this.operation.restore.failed && !this.stopped) {
          this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.wake(); }, 15000);
        }
      });
    }, 100);
  }
  stop() { this.stopped = true; this.abort.abort(); clearTimeout(this.timer); clearTimeout(this.retryTimer); this.listeners.clear(); }
}
