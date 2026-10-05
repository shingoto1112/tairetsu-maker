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
    this.log = []; this.receipts = new Map(); this.writers = new Map(); this.snapshotId = randomUUID(); this.snapshotSeq = '0'; this.notices = []; this.sinks = new Set(); this.requests = [];
    this.dropNotices = false; this.delayAckMs = 0; this.delayPullMs = 0; this.failNext = null; this.authExpired = false; this.capacity = false;
    this.users = new Map(actors.map(id => [id, { id, is_anonymous: false }]));
    this.details = new Map(actors.map(id => [id, { displayName: '通常利用者', isGuest: false }]));
    this.creator = actors[0]; this.deleted = false; this.created = !fresh;
    this.invites = new Map(); this.departures = new Map(); this.attempts = new Map();
    this.title = '隊列表'; this.titleSeq = '0'; this.createdAt = new Date().toISOString(); this.managementCalls = [];
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
  page(cursor, limit, knownSnapshotId = null) {
    return { documentId, documentSchema: 2, generation: this.generation, headSeq: this.head, aclGeneration: this.acl,
      topic: this.topic, deleted: false, snapshot: BigInt(cursor) < BigInt(this.snapshotSeq) || knownSnapshotId !== this.snapshotId ? { id: this.snapshotId, uptoSeq: this.snapshotSeq, bytes: this.base } : null,
      updates: this.log.filter(u => BigInt(u.seq) > BigInt(cursor) && BigInt(u.seq) > BigInt(this.snapshotSeq)).slice(0, limit).map(u => ({ ...u })) };
  }
  rpc = async (name, args) => {
    this.managementCalls.push(name);
    if (name === 'collab_v2_list_my_documents') {
      return { items: this.created && !this.deleted && this.members.has(args.p_actor) && !args.p_before_id ? [{ documentId, title: this.title,
        createdAt: this.createdAt, isCreator: args.p_actor === this.creator, memberCount: this.members.size, documentSchema: 2 }] : [], nextCursor: null };
    }
    if (name === 'collab_v2_create_document') {
      if (!this.users.has(args.p_actor) || this.users.get(args.p_actor).is_anonymous) this.fail('42501', 'PERMANENT_ACCOUNT_REQUIRED');
      const base = Buffer.from(args.p_bytes.slice(2), 'hex').toString('base64');
      if (this.deleted) this.fail('42501', 'DOCUMENT_DELETED');
      if (!this.created) {
        this.title = args.p_title ?? '隊列表'; this.titleSeq = '0';
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
      const uses = invite.uses ?? new Map();
      if (invite.multiUse && uses.get(actor) === this.members.get(actor) && uses.has(actor)) return this.receipt(actor);
      if (invite.multiUse && uses.has(actor)) return { error: 'INVALID_INVITE' };
      if (!invite.multiUse && invite.usedBy === actor && invite.usedMembership === this.members.get(actor)) return this.receipt(actor);
      if (invite.revoked || (!invite.multiUse && invite.usedBy) || invite.expiresAt <= time || !this.members.has(invite.issuedBy) || (invite.multiUse && uses.size >= 64)) return { error: 'INVALID_INVITE' };
      if (!this.members.has(actor)) {
        if (this.members.size >= 8) return { error: 'MEMBER_LIMIT' };
        this.members.set(actor, randomUUID()); this.details.set(actor, { displayName: args.p_display_name, isGuest: this.users.get(actor).is_anonymous });
        this.departures.delete(actor); this.rotate(actor);
        if (invite.multiUse) uses.set(actor, this.members.get(actor));
      }
      if (invite.multiUse) invite.uses = uses;
      else { invite.usedBy = actor; invite.usedMembership = this.members.get(actor); }
      return this.receipt(actor);
    }
    if (args.p_document !== documentId) this.fail('42501', 'NOT_MEMBER');
    if (name === 'collab_v2_access_status') return this.access(args.p_actor);
    if (name === 'collab_v2_open_existing') { this.requireMember(args.p_actor); return this.receipt(args.p_actor); }
    if (name === 'collab_v2_list_invites') {
      this.requireMember(args.p_actor);
      return [...this.invites.values()].reverse().map(invite => ({ inviteId: invite.inviteId, expiresAt: new Date(invite.expiresAt).toISOString(),
        multiUse: !!invite.multiUse, joinedCount: invite.multiUse ? (invite.uses?.size ?? 0) : invite.usedBy ? 1 : 0,
        status: invite.revoked ? 'revoked' : invite.multiUse ? (invite.expiresAt <= Date.now() ? 'expired' : invite.uses?.size >= 64 ? 'used' : 'active') : invite.usedBy ? 'used' : invite.expiresAt <= Date.now() ? 'expired' : 'active' }));
    }
    if (name === 'collab_v2_list_members') {
      this.requireMember(args.p_actor);
      return [...this.members.keys()].map(userId => ({ userId, ...this.details.get(userId), isCreator: userId === this.creator }));
    }
    if (name === 'collab_v2_create_invite') {
      this.requireMember(args.p_actor);
      if (this.invites.size >= 256 || [...this.invites.values()].filter(i => i.issuedAt > Date.now() - 3600000).length >= 32) this.fail('54000', 'INVITE_RATE_LIMIT');
      const token = randomBytes(32).toString('hex'), inviteId = randomUUID(), expiresAt = Date.now() + 7 * 86400000;
      this.invites.set(createHash('sha256').update(token).digest('hex'), { inviteId, issuedBy: args.p_actor, issuedAt: Date.now(), expiresAt, multiUse: true, uses: new Map() });
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
      for (const invite of this.invites.values()) if (invite.issuedBy === user && !invite.revoked && invite.expiresAt > Date.now() && (invite.multiUse || !invite.usedBy)) invite.revoked = true;
      this.departures.set(user, 'removed'); this.rotate(user); return null;
    }
    if (name === 'collab_v2_delete_document') {
      if (args.p_actor !== this.creator) this.fail('42501', 'CREATOR_ONLY');
      this.deleted = true; this.invites.clear(); this.log = []; this.receipts.clear(); this.base = null; this.rotate(args.p_actor);
      for (const user of this.departures.keys()) this.departures.set(user, 'ended'); return null;
    }
    this.check(args.p_actor, args.p_generation, args.p_membership);
    if (name === 'collab_v2_confirm_writer' || name === 'collab_v2_probe_writer') {
      let writer = this.writers.get(args.p_writer);
      if (writer && (writer.actor !== args.p_actor || writer.membership !== args.p_membership)) this.fail('42501', 'WRITER_MISMATCH');
      if (name === 'collab_v2_probe_writer') return writer && BigInt(args.p_writer_seq) <= BigInt(writer.reclaimed) ?
        { result: 'RECEIPT_RECLAIMED', writerId: args.p_writer, reclaimedThrough: writer.reclaimed } : null;
      if (!writer) {
        if (args.p_ack_through !== '0') this.fail('22023', 'ACK_AHEAD');
        writer = { actor: args.p_actor, membership: args.p_membership, accepted: '0', reclaimed: '0' }; this.writers.set(args.p_writer, writer);
      }
      if (BigInt(args.p_ack_through) > BigInt(writer.accepted)) this.fail('22023', 'ACK_AHEAD');
      if (BigInt(args.p_ack_through) > BigInt(writer.reclaimed)) {
        writer.reclaimed = args.p_ack_through;
        for (const [id, receipt] of this.receipts) if (receipt.writer === args.p_writer && BigInt(receipt.writerSeq) <= BigInt(writer.reclaimed)) this.receipts.delete(id);
      }
      return { writerId: args.p_writer, reclaimedThrough: writer.reclaimed };
    }
    if (name === 'collab_v2_ingest_state') return this.page('0', 4096);
    if (name === 'collab_v2_get_updates') {
      if (!Number.isInteger(args.p_limit) || args.p_limit < 1 || args.p_limit > 32 || !/^(0|[1-9][0-9]*)$/.test(args.p_cursor)) this.fail('22023', 'INVALID_ARGUMENT');
      if (BigInt(args.p_cursor) > BigInt(this.head)) this.fail('22023', 'INVALID_CURSOR');
      return this.page(args.p_cursor, args.p_limit, args.p_known_snapshot_id);
    }
    if (name !== 'collab_v2_append') throw new Error(`Unexpected RPC ${name}`);
    const bytes = Buffer.from(args.p_bytes.slice(2), 'hex');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (`\\x${digest}` !== args.p_digest) this.fail('22023', 'DIGEST_MISMATCH');
    let writer;
    if (args.p_writer) {
      writer = this.writers.get(args.p_writer);
      if (!writer) { writer = { actor: args.p_actor, membership: args.p_membership, accepted: '0', reclaimed: '0' }; this.writers.set(args.p_writer, writer); }
      if (writer.actor !== args.p_actor || writer.membership !== args.p_membership) this.fail('42501', 'WRITER_MISMATCH');
      if (BigInt(args.p_writer_seq) <= BigInt(writer.reclaimed)) return { result: 'RECEIPT_RECLAIMED', writerId: args.p_writer, reclaimedThrough: writer.reclaimed };
    }
    const old = this.receipts.get(args.p_update_id);
    if (old) {
      if (old.digest !== digest) this.fail('22023', 'UPDATE_ID_CONFLICT');
      if (old.actor !== args.p_actor) this.fail('42501', 'ACTOR_MISMATCH');
      if (writer && !old.writer) {
        if (BigInt(args.p_writer_seq) !== BigInt(writer.accepted)+1n) this.fail('40001','WRITER_SEQUENCE_CONFLICT');
        old.writer=args.p_writer;old.writerSeq=args.p_writer_seq;writer.accepted=args.p_writer_seq;
      } else if ((old.writer??null)!==(args.p_writer??null) || (old.writerSeq??null)!==(args.p_writer_seq??null)) this.fail('22023','WRITER_SEQUENCE_CONFLICT');
      return { seq: old.seq, duplicate: true };
    }
    if (!writer && this.writers.size) this.fail('22023','WRITER_REQUIRED');
    if (writer && BigInt(args.p_writer_seq) !== BigInt(writer.accepted) + 1n) this.fail('40001', 'WRITER_SEQUENCE_CONFLICT');
    if (this.log.some(u => u.updateId === args.p_update_id)) this.fail('22023', 'UPDATE_ID_CONFLICT');
    if (args.p_expected_head !== this.head) this.fail('40001', 'HEAD_CONFLICT');
    if (this.capacity || this.receipts.size >= 4096 || this.log.reduce((sum, u) => sum + Buffer.from(u.bytes, 'base64').length, 0) + bytes.length > 1048576) this.fail('54000', 'QUOTA_EXCEEDED');
    this.head = String(BigInt(this.head) + 1n);
    this.title = args.p_title ?? '隊列表'; this.titleSeq = this.head;
    this.log.push({ seq: this.head, updateId: args.p_update_id, actor: args.p_actor, bytes: bytes.toString('base64') });
    this.receipts.set(args.p_update_id, { seq: this.head, digest, actor: args.p_actor, writer: args.p_writer, writerSeq: args.p_writer_seq });
    if (writer) writer.accepted = args.p_writer_seq;
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
    for (const invite of this.invites.values()) if (invite.issuedBy === actor && !invite.revoked && invite.expiresAt > Date.now() && (invite.multiUse || !invite.usedBy)) invite.revoked = true;
    if (actor === this.creator) {
      for (const member of this.members.keys()) if (member !== actor) this.departures.set(member, 'ended');
      this.members.clear(); this.deleted = true; this.created = false; this.base = null; this.log = []; this.receipts.clear(); this.invites.clear();
    } else this.members.delete(actor);
    this.users.delete(actor); this.rotate(actor);
  }
}

