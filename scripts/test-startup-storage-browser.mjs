import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

// Anonymous fixtures and isolated contexts only. No production/native storage.
const origin = process.env.REPOSITORY_TEST_ORIGIN ?? 'http://127.0.0.1:5179';
const url = new URL(origin);
assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
const { stage: base } = JSON.parse(await readFile(new URL('../src/repositories/contract/fixtures/commitProjects.json', import.meta.url), 'utf8'));
const zip = new JSZip();
zip.file('manifest.json', JSON.stringify({ app: '隊列メーカー', fileType: 'tairetsu-project', formatVersion: 1, includesAudio: true }));
zip.file('project.json', JSON.stringify({ ...base, title: '起動読み込み', audio: { id: 'startup-audio', name: 'test.mp3', type: 'audio/mpeg', size: 5 } }));
zip.file('audio/audio.mp3', new Uint8Array([0, 1, 2, 3, 4]));
const bytes = [...await zip.generateAsync({ type: 'uint8array' })];
// Run at document creation, including StrictMode startup. Each tab receives one
// file; reload must verify persistence rather than importing another copy.
const deliverStartupFile = ({ timing, bytes }) => {
  if (sessionStorage.getItem('startup-import-dispatched')) return;
  const observer = new MutationObserver(() => {
    const add = document.querySelector('.formation-card--new');
    const input = document.querySelector('input[type="file"][accept*=".zip"]');
    if (!add || !input || (timing === 'ready' && add.disabled)) return;
    observer.disconnect();
    sessionStorage.setItem('startup-import-dispatched', 'true');
    window.startupImport = { timing, disabled: add.disabled, dispatched: performance.now() };
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'startup.zip', { type: 'application/zip' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true });
};
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const timing of ['ready', 'early']) {
    const context = await browser.newContext();
    try {
      // Dispatch in the same browser task as button enablement, with no driver
      // round-trip, ZIP generation, module warmup, or arbitrary 2s delay.
      await context.addInitScript(deliverStartupFile, { timing, bytes });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      if (timing === 'early') {
        // Deterministically hold startup before optional maintenance finishes.
        await page.route('**/src/storage/maintenance.ts', async route => {
          const response = await route.fetch();
          await new Promise(resolve => setTimeout(resolve, 300));
          await route.fulfill({ response });
        });
      }
      await page.goto(origin);
      const title = page.getByRole('textbox', { name: '隊列表名', exact: true });
      await expect(title).toHaveValue('起動読み込み');
      const dispatch = await page.evaluate(() => window.startupImport);
      assert.equal(dispatch.disabled, timing === 'early');
      for (const suffix of ['1', '2']) {
        await title.fill(`連続編集${suffix}`);
        await page.locator('.toolbar-save-button').click();
        await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty|is-saving/);
      }
      await page.getByRole('button', { name: '隊列一覧へ戻る', exact: true }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: '連続編集2を開く', exact: true })).toBeVisible();
      const audioRetained = await page.evaluate(async () => {
        const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
        const { loadAudioBlobFromIndexedDb } = await import('/src/utils/audioStorage.ts');
        const r = new IndexedDbProjectRepository();
        try {
          const items = await r.list({ limit: 100 });
          const record = await r.get(items.items[0].id);
          return !!record.project.audio && (await loadAudioBlobFromIndexedDb(record.project.audio.id))?.size === 5;
        } finally { r.close(); }
      });
      assert(audioRetained);
      await expect(page.getByText('保存できませんでした。再試行できます。', { exact: true })).toHaveCount(0);
      console.log(`PASS startup ${timing}: immediate ZIP + audio + consecutive edit/save + reload`);
    } finally { await context.close(); }
  }

  const simultaneous = await browser.newContext();
  try {
    await simultaneous.addInitScript(deliverStartupFile, { timing: 'ready', bytes });
    const tabs = await Promise.all([simultaneous.newPage(), simultaneous.newPage()]);
    tabs.forEach(page => page.on('pageerror', error => errors.push(error.message)));
    await Promise.all(tabs.map(page => page.goto(origin)));
    await Promise.all(tabs.map(async (page, index) => {
      const title = page.getByRole('textbox', { name: '隊列表名', exact: true });
      await expect(title).toHaveValue(/起動読み込み/);
      await title.fill(`同時タブ${index + 1}`);
      await page.locator('.toolbar-save-button').click();
      await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty|is-saving/);
      await page.getByRole('button', { name: '隊列一覧へ戻る', exact: true }).click();
    }));
    await tabs[0].reload();
    for (const index of [1, 2]) await expect(tabs[0].getByRole('button', { name: `同時タブ${index}を開く`, exact: true })).toBeVisible();
    console.log('PASS simultaneous App startup in two tabs: immediate import/edit/save retained');
  } finally { await simultaneous.close(); }

  const context = await browser.newContext();
  try {
    const inert = `${origin}/__startup_storage_test__`;
    await context.route(inert, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage concurrency test</title>' }));
    const page = await context.newPage();
    await page.goto(inert);
    await page.evaluate(async base => {
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const { migrateLegacyStorage } = await import('/src/storage/migrationCoordinator.ts');
      const locks = await import('/src/storage/maintenanceLock.ts');
      const r = new IndexedDbProjectRepository();
      await migrateLegacyStorage({ repository: r, readers: { includeDrafts: false } });
      await r.updateMaintenance({ action: 'started' });
      for (const id of ['edit', 'rename', 'remove']) {
        await r.commit({ project: { ...base, id }, localRevision: '1', expectedRepositoryRevision: null, operationId: `seed-${id}` });
      }
      window.storageTest = { r, base, locks };
      const original = r.readMaintenance.bind(r);
      const entered = new Promise(resolve => { window.gcEntered = resolve; });
      const release = new Promise(resolve => { window.releaseGC = resolve; });
      r.readMaintenance = async () => { window.gcEntered(); await release; return original(); };
      window.gcWork = r.collectUnusedAudio();
      await entered;
      r.readMaintenance = original;
      window.writerFinished = false;
      window.writeWork = Promise.all([
        r.commit({ project: { ...base, id: 'edit', title: 'GC中の保存' }, localRevision: '2', expectedRepositoryRevision: '1', operationId: 'gc-save' }),
        r.rename({ id: 'rename', title: 'GC中の名前変更', updatedAt: base.updatedAt, localRevision: '2', expectedRepositoryRevision: '1', operationId: 'gc-rename' }),
        r.remove({ id: 'remove', expectedRepositoryRevision: '1', operationId: 'gc-remove' }),
      ]).then(() => { window.writerFinished = true; });
    }, base);
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending.filter(lock => lock.name === 'tairetsu-storage-maintenance').length)).toBe(3);
    assert.equal(await page.evaluate(() => window.writerFinished), false);
    await page.evaluate(async () => {
      window.releaseGC();
      await Promise.all([window.gcWork, window.writeWork]);
      const { r } = window.storageTest;
      if ((await r.get('edit')).project.title !== 'GC中の保存' || (await r.get('rename')).project.title !== 'GC中の名前変更' || await r.get('remove')) throw new Error('GC lost a foreground mutation');
    });
    console.log('PASS running GC: save/rename/delete wait and succeed');

    // Foreground writer first: GC must SKIP rather than wait while holding the
    // editor barrier. A second tab can start an editor immediately.
    await page.evaluate(async () => {
      const { locks } = window.storageTest;
      const entered = new Promise(resolve => { window.writerEntered = resolve; });
      const release = new Promise(resolve => { window.releaseWriter = resolve; });
      window.heldWriter = locks.withStorageWrite(async () => { window.writerEntered(); await release; });
      await entered;
      window.gcDuringWriter = locks.withStorageMaintenance(async () => 'ran', 'skipped');
    });
    const second = await context.newPage();
    await second.goto(inert);
    const skipped = await page.evaluate(() => window.gcDuringWriter);
    assert.equal(skipped, 'skipped');
    await second.evaluate(async () => {
      const { protectAudioEditor } = await import('/src/storage/maintenanceLock.ts');
      window.releaseEditor = await protectAudioEditor();
    });
    assert.equal(await page.evaluate(() => window.storageTest.r.collectUnusedAudio().then(value => value.skipped)), true);
    await second.evaluate(() => window.releaseEditor());
    await page.evaluate(async () => { window.releaseWriter(); await window.heldWriter; });
    console.log('PASS foreground writer + two tabs: GC skips; editor is not blocked');

    // Regression for a connection captured before waiting for the GC lock.
    await page.evaluate(async () => {
      const { r, locks, base } = window.storageTest;
      const entered = new Promise(resolve => { window.barrierEntered = resolve; });
      const release = new Promise(resolve => { window.releaseBarrier = resolve; });
      window.barrier = locks.withStorageMaintenance(async () => { window.barrierEntered(); await release; }, undefined);
      await entered;
      window.reopenedWrite = r.commit({ project: { ...base, id: 'after-close' }, localRevision: '1', expectedRepositoryRevision: null, operationId: 'after-close' });
    });
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending.some(lock => lock.name === 'tairetsu-storage-maintenance'))).toBe(true);
    await page.evaluate(async () => {
      const { r } = window.storageTest;
      r.close(); window.releaseBarrier();
      await Promise.all([window.barrier, window.reopenedWrite]);
      if (!await r.get('after-close')) throw new Error('Queued commit failed after connection close');
      r.close();
    });
    console.log('PASS queued commit: reopens connection after maintenance barrier');
  } finally { await context.close(); }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
