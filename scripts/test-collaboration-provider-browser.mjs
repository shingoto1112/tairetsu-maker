import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { MockCollabBackend, startMockServer, actors, memberships, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

const origin = 'http://127.0.0.1:5179'; // Never starts/stops the user's Vite server.
const { createHandler, RpcError } = await loadCollabEdge();
const fixture = JSON.parse(await readFile('src/repositories/contract/fixtures/collaboration.json', 'utf8'));
const backend = new MockCollabBackend(fixture.initial.base, RpcError);
const server = await startMockServer(backend, createHandler);
const browser = await chromium.launch({ headless: true });
const contexts = [], pages = [], dbNames = [0, 1].map(() => `provider-test-${randomUUID()}`), errors = [], checks = [];
const inert = `${origin}/__provider_test__`;
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 12_000;
  while (!await predicate()) { if (Date.now() > deadline) {
    console.error('TIMEOUT_STATE', JSON.stringify({ head: backend.head, requests: backend.requests, states: await Promise.all(pages.map((_, i) => state(i))) }));
    throw new Error(`Timeout: ${label}`);
  } await new Promise(resolve => setTimeout(resolve, 30)); }
};
const load = async i => {
  await pages[i].goto(inert);
  await pages[i].evaluate(async options => {
    const { createProviderHarness } = await import('/src/collaboration/testing/providerHarness.ts');
    window.harness = await createProviderHarness(options);
  }, { url: server.url, actor: actors[i], membership: memberships[i], documentId, dbName: dbNames[i] });
};
const state = i => pages[i].evaluate(() => window.harness.state());
const position = (i, member) => pages[i].evaluate(async m => (await window.harness.read()).project.frames[0].positions[m]?.x, member);
const synced = async () => waitFor(async () => {
  const states = await Promise.all([state(0), state(1)]);
  return states.every(s => s.cursor === backend.head && s.pending === 0);
}, 'durable convergence');
const move = (i, member, x, commit = true) => pages[i].evaluate(args => window.harness.move(...args), [member, x, commit]);
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext(); contexts.push(context);
    await context.grantPermissions(['local-network-access'], { origin });
    // Network guard: only the existing Vite server and this test's random mock port.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (![origin, server.url].includes(url.origin)) return route.abort('blockedbyclient');
      if (url.href === inert) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Provider test</title>' });
      return route.continue();
    });
    const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message));
    await load(i);
  }
  // Keep provider stopped while inspecting a dirty update: it must see ONLY committed outbox.
  const dirty = await move(0, 'm_001', 10, false);
  backend.delayPullMs = 1000;
  await pages[0].evaluate(() => window.harness.start());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(backend.requests.length, 0);
  assert.equal((await pages[0].evaluate(() => window.harness.read())).collaboration.outbox.length, 0);
  await pages[0].evaluate(() => window.harness.flush()); backend.delayPullMs = 0;
  await pages[1].evaluate(() => window.harness.start()); await synced();
  assert.equal(await position(1, 'm_001'), 10); checks.push('A move -> B, committed outbox only');
  assert.equal(backend.requests[0].updateId, dirty.updateId);

  await contexts[1].setOffline(true); await pages[1].evaluate(() => window.harness.online(false));
  await move(1, 'm_001', 20);
  await pages[1].evaluate(() => window.harness.close());
  await contexts[1].setOffline(false); await load(1); await pages[1].evaluate(() => window.harness.start());
  await synced(); assert.equal(await position(0, 'm_001'), 20); checks.push('B offline edit -> restart -> reconnect -> A');

  for (const i of [0, 1]) await pages[i].evaluate(() => window.harness.online(false));
  await Promise.all([move(0, 'm_001', 30), move(1, 'm_002', 40)]);
  for (const i of [0, 1]) await pages[i].evaluate(() => window.harness.online(true));
  await synced(); for (const i of [0, 1]) { assert.equal(await position(i, 'm_001'), 30); assert.equal(await position(i, 'm_002'), 40); }
  checks.push('simultaneous different members retained');

  for (const i of [0, 1]) await pages[i].evaluate(() => window.harness.online(false));
  await Promise.all([move(0, 'm_001', 50), move(1, 'm_001', 60)]);
  for (const i of [0, 1]) await pages[i].evaluate(() => window.harness.online(true));
  await synced(); assert.equal(await position(0, 'm_001'), await position(1, 'm_001')); checks.push('same member concurrent moves converge');

  backend.dropNotices = true; backend.delayPullMs = 80;
  await move(0, 'm_001', 70); await synced(); assert.equal(await position(1, 'm_001'), 70);
  for (const event of [...backend.notices].reverse()) { backend.deliver(event); backend.deliver(event); }
  await synced(); assert.equal(await position(1, 'm_001'), 70); checks.push('missing, delayed, duplicate, reordered notices recover by poll');
  backend.dropNotices = false; backend.delayPullMs = 0;

  backend.delayAckMs = 1500;
  const before = backend.receipts.size, update = await move(0, 'm_001', 80);
  await waitFor(() => backend.receipts.has(update.updateId), 'DB commit before ACK');
  await pages[0].evaluate(() => window.harness.stop()); // Abort after DB commit, before ACK recording.
  assert.equal((await pages[0].evaluate(() => window.harness.read())).collaboration.outbox.find(u => u.updateId === update.updateId).status, 'pending');
  await pages[0].evaluate(() => window.harness.close());
  backend.delayAckMs = 0; await load(0); await pages[0].evaluate(() => window.harness.start()); await synced();
  assert.equal(backend.receipts.size, before + 1);
  const retries = backend.requests.filter(u => u.updateId === update.updateId);
  assert(retries.length >= 2); assert(retries.every(u => u.bytes === update.bytes)); checks.push('lost ACK + restart retries identical ID/bytes without double append');

  backend.failNext = { status: 429, code: 'WORKER_BUSY' };
  const rate = await move(0, 'm_001', 90); await synced();
  assert(backend.requests.filter(u => u.updateId === rate.updateId).length >= 2); checks.push('429 backoff retains fixed request');

  backend.rotate(actors[0]); await move(1, 'm_002', 95); await synced();
  assert.equal(await position(0, 'm_002'), 95); checks.push('ACL/topic rotation resubscribes');

  await pages[1].evaluate(() => window.harness.online(false)); const stale = await move(1, 'm_002', 100);
  backend.rotate(actors[1], true); await pages[1].evaluate(() => window.harness.close()); await load(1);
  await pages[1].evaluate(() => window.harness.start());
  await waitFor(async () => (await state(1)).held, 'membership held');
  assert(!backend.requests.some(u => u.updateId === stale.updateId));
  assert.equal(await position(1, 'm_002'), 100); checks.push('rejoin generation holds old outbox across restart');
  assert.deepEqual(errors, []);
  console.log('PROVIDER_BROWSER', JSON.stringify({ checks, contexts: 2, receipts: backend.receipts.size, requests: backend.requests.length, chromium: browser.version(), productionNetwork: false }));
} finally {
  for (const page of pages) if (!page.isClosed()) await page.evaluate(() => window.harness?.close()).catch(() => {});
  // Only randomly named isolated test DBs, no user's profile.
  const cleanupErrors = [];
  for (const [i, page] of pages.entries()) if (!page.isClosed()) await page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = reject; request.onblocked = reject;
  }), dbNames[i]).catch(error => cleanupErrors.push(error.message));
  for (const context of contexts) await context.close(); await browser.close(); await server.close();
  assert.deepEqual(cleanupErrors, [], 'Test database cleanup failed');
  console.log('PROVIDER_BROWSER_CLEANUP', JSON.stringify({ deletedDatabases: pages.length, mockStopped: true }));
}
