// @ts-ignore Deno source import.
import { decodeBase64, SERVER_LIMITS, ValidationError } from '../../../src/collaboration/serverValidation.ts';
// @ts-ignore Deno source import.
import { buildRestoreOutput } from '../../../src/collaboration/restore.ts';
// @ts-ignore Deno source import.
import { boundedBody, hex, RpcError, type Backend } from '../collab-ingest/handler.ts';
// @ts-ignore Deno source import.
import type { MaintenanceCut } from '../../../src/collaboration/maintenance.ts';

const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const revision = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
type State = { result: 'READY'; leaseToken: string; checkpoint: unknown; state: { documentId: string; generation: string; headSeq: string; documentSchema: 1 | 2;
  snapshot: { id: string; uptoSeq: string; bytes: string }; updates: { seq: string; bytes: string }[] } };
/** Dedicated worker: tiny requests, no client binary/actor/seq/title. Auth and
 * generation are rechecked under the DB transaction that commits restore. */
export function createRestoreHandler(backend: Backend, origins: readonly string[],
  metric: (v: { bytes: number; seq: string; elapsedMs: number; result: string }) => void = v => console.info(JSON.stringify(v))) {
  let busy = false;
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin'), headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && origins.includes(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    const response = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !origins.includes(origin)) return response(403, { error: 'ORIGIN_DENIED' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    const auth = request.headers.get('authorization'); if (!auth?.startsWith('Bearer ')) return response(401, { error: 'NOT_AUTHENTICATED' });
    if (busy) { headers['Retry-After'] = '1'; return response(429, { error: 'WORKER_BUSY' }); }
    busy = true; const start = performance.now(); let resultCode = 'SERVER_UNAVAILABLE', bytes = 0, seq = '0';
    let lease: { p_document: string; p_actor: string; p_request: string; p_lease: string } | undefined;
    try {
      const user = await backend.authenticate(auth.slice(7)); if (!user || !uuid(user.id)) { resultCode = 'NOT_AUTHENTICATED'; return response(401, { error: resultCode }); }
      if (!request.headers.get('content-type')?.startsWith('application/json')) { resultCode = 'JSON_REQUIRED'; return response(415, { error: resultCode }); }
      const input = await boundedBody(request, 1024);
      if (Object.keys(input).sort().join(',') !== 'action,checkpointId,documentId,generation,membershipGeneration,requestId' ||
        !['accept','restore'].includes(input.action as string) || !uuid(input.documentId) || !uuid(input.membershipGeneration) || !uuid(input.checkpointId) || !uuid(input.requestId) || !revision(input.generation)) throw new ValidationError('INVALID_ARGUMENT');
      const args = { p_document: input.documentId, p_actor: user.id, p_generation: input.generation, p_membership: input.membershipGeneration, p_request: input.requestId };
      const accepted = await backend.rpc('collab_v2_accept_restore', { ...args, p_checkpoint: input.checkpointId }) as { result: string; retryAfterMs?: number };
      if (accepted?.result === 'RATE_LIMIT') { resultCode = 'RATE_LIMIT'; headers['Retry-After'] = String(Math.max(1, Math.ceil((accepted.retryAfterMs ?? 60000) / 1000))); return response(429, accepted); }
      if (!accepted || !['ACCEPTED','COMMITTED'].includes(accepted.result)) throw new ValidationError('INVALID_RESTORE_RESPONSE');
      if (input.action === 'accept' || accepted.result === 'COMMITTED') { resultCode = accepted.result; return response(200, accepted); }
      // One plan per Edge invocation. Client retries CAS using the SAME request
      // in a new invocation; two full plans must not share the 2s CPU budget.
      {
        const claimed = await backend.rpc('collab_v2_restore_state', args) as State | { result: 'COMMITTED' | 'BUSY' | 'RATE_LIMIT'; retryAfterMs?: number };
        if (claimed?.result === 'COMMITTED') { resultCode = 'COMMITTED'; return response(200, claimed); }
        if (claimed?.result === 'BUSY' || claimed?.result === 'RATE_LIMIT') { resultCode = claimed.result; headers['Retry-After'] = String(Math.max(1, Math.ceil((claimed.retryAfterMs ?? 5000) / 1000))); return response(429, claimed); }
        if (claimed?.result !== 'READY') throw new ValidationError('INVALID_RESTORE_RESPONSE');
        if (!uuid(claimed.leaseToken)) throw new ValidationError('INVALID_RESTORE_RESPONSE');
        lease = { p_document: input.documentId, p_actor: user.id, p_request: input.requestId, p_lease: claimed.leaseToken };
        const state = claimed.state;
        if (!state || state.documentId !== input.documentId || state.generation !== input.generation || ![1,2].includes(state.documentSchema) ||
          !state.snapshot || !uuid(state.snapshot.id) || !Array.isArray(state.updates) || state.updates.length > SERVER_LIMITS.entries) throw new ValidationError('INVALID_RESTORE_RESPONSE');
        const cut: MaintenanceCut = { documentId: input.documentId, generation: input.generation, cutSeq: state.headSeq, documentSchema: state.documentSchema,
          snapshot: { ...state.snapshot, bytes: decodeBase64(state.snapshot.bytes, SERVER_LIMITS.snapshotBytes) },
          updates: state.updates.map(u => ({ seq: u.seq, bytes: decodeBase64(u.bytes, SERVER_LIMITS.updateBytes) })) };
        state.snapshot.bytes = ''; state.updates = [];
        const output = await buildRestoreOutput(cut, claimed.checkpoint); claimed.checkpoint = null;
        bytes = output.update.length; seq = cut.cutSeq;
        const publish = { ...args, p_lease: claimed.leaseToken, p_expected_head: cut.cutSeq, p_base_snapshot: cut.snapshot.id, p_before: hex(output.beforeBytes), p_before_digest: '\\x' + output.beforeDigest,
          p_update: hex(output.update), p_update_digest: '\\x' + output.updateDigest, p_title: output.title };
        try {
          // A lost publish reply retries IDENTICAL bytes. The durable request
          // receipt is checked before CAS; it never creates a second restore.
          let result: unknown;
          for (let retry = 0; retry < 2; retry++) {
            try { result = await backend.rpc('collab_v2_publish_restore', publish); break; }
            catch (e) { if (retry || e instanceof RpcError && !['SERVER_ERROR','SERVER_UNAVAILABLE'].includes(e.code)) throw e; }
          }
          resultCode = 'COMMITTED'; return response(200, result);
        } catch (e) { throw e; }
      }
      throw new ValidationError('INVALID_RESTORE_RESPONSE');
    } catch (e) {
      resultCode = e instanceof ValidationError ? e.code : e instanceof RpcError && ['42501','54000','40001','22023'].includes(e.code) ? e.message : 'SERVER_UNAVAILABLE';
      const status = e instanceof ValidationError ? e.code.includes('QUOTA') || e.code === 'RESTORE_UPDATE_TOO_LARGE' ? 413 : e.code === 'VALIDATION_BUDGET' ? 429 : 400 :
        e instanceof RpcError ? e.code === '42501' ? 403 : e.code === '54000' ? 413 : e.code === '40001' ? 409 : e.code === '22023' ? 400 : 503 : 503;
      if (['HEAD_CONFLICT','SNAPSHOT_CONFLICT'].includes(resultCode)) headers['Retry-After'] = '5';
      return response(status, { error: resultCode, ...(resultCode === 'RESTORE_UPDATE_TOO_LARGE' ? { independentCopyRecommended: true } : {}) });
    } finally {
      if (lease) { try { await backend.rpc('collab_v2_release_restore', lease); } catch { /* Durable lease expiry recovers a stopped worker. */ } }
      try { metric({ bytes, seq: /^(0|[1-9][0-9]{0,18})$/.test(seq) ? seq : '0', elapsedMs: performance.now() - start, result: /^[A-Z_]{1,64}$/.test(resultCode) ? resultCode : 'SERVER_UNAVAILABLE' }); } catch { /* Nonessential metrics. */ }
      busy = false;
    }
  };
}
