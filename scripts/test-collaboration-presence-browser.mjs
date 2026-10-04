import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MockCollabBackend, startMockServer, actors, memberships, documentId } from './testing/mock-collab-server.mjs';
import { mockEphemeralRelay } from './testing/mock-ephemeral-relay.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

process.env.VITE_COLLABORATION_V2 = '1';
const origin = 'http://127.0.0.1:5189';
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5189, strictPort: true }, logLevel: 'warn' });
await vite.listen();
const { createHandler, RpcError } = await loadCollabEdge();
const backend = new MockCollabBackend(null, RpcError);
const people = [...actors, ...Array.from({ length: 3 }, randomUUID)], generations = [...memberships, ...Array.from({ length: 3 }, randomUUID)];
people.forEach((id, i) => { backend.users.set(id, { id, is_anonymous: false }); backend.members.set(id, generations[i]); backend.details.set(id, { displayName: `参加者${i + 1}`, isGuest: false }); });
const relay = mockEphemeralRelay(backend, documentId), server = await startMockServer(backend, createHandler, origin, { ephemeral: relay.handler });
const shotDir = process.env.PRESENCE_SHOT_DIR ?? 'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-10';
const browser = await chromium.launch({ headless: true }), contexts = [], pages = [], errors = [], denied = [], shots = [], checks = [], measurements = {};
const base = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json', 'utf8')).stage;
const ids = Array.from({ length: 146 }, randomUUID);
const fixture = { ...base, title: '一時表示の匿名試験', members: ids.map((id, i) => ({ id, name: `M${i + 1}`, color: '#2563eb', visible: true, zIndex: 20 })), memberGroups: [], objectGroups: [], movementPaths: [], movementPlans: [],
  frames: [0, 1].map(i => ({ id: `scene_${i}`, label: `シーン${i + 1}`, timeSec: i * 10,
    positions: Object.fromEntries(ids.map((id, n) => [id, { x: .7 + n % 19 * .56, y: .5 + Math.floor(n / 19) * .6 }])),
    objectStates: { o_001: { objectId: 'o_001', x: 3, y: 2, widthMeters: 1, heightMeters: 1, rotation: 10, visible: true, zIndex: 10 } }, memberVisibility: {}, objectAssignments: {} })) };
