// @ts-ignore Deno source import.
import { decodeBase64, SERVER_LIMITS, ValidationError } from '../../../src/collaboration/serverValidation.ts';
// @ts-ignore Deno source import.
import { buildMaintenanceOutput, type MaintenanceCut } from '../../../src/collaboration/maintenance.ts';
// @ts-ignore Deno source import.
import { boundedBody, hex, RpcError, type Backend } from '../collab-ingest/handler.ts';

type Claim = { result: string; leaseToken: string; generation: string; baseSnapshotId: string; cutSeq: string;
  operation: 'compact' | 'automatic' | 'manual'; documentSchema: 1 | 2; serverAt: string;
  snapshot: { id: string; uptoSeq: string; bytes: string }; updates: { seq: string; bytes: string }[] };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const revision = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
export type MaintenanceMetric = { bytes: number; seq: string; elapsedMs: number; result: string };
/** Small requests only. Membership/rates/lease are checked in DB before binary
 * fetch. Worker backpressure prevents simultaneous large Docs in one isolate. */
export function createMaintenanceHandler(backend: Backend, origins: readonly string[],
  metric: (value: MaintenanceMetric) => void = value => console.info(JSON.stringify(value))) {
  let busy = false;
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && origins.includes(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    const response = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
    if (origin && !origins.includes(origin)) return response(403, { error: 'ORIGIN_DENIED' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    const auth = request.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return response(401, { error: 'NOT_AUTHENTICATED' });
    if (busy) { headers['Retry-After'] = '1'; return response(429, { error: 'WORKER_BUSY' }); }
    busy = true;
    const start = performance.now(); let bytes = 0, seq = '0', resultCode = 'SERVER_UNAVAILABLE';
    let claimed: { document: string; actor: string; token: string } | undefined;
    let published = false;
    try {
      const user = await backend.authenticate(auth.slice(7));
      if (!user || !uuid(user.id)) { resultCode = 'NOT_AUTHENTICATED'; return response(401, { error: resultCode }); }
      if (!request.headers.get('content-type')?.startsWith('application/json')) { resultCode = 'JSON_REQUIRED'; return response(415, { error: resultCode }); }
      const input = await boundedBody(request, 1024);
      if (Object.keys(input).sort().join(',') !== 'action,documentId,generation,membershipGeneration' ||
        !['maintain','manual'].includes(input.action as string) || !uuid(input.documentId) || !uuid(input.membershipGeneration) || !revision(input.generation))
        throw new ValidationError('INVALID_ARGUMENT');
      const args = { p_document: input.documentId, p_actor: user.id, p_generation: input.generation, p_membership: input.membershipGeneration };
      const claim = await backend.rpc('collab_v2_claim_maintenance', { ...args, p_action: input.action }) as Claim;
      if (!claim || typeof claim.result !== 'string') throw new ValidationError('INVALID_MAINTENANCE_CLAIM');
      if (claim.result !== 'CLAIMED') {
        if (!['BUSY','NOOP','RATE_LIMIT','DEFERRED_CAPACITY'].includes(claim.result)) throw new ValidationError('INVALID_MAINTENANCE_CLAIM');
        resultCode = claim.result;
        const retryMs = (claim as unknown as { retryAfterMs?: number }).retryAfterMs;
        if (typeof retryMs === 'number' && Number.isFinite(retryMs)) headers['Retry-After'] = String(Math.max(1, Math.ceil(retryMs / 1000)));
        // Manual must never report success for a busy or capacity-deferred request.
        return response(claim.result === 'RATE_LIMIT' || input.action === 'manual' && claim.result === 'BUSY' ? 429 : 200, claim);
      }
      if (!uuid(claim.leaseToken) || !uuid(claim.baseSnapshotId) || claim.generation !== input.generation ||
        !['compact','automatic','manual'].includes(claim.operation) || ![1,2].includes(claim.documentSchema) ||
        !claim.snapshot || claim.snapshot.id !== claim.baseSnapshotId || !Array.isArray(claim.updates) || claim.updates.length > SERVER_LIMITS.entries)
        throw new ValidationError('INVALID_MAINTENANCE_CLAIM');
      claimed = { document: input.documentId, actor: user.id, token: claim.leaseToken }; seq = claim.cutSeq;
      const cut: MaintenanceCut = { documentId: input.documentId, generation: claim.generation, cutSeq: claim.cutSeq,
        documentSchema: claim.documentSchema, snapshot: { ...claim.snapshot, bytes: decodeBase64(claim.snapshot.bytes, SERVER_LIMITS.snapshotBytes) },
        updates: claim.updates.map(u => ({ seq: u.seq, bytes: decodeBase64(u.bytes, SERVER_LIMITS.updateBytes) })) };
      // Drop the large base64 strings before Doc allocation.
      claim.snapshot.bytes = ''; claim.updates = [];
      const output = await buildMaintenanceOutput(cut, claim.operation, user.id, claim.serverAt);
      bytes = output.bytes.length;
      const publish = { ...args, p_lease: claim.leaseToken, p_base_snapshot: claim.baseSnapshotId, p_cut: claim.cutSeq,
        p_bytes: hex(output.bytes), p_digest: '\\x' + output.digest };
      let result: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { result = await backend.rpc('collab_v2_publish_maintenance', publish); published = true; break; }
        catch (e) { if (attempt || e instanceof RpcError && !['SERVER_ERROR','SERVER_UNAVAILABLE'].includes(e.code)) throw e; }
      }
      resultCode = (result as { result: string }).result;
      return response(200, result);
    } catch (e) {
      resultCode = e instanceof ValidationError ? e.code : e instanceof RpcError && ['42501','54000','40001','22023'].includes(e.code) ? e.message : 'SERVER_UNAVAILABLE';
      const status = e instanceof ValidationError ? e.code.includes('QUOTA') ? 413 : e.code === 'VALIDATION_BUDGET' ? 429 : 400 :
        e instanceof RpcError ? e.code === '42501' ? 403 : e.code === '54000' ? 413 : e.code === '40001' ? 409 : e.code === '22023' ? 400 : 503 : 503;
      return response(status, { error: resultCode });
    } finally {
      if (claimed && !published) {
        try { await backend.rpc('collab_v2_release_maintenance', { p_document: claimed.document, p_actor: claimed.actor, p_lease: claimed.token }); } catch { /* Durable lease expiry recovers. */ }
      }
      // Only bounded codes produced here/DB, numeric sizes/seq/time; no exceptions.
      try { metric({ bytes, seq: /^(0|[1-9][0-9]{0,18})$/.test(seq) ? seq : '0', elapsedMs: performance.now() - start,
        result: /^[A-Z_]{1,64}$/.test(resultCode) ? resultCode : 'SERVER_UNAVAILABLE' }); } catch { /* Metrics cannot fail the operation. */ }
      busy = false;
    }
  };
}
