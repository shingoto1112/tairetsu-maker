import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:5380';
const out = 'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-impl70';
await mkdir(out, { recursive: true });
let vite;
try { await fetch(origin); } catch {
  vite = await createServer({ server: { host: '127.0.0.1', port: 5380, strictPort: true } }); await vite.listen();
}
const browser = await chromium.launch({ headless: true });
const errors = [], results = [];
if (process.argv.includes('--matrix-only')) results.push(...JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8')).filter(result => result.uiImages));
const context = await browser.newContext({ viewport: { width: 1376, height: 1032 } });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin); await expect(page.locator('.library-shell')).toBeVisible();
  const projects = await page.evaluate(async () => {
    const { formationExportFixture } = await import('/src/utils/formationExportFixture.ts');
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const repository = new IndexedDbProjectRepository(); await repository.initialize();
    const projects = ['stage', 'parade'].map(mode => {
      const p = formationExportFixture(); p.id = `export70-${mode}`; p.mode = mode; p.title = `架空演目・${mode === 'stage' ? '舞台' : 'パレード'}`;
      p.stage.horizontalGuideMode = 'centerSplit'; p.stage.gridSizeMeters = .5;
      p.paradeSettings = { totalDistance: 100, width: 12, cellSizeMeters: 1, direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
      p.frames = Array.from({ length: mode === 'stage' ? 26 : 3 }, (_, i) => ({ ...structuredClone(p.frames[i % 3]), id: `scene-${i}`, label: `場面${i + 1}・架空の公演`, timeSec: i * 30, objectAssignments: { flag: ['m0', 'm1'] } }));
      p.frames.forEach(f => { f.annotationLines = { test: { x1: 1, y1: 1, x2: 10, y2: 6, color: 'blue', dash: 'dashed' } }; });
      return p;
    });
    for (const project of projects) await repository.commit({ project, localRevision: '1', expectedRepositoryRevision: null, operationId: project.id });
    repository.close(); return projects;
  });
  await page.reload();
  for (const p of process.argv.includes('--matrix-only') ? [] : projects) {
    await page.getByRole('button', { name: `${p.title}を開く`, exact: true }).click(); await expect(page.locator('.toolbar')).toBeVisible();
    const notice = page.getByRole('button', { name: 'お知らせを閉じる', exact: true }); if (await notice.count()) await notice.click();
    await page.getByRole('button', { name: '共有と書き出し', exact: true }).click();
    await expect(page.getByText('隊列表（A4）', { exact: true })).toBeVisible();
    assert.equal(await page.getByText('道具名簿', { exact: true }).count(), 0);
    assert.equal(await page.getByText('道具割当表', { exact: true }).count(), 0);
    await page.getByRole('button', { name: /^すべてのシーンを書き出す/ }).click();
    await page.getByRole('button', { name: '画像', exact: true }).click();
    if (p.mode === 'stage') await page.screenshot({ path: path.join(out, 'format-selection-1376x1032.png') });
    await page.evaluate(() => {
      window.exportShares = []; let attempt = 0;
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: ({ files }) => {
        window.exportShares.push(files); attempt++;
        return attempt === 1 ? Promise.reject(new DOMException('cancel', 'AbortError')) : attempt === 2 ? Promise.reject(new Error('test share failure')) : Promise.resolve();
      } });
    });
    await page.getByRole('button', { name: '画像を作成', exact: true }).click();
    const done = page.getByRole('dialog', { name: '書き出し完了' }); await expect(done).toBeVisible({ timeout: 120000 });
    for (const text of [/取り消しました。作成済み/, /受け渡しに失敗/, /共有先への受け渡しが完了/]) {
      await done.getByRole('button', { name: '共有する', exact: true }).click(); await expect(done.getByRole('status')).toContainText(text);
    }
    const shares = await page.evaluate(async () => {
      const arrays = window.exportShares;
      for (const files of arrays) if (files.some((file, i) => file !== arrays[0][i])) throw Error('retry changed files');
      const read = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
      return { names: arrays.map(files => files.map(file => file.name)), images: await Promise.all(arrays[0].slice(0, 2).map(read)) };
    });
    assert.deepEqual(shares.names[0], shares.names[1]); assert.deepEqual(shares.names[0], shares.names[2]);
    if (p.mode === 'stage') {
      assert.ok(shares.names[0].length >= 12);
      shares.names[0].forEach((name, i) => assert.match(name, new RegExp(`_${String(i + 1).padStart(3, '0')}\\.png$`)));
      const viewer = await context.newPage();
      for (const [i, image] of shares.images.entries()) {
        await writeFile(path.join(out, `a4-original-${i + 1}.png`), Buffer.from(image.split(',')[1], 'base64'));
        await viewer.setContent('<body style="margin:0;background:#eef2f4;display:flex;justify-content:center;align-items:center;height:100vh"><img style="max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);box-shadow:0 2px 12px #aaa"></body>');
        await viewer.locator('img').evaluate((element, src) => { element.src = src; }, image);
        await expect(viewer.locator('img')).toBeVisible(); await viewer.screenshot({ path: path.join(out, `a4-page-${i + 1}-1376x1032.png`) });
      }
      await viewer.close();
    }
    await done.getByRole('button', { name: '保存する', exact: true }).click();
    await page.evaluate(() => { window.exportSaves = []; window.showSaveFilePicker = async ({ suggestedName }) => ({ createWritable: async () => ({ write: async () => window.exportSaves.push(suggestedName), close: async () => {} }) }); });
    const saved = [];
    for (let i = 1; i <= Math.min(2, shares.names[0].length); i++) {
      await done.getByRole('button', { name: `${i}枚目を保存`, exact: true }).click();
      await expect(done.getByRole('status')).toHaveText('保存しました。');
      saved.push(await page.evaluate(() => window.exportSaves[window.exportSaves.length - 1]));
    }
    assert.deepEqual(saved, shares.names[0].slice(0, saved.length));
    await done.getByRole('button', { name: '閉じる', exact: true }).click();
    // Exercise the actual camera button in both editor modes.
    const camera = page.getByRole('button', { name: /画像保存|ステージを画像保存|ステージ画像を保存/ }).first();
    const candidates = await page.getByRole('button').evaluateAll(buttons => buttons.filter(b => /画像|カメラ/.test(b.getAttribute('aria-label') || b.title || b.textContent)).map(b => ({ text: b.textContent, title: b.title, aria: b.getAttribute('aria-label') })));
    console.log('CAMERA_CONTROLS', p.mode, JSON.stringify(candidates));
    await camera.click();
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    await page.getByRole('button', { name: 'PDFを作成', exact: true }).click();
    await expect(done).toBeVisible({ timeout: 120000 }); await expect(done.getByText(/PDF・1ページ/)).toBeVisible();
    await done.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: '隊列一覧へ戻る', exact: true }).click(); await expect(page.locator('.library-shell')).toBeVisible();
    results.push({ mode: p.mode, uiImages: shares.names[0].length, retry: 'cancel/failure/success: same ordered files', saved, cameraPdf: 'one page' });
  }
  // Independent bounded generation checks with real encoders, both formats and assignment options.
  const matrix = await page.evaluate(async projects => {
    const { generateA4Document } = await import('/scripts/testing/export-a4.tsx');
    const output = [];
    for (const project of projects) for (const assignments of [false, true]) for (const scope of ['all', 'current']) {
      const p = structuredClone(project); if (assignments || p.mode === 'parade') p.frames = p.frames.slice(0, 3);
      const ink = [], released = []; const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { if (/^\d+\/\d+$/.test(text)) { ink.push(text); released.push(this.canvas); } return original.call(this, text, ...args); };
      let png; try { png = await generateA4Document(p, 'png', { includeAssignments: assignments }, scope); } finally { CanvasRenderingContext2D.prototype.fillText = original; }
      const pdf = await generateA4Document(p, 'pdf', { includeAssignments: assignments }, scope);
      const pdfText = new TextDecoder('latin1').decode(await pdf.files[0].arrayBuffer());
      const pdfPages = [...pdfText.matchAll(/\/Type \/Page\b/g)].length;
      if (pdfPages !== png.files.length || pdf.pageCount !== png.pageCount) throw Error('A4 PDF/image page mismatch');
      const expected = png.pageCount > 1 ? png.files.map((_, i) => `${i + 1}/${png.pageCount}`) : [];
      if (JSON.stringify(ink) !== JSON.stringify(expected)) throw Error('page ink mismatch');
      if (released.some(canvas => canvas.width || canvas.height)) throw Error('canvas not released');
      output.push({ mode: p.mode, assignments, scope, png: png.files.length, pdfPages, ink, bytes: pdf.files[0].size });
    }
    return output;
  }, projects);
  results.push(...matrix); assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log('EXPORT_BROWSER PASS', JSON.stringify(results, null, 2), out);
} catch (error) { await page.screenshot({ path: path.join(out, 'debug-failure.png') }); console.log('FAILED_STATE', (await page.locator('body').innerText()).slice(-3000)); throw error; } finally { await browser.close(); await vite?.close(); }
