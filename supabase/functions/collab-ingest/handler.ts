// @ts-ignore Deno source import; also exercised by the client contract tests.
import { decodeBase64, validId, validateState, ValidationError, SERVER_LIMITS } from '../../../src/collaboration/serverValidation.ts';
// @ts-ignore Deno source import.
import { buildMaintenanceOutput } from '../../../src/collaboration/maintenance.ts';

type User = { id: string; is_anonymous: boolean };
export type Backend = {
  authenticate(token: string): Promise<User | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
};
export class RpcError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const revision = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
const hexDigits = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));
export const hex = (bytes: Uint8Array) => {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    let chunk = '';
    for (let j = i; j < Math.min(i + 8192, bytes.length); j++) chunk += hexDigits[bytes[j]];
    chunks.push(chunk);
  }
  return '\\x' + chunks.join('');
};
const invalid = (): never => { throw new ValidationError('INVALID_ARGUMENT'); };
const fields = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');

/** Stream-bound body before JSON parsing; Content-Length is not trusted. */
export async function boundedBody(request: Request, max: number): Promise<Record<string, unknown>> {
  if (!request.body) return invalid();
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new ValidationError('QUOTA_EXCEEDED'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  let data: unknown;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); } catch { return invalid(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  return data as Record<string, unknown>;
}
type State = { headSeq: string; documentSchema: number; snapshot: { bytes: string; uptoSeq: string }; updates: { bytes: string; seq: string }[] };

export function createHandler(backend: Backend, allowedOrigins: readonly string[]) {
  // Per-worker memory guard. Never queue parsed MiB bodies while another Doc is
  // alive. This is backpressure, not a distributed abuse/rate-limit guarantee.
  let busy = false;
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    if (origin && allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    const response = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return response(403, { error: 'ORIGIN_DENIED' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    const auth = request.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return response(401, { error: 'NOT_AUTHENTICATED' });
    if (busy) {
      headers['Retry-After'] = '1'; return response(429, { error: 'WORKER_BUSY', retryable: true });
    }
    busy = true;
    try {
      const user = await backend.authenticate(auth.slice(7));
      if (!user || !uuid(user.id)) return response(401, { error: 'NOT_AUTHENTICATED' });
      if (!request.headers.get('content-type')?.startsWith('application/json')) return response(415, { error: 'JSON_REQUIRED' });
      // Create is larger, but no anonymous account can allocate a snapshot/document.
      const max = user.is_anonymous ? 360000 : Math.ceil(SERVER_LIMITS.snapshotBytes / 3) * 4 + 2048;
      const input = await boundedBody(request, max);
      if (input.action === 'create') {
        if (user.is_anonymous) return response(403, { error: 'PERMANENT_ACCOUNT_REQUIRED' });
        if (!fields(input, ['action', 'displayName', 'bytes']) || typeof input.displayName !== 'string' ||
          !input.displayName.trim() || [...input.displayName].length > 80) invalid();
        const bytes = decodeBase64(input.bytes, SERVER_LIMITS.snapshotBytes);
        const validated = validateState(bytes, [], undefined, 2);
        const initial = await buildMaintenanceOutput({ documentId: crypto.randomUUID(), generation: '1', cutSeq: '0', documentSchema: 2,
          snapshot: { id: crypto.randomUUID(), uptoSeq: '0', bytes }, updates: [] }, 'automatic', user.id, new Date().toISOString());
        const result = await backend.rpc('collab_v2_create_document', { p_actor: user.id, p_display_name: input.displayName, p_bytes: hex(bytes), p_title: validated.title,
          p_checkpoint: hex(initial.bytes), p_checkpoint_digest: '\\x' + initial.digest });
        return response(200, result);
      }
      const hasWriter = 'writerId' in input || 'writerSeq' in input;
      if (input.action !== 'append' || !fields(input, ['action', 'documentId', 'generation', 'membershipGeneration', 'updateId', 'bytes', ...(hasWriter ? ['writerId','writerSeq'] : [])]) ||
        hasWriter && (!uuid(input.writerId) || !revision(input.writerSeq)) ||
        !uuid(input.documentId) || !uuid(input.membershipGeneration) || !revision(input.generation) || !validId(input.updateId)) invalid();
      const bytes = decodeBase64(input.bytes, SERVER_LIMITS.updateBytes);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
      const args = { p_document: input.documentId, p_actor: user.id, p_generation: input.generation, p_membership: input.membershipGeneration };
      const envelope = { documentId: input.documentId, generation: input.generation, updateId: input.updateId };
      if (hasWriter) {
        const result = await backend.rpc('collab_v2_probe_writer', { ...args, p_writer: input.writerId, p_writer_seq: input.writerSeq });
        if (result) return response(200, { ...envelope, ...result as object });
      }
      let validationTime = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await backend.rpc('collab_v2_ingest_state', args) as State;
        if (![1, 2].includes(state.documentSchema) || !state.snapshot || !Array.isArray(state.updates)) throw new ValidationError('UNSUPPORTED_SCHEMA');
        const seqValue = (v: unknown): v is string => v === '0' || revision(v);
        if (!seqValue(state.headSeq) || !seqValue(state.snapshot.uptoSeq)) throw new ValidationError('INCOMPLETE_SERVER_STATE');
        let replayed = BigInt(state.snapshot.uptoSeq);
        for (const update of state.updates) {
          if (!revision(update.seq) || BigInt(update.seq) !== ++replayed) throw new ValidationError('INCOMPLETE_SERVER_STATE');
        }
        if (replayed !== BigInt(state.headSeq)) throw new ValidationError(state.updates.length === SERVER_LIMITS.entries ? 'LOG_QUOTA_EXCEEDED' : 'INCOMPLETE_SERVER_STATE');
        const snapshot = decodeBase64(state.snapshot.bytes, SERVER_LIMITS.snapshotBytes);
        const updates = state.updates.map(u => decodeBase64(u.bytes, SERVER_LIMITS.updateBytes));
        const validated = validateState(snapshot, updates, bytes, state.documentSchema as 1 | 2);
        validationTime += validated.elapsedMs;
        if (validationTime > SERVER_LIMITS.validationMs) throw new ValidationError('VALIDATION_BUDGET');
        try {
          const ack = await backend.rpc('collab_v2_append', { ...args, p_expected_head: state.headSeq,
            p_update_id: input.updateId, p_bytes: hex(bytes), p_digest: hex(digest), p_title: validated.title,
            ...(hasWriter ? { p_writer: input.writerId, p_writer_seq: input.writerSeq } : {}) });
          return response(200, { ...envelope, ...ack as object });
        } catch (error) {
          if (!(error instanceof RpcError) || error.message !== 'HEAD_CONFLICT') throw error;
        }
      }
      return response(409, { error: 'HEAD_CONFLICT', retryable: true });
    } catch (error) {
      if (error instanceof ValidationError) return response(error.code.includes('QUOTA') ? 413 : error.code === 'VALIDATION_BUDGET' ? 429 : 400, { error: error.code });
      if (error instanceof RpcError) {
        const status = error.code === '42501' ? 403 : error.code === '54000' ? 413 : error.code === '40001' ? 409 : error.code === '22023' ? 400 : 503;
        return response(status, { error: status === 503 ? 'SERVER_UNAVAILABLE' : error.message });
      }
      return response(503, { error: 'SERVER_UNAVAILABLE' });
    } finally { busy = false; }
  };
}
