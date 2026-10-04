import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { readFile } from 'node:fs/promises';
import fixture from '../src/repositories/contract/fixtures/collaboration.json';
import projects from '../src/repositories/contract/fixtures/commitProjects.json';
import { SaveCoordinator } from '../src/storage/saveCoordinator';
import { MemoryProjectRepository } from '../src/repositories/contract/testing/MemoryProjectRepository';
import { RepositoryError, type CollaborationData } from '../src/repositories/types';
import { validateCollaboration, validateCollaborationTransition } from '../src/repositories/collaborationData';
import type { Project } from '../src/types';
import { hydrateCollaboration, encodeUpdate } from '../src/collaboration/persistence';
import { CollaborationCommands } from '../src/collaboration/commands';
import { CollaborationProvider } from '../src/collaboration/provider';
import { parseAck, parsePage, TransportError, type CollaborationTransport } from '../src/collaboration/transport';
import { createHttpTransport, httpError } from '../src/collaboration/supabaseTransport';
import { MockCollabBackend, actors, memberships, documentId } from './testing/mock-collab-server.mjs';
import { createHandler, RpcError } from '../supabase/functions/collab-ingest/handler';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check: () => boolean | Promise<boolean>) { for (let n = 0; n < 200; n++) { if (await check()) return; await tick(); } throw new Error('Test did not settle'); }
const appendInput = (updateId: string, bytes: string) => ({ action: 'append' as const, documentId, generation: '1', membershipGeneration: memberships[0], updateId, bytes });
const request = (value: unknown, actor = actors[0]) => new Request('http://mock.invalid', { method: 'POST', headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
async function setup() {
  const repository = new MemoryProjectRepository(); await repository.initialize();
  const collaboration = { ...fixture.initial, sharedDocumentId: documentId, transportBinding: { accountId: actors[0], membershipGeneration: memberships[0] } } as CollaborationData;
  await repository.commit({ project: projects.stage as Project, collaboration, localRevision: '1', expectedRepositoryRevision: null, operationId: 'initial' });
  const coordinator = new SaveCoordinator(repository, () => {}); coordinator.activate((await repository.get('project_a'))!);
  const backend = new MockCollabBackend(fixture.initial.base, RpcError), handler = createHandler(backend, []);
  const transport: CollaborationTransport = {
    credential: async () => ({ accountId: actors[0], accessToken: actors[0] }),
    membership: async () => { if (!backend.members.has(actors[0])) throw new TransportError('permission', 'NOT_MEMBER'); return backend.members.get(actors[0])!; },
    pull: async (_id, generation, cursor, limit, _auth, _signal, knownSnapshotId) => backend.rpc('collab_v2_get_updates', { p_document: documentId, p_actor: actors[0], p_generation: generation, p_cursor: cursor, p_limit: limit, p_known_snapshot_id: knownSnapshotId }),
    confirm: async input => backend.rpc('collab_v2_confirm_writer', { p_document: documentId, p_actor: actors[0], p_generation: input.generation, p_membership: input.membershipGeneration, p_writer: input.writerId, p_ack_through: input.ackThrough }),
    append: async input => {
      backend.requests.push(input); const response = await handler(request(input)); const value = await response.json();
      if (!response.ok) throw httpError(response.status, value.error); return value;
    },
    subscribe: async (topic, _auth, notice, status) => {
      const sink = { topic, send: notice }; backend.sinks.add(sink); status(true);
      return () => { backend.sinks.delete(sink); };
    },
  };
  const provider = new CollaborationProvider(coordinator, transport, { pollMs: 60_000, backoffMs: 10, random: () => 0, lifecycle: false });
  coordinator.subscribeCommits(event => provider.committedPending(event.pendingCount));
  const move = async (x: number, commit = true) => {
    const doc = hydrateCollaboration((await coordinator.getCommittedCollaboration())!), before = Y.encodeStateVector(doc), commands = new CollaborationCommands(doc);
    commands.moveMembers([{ sceneId: 'f_001', memberId: 'm_001', position: { x, y: 2 } }]);
    const input = appendInput(crypto.randomUUID(), encodeUpdate(Y.encodeStateAsUpdate(doc, before))); commands.destroy(); doc.destroy();
    await coordinator.editCollaboration([{ updateId: input.updateId, bytes: input.bytes, source: 'local' }]);
    if (commit) expect(await coordinator.flush()).toBe(true); return input;
  };
  return { repository, coordinator, backend, handler, transport, provider, move };
}
describe('round-3 contract oracle with real Edge ingest', () => {
  it('uses exact SQL page/ACK fields, seq order, snapshot and no invented membership field', async () => {
    const s = await setup(), input = await s.move(10);
    const first = await s.handler(request(input)); expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ documentId, generation: '1', updateId: input.updateId, seq: '1', duplicate: false });
    expect(await (await s.handler(request(input))).json()).toEqual({ documentId, generation: '1', updateId: input.updateId, seq: '1', duplicate: true });
    const page = await s.transport.pull(documentId, '1', '0', 1, { accountId: actors[0], accessToken: actors[0] }, new AbortController().signal);
    expect(page).toEqual({ documentId, documentSchema: 2, generation: '1', headSeq: '1', aclGeneration: '1', topic: s.backend.topic, deleted: false,
      snapshot: { id: s.backend.snapshotId, uptoSeq: '0', bytes: fixture.initial.base }, updates: [{ seq: '1', updateId: input.updateId, actor: actors[0], bytes: input.bytes }] });
    expect(s.backend.page('1', 32, s.backend.snapshotId)).toMatchObject({ snapshot: null, updates: [] });
    expect(s.backend.notices[0].notice).toEqual({ documentId, generation: '1', headSeq: '1', aclGeneration: '1' });
    // Keep the independently authored mock's key names and boundary anchored to SQL.
    const sql = await readFile('supabase/migrations/20261004000000_collab_v2_foundation.sql', 'utf8');
    for (const text of ["'uptoSeq', s.upto_seq::text", "'actor', u.actor_id", "order by u.seq", "p_limit not between 1 and 32", "v_doc.head_seq + 1", "'seq', v_receipt.seq::text, 'duplicate', true"]) expect(sql).toContain(text);
  });
  it('rejects changed bytes, wrong actor/epoch/cursor, capacity; rotates ACL without old topic delivery', async () => {
    const s = await setup(), input = await s.move(10); await s.handler(request(input));
    const other = await s.move(20);
    expect((await s.handler(request({ ...other, updateId: input.updateId }))).status).toBe(400);
    expect((await s.handler(request({ ...input, membershipGeneration: memberships[1] }, actors[1]))).status).toBe(403);
    expect((await s.handler(request({ ...input, generation: '2' }))).status).toBe(409);
    await expect(s.backend.rpc('collab_v2_get_updates', { p_document: documentId, p_actor: actors[0], p_generation: '1', p_cursor: '2', p_limit: 32 })).rejects.toThrow('INVALID_CURSOR');
    s.backend.capacity = true; expect((await s.handler(request(other))).status).toBe(413);
    s.backend.capacity = false; const topic = s.backend.topic; s.backend.rotate(actors[0]); await s.handler(request(other));
    expect(s.backend.notices.at(-1).topic).not.toBe(topic);
    s.backend.rotate(actors[0], true); expect((await s.handler(request(input))).status).toBe(403);
  });
});
describe('provider durable boundaries and failure states', () => {
  it('remembers the initial snapshot ID even at head=0 and does not download it on every pull', async () => {
    const s=await setup(), pages: unknown[]=[]; const pull=s.transport.pull;
    s.transport.pull=async(...args)=>{const page=await pull(...args);pages.push(page);return page;};
    s.provider.start();
    try {
      await until(()=>s.provider.snapshot.pullConfirmed);
      for(let n=0;n<4;n++){const count=pages.length;s.provider.wake();await until(()=>pages.length>count && s.provider.snapshot.pullConfirmed);}
      expect(pages.filter(p=>(p as {snapshot:unknown}).snapshot)).toHaveLength(1);
      expect((await s.coordinator.getCommittedCollaboration())!.knownSnapshotId).toBe(s.backend.snapshotId);
    } finally{s.provider.stop();}
  });
  it('keeps an edit made while the initial snapshot is in flight', async () => {
    const s=await setup();let release!:()=>void, entered=false;const gate=new Promise<void>(r=>{release=r;});const pull=s.transport.pull;
    s.transport.pull=async(...args)=>{const page=await pull(...args);if(!entered){entered=true;await gate;}return page;};
    s.transport.append=async()=>{throw new TransportError('capacity','QUOTA_EXCEEDED');};s.provider.start();
    try {
      await until(()=>entered);await s.move(99,false);release();await until(()=>s.provider.snapshot.pullConfirmed);
      expect(s.coordinator.projectProjection!.frames[0].positions.m_001.x).toBe(99);
      expect((await s.coordinator.getCommittedCollaboration())!.outbox.some(e=>e.status==='pending')).toBe(true);
    }finally{release();s.provider.stop();}
  });
  it('resends already committed pending after reopen with dirty device audio/view review', async()=>{
    const s=await setup();await s.move(12);await s.coordinator.prepareCollaborationEditing();
    s.coordinator.editCollaborationLocal({...s.coordinator.projectProjection!,viewerPerspective:'performer'});
    expect(s.coordinator.state!.dirty).toBe(true);s.provider.start();
    try{await until(()=>s.backend.head==='1' && s.provider.snapshot.pending===0);expect(s.backend.requests.length).toBe(1);}
    finally{s.provider.stop();}
  });
  it('holds a reclaimed old request without ACK/reassignment and retains bytes through wake and reads', async () => {
    const s=await setup();await s.move(42);expect(await s.coordinator.prepareCollaborationWriter()).toBe(true);
    const data=(await s.coordinator.getCommittedCollaboration())!, old=data.outbox[0];
    await s.transport.append({action:'append',documentId,generation:'1',membershipGeneration:memberships[0],writerId:data.writer!.id,writerSeq:old.writerSeq,updateId:old.updateId,bytes:old.bytes},
      {accountId:actors[0],accessToken:actors[0]},new AbortController().signal);
    await s.transport.confirm({documentId,generation:'1',membershipGeneration:memberships[0],writerId:data.writer!.id,ackThrough:'1'},
      {accountId:actors[0],accessToken:actors[0]},new AbortController().signal);
    const count=s.backend.requests.length;s.provider.start();
    try{
      await until(()=>s.provider.snapshot.error?.code==='RECEIPT_RECLAIMED');
      s.provider.wake();await tick();await tick();
      expect(s.provider.snapshot.held).toBe(true);expect(s.backend.requests.length).toBe(count+1);
      expect((await s.coordinator.getCommittedCollaboration())!.outbox[0]).toEqual(old);
      expect(s.coordinator.projectProjection!.frames[0].positions.m_001.x).toBe(42);
    }finally{s.provider.stop();}
  });
  it('never reports ACK to the server until the local ACK commit succeeds', async () => {
    const s=await setup();await s.move(12);const commit=s.repository.commit.bind(s.repository);let fail=true;
    s.repository.commit=async input=>{if(fail && input.collaboration?.writer?.ackThrough==='1')throw new RepositoryError('NO_SPACE');return commit(input);};
    s.provider.start();
    try{
      await until(()=>s.provider.snapshot.error?.code==='LOCAL_ACK_COMMIT_FAILED');
      expect(s.backend.receipts.size).toBe(1);expect((await s.coordinator.getCommittedCollaboration())!.writer!.ackThrough).toBe('0');
      fail=false;expect(await s.coordinator.flush()).toBe(true);s.provider.wake();await until(()=>s.backend.receipts.size===0);
      expect((await s.coordinator.getCommittedCollaboration())!.outbox).toEqual([]);
    }finally{s.provider.stop();}
  });
  it('adopts an ACK-lost legacy request without appending and refuses an old unsequenced retry after collection', async()=>{
    const s=await setup(), original=await s.move(12);
    expect((await s.handler(request(original))).status).toBe(200);s.provider.start();
    try{
      await until(()=>s.provider.snapshot.pending===0 && s.backend.receipts.size===0);
      expect(s.backend.head).toBe('1');expect((await s.coordinator.getCommittedCollaboration())!.writer!.ackThrough).toBe('1');
      const stale=await s.handler(request(original));expect(stale.status).toBe(400);expect(await stale.json()).toEqual({error:'WRITER_REQUIRED'});expect(s.backend.head).toBe('1');
    }finally{s.provider.stop();}
  });
  it('holds whole-database recovery including old pre-writer backups without sending', async () => {
    const s=await setup();await s.move(12);const record=(await s.repository.get('project_a'))!;
    await s.repository.commit({project:record.project,collaboration:{...record.collaboration!,recoveryRequired:true},operationId:'recovered',localRevision:'3',expectedRepositoryRevision:record.repositoryRevision});
    s.coordinator.activate((await s.repository.get('project_a'))!);s.provider.start();
    try{await until(()=>s.provider.snapshot.error?.code==='RECOVERY_CONFIRMATION_REQUIRED');expect(s.backend.requests).toEqual([]);expect((await s.coordinator.getCommittedCollaboration())!.outbox).toHaveLength(1);}
    finally{s.provider.stop();}
  });
  it('accepts old attachments, binds only at initial sharing, rejects implicit sender changes', async () => {
    expect(validateCollaboration(fixture.initial).transportBinding).toBeUndefined();
    const old = { ...fixture.initial, sharedDocumentId: null } as CollaborationData;
    const bound = { ...old, sharedDocumentId: documentId, transportBinding: { accountId: actors[0], membershipGeneration: memberships[0] } };
    expect(() => validateCollaborationTransition(old, bound)).not.toThrow();
    expect(() => validateCollaborationTransition(fixture.initial as CollaborationData, bound)).toThrow();
    expect(() => validateCollaborationTransition(bound, { ...bound, transportBinding: { ...bound.transportBinding, membershipGeneration: memberships[1] } })).toThrow();
    expect(() => validateCollaboration({ ...old, transportBinding: { accountId: actors[0], membershipGeneration: 'bad' } })).toThrow();
    const s = await setup();
    s.coordinator.getCommittedCollaboration = async () => fixture.initial as CollaborationData; s.provider.start();
    try { await until(() => s.provider.snapshot.held); expect(s.backend.requests).toHaveLength(0); }
    finally { s.provider.stop(); }
  });
  it.each(['network', 'rate-limit', 'temporary'] as const)('retries %s with exactly the same ID/bytes and backoff', async kind => {
    const s = await setup(), input = await s.move(16), real = s.transport.append;
    const attempts: { input: unknown; time: number }[] = [];
    s.transport.append = async (...args) => {
      attempts.push({ input: { ...args[0] }, time: performance.now() });
      if (attempts.length < 3) throw new TransportError(kind, kind === 'temporary' ? 'HEAD_CONFLICT' : 'RETRY', 20);
      return real(...args);
    };
    s.provider.start(); try {
      await until(() => s.provider.snapshot.pending === 0 && attempts.length === 3);
      expect(attempts.every(a => JSON.stringify(a.input) === JSON.stringify(attempts[0].input))).toBe(true);
      expect(attempts[0].input).toMatchObject(input);
      expect(attempts[1].time - attempts[0].time).toBeGreaterThanOrEqual(15);
      expect(attempts[2].time - attempts[1].time).toBeGreaterThanOrEqual(15);
      await until(() => s.backend.receipts.size === 0);
    } finally { s.provider.stop(); }
  });
  it('recovers MISSING_DEPENDENCIES by pull and resumes auth with explicit wake', async () => {
    const s = await setup(); await s.move(16); const real = s.transport.append;
    let attempt = 0; s.transport.append = async (...args) => { if (!attempt++) throw new TransportError('temporary', 'MISSING_DEPENDENCIES'); return real(...args); };
    let auth = false; s.transport.credential = async () => auth ? { accountId: actors[0], accessToken: actors[0] } : null;
    const pull = vi.fn(s.transport.pull); s.transport.pull = pull; s.provider.start();
    try {
      await until(() => s.provider.snapshot.error?.kind === 'auth'); expect(attempt).toBe(0);
      auth = true; s.provider.wake(); await until(() => s.provider.snapshot.pending === 0 && attempt === 2);
      expect(pull.mock.calls.length).toBeGreaterThan(0);
    } finally { s.provider.stop(); }
  });
  it('does not send during a delayed/failed local transaction; sends after commit only', async () => {
    const s = await setup(); await s.move(12, false);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const commit = s.repository.commit.bind(s.repository);
    s.repository.commit = async input => { await gate; return commit(input); };
    s.transport.pull = async () => s.backend.page('0', 32);
    const saving = s.coordinator.flush(); s.provider.start();
    try {
      await tick(); await tick(); expect(s.backend.requests).toHaveLength(0); expect((await s.coordinator.getCommittedCollaboration())!.outbox).toHaveLength(0);
      release(); expect(await saving).toBe(true); s.provider.wake(); await until(() => s.backend.requests.length === 1);
      await until(() => s.provider.snapshot.pending === 0);
    } finally { release(); s.provider.stop(); }
  });
  it('keeps receiving and editing while ACK is pending, ignores completion after stop', async () => {
    const s = await setup(); await s.move(12);
    let resolve!: (v: unknown) => void; s.transport.append = input => new Promise(r => { resolve = r; });
    s.provider.start();
    try {
      await until(() => !!resolve); await until(() => s.provider.snapshot.realtimeConnected);
      const second = await s.move(13); expect(s.coordinator.projectProjection!.frames[0].positions.m_001.x).toBe(13);
      s.provider.stop(); resolve({ documentId, generation: '1', updateId: second.updateId, seq: '1', duplicate: false }); await tick();
      expect((await s.coordinator.getSendableOutbox()).length).toBe(2);
    } finally { s.provider.stop(); }
  });
  it('does not advance durable cursor on failed receive commit and resumes after explicit retry', async () => {
    const s = await setup(), input = await s.move(15); await s.handler(request(input));
    const commit = s.repository.commit.bind(s.repository); let fail = true;
    s.repository.commit = async input => { if (fail) throw new RepositoryError('NO_SPACE'); return commit(input); };
    s.transport.append = async () => { throw new TransportError('capacity', 'QUOTA_EXCEEDED'); };
    s.provider.start();
    try {
      await until(() => !!s.coordinator.state?.error);
      expect(s.provider.snapshot.cursor).toBe('0'); expect((await s.coordinator.getCommittedCollaboration())!.serverCursor).toBe('0');
      fail = false; s.provider.wake(); await until(() => s.provider.snapshot.cursor === '1');
      expect(s.coordinator.projectProjection!.frames[0].positions.m_001.x).toBe(15);
    } finally { s.provider.stop(); }
  });
  it.each(['auth', 'permission', 'capacity', 'validation', 'generation'] as const)('holds local editing on %s without hot retries', async kind => {
    const s = await setup(); await s.move(17); const append = vi.fn(async () => { throw new TransportError(kind, kind === 'validation' ? 'VALIDATION_BUDGET' : kind.toUpperCase()); });
    s.transport.append = append; s.provider.start();
    try {
      await until(() => s.provider.snapshot.error?.kind === kind);
      await tick(); await tick(); expect(append).toHaveBeenCalledTimes(1); expect(s.provider.snapshot.pending).toBe(1);
      await s.move(18); expect(s.coordinator.projectProjection!.frames[0].positions.m_001.x).toBe(18);
      expect((await s.coordinator.getSendableOutbox()).length).toBe(2);
    } finally { s.provider.stop(); }
  });
  it('holds missing/account/rejoin binding and keeps reads possible after membership changes', async () => {
    const s = await setup(); await s.move(19); s.backend.rotate(actors[0], true); s.provider.start();
    try { await until(() => s.provider.snapshot.held); expect(s.backend.requests).toHaveLength(0); expect(s.provider.snapshot.error?.code).toBe('MEMBERSHIP_CHANGED'); }
    finally { s.provider.stop(); }
    const other = await setup(); other.transport.credential = async () => ({ accountId: actors[1], accessToken: actors[1] }); other.provider.start();
    try { await until(() => other.provider.snapshot.held); expect(other.backend.requests).toHaveLength(0); }
    finally { other.provider.stop(); }
  });
  it('fetches multiple pages and never uses head as cursor (including seq > JS safe integer)', async () => {
    const s = await setup();
    for (let i = 0; i < 35; i++) await s.handler(request(await s.move(i + 100)));
    // Isolate the receive contract from worker-busy races in the independent send lane.
    s.transport.append = async () => { throw new TransportError('capacity', 'QUOTA_EXCEEDED'); };
    const realPull = s.transport.pull;
    const pull = vi.fn(async (...args: Parameters<CollaborationTransport['pull']>) => {
      const page = await realPull(...args);
      if (args[2] === '0') {
        const edit=await s.move(200);
        await s.handler(request({...edit,updateId:'remote-during-pull',membershipGeneration:memberships[1],writerId:crypto.randomUUID(),writerSeq:'1'},actors[1]));
      }
      return page;
    }); s.transport.pull = pull; s.provider.start();
    try { await until(() => s.provider.snapshot.cursor === '36'); expect(pull.mock.calls.some(c => c[2] === '32')).toBe(true); }
    finally { s.provider.stop(); }
    const ack = { documentId, generation: '1', updateId: 'fixed', seq: '9007199254740993', duplicate: true };
    expect(parseAck(ack, appendInput('fixed', fixture.updates[0].bytes)).seq).toBe('9007199254740993');
    expect(() => parseAck({ ...ack, seq: 9007199254740993 }, appendInput('fixed', fixture.updates[0].bytes))).toThrow();
  });
  it('rejects malformed ACK and out-of-order pages without losing outbox or advancing cursor', async () => {
    const s = await setup(), input = await s.move(21);
    s.transport.append = async () => ({ documentId, generation: '1', updateId: 'wrong', seq: '1', duplicate: false });
    s.transport.pull = async () => ({ ...s.backend.page('0', 32), headSeq: '2', updates: [{ seq: '2', updateId: input.updateId, actor: actors[0], bytes: input.bytes }] });
    s.provider.start(); try {
      await until(() => s.provider.snapshot.error?.kind === 'protocol'); expect(s.provider.snapshot.cursor).toBe('0'); expect((await s.coordinator.getSendableOutbox()).length).toBe(1);
    } finally { s.provider.stop(); }
    expect(() => parsePage({ ...s.backend.page('0', 32), headSeq: 1 }, documentId, '1')).toThrow();
  });
  it('HTTP adapter supplies exact RPC args/Bearer and membership read with injected config', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url, init) => {
      calls.push({ url: String(url), init }); return new Response(JSON.stringify(String(url).includes('collab_v2_access_status') ? { status: 'active', membershipGeneration: memberships[0] } : { ok: true }));
    }) as typeof fetch;
    const transport = createHttpTransport({ url: 'http://localhost:9999', anonKey: 'public-only' }, async () => null, async () => () => {}, fetcher);
    const auth = { accountId: actors[0], accessToken: 'injected-token' }, signal = new AbortController().signal;
    await transport.membership(documentId, auth, signal); await transport.pull(documentId, '1', '9007199254740993', 32, auth, signal);
    expect(calls[0].url).toContain('/rpc/collab_v2_access_status');
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({ p_document: documentId });
    expect(calls[1].init?.headers).toMatchObject({ Authorization: 'Bearer injected-token', apikey: 'public-only' });
    expect(JSON.parse(calls[1].init!.body as string)).toEqual({ p_document: documentId, p_generation: '1', p_cursor: '9007199254740993', p_limit: 32, p_known_snapshot_id: null });
    expect(httpError(429, 'VALIDATION_BUDGET').kind).toBe('validation'); expect(httpError(400, 'MISSING_DEPENDENCIES').kind).toBe('temporary');
  });
});
