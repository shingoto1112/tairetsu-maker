import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:5393';
const out = path.resolve('output/build30');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [], errors = [];
async function createPage(viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await expect(page.locator('.library-shell')).toBeVisible({ timeout: 90000 });
  await page.evaluate(async () => {
    const { createSampleProject } = await import('/src/sampleProject.ts');
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const p = { ...createSampleProject(), id: 'roster-source', title: '前大会の名簿', mode: 'stage' };
    p.members.forEach((m, i) => { m.name = ['さくら', 'たろう', 'はな'][i]; });
    p.memberGroups = [{ id: 'old-group', name: '出演者', color: '#123456', memberIds: p.members.map(m => m.id).reverse() }];
    p.objectGroups = [{ id: 'old-object-group', name: '舞台道具', color: '#876543', objectIds: p.stageObjects.map(o => o.id), defaultType: 'curtain', defaultShape: 'curtain' }];
    p.stageObjects[0].shape = 'curtain';
    p.frames.forEach(f => { f.objectStates.o_curtain.widthMeters = 20; f.objectStates.o_curtain.heightMeters = 2; });
    const repository = new IndexedDbProjectRepository(); await repository.initialize();
    await repository.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: 'roster-seed' }); repository.close();
  });
  await page.reload(); await expect(page.getByRole('button', { name: '前大会の名簿を開く' })).toBeVisible();
  return { page, context };
}
async function openCopy(page, shortcut) {
  if (shortcut) {
    await page.getByRole('button', { name: '前大会の名簿のメニュー' }).click();
    await page.getByRole('button', { name: 'この名簿で新しく作る' }).click();
  } else {
    await page.getByRole('button', { name: /追加/ }).click(); await page.getByRole('button', { name: /新しく作る/ }).click();
    await page.getByRole('button', { name: /ステージ隊列/ }).click();
    await page.getByRole('combobox', { name: '名簿をコピー（任意）' }).selectOption('roster-source');
  }
  await page.getByRole('textbox', { name: '隊列表名' }).fill('新大会');
  await expect(page.getByRole('button', { name: '作成する' })).toBeEnabled();
  assert.equal(await page.getByRole('combobox', { name: '名簿をコピー（任意）' }).evaluate(el => !!el.closest('details')), false);
}
async function inViewport(locator, viewport) {
  const box = await locator.boundingBox(); assert.ok(box);
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));
}
try {
  for (const viewport of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }]) {
    const { page, context } = await createPage(viewport), label = `${viewport.width}x${viewport.height}`;
    await openCopy(page, viewport.width === 820);
    await inViewport(page.getByRole('button', { name: '作成する' }), viewport);
    await page.screenshot({ path: path.join(out, `roster-copy-create-${label}.png`) });
    await page.getByRole('button', { name: '作成する' }).click();
    const overflow = page.getByRole('dialog', { name: 'ステージに入らない道具があります' }); await expect(overflow).toBeVisible();
    await expect(overflow).toContainText('移動幕：幅20m・奥行き2m');
    for (const button of await overflow.getByRole('button').all()) await inViewport(button, viewport);
    await page.screenshot({ path: path.join(out, `roster-copy-overflow-${label}.png`) });
    await overflow.getByRole('button', { name: '戻ってステージの大きさを変える' }).click();
    await expect(page.getByRole('textbox', { name: '隊列表名' })).toHaveValue('新大会');
    await expect(page.getByRole('combobox', { name: '名簿をコピー（任意）' })).toHaveValue('roster-source');
    await page.getByRole('button', { name: '作成する' }).click();
    await page.getByRole('button', { name: 'ステージに入る大きさに縮めてコピー' }).click();
    await expect(page.getByRole('button', { name: '全体名簿を開く' })).toBeVisible({ timeout: 30000 });
    const saved = await page.evaluate(async () => {
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const repository = new IndexedDbProjectRepository();
      const summary = (await repository.list({ limit: 100 })).items.find(p => p.title === '新大会');
      const record = await repository.get(summary.id); repository.close(); return record;
    });
    assert.equal(saved.project.members.length, 3); assert.equal(saved.project.frames.length, 1);
    assert.ok(saved.project.members.every(m => m.visible && !saved.project.frames[0].memberVisibility[m.id]));
    assert.ok(Object.values(saved.project.frames[0].objectStates).every(o => !o.visible));
    assert.equal(saved.project.stageObjects[0].widthMeters, 12); assert.equal(saved.project.stageObjects[0].heightMeters, 2);
    assert.equal(saved.project.stageObjects[0].shape, 'curtain'); assert.equal(saved.sync, null); assert.equal(saved.collaboration ?? null, null);
    await page.getByRole('button', { name: '全体名簿を開く' }).click();
    await expect(page.getByRole('dialog', { name: 'メンバー/道具の管理' })).toBeVisible();
    await page.screenshot({ path: path.join(out, `roster-copy-roster-${label}.png`) });
    await writeFile(path.join(out, `roster-copy-project-${label}.json`), JSON.stringify(saved.project, null, 2));
    results.push({ viewport, creationButtonsInViewport: true, overflowButtonsInViewport: true, shortcut: viewport.width === 820, copiedMemberCount: 3, hiddenInitialScene: true });
    await context.close();
  }
  const viewport = { width: 744, height: 1133 }, { page, context } = await createPage(viewport);
  await openCopy(page, false); await inViewport(page.getByRole('button', { name: '作成する' }), viewport);
  await page.getByRole('button', { name: '作成する' }).click();
  const overflow = page.getByRole('dialog', { name: 'ステージに入らない道具があります' }); await expect(overflow).toBeVisible();
  for (const button of await overflow.getByRole('button').all()) await inViewport(button, viewport);
  await overflow.getByRole('button', { name: '入らない道具はコピーしない' }).click();
  await expect(page.getByRole('button', { name: '全体名簿を開く' })).toBeVisible();
  const names = await page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const repository = new IndexedDbProjectRepository(); const summary = (await repository.list({ limit: 100 })).items.find(p => p.title === '新大会');
    const names = (await repository.get(summary.id)).project.stageObjects.map(o => o.name); repository.close(); return names;
  });
  assert.deepEqual(names, ['椅子']); results.push({ viewport, creationButtonsInViewport: true, overflowButtonsInViewport: true, excludedOversizedTool: true });
  await context.close(); assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'roster-copy-browser-results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
