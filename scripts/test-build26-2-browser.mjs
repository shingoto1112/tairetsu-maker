import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:5380';
const output = process.env.BUILD26_SHOTS_DIR ?? 'output/playwright/build26-2';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1376, height: 1032 }, hasTouch: true });
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const checks = {};
try {
  await page.goto(origin);
  await page.getByRole('button', { name: /追加/ }).waitFor();
  await page.evaluate(async () => {
    const { createSampleProject } = await import('/src/sampleProject.ts');
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const p = createSampleProject(); p.id = 'build26-2-anonymous'; p.title = '練習用の架空隊列'; p.audio = null;
    p.members = [{ id: 'm1', name: '練習01', color: '#0f766e', visible: true }, { id: 'm2', name: '練習02', color: '#db2777', visible: true }];
    p.memberGroups = []; p.objectGroups = []; p.stageObjects = [{ ...p.stageObjects[1], id: 'o1', name: '練習用の椅子' }];
    p.frames = [{ id: 'f1', label: '開始', timeSec: 0, positions: { m1: { x: 4, y: 3 }, m2: { x: 7, y: 3 } },
      objectStates: { o1: { objectId: 'o1', x: 6, y: 4, widthMeters: .8, heightMeters: .8, rotation: 15, visible: true, zIndex: 10 } } }];
    const repo = new IndexedDbProjectRepository(); await repo.initialize();
    await repo.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: 'build26-2-seed' }); repo.close();
  });
  await page.reload();
  await page.getByRole('button', { name: '練習用の架空隊列のメニュー', exact: true }).click();
  await expect(page.getByRole('button', { name: 'クラウドに保存', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, '03-home-cloud-menu-1376x1032.png') });
  await page.getByRole('button', { name: 'クラウドに保存', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'アカウント', exact: true })).toBeVisible();
  await expect(page.getByText(/クラウドに保存するにはログインしてください/)).toBeVisible();
  await expect(page.getByRole('button', { name: '練習用の架空隊列を開く', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '共同編集画面を閉じる', exact: true }).click();
  await page.getByRole('button', { name: '練習用の架空隊列を開く', exact: true }).click();
  const picker = page.getByRole('region', { name: 'このシーンの表示', exact: true });
  await picker.getByRole('button', { name: /^練習01/ }).click();
  while (await page.getByRole('button', { name: 'お知らせを閉じる', exact: true }).count()) {
    await page.getByRole('button', { name: 'お知らせを閉じる', exact: true }).first().click();
  }
  const card = page.getByRole('region', { name: '選択対象の位置', exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByRole('spinbutton')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: '詳細', exact: true })).toHaveCount(0);
  const order = async () => card.evaluate(node => {
    const header = node.closest('.member-manager, .object-manager').querySelector('.panel-manager-header');
    const picker = node.closest('.member-manager, .object-manager').querySelector('.scene-visibility-picker');
    return { afterHeader: !!(header.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
      beforePicker: !!(node.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING),
      top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom };
  });
  checks.member = await order(); assert(checks.member.afterHeader && checks.member.beforePicker);
  await page.screenshot({ path: path.join(output, '01-member-position-1376x1032.png') });
  const x = card.getByRole('spinbutton', { name: /^横（/ });
  await x.fill('-1.13'); await x.press('Tab');
  await page.keyboard.press('Control+z');
  await expect(x).toHaveValue('-2');
  await page.getByRole('tab', { name: '音源', exact: true }).click();
  await page.keyboard.press('Control+1'); await expect(x).toBeFocused();
  await page.getByRole('tab', { name: '道具', exact: true }).click();
  await picker.getByRole('button', { name: /^練習用の椅子/ }).click();
  await expect(card.getByRole('spinbutton')).toHaveCount(5);
  await expect(page.getByLabel('幅 m', { exact: true })).toHaveCount(0);
  checks.object = await order(); assert(checks.object.afterHeader && checks.object.beforePicker);
  await page.screenshot({ path: path.join(output, '02-object-position-1376x1032.png') });
  await card.getByRole('spinbutton', { name: /横幅/ }).fill('.01');
  await page.locator('.toolbar-save-button').click();
  await page.reload();
  await page.getByRole('button', { name: '練習用の架空隊列を開く', exact: true }).click();
  await page.getByRole('tab', { name: '道具', exact: true }).click();
  await picker.getByRole('button', { name: /^練習用の椅子/ }).click();
  await expect(card.getByRole('spinbutton', { name: /横幅/ })).toHaveValue('0.01');
  await page.getByRole('tab', { name: 'メンバー', exact: true }).click();
  await picker.getByRole('button', { name: /^練習01/ }).click();
  // Both portrait sizes keep the card between the normal heading and chips.
  for (const viewport of [{ width: 1032, height: 1376 }, { width: 744, height: 1133 }]) {
    await page.setViewportSize(viewport); await expect(card).toBeVisible();
    checks[`portrait-${viewport.width}`] = await card.evaluate(node => {
      const heading = node.closest('.scene-visibility-picker').querySelector('.portrait-panel-header');
      const chips = node.closest('.scene-visibility-picker').querySelector('.scene-visibility-picker__edge');
      return { afterHeader: !!(heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
        beforeChips: !!(node.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING), width: node.getBoundingClientRect().width };
    });
    assert(checks[`portrait-${viewport.width}`].afterHeader && checks[`portrait-${viewport.width}`].beforeChips);
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ result: 'passed', checks, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', screenshots: ['01-member-position-1376x1032.png', '02-object-position-1376x1032.png', '03-home-cloud-menu-1376x1032.png'].map(name => path.join(output, name)), checks }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'failure-ui.txt'), await page.locator('body').innerText());
  throw error;
} finally { await context.close(); await browser.close(); }