const until = async (fn, label, timeout = 12000) => { const end = Date.now() + timeout; while (!await fn()) { if (Date.now() > end) throw Error(`Timeout: ${label}; errors=${JSON.stringify(errors)}`); await new Promise(r => setTimeout(r, 40)); } };
const ephemeral = (i, fn, arg) => pages[i].evaluate(({ fn, arg }) => new Function('s', 'arg', `return (${fn})(s,arg)`)(window.__sharedSession.active.ephemeral, arg), { fn: fn.toString(), arg });
const snapshot = i => pages[i].evaluate(async () => {
  const owner = window.__sharedSession.active;
  const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts'); const r = new IndexedDbProjectRepository(); await r.initialize();
  try { return { record: await r.get(owner.localId), project: owner.editor.project, undo: owner.editor.commands.undoManager.undoStack.length, redo: owner.editor.commands.undoManager.redoStack.length }; } finally { r.close(); }
});
const begin = async (i, selection = ids) => ephemeral(i, (s, selection) => { const p = s.options.project(), f = p.frames[0]; s.begin(f.id, selection.filter(id => f.positions[id] && p.members.some(m => m.id === id)).map(id => ['member', id, f.positions[id].x, f.positions[id].y])); s.latest(.5, .25); }, selection);
async function addPage(i, data) {
  const context = await browser.newContext({ viewport: { width: 1376, height: 1032 } }); contexts.push(context);
  await context.addInitScript(() => { window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject(renderer) { this.renderers.set(1, renderer); return 1; }, onCommitFiberRoot() {}, onCommitFiberUnmount() {} }; });
  await context.grantPermissions(['local-network-access'], { origin });
  await context.addInitScript(config => { window.__sharedSessionMock = config; }, { url: server.url, anonKey: 'mock-public-key' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (![origin, server.url].includes(url.origin) && !['data:', 'blob:'].includes(url.protocol)) { denied.push(url.origin); return route.abort(); }
    if (url.href === `${origin}/__seed__`) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>匿名モック試験</title>' });
    return route.continue();
  });
  const page = await context.newPage(); pages[i] = page; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/__seed__`);
  const seeded = await page.evaluate(async ({ fixture, data, actor, membership, documentId }) => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const { createSharedDocument } = await import('/src/collaboration/model.ts'); const { createCollaborationData } = await import('/src/collaboration/persistence.ts');
    const { saveCloudAuthSession } = await import('/src/cloud/session.ts');
    saveCloudAuthSession({ accessToken: actor, refreshToken: 'mock-refresh', tokenType: 'bearer', expiresAt: Date.now() + 3600000, user: { id: actor, email: 'anonymous@example.invalid' } });
    const r = new IndexedDbProjectRepository(); await r.initialize();
    if (!data) { const doc = createSharedDocument(fixture); data = createCollaborationData(doc); doc.destroy(); }
    data = { ...data, sharedDocumentId: documentId, transportBinding: { accountId: actor, membershipGeneration: membership } };
    await r.commit({ project: fixture, collaboration: data, localRevision: '1', expectedRepositoryRevision: null, operationId: crypto.randomUUID() }); r.close(); return data;
  }, { fixture, data, actor: people[i], membership: generations[i], documentId });
  await page.goto(`${origin}/?runtime=capacitor-ios`); await page.getByRole('button', { name: '一時表示の匿名試験を開く', exact: true }).click();
  await until(() => page.evaluate(() => !!window.__sharedSession?.active?.ephemeral), 'session installed');
  await until(() => ephemeral(i, s => s.getSnapshot().mode === 'A'), 'mock A ready'); return seeded;
}
async function observeRenders(page) {
  await page.evaluate(() => {
    window.__renderCounts = { app: 0, thumbnail: 0 };
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) throw Error('Missing test-only React hook');
    hook.onCommitFiberRoot = (_id, root) => {
      const visit = f => {
        if (!f) return;
        if ((f.flags & 1) && (f.type?.name === 'App' || f.type?.displayName === 'App')) window.__renderCounts.app++;
        if ((f.flags & 1) && f.stateNode?.tagName?.toLowerCase() === 'svg' && f.stateNode.closest('.scene-thumbnail-card')) window.__renderCounts.thumbnail++;
        visit(f.child); visit(f.sibling);
      }; visit(root.current);
    };
  });
}
try {
  await mkdir(shotDir, { recursive: true });
  let data = await addPage(0); backend.base = data.base; backend.generation = data.generation;
  await addPage(1, data);
  await until(() => ephemeral(0, s => s.getSnapshot().participants.length > 0), '2 browser presence');
  await until(() => pages[1].locator('.remote-avatar').count().then(n => n > 0), 'participant icons', 22000).catch(async error => {
    console.log('PRESENCE_DIAGNOSTIC', JSON.stringify({ sessions: await Promise.all([0, 1].map(i => ephemeral(i, s => ({ snapshot: s.getSnapshot(), sceneId: s.sceneId, metrics: s.metrics.sent })))), records: relay.records.map(r => ({ actor: people.indexOf(r.actor), type: r.type })), dom: await pages[1].locator('.toolbar').innerText() })); throw error;
  });
  await pages[1].waitForTimeout(500);
  const before = await snapshot(1); await observeRenders(pages[1]);
  relay.state.drop.add('start'); await begin(0); await pages[1].waitForTimeout(600); assert.equal(await ephemeral(1, s => s.drags.size), 0);
  relay.state.drop.clear(); await until(() => ephemeral(1, s => s.drags.size === 1), 'lost start renewal');
  relay.state.duplicate = true; relay.state.reverse = true;
  for (let i = 0; i < 40; i++) { await ephemeral(0, (s, i) => s.latest(i / 40, .2), i); await pages[0].waitForTimeout(20); }
  relay.flushReverse(); relay.state.reverse = false; relay.state.duplicate = false;
  assert.deepEqual(await snapshot(1), before);
  measurements.previewRenders = await pages[1].evaluate(() => window.__renderCounts);
  assert.equal(measurements.previewRenders.app, 0); assert.equal(measurements.previewRenders.thumbnail, 0);
  checks.push('2 independent browsers: lost start, reverse/duplicate, Project/Undo/revision/outbox/cursor isolation and zero App/thumbnail SVG renders');
  await addPage(2, data); await addPage(3, data); await addPage(4, data);
  await until(() => ephemeral(4, s => s.drags.size > 0), 'late join sees renewed 146-target start');
  await begin(1, [ids[8]]); await until(() => ephemeral(2, s => s.drags.size === 2), 'same-target concurrent previews');
  await until(() => pages[2].locator(`.remote-target.is-dragging[data-remote-target="${ids[8]}"]`).count().then(n => n === 2), 'separate colored concurrent borders').catch(async error => {
    console.log('BORDER_DIAGNOSTIC', JSON.stringify(await pages[2].evaluate(() => ({ count: document.querySelectorAll('.remote-target').length, drags: window.__sharedSession.active.ephemeral.drags.size, participants: window.__sharedSession.active.ephemeral.getSnapshot(), rect: document.querySelector('.stage-surface')?.getBoundingClientRect(), viewport: document.querySelector('.stage-fit-area')?.getBoundingClientRect(), root: document.querySelector('.remote-interaction-layer')?.outerHTML.slice(0, 1000) })))); throw error;
  });
  checks.push('5 independent browsers, late join, concurrent same-target previews');
  // Sample frames during sustained latest-only traffic, no transport gate bypass.
  await pages[0].evaluate(() => { window.__frames = []; window.__running = true; const step = time => { window.__frames.push(time); if (window.__running) requestAnimationFrame(step); }; requestAnimationFrame(step); });
  const measureStart = Date.now(), sendsBefore = relay.records.length;
  for (let i = 0; i < 100; i++) { await ephemeral(0, (s, i) => s.latest(.25 + i % 8 / 20, .15), i); await pages[0].waitForTimeout(20); }
  const duration = Date.now() - measureStart;
  measurements.frames = await pages[0].evaluate(() => { window.__running = false; const f = window.__frames; return { fps: (f.length - 1) / ((f.at(-1) - f[0]) / 1000), count: f.length }; });
  measurements.sendCount = relay.records.length - sendsBefore; measurements.durationMs = duration;
  measurements.sessions = await Promise.all(pages.map((_, i) => ephemeral(i, s => ({ metrics: { ...s.metrics, localMs: undefined, latencyMs: undefined, rafMs: undefined }, p95: s.measurements, state: s.getSnapshot().mode }))));
  measurements.payload = { startMax: Math.max(...relay.records.filter(r => r.type === 'start').map(r => r.bytes)), moveMax: Math.max(...relay.records.filter(r => r.type === 'move').map(r => r.bytes)) };
  assert(measurements.payload.startMax <= 16384 && measurements.payload.moveMax <= 512);
  const aRecords = relay.records.filter(r => r.actor === people[0]);
  assert(aRecords.slice(1).every((r, i) => r.time - aRecords[i].time >= 315), 'all sends share <=3Hz gate (scheduling tolerance 18ms)');
  checks.push('payload bytes, fps, rAF time, send count and shared 3Hz gate measured');
  // Move and end loss expire without altering durable state; ended drag cannot revive.
  const oldStart = relay.records.findLast(r => r.actor === people[0] && r.type === 'start').message;
  relay.state.drop.add('stop'); await ephemeral(0, s => s.finish()); await pages[2].waitForTimeout(3300); assert.equal(await ephemeral(2, s => [...s.drags.values()].some(d => d.actorId === s.transport.members()[0].actorId)), false); relay.state.drop.clear();
  relay.inject(people[0], { ...oldStart, type: 'move', seq: oldStart.seq - 1, dx: 99, dy: 99 });
  await ephemeral(1, s => s.cancel());
  checks.push('missing stop expires after 3s; stale moves ignored');
  // Actual Stage pointer route and local operation samples, then cancel preview.
  await pages[0].locator('body').click({ position: { x: 2, y: 2 } }); await pages[0].keyboard.press('ControlOrMeta+A');
  const member = pages[0].locator('.member-token').nth(8); const box = await member.boundingBox(); assert(box);
  await pages[0].mouse.move(box.x + box.width / 2, box.y + box.height / 2); await pages[0].mouse.down();
  await pages[0].mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 15, { steps: 24 });
  assert.equal(await ephemeral(0, s => s.local?.targets.length), 146);
  await pages[0].waitForTimeout(450); await pages[0].mouse.up();
  measurements.stageLocal = await ephemeral(0, s => s.measurements); assert(measurements.stageLocal.localP95 >= 0);
  await until(() => pages[1].evaluate(id => window.__sharedSession.active.editor.project.frames[0].positions[id].x > 5.18, ids[8]), 'actual Stage drag committed remotely');
  checks.push('actual Stage pointer notification + durable edit + operation timing');
  relay.state.drop.add('move'); await begin(0); await ephemeral(0, s => s.latest(.75, .4));
  await until(() => ephemeral(1, s => [...s.drags.values()].some(d => d.start.dx === .75 && d.start.dy === .4)), 'lost move repaired by cumulative self-contained start');
  relay.state.drop.clear(); await ephemeral(0, s => s.cancel());
  await pages[1].locator('.scene-thumbnail-card').nth(1).click();
  await until(() => ephemeral(1, s => s.sceneId === 'scene_1' && s.drags.size === 0), 'actual scene switch clears preview');
  assert.equal(await pages[1].locator('.remote-target.is-dragging').count(), 0);
  await pages[1].locator('.scene-thumbnail-card').nth(0).click();
  await until(() => ephemeral(1, s => s.sceneId === 'scene_0'), 'scene return');
  checks.push('lost move repaired by renewed start; actual scene switch immediately clears previews');
  // Save failure preserves editable draft, matching update only waits for durability/TTL.
  await pages[0].evaluate(() => { const o = window.__sharedSession.active; window.__oldCommit = o.coordinator.repository.commit.bind(o.coordinator.repository); o.coordinator.repository.commit = async () => { const { RepositoryError } = await import('/src/repositories/types.ts'); throw new RepositoryError('NO_SPACE'); }; o.editor.edit(p => ({ ...p, title: '保存失敗の編集保持' })); });
  assert.equal(await pages[0].evaluate(() => window.__sharedSession.active.flush()), false);
  assert.equal(await pages[0].evaluate(() => window.__sharedSession.active.editor.project.title), '保存失敗の編集保持');
  await pages[0].evaluate(async () => { const o = window.__sharedSession.active; o.coordinator.repository.commit = window.__oldCommit; await o.flush(); });
  checks.push('failed local save retains edit; retry succeeds');
  // Receiver clamps current dimensions and rejects deleted targets via session read path.
  await pages[2].evaluate(id => { const o = window.__sharedSession.active; o.editor.edit(p => ({ ...p, members: p.members.filter(m => m.id !== id) })); }, ids.at(-1));
  assert.equal(await ephemeral(2, (s, id) => s.position('scene_0', ['member', id, 0, 0], 100, 100), ids.at(-1)), null);
  await pages[2].evaluate(() => window.__sharedSession.active.flush());
  await until(() => pages[1].evaluate(id => !window.__sharedSession.active.editor.project.members.some(m => m.id === id), ids.at(-1)), 'deleted target durably received');
  await expect(pages[1].locator('.member-token')).toHaveCount(145);
  // Reconnection clears immediately, then fake monotonic clock exercises real 45s state machine.
  relay.reconnect(people[4]); await until(() => ephemeral(4, s => s.getSnapshot().mode === 'B'), 'reconnection drops A');
  await until(() => ephemeral(4, s => s.online), 'reconnection transport online');
  await ephemeral(4, s => { const at = Date.now(); s.options.now = () => at + 46000; s.metrics.latencyMs = []; s.metrics.localMs = []; }); await ephemeral(4, s => s.tick());
  checks.push('deletion + reconnect clears previews; recovery uses controllable test clock');
  // Exercise A/B receive latency, render throttle is independent from sender frequency.
  await ephemeral(3, s => { s.degradedAt = 0; s.mode('A', '', 3); s.metrics.latencyMs = Array(30).fill(600); s.latencyAt = s.now(); s.lastBadAt = 0; });
  for (let step = 0; step < 3; step++) { await ephemeral(3, s => { s.lastBadAt = 0; return s.tick(); }); }
  assert.equal(await ephemeral(3, s => s.getSnapshot().mode), 'B');
  await ephemeral(3, s => { const at = Date.now(); s.options.now = () => at + 80000; s.metrics.latencyMs = []; s.metrics.localMs = []; s.failures = 0; }); await ephemeral(3, s => s.tick()); assert.equal(await ephemeral(3, s => s.getSnapshot().hz), 1);
  checks.push('A->2Hz->1Hz->B, stable clock recovery at 1Hz');
  // Export uses real image utility while overlays are visible; compare exact PNGs.
  await begin(0); await pages[1].waitForTimeout(500);
  const exportResult = await pages[1].evaluate(async () => {
    const { visibleElementToPngBlob, elementToPngBlob, elementToJpegDataUrl, withExportClone } = await import('/src/utils/exportImage.ts');
    const el = document.querySelector('.stage-surface');
    const cleanClone = await withExportClone(el, async clone => clone.querySelectorAll('[data-ephemeral]').length);
    const first = await visibleElementToPngBlob(el, { pixelRatio: 1 });
    const cloned = await elementToPngBlob(el, { pixelRatio: 1 }); const jpeg = await elementToJpegDataUrl(el);
    document.querySelectorAll('[data-ephemeral]').forEach(e => e.style.visibility = 'hidden');
    const second = await visibleElementToPngBlob(el, { pixelRatio: 1 }); document.querySelectorAll('[data-ephemeral]').forEach(e => e.style.removeProperty('visibility'));
    return { cleanClone, first: Array.from(new Uint8Array(await first.arrayBuffer())), second: Array.from(new Uint8Array(await second.arrayBuffer())), pngBytes: first.size, clonedBytes: cloned.size, jpeg: jpeg.startsWith('data:image/jpeg') };
  });
  const { PNG } = await import('pngjs');
  const pngA = PNG.sync.read(Buffer.from(exportResult.first)), pngB = PNG.sync.read(Buffer.from(exportResult.second));
  let differences = 0; for (let i = 0; i < pngA.data.length; i += 4) if (pngA.data.subarray(i, i + 4).compare(pngB.data.subarray(i, i + 4)) !== 0) differences++;
  const exportMetrics = { ...exportResult, first: undefined, second: undefined, differences, width: pngA.width, height: pngA.height };
  if (differences) { await writeFile(path.join(shotDir, 'export-a.png'), Buffer.from(exportResult.first)); await writeFile(path.join(shotDir, 'export-b.png'), Buffer.from(exportResult.second)); console.log('EXPORT_DIAGNOSTIC', JSON.stringify(exportMetrics)); }
  assert.equal(exportResult.cleanClone, 0); assert.equal(differences, 0); assert(exportResult.jpeg); measurements.export = exportMetrics;
  await pages[1].emulateMedia({ media: 'print' }); assert.equal(await pages[1].locator('.remote-interaction-layer').evaluate(el => getComputedStyle(el).display), 'none'); await pages[1].emulateMedia({ media: 'screen' });
  checks.push('PNG bytes identical with visible overlays/hidden overlays, clone PNG/JPEG exclusion, print CSS exclusion');
  // All dimensions include real App toolbar, participant icons, scene mark and drag rings.
  const dims = [[744,1133],[1133,744],[810,1080],[1080,810],[820,1180],[1180,820],[834,1210],[1210,834],[1024,1366],[1366,1024],[1032,1376],[1376,1032],[390,844]];
  for (const mode of ['stage', 'parade']) {
    await pages[1].setViewportSize({ width: 1376, height: 1032 });
    if (mode === 'parade') {
      await pages[0].evaluate(() => { const o = window.__sharedSession.active; o.editor.edit(p => ({ ...p, mode: 'parade', paradeSettings: { totalDistance: 100, backwardDistanceMeters: 5, width: 12, cellSizeMeters: .5, direction: 'up', rulerPosition: 'both', emphasizeEvery5m: true, emphasizeEvery10m: true }, frames: p.frames.map(f => ({ ...f, sceneViewState: { scrollTop: 0, scrollLeft: 0, zoom: 1 } })) })); });
      await pages[0].evaluate(() => window.__sharedSession.active.flush()); await until(() => pages[1].locator('.parade-stage').count().then(n => n === 1), 'parade mode');
      await pages[1].locator('.parade-viewport').evaluate(el => { el.scrollTop = 0; el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2); });
    }
    // Expire prior sessions' fake clocks before screenshot; renew peers' presence explicitly.
    for (let i = 0; i < 5; i++) await ephemeral(i, s => { s.options.now = undefined; s.degradedAt = 0; s.metrics.localMs = []; s.metrics.latencyMs = []; s.baseline = 0; s.failures = 0; s.mode('A', '', 3); s.presenceDirty = true; s.nextSend = 0; });
    await begin(0); await until(() => pages[1].locator('.remote-target.is-dragging').count().then(n => n > 0), 'visible drag borders');
    for (const [width, height] of dims) {
      await pages[1].setViewportSize({ width, height }); await pages[1].waitForTimeout(160);
      const bounds = await pages[1].locator('.toolbar-label-button').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, hit: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; }));
      assert(bounds.every(r => r.hit && r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= height), `${mode} ${width}x${height}: ${JSON.stringify(bounds)}`);
      assert(await pages[1].locator('.remote-avatar').count() > 0); assert(await pages[1].locator('.remote-scene-presence').count() > 0);
      assert(await pages[1].locator('.remote-scene-presence').first().evaluate(el => { const r = el.getBoundingClientRect(), card = el.closest('.scene-thumbnail-card').getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= card.left && r.right <= card.right && r.top >= card.top && r.bottom <= card.bottom; }), `${mode} ${width}x${height}: clipped scene presence mark`);
      const filename = `${mode}-${width}x${height}.png`; await pages[1].screenshot({ path: path.join(shotDir, filename) }); shots.push(filename);
    }
    if (mode === 'parade') {
      await pages[1].setViewportSize({ width: 1376, height: 1032 });
      const pMember = pages[1].locator('.parade-member').nth(8), r = await pMember.boundingBox(); assert(r);
      await pages[1].mouse.move(r.x + r.width / 2, r.y + r.height / 2); await pages[1].mouse.down(); await pages[1].mouse.move(r.x + r.width / 2 + 30, r.y + r.height / 2 + 15, { steps: 24 }); await pages[1].mouse.up(); measurements.paradeLocal = await ephemeral(1, s => s.measurements);
      await pages[1].locator('.parade-viewport').evaluate(el => { el.scrollTop = 4000; }); await pages[1].waitForTimeout(100);
      assert.equal(await pages[1].locator('.remote-target').count(), 0); checks.push('actual Parade drag and viewport culling after long-distance scroll');
    }
    await ephemeral(0, s => s.cancel());
  }
  relay.revoke(people[4]); await until(() => ephemeral(4, s => s.getSnapshot().reason === '停止'), 'credential revocation immediate clear');
  await pages[1].getByRole('button', { name: '隊列一覧へ戻る', exact: true }).click(); await expect(pages[1].locator('.library-shell')).toBeVisible();
  assert.equal(await pages[1].evaluate(() => window.__sharedSession.active), null);
  checks.push('revocation and document close stop ephemeral transport');
  assert.deepEqual(errors, []); assert.deepEqual(denied, []);
  const result = { checks, measurements, shots, errors, denied };
  await writeFile(path.join(shotDir, 'results.json'), JSON.stringify(result, null, 2)); console.log('PRESENCE_BROWSER', JSON.stringify(result));
} finally { await Promise.all(contexts.map(c => c.close())); await browser.close(); await server.close(); await vite.close(); }
