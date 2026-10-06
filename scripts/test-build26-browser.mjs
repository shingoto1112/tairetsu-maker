import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.REPOSITORY_TEST_ORIGIN ?? 'http://127.0.0.1:5380';
assert(new URL(origin).protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const output = process.env.BUILD26_SHOTS_DIR ?? 'output/playwright/build26';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1376, height: 1032 }, hasTouch: true });
// The browser uses anonymous data and cannot contact external services.
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const diagnostics = {};
try {
  await page.goto(`${origin}/?runtime=capacitor-ios`);
  await page.getByRole('button', { name: '追加', exact: false }).waitFor();
  diagnostics.initialUi = (await page.locator('body').innerText()).slice(0, 700);
  await page.evaluate(async () => {
    const { createSampleProject } = await import('/src/sampleProject.ts');
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const project = createSampleProject();
    project.id = 'build26-anonymous'; project.title = '架空データ build26'; project.mode = 'parade'; project.audio = null;
    project.stage.widthMeters = 18; project.stage.depthMeters = 120;
    project.paradeSettings = { totalDistance: 120, backwardDistanceMeters: 5, width: 18, cellSizeMeters: .5,
      direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
    project.members = Array.from({ length: 60 }, (_, i) => ({ id: `anon-${i}`, name: `練習${String(i + 1).padStart(2, '0')}`, color: ['#06a77d', '#e06b35', '#3886b9'][i % 3] }));
    project.memberGroups = ['緑チーム', '橙チーム', '青チーム'].map((name, i) => ({ id: `group-${i}`, name,
      color: ['#06a77d', '#e06b35', '#3886b9'][i], memberIds: project.members.filter((_, n) => n % 3 === i).map(m => m.id) }));
    project.stageObjects = []; project.objectGroups = [];
    project.frames = [30, 10, 10].map((timeSec, i) => ({ id: `scene-${i}`, label: ['後半', '開始', '開始・同時刻'][i], timeSec,
      notes: '架空データによる操作確認です。', section: '練習', positions: Object.fromEntries(project.members.map((m, n) => [m.id, { x: 2 + n % 12, y: 108 + Math.floor(n / 12) * 2 }])),
      objectStates: {}, objectAssignments: {}, sceneViewState: { zoom: 1, scrollTop: 3400, scrollLeft: 0 } }));
    const repository = new IndexedDbProjectRepository(); await repository.initialize();
    await repository.commit({ project, localRevision: '1', expectedRepositoryRevision: null, operationId: 'build26-seed' }); repository.close();
  });
  await page.reload();
  await page.getByRole('button', { name: '架空データ build26を開く', exact: true }).click();
  await page.locator('.parade-control-panel').waitFor();
  await expect(page.getByRole('button', { name: '100%', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'スタートへ', exact: true })).toHaveCount(0);
  await expect(page.locator('.parade-front-distance')).toHaveText('最前 12m');
  const warning = page.getByRole('button', { name: /^警告/ });
  if (await warning.count()) {
    await warning.click();
    diagnostics.warningText = await page.locator('.status-warnings__list').innerText();
  }
  while (await page.getByRole('button', { name: 'お知らせを閉じる', exact: true }).count()) {
    await page.getByRole('button', { name: 'お知らせを閉じる', exact: true }).first().click();
  }
  const target = page.getByRole('combobox', { name: /^対象/ });
  await expect(target.locator('option')).toHaveText(['全員', '緑チーム', '橙チーム', '青チーム']);
  await target.selectOption('group-0');
  diagnostics.checkbox = await page.getByLabel('道具も移動', { exact: true }).evaluate(input => {
    const box = input.getBoundingClientRect(), parent = input.parentElement.getBoundingClientRect();
    return { width: box.width, height: box.height, labelHeight: parent.height, display: getComputedStyle(input.parentElement).display };
  });
  assert.equal(diagnostics.checkbox.display, 'flex'); assert.ok(diagnostics.checkbox.width < 30);
  await page.screenshot({ path: path.join(output, '01-parade-panel-1376x1032.png') });
  await page.getByRole('tab', { name: 'メンバー', exact: true }).click();
  await page.locator('.member-manager').waitFor();
  await page.locator('.tab-panel__content').evaluate(panel => { panel.scrollTop = 650; });
  await expect.poll(() => page.locator('.tab-panel__content').evaluate(panel => panel.scrollTop)).toBeGreaterThan(400);
  diagnostics.sticky = await page.locator('.member-manager .panel-sticky-header').evaluate(header => {
    const panel = header.closest('.tab-panel__content'), box = header.getBoundingClientRect(), parent = panel.getBoundingClientRect();
    return { count: panel.querySelectorAll('.panel-sticky-header').length, height: box.height,
      measuredHeight: parseFloat(panel.style.getPropertyValue('--panel-sticky-height')), top: box.top, panelTop: parent.top,
      text: header.textContent, titleInSticky: !!header.querySelector('h2') };
  });
  assert.equal(diagnostics.sticky.count, 1); assert.equal(diagnostics.sticky.titleInSticky, false);
  assert.ok(Math.abs(diagnostics.sticky.top - diagnostics.sticky.panelTop) < 2);
  assert.ok(diagnostics.sticky.measuredHeight >= diagnostics.sticky.height - 1);
  await page.screenshot({ path: path.join(output, '02-member-sticky-1376x1032.png') });
  await page.getByRole('tab', { name: 'シーン', exact: true }).click();
  const time = page.getByLabel('時刻（秒）', { exact: true }); await time.waitFor();
  const labels = () => page.locator('.timeline-card__top strong').allTextContents();
  assert.deepEqual(await labels(), ['開始', '開始・同時刻', '後半']);
  await time.fill('5'); assert.deepEqual(await labels(), ['開始', '開始・同時刻', '後半']);
  await time.press('Enter'); await expect.poll(labels).toEqual(['後半', '開始', '開始・同時刻']);
  await expect(page.locator('.timeline-card.is-selected strong')).toHaveText('後半');
  await expect(time).toBeInViewport();
  await time.fill('25'); await time.press('Enter');
  await expect.poll(labels).toEqual(['開始', '開始・同時刻', '後半']);
  await expect(page.locator('.timeline-card.is-selected')).toBeInViewport();
  await expect(time).toBeInViewport();
  diagnostics.details = await page.locator('.scene-inline-details').innerText();
  assert.ok(!diagnostics.details.includes('ステージサイズは全シーン共通'));
  assert.equal(await page.getByLabel('セクション', { exact: true }).count(), 0);
  await page.locator('.tab-panel__content').evaluate(panel => {
    const details = panel.querySelector('.scene-inline-details');
    panel.scrollTop += Math.max(0, details.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom + 12);
  });
  await expect(page.locator('.timeline-card.is-selected')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'このシーンを削除', exact: true })).toBeInViewport();
  await page.screenshot({ path: path.join(output, '03-scene-details-1376x1032.png') });
  // Check that object tabs and the existing portrait placement also retain one scroll owner.
  await page.getByRole('tab', { name: '道具', exact: true }).click();
  await expect(page.locator('.object-manager .panel-sticky-header')).toHaveCount(1);
  await page.setViewportSize({ width: 1032, height: 1376 });
  await page.getByRole('tab', { name: 'メンバー', exact: true }).click();
  await expect(page.getByRole('group', { name: '管理欄の対象' })).toBeVisible();
  assert.equal(errors.length, 0, errors.join('\n'));
  diagnostics.result = 'passed';
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(diagnostics, null, 2));
  console.log(JSON.stringify({ result: 'passed', screenshots: ['01-parade-panel-1376x1032.png', '02-member-sticky-1376x1032.png', '03-scene-details-1376x1032.png'].map(f => path.join(output, f)), diagnostics }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'failure-ui.txt'), await page.locator('body').innerText());
  await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally { await context.close(); await browser.close(); }
