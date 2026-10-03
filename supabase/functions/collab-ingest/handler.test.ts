import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHandler, RpcError, type Backend } from './handler';
import { encodeBase64 } from '../../../src/collaboration/serverValidation';

const userId = '00000000-0000-0000-0000-000000000001';
const documentId = '00000000-0000-0000-0000-000000000101';
const membership = '00000000-0000-0000-0000-000000000201';
function fixture() {
  const doc = new Y.Doc();
  doc.getMap('metadata').set('schemaVersion', 1); doc.getMap('metadata').set('projectId', 'test');
  doc.getMap('members').set('m', new Y.Map());
  const scene = new Y.Map(), positions = new Y.Map(); doc.getMap('scenes').set('s', scene); scene.set('positions', positions);
  positions.set('m', { x: 0, y: 0 }); const base = Y.encodeStateAsUpdate(doc);
  let delta!: Uint8Array; doc.on('update', b => { delta = b; }); positions.set('m', { x: 1, y: 2 }); doc.destroy();
  return { base, delta };
}
const input = (bytes: Uint8Array) => ({ action: 'append', documentId, generation: '1', membershipGeneration: membership,
  updateId: 'fixed-id', bytes: encodeBase64(bytes) });
function request(value: unknown, auth = true, origin = 'https://app.example.invalid') {
  return new Request('https://function.example.invalid', { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer user-token' } : {}), Origin: origin,
  }, body: JSON.stringify(value) });
}
describe('Edge ingest contract with a stub backend', () => {
  it('bounds active request memory per worker and asks concurrent clients to retry', async () => {
    let release!: (user: { id: string; is_anonymous: boolean }) => void;
    const backend: Backend = { authenticate: () => new Promise(resolve => { release = resolve; }), rpc: async () => ({}) };
    const handler = createHandler(backend, ['https://app.example.invalid']);
    const first = handler(request(null));
    expect((await handler(request(null))).status).toBe(429);
    release({ id: userId, is_anonymous: true }); expect((await first).status).toBe(400);
  });
  it('authenticates actor, retries head conflict with fresh state and only then ACKs', async () => {
    const { base, delta } = fixture(), calls: { name: string; args: Record<string, unknown> }[] = [];
    let appendCount = 0;
    const backend: Backend = { authenticate: async token => token === 'user-token' ? { id: userId, is_anonymous: true } : null,
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'collab_v2_ingest_state') return { documentSchema: 1, headSeq: appendCount ? '1' : '0',
          snapshot: { bytes: encodeBase64(base), uptoSeq: '0' }, updates: appendCount ? [{ bytes: encodeBase64(delta), seq: '1' }] : [] };
        if (++appendCount === 1) throw new RpcError('40001', 'HEAD_CONFLICT');
        return { seq: '1', duplicate: true };
      } };
    const result = await createHandler(backend, ['https://app.example.invalid'])(request(input(delta)));
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ seq: '1', duplicate: true, updateId: 'fixed-id' });
    expect(calls.map(c => c.name)).toEqual(['collab_v2_ingest_state', 'collab_v2_append', 'collab_v2_ingest_state', 'collab_v2_append']);
    expect(calls.every(c => c.args.p_actor === userId)).toBe(true);
    expect(calls[1].args.p_bytes).toEqual(calls[3].args.p_bytes); expect(calls[3].args.p_expected_head).toBe('1');
  });
  it('does not ACK on DB failure, membership expiry, unsupported schema, or invalid update', async () => {
    const { base, delta } = fixture();
    for (const error of [new RpcError('42501', 'NOT_MEMBER'), new RpcError('54000', 'QUOTA_EXCEEDED'), new Error('timeout')]) {
      const backend: Backend = { authenticate: async () => ({ id: userId, is_anonymous: false }), rpc: async () => { throw error; } };
      const result = await createHandler(backend, ['https://app.example.invalid'])(request(input(delta)));
      expect(result.status).toBeGreaterThanOrEqual(400); expect(await result.json()).not.toHaveProperty('seq');
    }
    let writes = 0;
    const backend: Backend = { authenticate: async () => ({ id: userId, is_anonymous: false }), rpc: async name => {
      if (name === 'collab_v2_append') writes++;
      return { documentSchema: 1, snapshot: { bytes: encodeBase64(base), uptoSeq: '0' }, updates: [], headSeq: '0' };
    } };
    const result = await createHandler(backend, ['https://app.example.invalid'])(request(input(Uint8Array.of(1))));
    expect(result.status).toBe(400); expect(writes).toBe(0);
    backend.rpc = async () => ({ documentSchema: 2 });
    const unsupported = await createHandler(backend, ['https://app.example.invalid'])(request(input(delta)));
    expect(unsupported.status).toBe(400); expect(await unsupported.json()).toEqual({ error: 'UNSUPPORTED_SCHEMA' });
  });
  it('bounds CAS retries and preserves the fixed request when conflicts persist', async () => {
    const { base, delta } = fixture(); let reads = 0, writes = 0;
    const backend: Backend = { authenticate: async () => ({ id: userId, is_anonymous: false }), rpc: async name => {
      if (name === 'collab_v2_ingest_state') {
        reads++; return { documentSchema: 1, headSeq: '0', snapshot: { bytes: encodeBase64(base), uptoSeq: '0' }, updates: [] };
      }
      writes++; throw new RpcError('40001', 'HEAD_CONFLICT');
    } };
    const result = await createHandler(backend, ['https://app.example.invalid'])(request(input(delta)));
    expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: 'HEAD_CONFLICT', retryable: true });
    expect(reads).toBe(3); expect(writes).toBe(3);
  });
  it('rejects payload actor, NULL, missing auth, forbidden origin and excessive streamed body', async () => {
    const { delta } = fixture(); let writes = 0;
    const backend: Backend = { authenticate: async () => ({ id: userId, is_anonymous: true }), rpc: async () => { writes++; return {}; } };
    const handler = createHandler(backend, ['https://app.example.invalid']);
    expect((await handler(request({ ...input(delta), actor: userId }))).status).toBe(400);
    expect((await handler(request(null))).status).toBe(400);
    expect((await handler(request(input(delta), false))).status).toBe(401);
    expect((await handler(request(input(delta), true, 'https://evil.example.invalid'))).status).toBe(403);
    expect((await handler(request({ padding: 'a'.repeat(360001) }))).status).toBe(413);
    expect(writes).toBe(0);
  });
  it('requires creator validation through Edge and refuses guest creation', async () => {
    const { base } = fixture(); let guest = true; const calls: string[] = [];
    const backend: Backend = { authenticate: async () => ({ id: userId, is_anonymous: guest }), rpc: async name => { calls.push(name); return { documentId }; } };
    const handler = createHandler(backend, ['https://app.example.invalid']);
    const create = { action: 'create', displayName: '作成者', bytes: encodeBase64(base) };
    expect((await handler(request(create))).status).toBe(403); guest = false;
    expect((await handler(request({ ...create, bytes: encodeBase64(Uint8Array.of(1)) }))).status).toBe(400);
    expect((await handler(request(create))).status).toBe(200); expect(calls).toEqual(['collab_v2_create_document']);
  });
});
