import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Loopback only. Never use configured cloud credentials or a production backend.
const port = Number(process.env.LEGACY_DRAFT_PORT ?? 5392);
assert(Number.isInteger(port) && port >= 5392 && port <= 5399);
const origin = `http://127.0.0.1:${port}`;
process.env.VITE_COLLABORATION_V2 = '0';
process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_ANON_KEY = '';
const shotDir = process.env.LEGACY_DRAFT_SHOT_DIR ?? path.join(process.cwd(), 'output/audit-20261110/legacy-drafts-88');
const dimensions = [[1180, 820], [820, 1180]];
const checks = [], errors = [], requests = [], shots = [];
const label = '旧クラウドの下書きを救出';
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' });
let browser, context;
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
      requests.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  checks.push(...await page.evaluate(async () => {
    const { runLegacyIndexedDbSuite } = await import('/src/legacyImport/testing/browserSuite.ts');
    return runLegacyIndexedDbSuite();
  }));
  // Keep the existing shared importer/ledger browser coverage; no cloud UI or network.
  const second = await context.newPage(); await second.goto(origin);
  const db = `legacy-two-tabs-${Date.now()}`;
  for (const tab of [page, second]) await tab.evaluate(async name => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const { testImporter, fixtureRow } = await import('/src/legacyImport/testing/browserSuite.ts');
    window.legacyRepo = new IndexedDbProjectRepository({ dbName: name }); await window.legacyRepo.initialize();
    window.runLegacyImport = () => testImporter(window.legacyRepo).importOne(fixtureRow);
  }, db);
  const outcomes = await Promise.all([page, second].map(tab => tab.evaluate(() => window.runLegacyImport())));
  assert(outcomes.every(r => ['imported', 'already'].includes(r.status)));
  assert.equal(new Set(outcomes.map(r => r.targetId)).size, 1);
  assert.equal(await page.evaluate(async () => (await window.legacyRepo.list({ limit: 100 })).items.length), 1);
  for (const tab of [page, second]) await tab.evaluate(() => window.legacyRepo.close());
  await second.close(); checks.push('two actual tabs create only one independent target');

  await expect(page.getByRole('button', { name: '追加 新規 / 読込', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'ホームのその他の操作', exact: true }).click();
  await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  await expect(page.locator('.legacy-rescue-entry, .legacy-rescue-dialog')).toHaveCount(0);
  checks.push('Web has neither draft rescue menu item nor panel');

  await page.goto(`${origin}/?runtime=capacitor-ios`);
  await expect(page.getByRole('button', { name: '追加 新規 / 読込', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    await import('/src/components/LegacyRescuePanel.tsx');
    const { snapshotProject, validateSnapshot } = await import('/src/legacyImport/validation.ts');
    const { default: fixture } = await import('/supabase/tests/fixtures/legacy-export-v1.json');
    const project = snapshotProject(validateSnapshot(fixture, fixture.project.id), 'synthetic-draft');
    project.title = '試験用旧下書き'; delete project.audio;
    const raw = JSON.stringify({ project, cloudProjectId: 'old', baseUpdatedAt: null, savedAt: project.updatedAt });
    window.__legacyDraftReaders = { native: {
      draftNames: async () => ['old.json', 'old.pending.json', 'old.backup.json', 'bad.json', 'denied.json'],
      readText: async file => {
        if (file.includes('denied')) throw Object.assign(new Error(), { name: 'NotAllowedError' });
        return file.includes('bad') ? '{' : file.startsWith('personal-cloud-drafts/') ? raw : null;
      },
    } };
  });
  const capture = async (kind, width, height, root) => {
    const bounds = await root.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
    assert(await root.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no horizontal overflow');
    await mkdir(shotDir, { recursive: true });
    const file = path.join(shotDir, `${kind}-${width}x${height}.png`);
    await assert.rejects(access(file), { code: 'ENOENT' }); // Never replace existing evidence.
    await page.screenshot({ path: file }); shots.push(file);
  };
  for (const [width, height] of dimensions) {
    await page.setViewportSize({ width, height });
    const more = page.getByRole('button', { name: 'ホームのその他の操作', exact: true });
    await more.click(); await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    await capture('menu', width, height, page.locator('.library-more__panel'));
    await page.getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: label, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '戻る', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '一覧を取得', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: '端末の下書きを調べる', exact: true }).click();
    await expect(dialog.getByText('読取りが拒否されました。', { exact: true })).toBeVisible();
    await expect(dialog.getByText('破損しているため読めません。', { exact: true })).toBeVisible();
    for (const variant of ['通常の下書き', '保存途中の下書き', '予備の下書き'])
      await expect(dialog.locator('li').filter({ hasText: variant }).filter({ has: page.getByRole('button', { name: 'この下書きを独立コピーとして救出', exact: true }) })).toHaveCount(1);
    // Capture the top of the actual draft results; the list scrolls inside the dialog.
    await capture('draft', width, height, dialog);
    if (width === 1180) {
      const rescue = dialog.getByRole('button', { name: 'この下書きを独立コピーとして救出', exact: true }).first();
      await rescue.click(); await expect(dialog.getByText('独立コピーを保存しました。元ファイルは残っています。', { exact: true })).toBeVisible();
      await rescue.click(); await expect(dialog.getByText('救出済みです。編集・削除した文書は戻しません。', { exact: true })).toBeVisible();
      const count = await page.evaluate(async () => {
        const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
        const repository = new IndexedDbProjectRepository();
        try { return (await repository.list({ limit: 100 })).items.filter(item => item.title === '試験用旧下書き').length; }
        finally { repository.close(); }
      });
      assert.equal(count, 1);
      const pending = dialog.locator('li').filter({ hasText: '保存途中の下書き' });
      await expect(pending.getByText('old.pending.json', { exact: true })).toBeHidden();
      await pending.locator('summary').click();
      await expect(pending.getByText('old.pending.json', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    } else await dialog.getByRole('button', { name: '救出画面を閉じる', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(more).toBeFocused();
  }
  checks.push('iPad signed-out / collaboration OFF: direct draft UI, variants, corrupt/denied reads, explicit rescue, deduplication, Escape/close focus return');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(requests.length, 0, 'no external requests');
  console.log('LEGACY_DRAFT_BROWSER', JSON.stringify({ checks, shots, requests, errors }));
} finally {
  await context?.close(); await browser?.close(); await vite.close();
}
