// Test-only SQL oracle + loopback server. Ingest uses the REAL round-3 Edge handler.
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';

export const actors = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
export const memberships = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
export const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export class MockCollabBackend {
  constructor(base, RpcError) {
    this.base = base; this.RpcError = RpcError; this.generation = '1'; this.head = '0'; this.acl = '1';
    this.topic = `collab-v2:${randomUUID()}`; this.members = new Map(actors.map((a, i) => [a, memberships[i]]));
    this.log = []; this.receipts = new Map(); this.notices = []; this.sinks = new Set(); this.requests = [];
    this.dropNotices = false; this.delayAckMs = 0; this.delayPullMs = 0; this.failNext = null; this.authExpired = false; this.capacity = false;
  }
  fail(code, message) { throw new this.RpcError(code, message); }
  authenticate = async token => !this.authExpired && actors.includes(token) ? { id: token, is_anonymous: false } : null;
  check(actor, generation, membership) {
    if (!this.members.has(actor) || (membership !== undefined && this.members.get(actor) !== membership)) this.fail('42501', 'NOT_MEMBER');
    if (generation !== this.generation) this.fail('40001', 'STALE_GENERATION');
  }
  page(cursor, limit) {
    return { documentId, documentSchema: 2, generation: this.generation, headSeq: this.head, aclGeneration: this.acl,
      topic: this.topic, deleted: false, snapshot: cursor === '0' ? { uptoSeq: '0', bytes: this.base } : null,
      updates: this.log.filter(u => BigInt(u.seq) > BigInt(cursor)).slice(0, limit).map(u => ({ ...u })) };
  }
  rpc = async (name, args) => {
    if (args.p_document !== documentId) this.fail('42501', 'NOT_MEMBER');
    this.check(args.p_actor, args.p_generation, args.p_membership);
    if (name === 'collab_v2_ingest_state') return this.page('0', 4096);
    if (name === 'collab_v2_get_updates') {
      if (!Number.isInteger(args.p_limit) || args.p_limit < 1 || args.p_limit > 32 || !/^(0|[1-9][0-9]*)$/.test(args.p_cursor)) this.fail('22023', 'INVALID_ARGUMENT');
      if (BigInt(args.p_cursor) > BigInt(this.head)) this.fail('22023', 'INVALID_CURSOR');
      return this.page(args.p_cursor, args.p_limit);
    }
    if (name !== 'collab_v2_append') throw new Error(`Unexpected RPC ${name}`);
    const bytes = Buffer.from(args.p_bytes.slice(2), 'hex');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (`\\x${digest}` !== args.p_digest) this.fail('22023', 'DIGEST_MISMATCH');
    const old = this.receipts.get(args.p_update_id);
    if (old) {
      if (old.digest !== digest) this.fail('22023', 'UPDATE_ID_CONFLICT');
      if (old.actor !== args.p_actor) this.fail('42501', 'ACTOR_MISMATCH');
      return { seq: old.seq, duplicate: true };
    }
    if (args.p_expected_head !== this.head) this.fail('40001', 'HEAD_CONFLICT');
    if (this.capacity || this.receipts.size >= 4096 || this.log.reduce((sum, u) => sum + Buffer.from(u.bytes, 'base64').length, 0) + bytes.length > 4194304) this.fail('54000', 'QUOTA_EXCEEDED');
    this.head = String(BigInt(this.head) + 1n);
    this.log.push({ seq: this.head, updateId: args.p_update_id, actor: args.p_actor, bytes: bytes.toString('base64') });
    this.receipts.set(args.p_update_id, { seq: this.head, digest, actor: args.p_actor });
    const notice = { documentId, generation: this.generation, headSeq: this.head, aclGeneration: this.acl };
    this.notices.push({ topic: this.topic, notice });
    if (!this.dropNotices) this.deliver(this.notices.at(-1));
    return { seq: this.head, duplicate: false };
  };
  deliver(event) { for (const sink of this.sinks) if (sink.topic === event.topic) sink.send(event.notice); }
  rotate(actor, rejoin = false) {
    if (rejoin) this.members.set(actor, randomUUID());
    this.acl = String(BigInt(this.acl) + 1n); this.topic = `collab-v2:${randomUUID()}`;
  }
}

export async function startMockServer(backend, createHandler) {
  const origin = 'http://127.0.0.1:5179';
  const handler = createHandler(backend, [origin]);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/events') {
      const actor = url.searchParams.get('actor'), topic = url.searchParams.get('topic');
      if (!backend.members.has(actor) || topic !== backend.topic) { res.writeHead(403).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); res.write(': connected\n\n');
      const sink = { topic, send: notice => res.write(`data: ${JSON.stringify(notice)}\n\n`) };
      backend.sinks.add(sink); req.on('close', () => backend.sinks.delete(sink)); return;
    }
    try {
      const actor = req.headers.authorization?.replace(/^Bearer /, '');
      if (!await backend.authenticate(actor)) { res.writeHead(401).end(JSON.stringify({ error: 'NOT_AUTHENTICATED' })); return; }
      if (url.pathname === '/rest/v1/collab_v2_members') {
        const id = url.searchParams.get('document_id'), user = url.searchParams.get('user_id');
        const membership = id === `eq.${documentId}` && user === `eq.${actor}` ? backend.members.get(actor) : null;
        res.end(JSON.stringify(membership ? [{ membership_generation: membership }] : [])); return;
      }
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      if (url.pathname === '/rest/v1/rpc/collab_v2_get_updates') {
        const result = await backend.rpc('collab_v2_get_updates', { ...input, p_actor: actor });
        await wait(backend.delayPullMs); res.end(JSON.stringify(result)); return;
      }
      if (url.pathname !== '/functions/v1/collab-ingest') { res.writeHead(404).end(); return; }
      backend.requests.push({ actor, ...input });
      if (backend.failNext) { const failure = backend.failNext; backend.failNext = null; res.writeHead(failure.status, { 'Retry-After': '0.05' }).end(JSON.stringify({ error: failure.code })); return; }
      const response = await handler(new Request('http://mock.invalid/functions/v1/collab-ingest', {
        method: 'POST', headers: { authorization: `Bearer ${actor}`, 'content-type': 'application/json', origin }, body }));
      // DB commit can precede socket close, ACK remains delayed/lost.
      await wait(backend.delayAckMs);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) {
      res.writeHead(error.code === '42501' ? 403 : error.code === '40001' ? 409 : 400);
      res.end(JSON.stringify({ message: error.message, code: error.code }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    for (const sink of backend.sinks) sink.send({});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
