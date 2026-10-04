import type { Project, AudioMeta } from '../types';
import type { AudioBinding } from '../repositories/audioBindings';
import { validateAudioBindings } from '../repositories/audioBindings';
import type { CommitRequest, ProjectRepository } from '../repositories/types';
import { TransportError, uuid, type Credential } from './transport';
import { createCollaborationRequest } from './supabaseTransport';
import type { CloudConfig } from '../cloud/config';
import { validateCheckpointDTO, materializeCheckpoint, type CheckpointDTO } from './checkpoint';
import { projectSharedDocument } from './projection';
import { chooseDeviceAudio, deviceAudioCandidates } from './deviceAudio';
import type { RestoreReceipt, RestoreState } from './restore';

export type CheckpointSummary = Omit<CheckpointDTO, 'content' | 'song'> & { id: string };
export type CheckpointCursor = { documentId: string; serverAt: string; id: string };
export type RestoreRequest = { action: 'accept' | 'restore'; documentId: string; generation: string; membershipGeneration: string; checkpointId: string; requestId: string };
export interface HistoryTransport {
  credential(signal: AbortSignal): Promise<Credential | null>;
  list(documentId: string, limit: number, cursor: CheckpointCursor | null, auth: Credential, signal: AbortSignal): Promise<unknown>;
  get(documentId: string, checkpointId: string, auth: Credential, signal: AbortSignal): Promise<unknown>;
  restore(request: RestoreRequest, auth: Credential, signal: AbortSignal): Promise<unknown>;
  confirmRestore?(request: RestoreRequest, auth: Credential, signal: AbortSignal): Promise<unknown>;
  manual?(request: Omit<RestoreRequest, 'checkpointId' | 'requestId' | 'action'>, auth: Credential, signal: AbortSignal): Promise<unknown>;
  remove?(documentId: string, checkpointId: string, auth: Credential, signal: AbortSignal): Promise<unknown>;
}
export function createHistoryTransport(config: CloudConfig, credential: HistoryTransport['credential'], fetcher: typeof fetch = fetch): HistoryTransport {
  const request = createCollaborationRequest(config, fetcher);
  return { credential,
    list: (id, limit, cursor, auth, signal) => request('/rest/v1/rpc/collab_v2_list_checkpoints', auth, signal,
      { p_document: id, p_limit: limit, p_before_at: cursor?.serverAt ?? null, p_before_id: cursor?.id ?? null }),
    get: (id, checkpoint, auth, signal) => request('/rest/v1/rpc/collab_v2_get_checkpoint', auth, signal, { p_document: id, p_checkpoint: checkpoint }),
    restore: (body, auth, signal) => request('/functions/v1/collab-restore', auth, signal, body),
    manual: (body, auth, signal) => request('/functions/v1/collab-maintenance', auth, signal, { ...body, action: 'manual' }),
    remove: (id, checkpoint, auth, signal) => request('/rest/v1/rpc/collab_v2_delete_checkpoint', auth, signal, { p_document: id, p_checkpoint: checkpoint }),
    confirmRestore: (body, auth, signal) => request('/rest/v1/rpc/collab_v2_confirm_restore',auth,signal,
      {p_document:body.documentId,p_generation:body.generation,p_membership:body.membershipGeneration,p_request:body.requestId}) };
}
const revision = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v) && Number.isFinite(Date.parse(v));
const invalid = (): never => { throw new TransportError('protocol', 'INVALID_HISTORY_RESPONSE'); };
export function parseRestoreReceipt(value: unknown, request: RestoreRequest): RestoreReceipt {
  const v = value as RestoreReceipt;
  if (!v || Object.keys(v).sort().join(',') !== 'beforeCheckpointId,beforeSeq,checkpointId,documentId,duplicate,generation,requestId,restoreSeq,result,targetDigest,targetSeq' ||
    v.result !== 'COMMITTED' || v.documentId !== request.documentId || v.generation !== request.generation || v.requestId !== request.requestId ||
    v.checkpointId !== request.checkpointId || !revision(v.targetSeq) || !revision(v.beforeSeq) || !revision(v.restoreSeq) ||
    BigInt(v.restoreSeq) !== BigInt(v.beforeSeq) + 1n || BigInt(v.targetSeq) > BigInt(v.beforeSeq) || !uuid(v.beforeCheckpointId) ||
    typeof v.targetDigest !== 'string' || !/^[0-9a-f]{64}$/.test(v.targetDigest) || typeof v.duplicate !== 'boolean') invalid();
  return { ...v };
}
export class CollaborationHistory {
  constructor(private repository: ProjectRepository, private transport: HistoryTransport) {}
  private async auth(signal: AbortSignal) { const auth = await this.transport.credential(signal); if (!auth) throw new TransportError('auth', 'AUTH_REQUIRED'); return auth; }
  async manual(identity: Omit<RestoreRequest, 'checkpointId' | 'requestId' | 'action'>, signal = new AbortController().signal) {
    if (!this.transport.manual) throw new TransportError('protocol', 'UNSUPPORTED_HISTORY');
    let value: { result?: string; id?: string };
    try { value = await this.transport.manual(identity, await this.auth(signal), signal) as typeof value; }
    catch (error) {
      if (error instanceof TransportError && error.kind === 'rate-limit') throw new TransportError('rate-limit', 'RATE_LIMIT', error.retryAfterMs);
      throw error;
    }
    if (value?.result === 'DEFERRED_CAPACITY') throw new TransportError('capacity', 'CHECKPOINT_QUOTA_EXCEEDED');
    if (value?.result === 'BUSY' || value?.result === 'RATE_LIMIT') throw new TransportError('rate-limit', 'RATE_LIMIT');
    if (value?.result !== 'STORED' || !uuid(value.id)) invalid();
  }
  async remove(documentId: string, checkpointId: string, signal = new AbortController().signal) {
    if (!uuid(documentId) || !uuid(checkpointId) || !this.transport.remove) throw new TransportError('validation', 'INVALID_ARGUMENT');
    await this.transport.remove(documentId, checkpointId, await this.auth(signal), signal);
  }
  async list(documentId: string, limit = 32, cursor: CheckpointCursor | null = null, signal = new AbortController().signal) {
    if (!uuid(documentId) || !Number.isInteger(limit) || limit < 1 || limit > 64 || cursor && (cursor.documentId !== documentId || !uuid(cursor.id) || !date(cursor.serverAt))) throw new TransportError('validation', 'INVALID_ARGUMENT');
    const raw = await this.transport.list(documentId, limit, cursor, await this.auth(signal), signal);
    if (!Array.isArray(raw) || raw.length > limit) invalid();
    let previous = cursor;
    const items = (raw as unknown[]).map(value => {
      const v = value as CheckpointSummary;
      if (!v || Object.keys(v).sort().join(',') !== 'automatic,confirmedSeq,digest,documentId,formatVersion,generation,id,reason,requestedBy,serverAt,sharedSchemaVersion' ||
        !uuid(v.id) || v.documentId !== documentId || !revision(v.generation) || v.generation === '0' || !revision(v.confirmedSeq) ||
        v.formatVersion !== 1 || ![1,2].includes(v.sharedSchemaVersion) || !date(v.serverAt) || !['manual','automatic','before-restore','before-generation'].includes(v.reason) ||
        typeof v.automatic !== 'boolean' || v.automatic !== (v.reason === 'automatic') || v.requestedBy !== null && !uuid(v.requestedBy) || !/^[0-9a-f]{64}$/.test(v.digest)) invalid();
      // Normalize timestamp fractions for lexical microsecond keyset ordering.
      const time = (at: string) => at.replace(/(?:\.(\d{1,6}))?Z$/, (_, f: string | undefined) => `.${(f ?? '').padEnd(6, '0')}Z`);
      if (previous && !(time(v.serverAt) < time(previous.serverAt) || time(v.serverAt) === time(previous.serverAt) && v.id.toLowerCase() < previous.id.toLowerCase())) invalid();
      previous = { documentId, serverAt: v.serverAt, id: v.id }; return { ...v };
    });
    return { items, nextCursor: items.length === limit ? previous : null };
  }
  async get(documentId: string, checkpointId: string, signal = new AbortController().signal): Promise<CheckpointDTO> {
    if (!uuid(documentId) || !uuid(checkpointId)) throw new TransportError('validation', 'INVALID_ARGUMENT');
    const value = await this.transport.get(documentId, checkpointId, await this.auth(signal), signal);
    if (value === null) throw new TransportError('validation', 'CHECKPOINT_NOT_FOUND');
    const dto = await validateCheckpointDTO(value); if (dto.documentId !== documentId) invalid(); return dto;
  }
  /** Retain request/result after any failure. Retrying never assigns a new key. */
  async restore(request: RestoreRequest, onState: (state: RestoreState) => void, signal = new AbortController().signal): Promise<RestoreState> {
    if (!uuid(request.documentId) || !uuid(request.checkpointId) || !uuid(request.requestId) || !uuid(request.membershipGeneration) || !revision(request.generation) || request.generation === '0') throw new TransportError('validation', 'INVALID_ARGUMENT');
    const auth = await this.auth(signal);
    onState({ phase: 'requesting', requestId: request.requestId, message: '戻す要求を送信しています' });
    const accepted = await this.transport.restore({ ...request, action: 'accept' }, auth, signal) as { result: string; targetSeq: string; requestId: string };
    if (accepted?.result === 'COMMITTED') {
      const receipt = parseRestoreReceipt(accepted, request), state = { phase: 'committed' as const, requestId: request.requestId, targetSeq: receipt.targetSeq, restoreSeq: receipt.restoreSeq, receipt, message: '共有へ確定しました。この端末への反映を待っています' }; onState(state); return state;
    }
    if (!accepted || accepted.result !== 'ACCEPTED' || accepted.requestId !== request.requestId || !revision(accepted.targetSeq)) invalid();
    onState({ phase: 'accepted', requestId: request.requestId, targetSeq: accepted.targetSeq, message: '要求を受け付けました' });
    if ((await this.auth(signal)).accountId !== auth.accountId) throw new TransportError('auth', 'ACCOUNT_CHANGED');
    let value: unknown;
    // Each plan uses a separate Edge invocation, keeping the CPU budget per
    // invocation bounded even if the public head CAS repeatedly loses.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { value = await this.transport.restore({ ...request, action: 'restore' }, auth, signal); break; }
      catch (e) {
        if (attempt === 2 || !(e instanceof TransportError) || !['HEAD_CONFLICT','SNAPSHOT_CONFLICT'].includes(e.code)) throw e;
        if (e.retryAfterMs > 0) await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new TransportError('network','REQUEST_ABORTED')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(60000, e.retryAfterMs));
          signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
        });
        if ((await this.auth(signal)).accountId !== auth.accountId) throw new TransportError('auth','ACCOUNT_CHANGED');
      }
    }
    const receipt = parseRestoreReceipt(value, request);
    const state: RestoreState = { phase: 'committed', requestId: request.requestId, targetSeq: receipt.targetSeq, restoreSeq: receipt.restoreSeq, receipt, message: '共有へ確定しました。この端末への反映を待っています' }; onState(state); return state;
  }
  async prepareIndependentCopy(dto: CheckpointDTO, bindings: AudioBinding[] = [], resolve?: (song: CheckpointDTO['song'], bindings: AudioBinding[], candidates: AudioMeta[]) => Promise<AudioMeta | null>): Promise<{ request: CommitRequest; songUnresolved: boolean; message: string }> {
    const checked = await validateCheckpointDTO(dto), doc = materializeCheckpoint(checked);
    try {
      // Schema 1 never stored names/settings/objects: do not invent a full copy.
      if (checked.sharedSchemaVersion !== 2) throw new TransportError('validation', 'LEGACY_CHECKPOINT_REQUIRES_BASE_PROJECT');
      const now = new Date().toISOString(), base = { id: checked.content.roots.metadata.projectId, updatedAt: now, stage: {}, frames: [] } as unknown as Project;
      const project = projectSharedDocument(doc, base);
      project.id = crypto.randomUUID(); project.createdAt = now;
      const audio = checked.song ? await (resolve ?? chooseDeviceAudio)(checked.song, bindings, resolve ? [] : await deviceAudioCandidates(this.repository, bindings)) : null;
      if (audio && checked.song) validateAudioBindings([{ song: checked.song, audio }]);
      // Descriptor binding is checked by the default 8b resolver; caller resolver is a test/device seam.
      if (checked.content.hasSong) project.audio = audio;
      const songUnresolved = !!checked.song && !audio;
      return { request: { project, collaboration: null, expectedRepositoryRevision: null, localRevision: '1', operationId: crypto.randomUUID() }, songUnresolved,
        message: songUnresolved ? 'この端末に対応する音源がないため、曲は未設定です。音源を選び直してください' : '新しい独立した隊列表として保存できます' };
    } finally { doc.destroy(); }
  }
  async saveIndependentCopy(request: CommitRequest) {
    if (request.expectedRepositoryRevision !== null || request.collaboration !== null) throw new TransportError('validation', 'INDEPENDENT_COPY_REQUIRED');
    return this.repository.commit(request);
  }
  /** 9d persists the result and observes the durable receive BEFORE calling.
   * Failed confirmation retains the same state/request for a later retry. */
  async confirmApplied(request: RestoreRequest, state: RestoreState, signal = new AbortController().signal): Promise<void> {
    if (state.phase !== 'applied' || state.requestId !== request.requestId || !state.receipt || !this.transport.confirmRestore) throw new TransportError('validation','RESTORE_NOT_APPLIED');
    parseRestoreReceipt(state.receipt,request);
    const result=await this.transport.confirmRestore(request,await this.auth(signal),signal) as {requestId:string;confirmed:boolean;reclaimedThrough:string};
    if (!result || result.requestId!==request.requestId || result.confirmed!==true || !revision(result.reclaimedThrough)) invalid();
  }
}
export const newRestoreRequest = (documentId: string, generation: string, membershipGeneration: string, checkpointId: string): RestoreRequest =>
  ({ action: 'restore', documentId, generation, membershipGeneration, checkpointId, requestId: crypto.randomUUID() });
