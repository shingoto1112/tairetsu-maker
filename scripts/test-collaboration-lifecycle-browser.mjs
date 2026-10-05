import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { MockCollabBackend, startMockServer, actors, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

const origin = process.env.REPOSITORY_TEST_ORIGIN ?? 'http://127.0.0.1:5179', inert = `${origin}/__lifecycle_test__`;
const testUrl = new URL(origin);
assert(testUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(testUrl.hostname));
const { createHandler, RpcError } = await loadCollabEdge();
const browser = await chromium.launch({ headless: true }), checks = [];
async function scenario(accountDeletion) {
  const backend = new MockCollabBackend(null, RpcError, { fresh: true }), server = await startMockServer(backend, createHandler, origin);
  const contexts = [], pages = [], dbs = [0,1].map(() => `lifecycle-test-${randomUUID()}`), errors = [];
  const load = async (i, localId) => {
    await pages[i].goto(inert);
    await pages[i].evaluate(async options => {
      const { createLifecycleHarness } = await import('/src/collaboration/testing/lifecycleHarness.ts');
      window.harness = await createLifecycleHarness(options);
    }, { url: server.url, actor: i ? undefined : actors[0], dbName: dbs[i], localId });
  };
  const call = (i, method, ...args) => pages[i].evaluate(({ method, args }) => window.harness[method](...args), { method, args });
  const until = async (predicate, label) => {
    const deadline = Date.now() + 12000;
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`Timeout: ${label}; states=${JSON.stringify(await Promise.all([call(0,'state'), call(1,'state')]))}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const converged = () => until(async () => (await Promise.all([call(0,'state'),call(1,'state')])).every(s => s.cursor === backend.head && !s.pending), 'convergence');
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext(); contexts.push(context);
      await context.grantPermissions(['local-network-access'], { origin });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (![origin, server.url].includes(url.origin)) return route.abort('blockedbyclient');
        if (url.href === inert) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Lifecycle API test</title>' });
        return route.continue();
      });
      const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message)); await load(i);
    }
    await call(0, 'startSharing'); const invite = await call(0, 'invite', documentId);
    assert(!new URL(invite.link).search); assert.equal(backend.members.size, 1);
    await call(1, 'join', invite.link); const guest = await call(1, 'auth'), oldId = await call(1, 'id');
    assert.equal(guest.isGuest, true); assert.equal(backend.members.size, 2);
    assert.equal((await call(0,'members',documentId)).find(m => m.userId === guest.userId).isGuest, true);
    await converged(); checks.push('create -> fragment invite -> Web anonymous join -> durable new local record');
    // Browser restart with sessionStorage empty must recover the SAME guest ID.
    await call(1,'close'); await pages[1].evaluate(() => sessionStorage.clear()); await load(1, oldId);
    assert.equal((await call(1,'auth')).userId, guest.userId);
    await Promise.all([call(0,'online',false),call(1,'online',false)]);
    await Promise.all([call(0,'move','m_001',10),call(1,'move','m_002',20)]);
    await Promise.all([call(0,'online',true),call(1,'online',true)]); await converged();
    for (const i of [0,1]) { const r = await call(i,'read'); assert.equal(r.project.frames[0].positions.m_001.x,10); assert.equal(r.project.frames[0].positions.m_002.x,20); }
    checks.push('persistent guest session + simultaneous edits converge');
    if (!accountDeletion) {
      const guestInvite = await call(1,'invite',documentId), head = backend.head;
      await call(1,'online',false); await call(1,'move','m_002',99);
      await call(0,'remove',documentId,guest.userId); await call(1,'online',true);
      await until(async () => (await call(1,'state')).sharing === 'removed', 'removed state');
      assert.equal(backend.head,head);
      await call(0,'move','m_001',30); await until(async () => (await call(0,'state')).cursor === backend.head, 'creator sync');
      assert.equal((await call(1,'read')).project.frames[0].positions.m_001.x,10);
      assert.equal((await call(1,'read')).collaboration.outbox.at(-1).status,'pending');
      const rescue = await call(1,'rescue'); assert.equal(rescue.project.frames[0].positions.m_002.x,99); assert.equal(rescue.collaboration,null);
      assert.deepEqual(await call(0,'joinExtra',guestInvite.link),{joined:false,code:'INVALID_INVITE'});
      checks.push('removed guest cannot send/receive; original bytes and independent rescue remain; issuer invite revoked');
      await call(1,'join',(await call(0,'invite',documentId)).link);
      assert.notEqual(await call(1,'id'),oldId); assert.equal((await call(1,'lifecycleState',oldId)).status,'membership-changed');
      assert.equal((await call(1,'read',oldId)).collaboration.outbox.at(-1).status,'pending');
      await converged(); checks.push('rejoin creates new attachment; old outbox remains bound to old membership');
      const expired = await call(0,'invite',documentId);
      [...backend.invites.values()].find(i => i.inviteId === expired.inviteId).expiresAt = Date.now()-1;
      assert.equal((await call(1,'joinExtra',expired.link)).code,'INVALID_INVITE');
      const revoked = await call(0,'invite',documentId); await call(1,'revoke',documentId,revoked.inviteId);
      assert.equal((await call(0,'joinExtra',revoked.link)).code,'INVALID_INVITE');
      assert.equal((await call(0,'joinExtra',invite.link)).joined,true);
      for (let i=0;i<4;i++) assert.equal((await call(i%2,'joinExtra',invite.link)).joined,true);
      assert.equal(backend.members.size,7);
      const raceInvites = [await call(0,'invite',documentId),await call(1,'invite',documentId)];
      const race = await Promise.all([call(0,'joinExtra',raceInvites[0].link),call(1,'joinExtra',raceInvites[1].link)]);
      assert.equal(race.filter(r=>r.joined).length,1); assert.equal(race.find(r=>!r.joined).code,'MEMBER_LIMIT'); assert.equal(backend.members.size,8);
      assert.equal((await call(0,'joinExtra',(await call(0,'invite',documentId)).link)).code,'MEMBER_LIMIT');
      checks.push('expired/revoked invites denied; multi-use link admits multiple people; 8th/9th simultaneous race admits only one');
      await call(0,'deleteShared',documentId);
    } else {
      backend.deleteAccount(actors[0]);
      checks.push('creator account deletion cascades cloud document and leaves guest local copy');
    }
    await until(async () => (await call(1,'state')).sharing === 'ended','sharing ended');
    assert.equal((await call(1,'lifecycleState')).message,'共有が終了しました。この端末のコピーは残っています');
    assert(await call(1,'read')); assert.equal((await call(1,'state')).realtimeConnected,false);
    assert.deepEqual(errors,[]); checks.push('cloud end is distinct from local delete; provider stops both lanes');
  } finally {
    for (const page of pages) await page.evaluate(() => window.harness?.close()).catch(() => {});
    for (const [i,page] of pages.entries()) await page.evaluate(name => new Promise((resolve,reject) => {
      const request = indexedDB.deleteDatabase(name); request.onsuccess=resolve; request.onerror=reject; request.onblocked=reject;
    }),dbs[i]);
    for (const context of contexts) await context.close(); await server.close();
    console.log('LIFECYCLE_BROWSER_CLEANUP',JSON.stringify({ deletedDatabases:pages.length,mockStopped:true }));
  }
}
try {
  await scenario(false); await scenario(true);
  console.log('LIFECYCLE_BROWSER',JSON.stringify({ checks,activeBrowsers:2,productionNetwork:false,chromium:browser.version() }));
} finally { await browser.close(); }
