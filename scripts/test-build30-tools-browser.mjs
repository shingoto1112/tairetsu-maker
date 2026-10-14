import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const origin = 'http://127.0.0.1:5392', out = path.resolve('output/build30');
const browser = await chromium.launch({ headless: true }), results = [], errors = [];
const read = (page, id) => page.evaluate(async id => {
  const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
  const repository = new IndexedDbProjectRepository(); const p = (await repository.get(id)).project; repository.close(); return p;
}, id);
const save = async page => { await page.locator('.toolbar-save-button').click(); await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/); };
const lattice = (value, step, origin) => Math.abs((value - origin) / step - Math.round((value - origin) / step)) < 1e-6;
try {
  for (const mode of ['stage', 'parade']) {
    const p = JSON.parse(await readFile(path.join(out, `${mode}-1180x820-fixture.json`), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    await context.route('**/*', route => { const u = new URL(route.request().url()); return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 }); await expect(page.locator('.library-shell')).toBeVisible();
    await page.evaluate(async p => {
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const r = new IndexedDbProjectRepository(); await r.initialize(); await r.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: p.id }); r.close();
    }, p);
    await page.reload(); await page.getByRole('button', { name: `${p.title}を開く`, exact: true }).click(); await expect(page.locator('.toolbar')).toBeVisible();
    const notice = page.getByRole('button', { name: 'お知らせを閉じる', exact: true }); if (await notice.count()) await notice.click();
    await page.getByRole('tab', { name: '道具', exact: true }).click();
    const tool = page.locator(mode === 'stage' ? '.stage-object' : '.parade-object').filter({ hasText: '道具' }).first();
    const surface = page.locator(mode === 'stage' ? '.stage-surface' : '.parade-stage');
    await tool.click(); const box = await tool.boundingBox(), area = await surface.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2, extent = mode === 'stage' ? 5.4 : 12.44, sign = mode === 'stage' ? -1 : 1;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + sign * area.width / 9 * .31, y + sign * area.height / extent * .34, { steps: 10 }); await page.mouse.up(); await save(page);
    const dragged = (await read(page, p.id)).frames[0].objectStates.o0;
    const yLattice = mode === 'stage' ? dragged.y + dragged.heightMeters / 2 : dragged.y;
    assert.ok(lattice(yLattice, .25, mode === 'stage' ? 5.4 : 10.13), JSON.stringify(dragged));
    assert.equal(dragged.widthMeters, .73); assert.equal(dragged.heightMeters, .8);
    assert.notEqual(dragged.y, p.frames[0].objectStates.o0.y);
    await page.keyboard.press('ControlOrMeta+Z'); await save(page);
    assert.deepEqual((await read(page, p.id)).frames[0].objectStates, p.frames[0].objectStates);
    await tool.click(); await page.getByRole('button', { name: 'コピー', exact: true }).first().click();
    const center = { x: 4.77, y: mode === 'stage' ? 2.72 : 4.42 };
    if (mode === 'parade') await page.locator('.parade-viewport').evaluate((view, center) => {
      const stage = view.querySelector('.parade-stage').getBoundingClientRect(), rect = view.getBoundingClientRect();
      view.scrollLeft += stage.left + stage.width / 9 * center.x - (rect.left + rect.width / 2);
      view.scrollTop += stage.top + stage.height / 12.44 * center.y - (rect.top + rect.height / 2);
    }, center);
    const current = await surface.boundingBox();
    const screen = { x: current.x + (mode === 'stage' ? 9 - center.x : center.x) / 9 * current.width,
      y: current.y + (mode === 'stage' ? 5.4 - center.y : center.y) / extent * current.height };
    await page.mouse.move(screen.x, screen.y); await page.getByRole('button', { name: /^(貼り付け|貼付)$/ }).first().click(); await save(page);
    const pasted = await read(page, p.id), newTool = pasted.stageObjects.find(o => o.id !== 'o0'); assert.ok(newTool);
    const state = pasted.frames[0].objectStates[newTool.id];
    const expected = await page.evaluate(async ({ center, stage, parade }) => {
      const { snapPastedObjectPosition } = await import('/src/utils/placementGrid.ts');
      return snapPastedObjectPosition(center, .73, .8, stage, parade);
    }, { center, stage: { ...p.stage, depthMeters: extent }, parade: mode === 'parade' ? p.paradeSettings : undefined });
    assert.ok(Math.abs(state.x - expected.x) < .0011 && Math.abs(state.y - expected.y) < .0011, JSON.stringify({ state, expected }));
    assert.equal(state.widthMeters, .73); assert.equal(state.heightMeters, .8);
    await page.keyboard.press('ControlOrMeta+Z'); await save(page);
    assert.deepEqual((await read(page, p.id)).frames[0].objectStates, p.frames[0].objectStates);
    results.push({ mode, dragged, pasted: state, expected, undo: 'exact', dimensions: 'unchanged' }); await context.close();
  }
  assert.deepEqual(errors, []); await writeFile(path.join(out, 'tools-browser-results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('BUILD30_TOOLS_BROWSER PASS: stage center / parade top-left .25m drag, target-specific paste, exact Undo, dimensions unchanged.');
} finally { await browser.close(); }
