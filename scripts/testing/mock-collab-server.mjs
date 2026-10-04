// Test-only SQL oracle + loopback server. Ingest uses the REAL round-3 Edge handler.
import { createServer } from 'node:http';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

export const actors = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
export const memberships = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
export const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export class MockCollabBackend {
  constructor(base, RpcError, { fresh = false } = {}) {
    this.base = base; this.RpcError = RpcError; this.generation = '1'; this.head = '0'; this.acl = '1';
    this.topic = `collab-v2:${randomUUID()}`; this.members = new Map(actors.map((a, i) => [a, memberships[i]]));
    this.log = []; this.receipts = new Map(); this.notices = []; this.sinks = new Set(); this.requests = [];
    this.dropNotices = false; this.delayAckMs = 0; this.delayPullMs = 0; this.failNext = null; this.authExpired = false; this.capacity = false;
    this.users = new Map(actors.map(id => [id, { id, is_anonymous: false }]));
    this.details = new Map(actors.map(id => [id, { displayName: '通常利用者', isGuest: false }]));
    this.creator = actors[0]; this.deleted = false; this.created = !fresh;
    this.invites = new Map(); this.departures = new Map(); this.attempts = new Map();
    if (fresh) this.members.clear();
  }
  fail(code, message) { throw new this.RpcError(code, message); }
  authenticate = async token => !this.authExpired ? this.users.get(token) ?? null : null;
  guest(displayName) {
    const id = randomUUID(); this.users.set(id, { id, is_anonymous: true });
    this.details.set(id, { displayName, isGuest: true });
    return { access_token: id, refresh_token: `refresh-${id}`, expires_in: 3600, user: { id, is_anonymous: true, user_metadata: { display_name: displayName } } };
  }
  receipt(actor) { return { documentId, generation: this.generation, headSeq: this.head, aclGeneration: this.acl, topic: this.topic, membershipGeneration: this.members.get(actor) }; }
  access(actor) {
    if (this.members.has(actor)) return this.deleted ? { status: 'ended' } : { status: 'active', membershipGeneration: this.members.get(actor) };
    return { status: this.departures.get(actor) ?? 'unavailable' };
  }
  requireMember(actor) {
    if (!this.members.has(actor) || !this.created || this.deleted) this.fail('42501', 'NOT_MEMBER');
  }
  check(actor, generation, membership) {
    if (this.deleted) this.fail('42501', 'DOCUMENT_DELETED');
    if (!this.members.has(actor) || (membership !== undefined && this.members.get(actor) !== membership)) this.fail('42501', 'NOT_MEMBER');
    if (generation !== this.generation) this.fail('40001', 'STALE_GENERATION');
  }
  page(cursor, limit) {
    return { documentId, documentSchema: 2, generation: this.generation, headSeq: this.head, aclGeneration: this.acl,
      topic: this.topic, deleted: false, snapshot: cursor === '0' ? { uptoSeq: '0', bytes: this.base } : null,
      updates: this.log.filter(u => BigInt(u.seq) > BigInt(cursor)).slice(0, limit).map(u => ({ ...u })) };
  }
  rpc = async (name, args) => {
    if (name === 'collab_v2_create_document') {
      if (!this.users.has(args.p_actor) || this.users.get(args.p_actor).is_anonymous) this.fail('42501', 'PERMANENT_ACCOUNT_REQUIRED');
      const base = Buffer.from(args.p_bytes.slice(2), 'hex').toString('base64');
      if (this.deleted) this.fail('42501', 'DOCUMENT_DELETED');
      if (!this.created) {
        this.base = base; this.creator = args.p_actor; this.created = true; this.members.set(args.p_actor, randomUUID());
        this.details.set(args.p_actor, { displayName: args.p_display_name, isGuest: false }); this.rotate(args.p_actor);
      } else if (this.base !== base || this.creator !== args.p_actor) this.fail('54000', 'QUOTA_EXCEEDED');
      return this.receipt(args.p_actor);
    }
    if (name === 'collab_v2_join') {
      const actor = args.p_actor, time = Date.now(), old = this.attempts.get(actor);
      const attempt = !old || time - old.time >= 600000 ? { time, count: 1 } : { ...old, count: Math.min(21, old.count + 1) };
      this.attempts.set(actor, attempt);
      if (attempt.count > 20) return { error: 'INVITE_ATTEMPT_LIMIT' };
      if (!/^[0-9a-f]{64}$/.test(args.p_token ?? '') || !args.p_display_name?.trim() || [...args.p_display_name].length > 80) return { error: 'INVALID_ARGUMENT' };
      const hash = createHash('sha256').update(args.p_token).digest('hex'), invite = this.invites.get(hash);
      if (!invite || this.deleted) return { error: 'INVALID_INVITE' };
      if (invite.usedBy === actor && invite.usedMembership === this.members.get(actor)) return this.receipt(actor);
      if (invite.revoked || invite.usedBy || invite.expiresAt <= time || !this.members.has(invite.issuedBy)) return { error: 'INVALID_INVITE' };
      if (!this.members.has(actor)) {
        if (this.members.size >= 8) return { error: 'MEMBER_LIMIT' };
        this.members.set(actor, randomUUID()); this.details.set(actor, { displayName: args.p_display_name, isGuest: this.users.get(actor).is_anonymous });
        this.departures.delete(actor); this.rotate(actor);
      }
      invite.usedBy = actor; invite.usedMembership = this.members.get(actor); return this.receipt(actor);
    }
    if (args.p_document !== documentId) this.fail('42501', 'NOT_MEMBER');
    if (name === 'collab_v2_access_status') return this.access(args.p_actor);
    if (name === 'collab_v2_list_members') {
      this.requireMember(args.p_actor);
      return [...this.members.keys()].map(userId => ({ userId, ...this.details.get(userId), isCreator: userId === this.creator }));
    }
    if (name === 'collab_v2_create_invite') {
      this.requireMember(args.p_actor);
      if (this.invites.size >= 256 || [...this.invites.values()].filter(i => i.issuedAt > Date.now() - 3600000).length >= 32) this.fail('54000', 'INVITE_RATE_LIMIT');
      const token = randomBytes(32).toString('hex'), inviteId = randomUUID(), expiresAt = Date.now() + 86400000;
      this.invites.set(createHash('sha256').update(token).digest('hex'), { inviteId, issuedBy: args.p_actor, issuedAt: Date.now(), expiresAt });
      return { inviteId, token, expiresAt: new Date(expiresAt).toISOString() };
    }
    if (name === 'collab_v2_revoke_invite') {
      this.requireMember(args.p_actor);
      const invite = [...this.invites.values()].find(i => i.inviteId === args.p_invite);
      if (!invite) this.fail('22023', 'INVALID_INVITE'); invite.revoked = true; return null;
    }
    if (name === 'collab_v2_remove_member' || name === 'collab_v2_leave') {
      this.requireMember(args.p_actor); const user = name === 'collab_v2_leave' ? args.p_actor : args.p_user;
      if (user === this.creator) this.fail('42501', 'CREATOR_PROTECTED');
      if (!this.members.delete(user)) this.fail('22023', 'NOT_MEMBER');
      for (const invite of this.invites.values()) if (invite.issuedBy === user && !invite.usedBy) invite.revoked = true;
      this.departures.set(user, 'removed'); this.rotate(user); return null;
    }
    if (name === 'collab_v2_delete_document') {
      if (args.p_actor !== this.creator) this.fail('42501', 'CREATOR_ONLY');
      this.deleted = true; this.invites.clear(); this.log = []; this.receipts.clear(); this.base = null; this.rotate(args.p_actor);
      for (const user of this.departures.keys()) this.departures.set(user, 'ended'); return null;
    }
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
  deleteAccount(actor) {
    for (const invite of this.invites.values()) if (invite.issuedBy === actor && !invite.usedBy) invite.revoked = true;
    if (actor === this.creator) {
      for (const member of this.members.keys()) if (member !== actor) this.departures.set(member, 'ended');
      this.members.clear(); this.deleted = true; this.created = false; this.base = null; this.log = []; this.receipts.clear(); this.invites.clear();
    } else this.members.delete(actor);
    this.users.delete(actor); this.rotate(actor);
  }
}

export async function startMockServer(backend, createHandler, origin = 'http://127.0.0.1:5179') {
  if (new URL(origin).hostname !== '127.0.0.1' || new URL(origin).protocol !== 'http:') throw new Error('Loopback test origin only');
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
      let body = ''; for await (const chunk of req) body += chunk;
      if (url.pathname === '/auth/v1/signup') {
        const input = JSON.parse(body); res.end(JSON.stringify(backend.guest(input.data?.display_name))); return;
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const input = JSON.parse(body);
        if (input.email !== 'session-test@example.invalid' || input.password !== 'mock-pass') { res.writeHead(400).end(JSON.stringify({error:'invalid_credentials'})); return; }
        res.end(JSON.stringify({access_token:actors[0],refresh_token:'mock-login-refresh',expires_in:3600,token_type:'bearer',user:{id:actors[0],email:input.email,user_metadata:{display_name:'試験アカウント'}}})); return;
      }
      const actor = req.headers.authorization?.replace(/^Bearer /, '');
      if (!await backend.authenticate(actor)) { res.writeHead(401).end(JSON.stringify({ error: 'NOT_AUTHENTICATED' })); return; }
      if (url.pathname === '/rest/v1/collab_v2_members') {
        const id = url.searchParams.get('document_id'), user = url.searchParams.get('user_id');
        const membership = id === `eq.${documentId}` && user === `eq.${actor}` ? backend.members.get(actor) : null;
        res.end(JSON.stringify(membership ? [{ membership_generation: membership }] : [])); return;
      }
      const input = JSON.parse(body);
      if (url.pathname === '/rest/v1/rpc/collab_v2_get_updates') {
        const result = await backend.rpc('collab_v2_get_updates', { ...input, p_actor: actor });
        await wait(backend.delayPullMs); res.end(JSON.stringify(result)); return;
      }
      if (url.pathname.startsWith('/rest/v1/rpc/collab_v2_')) {
        const result = await backend.rpc(url.pathname.split('/').at(-1), { ...input, p_actor: actor });
        res.end(JSON.stringify(result)); return;
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
      res.writeHead(error.code === '42501' ? 403 : error.code === '40001' ? 409 : error.code === '54000' ? 413 : 400);
      res.end(JSON.stringify({ message: error.message, code: error.code }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => {
    for (const sink of backend.sinks) sink.send({});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}