export async function startMockServer(backend, createHandler, origin = process.env.COLLABORATION_TEST_ORIGIN ?? 'http://127.0.0.1:5179', extra = {}) {
  if (new URL(origin).hostname !== '127.0.0.1' || new URL(origin).protocol !== 'http:') throw new Error('Loopback test origin only');
  const handler = createHandler(backend, [origin]);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (extra.ephemeral && url.pathname === '/ephemeral') { await extra.ephemeral(req, res, url); return; }
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
        const input = JSON.parse(body), session = backend.guest(input.data?.display_name);
        if (input.email) {
          backend.users.get(session.user.id).is_anonymous = false;
          backend.details.get(session.user.id).isGuest = false;
          session.user.is_anonymous = false; session.user.email = input.email;
        }
        res.end(JSON.stringify(session)); return;
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const input = JSON.parse(body);
        if (input.email !== 'session-test@example.invalid' || input.password !== 'mock-pass') { res.writeHead(400).end(JSON.stringify({error:'invalid_credentials'})); return; }
        res.end(JSON.stringify({access_token:actors[0],refresh_token:'mock-login-refresh',expires_in:3600,token_type:'bearer',user:{id:actors[0],email:input.email,user_metadata:{display_name:'試験アカウント'}}})); return;
      }
      const actor = req.headers.authorization?.replace(/^Bearer /, '');
      if (!await backend.authenticate(actor)) { res.writeHead(401).end(JSON.stringify({ error: 'NOT_AUTHENTICATED' })); return; }
      if (url.pathname === '/auth/v1/logout') { res.writeHead(204).end(); return; }
      if (url.pathname === '/rest/v1/rpc/delete_current_account') {
        const input = JSON.parse(body);
        if (input.p_confirmation !== 'DELETE_MY_ACCOUNT') { res.writeHead(400).end(); return; }
        backend.deleteAccount(actor);
        res.end(JSON.stringify([{ success: true, reason: 'DELETED', deleted_project_count: 0, transferred_project_count: 0 }])); return;
      }
      if (url.pathname === '/rest/v1/collab_v2_members') {
        const id = url.searchParams.get('document_id'), user = url.searchParams.get('user_id');
        const membership = id === `eq.${documentId}` && user === `eq.${actor}` ? backend.members.get(actor) : null;
        res.end(JSON.stringify(membership ? [{ membership_generation: membership }] : [])); return;
      }
      const input = JSON.parse(body);
      if (extra.restore && url.pathname === '/functions/v1/collab-restore' || extra.maintenance && url.pathname === '/functions/v1/collab-maintenance') {
        const handler = url.pathname.endsWith('collab-restore') ? extra.restore : extra.maintenance;
        const response = await handler(new Request('http://mock.invalid' + url.pathname, {
          method: 'POST', headers: { authorization: `Bearer ${actor}`, 'content-type': 'application/json', origin }, body }));
        if (url.pathname.endsWith('collab-restore') && backend.loseRestoreReply && input.action === 'restore' && response.ok) {
          // Deterministically lose the successful receipt, after DB commit.
          // A socket close can be transparently retried by Chromium itself.
          backend.loseRestoreReply = false; res.writeHead(503).end(JSON.stringify({error:'SERVER_UNAVAILABLE'})); return;
        }
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      if (url.pathname === '/functions/v1/collab-maintenance') {
        // Pre-maintenance browser scenarios have no scheduled work; keep their
        // protocol complete without introducing a second snapshot implementation.
        backend.requireMember(actor);
        res.end(JSON.stringify({result:'NOOP'})); return;
      }
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
