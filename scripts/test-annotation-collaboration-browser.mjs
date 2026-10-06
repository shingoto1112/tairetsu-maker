import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { MockCollabBackend, startMockServer, actors, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';
import { loadCollabRuntime } from './testing/load-collab-runtime.mjs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import * as Y from 'yjs';
const origin = 'http://127.0.0.1:5195', inert = `${origin}/__lines_test__`;
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5195, strictPort: true }, logLevel: 'warn' }); await vite.listen();
const { createHandler, RpcError } = await loadCollabEdge();
const backend = new MockCollabBackend(null, RpcError, { fresh: true }), server = await startMockServer(backend, createHandler, origin);
const browser = await chromium.launch({ headless: true }), pages = [], errors = [], checks = [];
const line = { x1: 1, y1: 2, x2: 8, y2: 6, color: 'red', dash: 'dashed' };
const call = (i, method, ...args) => pages[i].evaluate(({ method, args }) => window.harness[method](...args), { method, args });
const converge = async () => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if ((await Promise.all([call(0, 'state'), call(1, 'state')])).every(s => s.cursor === backend.head && !s.pending)) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Line convergence timeout');
};
const lines = async i => (await call(i, 'read')).project.frames[0].annotationLines;
const offlineEdit = async edits => {
  await Promise.all([call(0, 'online', false), call(1, 'online', false)]);
  await Promise.all(edits.map(([i, id, value]) => call(i, 'line', id, value)));
  await Promise.all([call(0, 'online', true), call(1, 'online', true)]); await converge();
  assert.deepEqual(await lines(0), await lines(1));
};
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext(); await context.grantPermissions(['local-network-access'], { origin });
    await context.route('**/*', route => {
      const u = new URL(route.request().url()); if (![origin, server.url].includes(u.origin)) return route.abort();
      if (u.href === inert) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Annotation local test</title>' });
      return route.continue();
    });
    const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message)); await page.goto(inert);
    await page.evaluate(async options => { const { createLifecycleHarness } = await import('/src/collaboration/testing/lifecycleHarness.ts'); window.harness = await createLifecycleHarness(options); },
      { url: server.url, actor: i ? undefined : actors[0], dbName: `line-collab-${i}-${Date.now()}` });
  }
  await call(0, 'startSharing'); await call(1, 'join', (await call(0, 'invite', documentId)).link); await converge();
  await offlineEdit([[0, 'line-a', line], [1, 'line-b', { ...line, color: 'blue' }]]);
  assert.deepEqual(Object.keys(await lines(0)).sort(), ['line-a', 'line-b']); checks.push('2-device different-line edits through mock Edge');
  await offlineEdit([[0, 'line-a', { ...line, color: 'green', x1: 3 }], [1, 'line-a', { ...line, color: 'black', y2: 10 }]]);
  const winner = (await lines(0))['line-a'];
  assert([{ ...line, color: 'green', x1: 3 }, { ...line, color: 'black', y2: 10 }].some(v => JSON.stringify(v) === JSON.stringify(winner)));
  checks.push('same-line edits stay atomic');
  await offlineEdit([[0, 'line-a', null], [1, 'line-a', { ...line, x1: 5 }]]); assert(!('line-a' in await lines(0))); checks.push('deletion wins over disconnected movement');
  await call(1, 'undoLine'); await converge(); assert(!('line-a' in await lines(0))); checks.push('Undo cannot undo remote deletion');
  const id = await call(1, 'id'); await call(1, 'close');
  await pages[1].evaluate(async options => { const { createLifecycleHarness } = await import('/src/collaboration/testing/lifecycleHarness.ts'); window.harness = await createLifecycleHarness(options); },
    { url: server.url, dbName: (await pages[1].evaluate(() => indexedDB.databases())).find(d => d.name.startsWith('line-collab-1-')).name, localId: id });
  await converge(); assert.deepEqual(await lines(0), await lines(1)); checks.push('durable browser reconnect');
  // Run the actual build-24 closed validator, read-only from Git, with its own vocabulary.
  const runtime = await loadCollabRuntime();
  try {
    const oldSchema = execFileSync('git', ['show', 'b5f4076:src/collaboration/projectSchema.ts'], { encoding: 'utf8' });
    const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64');
    const oldValidator = execFileSync('git', ['show', 'b5f4076:src/collaboration/serverSchema2.ts'], { encoding: 'utf8' }).replace('"yjs"', JSON.stringify(import.meta.resolve('yjs'))).replace('"./projectSchema.ts"', JSON.stringify(moduleUrl(oldSchema)));
    const { assertFullState } = await import(moduleUrl(oldValidator));
    const { createSharedDocument } = await runtime.loadSource('src/collaboration/model.ts');
    const fixture = JSON.parse(await readFile('src/repositories/contract/fixtures/projects.json', 'utf8')).stage;
    const p = runtime.normalization.normalizeProject(fixture); p.frames[0].annotationLines = { line };
    const doc = createSharedDocument(p); try { assert.throws(() => assertFullState(doc), /INVALID_UPDATE/); } finally { doc.destroy(); }
    checks.push('actual build24 b5f4076 validator rejects line-containing v2 state');
  } finally { await runtime.dispose(); }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ checks, errors, productionNetwork: false }));
} finally {
  await Promise.all(pages.map(p => p.evaluate(() => window.harness?.close()).catch(() => {})));
  await browser.close(); await server.close(); await vite.close();
}
