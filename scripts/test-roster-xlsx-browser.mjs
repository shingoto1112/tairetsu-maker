import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

const origin = 'http://127.0.0.1:5394';
const out = path.resolve('output/build30/xlsx-v2');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [], results = [];
try {
  for (const viewport of [{ width: 1180, height: 820 }, { width: 820, height: 1180 }, { width: 744, height: 1133 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, acceptDownloads: true });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    // Exercise the Web download fallback without opening an OS file picker.
    await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await expect(page.locator('.library-shell')).toBeVisible({ timeout: 90000 });
    await page.evaluate(async () => {
      const { createSampleProject } = await import('/src/sampleProject.ts');
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const p = createSampleProject(); p.id = 'xlsx-browser'; p.title = 'Excel検証';
      p.members.forEach((member, index) => { member.name = ['さくら😀', '007', '=SUM(A1)'][index]; });
      p.memberGroups = [
        { id: 'group', name: '出演者<&', color: '#123456', memberIds: p.members.slice(1).map(m => m.id).reverse() },
        { id: 'second', name: '女振り右', color: '#f9a8d4', memberIds: [p.members[0].id] },
        { id: 'empty', name: '追加予定（空）', color: '#fde047', memberIds: [] },
      ];
      p.members.push({ id: 'ungrouped', name: '未所属の花子', color: '#ff0000' });
      p.objectGroups = [{ id: 'tools', name: '幕', color: 'rgba(18,52,86,.5)', objectIds: [p.stageObjects[0].id] }, { id: 'empty-tools', name: '準備中', color: '#fde047', objectIds: [] }];
      const repository = new IndexedDbProjectRepository(); await repository.initialize();
      await repository.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: 'xlsx-seed' }); repository.close();
    });
    await page.reload(); await page.getByRole('button', { name: 'Excel検証を開く' }).click();
    await page.getByRole('button', { name: '全体名簿を開く' }).click();
    const trigger = page.getByRole('button', { name: '書き出し ▾' });
    const topbar = page.locator('.roster-manager-topbar');
    const closedBox = await topbar.boundingBox();
    const triggerBox = await trigger.boundingBox();
    await trigger.click();
    const menu = page.getByRole('menu', { name: '名簿の書き出し形式' });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const openBox = await topbar.boundingBox(), menuBox = await menu.boundingBox();
    assert.deepEqual(openBox, closedBox, 'Opening the menu must not move or resize the tabs/count bar');
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= viewport.width, JSON.stringify(menuBox));
    assert.ok(Math.abs(menuBox.x + menuBox.width - triggerBox.x - triggerBox.width) <= 1);
    assert.ok(Math.abs(menuBox.y - triggerBox.y - triggerBox.height - 6) <= 1);
    const menuScreenshot = viewport.width === 744 ? null : path.join(out, `xlsx-menu-${viewport.width}x${viewport.height}.png`);
    if (menuScreenshot) await page.screenshot({ path: menuScreenshot });
    await page.getByRole('textbox', { name: '出演者<& 1行目' }).tap();
    await expect(menu).toHaveCount(0);
    await trigger.click(); await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.focus(); await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: '画像・PDF' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: 'Excel（.xlsx）' })).toBeFocused();
    await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    const imageSheet = page.getByRole('dialog', { name: '書き出し', exact: true });
    await expect(imageSheet.getByText('用途', { exact: true })).toBeVisible();
    await expect(menu).toHaveCount(0);
    await imageSheet.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: '道具管理', exact: true }).click();
    await expect(trigger).toHaveCount(0); await expect(menu).toHaveCount(0);
    await page.getByRole('button', { name: 'メンバー管理', exact: true }).click();
    const nameInput = page.getByRole('textbox', { name: '出演者<& 1行目' });
    await nameInput.fill('=SUM(A1)&<確定😀>');
    await nameInput.dispatchEvent('compositionstart');
    await page.getByRole('button', { name: '書き出し ▾' }).click();
    await expect(page.getByText('入力を確定してから書き出してください。').first()).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Excel（.xlsx）' })).toHaveCount(0);
    await nameInput.dispatchEvent('compositionend');
    await page.getByRole('button', { name: '書き出し ▾' }).click();
    await page.getByRole('menuitem', { name: 'Excel（.xlsx）' }).click();
    await expect(menu).toHaveCount(0);
    const sheet = page.getByRole('dialog', { name: '書き出し', exact: true });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('checkbox', { name: '道具も含める' })).toBeChecked();
    await expect(sheet.getByText('用途', { exact: true })).toHaveCount(0);
    await expect(sheet.getByText('1枚の名簿', { exact: true })).toHaveCount(0);
    const create = sheet.getByRole('button', { name: '名簿のExcelを作成' });
    await expect(create).toBeEnabled();
    for (const locator of [sheet, create]) {
      const box = await locator.boundingBox(); assert.ok(box);
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify(box));
    }
    if (viewport.width === 1180) {
      await create.click(); await expect(sheet.getByRole('button', { name: '保存する' })).toBeVisible();
      await expect(sheet.getByRole('img')).toHaveCount(0);
      const pending = page.waitForEvent('download'); await sheet.getByRole('button', { name: '保存する' }).click();
      const download = await pending;
      const downloadedFile = path.join(out, download.suggestedFilename()); await download.saveAs(downloadedFile);
      const zip = await JSZip.loadAsync(await readFile(downloadedFile));
      const parser = new (new JSDOM('').window.DOMParser)();
      const docs = new Map();
      for (const file of Object.values(zip.files).filter(file => !file.dir)) {
        const doc = parser.parseFromString(await file.async('string'), 'application/xml');
        assert.equal(doc.querySelector('parsererror'), null); assert.equal(doc.getElementsByTagName('f').length, 0); docs.set(file.name, doc);
      }
      assert.equal(docs.get('xl/workbook.xml').querySelectorAll('sheet').length, 2);
      assert.equal(docs.get('xl/worksheets/sheet1.xml').querySelector('[r="B2"]').textContent, '=SUM(A1)&<確定😀>');
      assert.equal(docs.get('xl/worksheets/sheet1.xml').querySelector('[r="B3"]').textContent, '007');
      assert.equal(docs.get('xl/worksheets/sheet1.xml').querySelector('[r="B3"]').getAttribute('t'), 'inlineStr');
      const members = docs.get('xl/worksheets/sheet1.xml'), tools = docs.get('xl/worksheets/sheet2.xml');
      assert.equal(members.querySelector('dimension').getAttribute('ref'), 'A1:E3');
      assert.equal(members.querySelector('[r="D1"]').textContent, '■ 追加予定（空）');
      assert.equal(members.querySelector('[r="D2"]'), null);
      assert.equal(members.querySelector('[r="C3"]'), null);
      assert.equal(tools.querySelector('dimension').getAttribute('ref'), 'A1:D2');
      assert.equal(tools.querySelector('[r="B2"]').textContent, '移動幕');
      assert.equal(tools.querySelector('[r="D2"]').textContent, '椅子');
      assert.equal(tools.querySelector('[r="F2"]'), null);
      results.push({ viewport, menuScreenshot, topbarBefore: closedBox, topbarAfter: openBox, menuBox, downloadedFile, xmlFiles: docs.size, twoSheets: true, committedName: true, groupedToolNamesOnly: true, formulas: 0 });
    } else {
      results.push({ viewport, menuScreenshot, topbarBefore: closedBox, topbarAfter: openBox, menuBox, defaultToolCheckbox: true, createButtonInViewport: true });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'browser-results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally { await browser.close(); }
