import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const origin = 'http://127.0.0.1:5194';
const shots = process.env.LINES_SHOT_DIR ?? 'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-lines';
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5194, strictPort: true }, logLevel: 'warn' });
await vite.listen(); console.log('Owned browser test process PID', process.pid);
const browser = await chromium.launch({ headless: true }), errors = [], results = [];
const context = await browser.newContext({ viewport: { width: 1376, height: 1032 }, hasTouch: true });
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
await context.route('**/*', route => { const u = new URL(route.request().url()); return u.origin === origin || ['blob:', 'data:'].includes(u.protocol) ? route.continue() : route.abort(); });
const shot = name => page.screenshot({ path: `${shots}/${name}.png` });
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up(); };
try {
  await mkdir(shots, { recursive: true }); await page.goto(origin);
  await page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const { normalizeProject } = await import('/src/project/normalizeProject.ts');
    const { formationExportFixture } = await import('/src/utils/formationExportFixture.ts');
    const repo = new IndexedDbProjectRepository(); await repo.initialize();
    for (const mode of ['stage', 'parade']) {
      const p = normalizeProject(formationExportFixture()); p.id = `lines-${mode}`; p.title = `線検証${mode}`; p.mode = mode; p.audio = null;
      if (mode === 'parade') p.paradeSettings = { width: 12, totalDistance: 30, cellSizeMeters: .5, direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
      p.frames[0].annotationLines = { existing: { x1: 1, y1: 1, x2: 9, y2: 4, color: 'red', dash: 'dashed' } };
      await repo.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: `seed-${mode}` });
    }
    repo.close();
  });
  for (const mode of ['stage', 'parade']) {
    await page.goto(origin); await page.getByRole('button', { name: `線検証${mode}を開く`, exact: true }).click();
    if (mode === 'stage') await page.getByRole('button', { name: 'ステージを全体表示に戻す' }).click();
    const surface = page.locator(mode === 'stage' ? '.stage-surface' : '.parade-stage');
    await expect(surface.locator('[data-annotation-line]')).toHaveCount(1);
    await page.getByRole('button', { name: '線を引く', exact: true }).click();
    await page.getByLabel('線の色').selectOption('blue'); await page.getByLabel('線の種類').selectOption('dashed');
    const box = await surface.boundingBox();
    const empty = await surface.locator('.annotation-interaction-layer').evaluate(svg => {
      const b = svg.getBoundingClientRect();
      for (const fy of [.75, .6, .4, .2]) for (const fx of [.2, .4, .6]) {
        const p = { x: b.x + b.width * fx, y: Math.min(b.y + b.height * fy, innerHeight - 100) };
        if (document.elementFromPoint(p.x, p.y) === svg) return p;
      }
      throw new Error('No empty annotation area');
    });
    await drag(empty, { x: Math.min(box.x + box.width - 30, empty.x + 130), y: empty.y + 35 });
    await expect(surface.locator('[data-annotation-line]')).toHaveCount(2);
    await expect(surface.locator('[data-endpoint]')).toHaveCount(2);
    await shot(`${mode}-landscape-selected`);
    const start = await surface.locator('[data-endpoint="start"]').boundingBox();
    await drag({ x: start.x + start.width / 2, y: start.y + start.height / 2 }, { x: start.x + start.width / 2 + 25, y: start.y + start.height / 2 + 25 });
    await page.getByLabel('線の色').selectOption('green');
    await page.setViewportSize({ width: 1032, height: 1376 }); await shot(`${mode}-portrait-endpoints`);
    await page.getByRole('button', { name: '完了', exact: true }).click();
    await expect(surface.locator('[data-endpoint]')).toHaveCount(0);
    // Normal mode ink cannot capture member/object drags.
    assert.equal(await surface.locator('.annotation-layer').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await page.getByRole('button', { name: '線を引く', exact: true }).click();
    await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '完了', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '線を引く', exact: true }).click(); await shot(`${mode}-phone-controls`);
    await page.getByRole('button', { name: '完了', exact: true }).click();
    results.push({ mode, editing: 'draw/endpoint/style/finish/Esc/normal pointer pass-through' });
    await page.setViewportSize({ width: 1376, height: 1032 });
    const lineIds = () => surface.locator('[data-annotation-line]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-annotation-line')).sort());
    const originalIds = await lineIds();
    await page.getByRole('tab', { name: 'シーン', exact: true }).click();
    await page.locator('.scene-nav').getByRole('button', { name: 'シーン', exact: true }).click();
    await expect(surface.locator('[data-annotation-line]')).toHaveCount(2);
    const addedIds = await lineIds(); assert(addedIds.every(id => !originalIds.includes(id)), 'New scene needs independent line IDs');
    await page.locator('.scene-nav').getByRole('button', { name: 'コピー', exact: true }).click();
    await page.getByRole('button', { name: '新規として貼り付け', exact: true }).click();
    await expect(surface.locator('[data-annotation-line]')).toHaveCount(2);
    const duplicatedIds = await lineIds(); assert(duplicatedIds.every(id => !addedIds.includes(id) && !originalIds.includes(id)), 'Duplicate needs independent line IDs');
    results.push({ mode, scenes: 'new scene and duplicate inherit both lines with fresh independent IDs' });
  }
  // Anonymous output fixture: A4 geometry before/after and mobile actual rendering.
  await page.evaluate(async () => {
    const reactModule = await import('/node_modules/.vite/deps/react.js'), domModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const React = reactModule.default ?? reactModule, createRoot = (domModule.default ?? domModule).createRoot;
    const { PrintPreview } = await import('/src/components/PrintPreview.tsx'); const { StaticStagePreview } = await import('/src/components/StaticStagePreview.tsx');
    const { formationExportFixture } = await import('/src/utils/formationExportFixture.ts');
    window.lineOutput = { React, createRoot, PrintPreview, StaticStagePreview, project: formationExportFixture() };
    const host = document.createElement('div'); host.id = 'line-output-host'; document.body.append(host);
    host.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:99999;background:white'; window.lineOutput.root = createRoot(host);
    window.lineOutput.root.render(React.createElement(PrintPreview, { project: window.lineOutput.project }));
  });
  await page.addStyleTag({ content: '#line-output-host .print-document { display:block !important; }' });
  await page.locator('#line-output-host .print-stage').first().waitFor();
  const geometry = () => page.locator('#line-output-host').evaluate(host => [...host.querySelectorAll('.print-page,.print-scene,.print-scene-title,.print-stage')].map(n => { const r = n.getBoundingClientRect(); return [n.className, r.x, r.y, r.width, r.height]; }));
  const before = await geometry();
  await page.evaluate(() => { const o = window.lineOutput; o.project = { ...o.project, frames: o.project.frames.map(f => ({ ...f, annotationLines: { line: { x1: 1, y1: 1, x2: 10, y2: 6, color: 'blue', dash: 'dashed' } } })) }; o.root.render(o.React.createElement(o.PrintPreview, { project: o.project })); });
  await expect(page.locator('#line-output-host [data-annotation-line]')).toHaveCount(3); assert.deepEqual(await geometry(), before);
  await page.locator('#line-output-host .print-page').first().screenshot({ path: `${shots}/a4-lines.png` }); results.push({ A4: 'identical page/frame/heading geometry' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { const o = window.lineOutput; o.root.render(o.React.createElement(o.StaticStagePreview, { project: o.project, frame: o.project.frames[0], stageWidth: 12, range: { left: 0, right: 12, top: 0, bottom: 8 }, outputWidth: 380 })); });
  await expect(page.locator('#line-output-host [data-annotation-line]')).toHaveCount(1);
  await expect(page.locator('#line-output-host [data-endpoint]')).toHaveCount(0); await shot('mobile-lines');
  // Capture real image export, not only DOM ink.
  const png = await page.evaluate(async () => { const { elementToPngBlob } = await import('/src/utils/exportImage.ts'); const blob = await elementToPngBlob(document.querySelector('#line-output-host .static-stage-preview')); return [...new Uint8Array(await blob.arrayBuffer())]; });
  await writeFile(`${shots}/mobile-lines-export.png`, Buffer.from(png));
  await page.goto(origin); await page.setViewportSize({ width: 1376, height: 1032 });
  await page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const { normalizeProject } = await import('/src/project/normalizeProject.ts'); const { default: fixtures } = await import('/src/repositories/contract/fixtures/projects.json');
    const repo = new IndexedDbProjectRepository(); await repo.initialize();
    for (const mode of ['stage-base', 'stage', 'parade']) {
      const p = normalizeProject(structuredClone(fixtures.large)); p.id = `lines-perf-${mode}`; p.title = `線性能${mode}`; p.mode = mode === 'parade' ? 'parade' : 'stage'; p.audio = null;
      p.frames = p.frames.slice(0, 1); p.frames[0].annotationLines = Object.fromEntries(Array.from({ length: mode === 'stage-base' ? 0 : 100 }, (_, i) => [`line${i}`, { x1: .5 + i % 8, y1: .5 + Math.floor(i / 8) * .25, x2: 5 + i % 8, y2: 5, color: 'blue', dash: i % 2 ? 'solid' : 'dashed' }]));
      if (mode === 'parade') p.paradeSettings = { width: 18, totalDistance: 120, cellSizeMeters: .5, direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
      await repo.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: `perf-${mode}` });
    } repo.close();
  });
  for (const mode of ['stage-base', 'stage', 'parade']) {
    await page.goto(origin); await page.getByRole('button', { name: `線性能${mode}を開く`, exact: true }).click();
    if (mode !== 'parade') await page.getByRole('button', { name: 'ステージを全体表示に戻す' }).click();
    await expect(page.locator('.annotation-layer [data-annotation-line]')).toHaveCount(mode === 'stage-base' ? 0 : 100);
    await page.waitForTimeout(350);
    await page.evaluate(() => { window.lineFrameSamples = []; window.lineMeasuring = true; let last; const tick = t => { if (!window.lineMeasuring) return; if (last) window.lineFrameSamples.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    if (mode !== 'parade') {
      const token = page.locator('.member-token').first(); await token.scrollIntoViewIfNeeded(); const b = await token.boundingBox();
      await drag({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: b.x + b.width / 2 + 80, y: b.y + b.height / 2 + 35 });
    } else {
      const viewport = page.locator('.parade-viewport'), b = await viewport.boundingBox(); await page.mouse.move(b.x + b.width * .5, b.y + b.height * .5);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 80); await page.waitForTimeout(20); }
    }
    await page.waitForTimeout(100);
    const samples = await page.evaluate(() => { window.lineMeasuring = false; return window.lineFrameSamples.sort((a, b) => a - b); });
    const p95 = samples[Math.floor(samples.length * .95)] ?? 0; assert(p95 < 100, `Obvious ${mode} frame slowdown: ${p95}`);
    results.push({ performance: mode === 'stage-base' ? '146 members, no lines, member drag baseline' : mode === 'stage' ? '146 members + 100 lines, member drag' : '146 members + 100 lines, scroll/pan', frames: samples.length, p95Ms: Math.round(p95 * 10) / 10 });
  }
  assert.deepEqual(errors, []); await writeFile(`${shots}/results.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify({ results, errors, shots }));
} finally { await browser.close(); await vite.close(); }
