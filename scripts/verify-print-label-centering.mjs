import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { PNG } from 'pngjs';

// Actual old stylesheet, read-only. No checkout or changes to existing outputs.
const oldCss = execFileSync('git', ['show', '78d7947:src/styles.css'], { encoding: 'utf8' });
const directory = 'output/build31/vector-pdf-assignment-fix/label-centering';
const origin = 'http://127.0.0.1:5398';
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
  plugins: [{ name: 'label-centering', resolveId(id) { if (id === '/__entry') return '\0entry'; },
    load(id) { if (id === '\0entry') return `export {default as React} from 'react';export {createRoot} from 'react-dom/client';export {flushSync} from 'react-dom';`; },
    configureServer(s) {
      s.middlewares.use('/__old.css', (_req, res) => { res.setHeader('Content-Type', 'text/css'); res.end(oldCss); });
      s.middlewares.use('/__labels', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link id="sheet" rel="stylesheet" href="/src/styles.css"><div id="preview"></div></html>'); });
    } }], server: { host: '127.0.0.1', port: 5398, strictPort: true } });
let browser;
const results = [], hash = data => createHash('sha256').update(data).digest('hex');
try {
  await mkdir(directory, { recursive: true }); await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1600 }, deviceScaleFactor: 2 });
  await context.route('**/*', route => { const u = new URL(route.request().url()); return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
  const page = await context.newPage(); await page.goto(`${origin}/__labels`);
  await page.evaluate(async () => {
    const { React, createRoot, flushSync } = await import('/__entry');
    const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
    const { vectorPdfFixture } = await import('/src/utils/vectorPdf/fixture.ts');
    const { ensureBrowserFonts } = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
    const { defaultPrintOptions } = await import('/src/utils/printLayout.ts');
    await ensureBrowserFonts(['bold']);
    window.h = { React, root: createRoot(document.getElementById('preview')), flushSync, PrintPreview, vectorPdfFixture, defaultPrintOptions };
  });
  for (const mode of ['stage', 'parade']) for (const font of ['legacy', 'BIZUDPGothic']) for (const small of [false, true]) {
    const name = `${mode}-${font}-${small ? 'tiny' : 'normal'}`;
    await page.evaluate(({ mode, font, small }) => {
      const h = window.h, p = h.vectorPdfFixture(9, 5.5);
      p.mode = mode; p.stage.memberDiameterMeters = small ? .1 : .5;
      if (mode === 'parade') p.paradeSettings = { totalDistance: 5.5, width: 9, cellSizeMeters: .5, direction: 'up', rulerPosition: 'both', emphasizeEvery5m: true, emphasizeEvery10m: true };
      const names = ['紅', 'あお', 'みどり', '山田花子', '高橋あかね', '佐々木ひかる', 'Takahashi'];
      p.members = p.members.slice(0, names.length); p.members.forEach((m, i) => { m.name = names[i]; });
      p.stageObjects = [];
      h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project: p, options: h.defaultPrintOptions })));
      const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting');
      Object.assign(doc.style, { left: '10px', top: '10px', zIndex: '1', fontFamily: font === 'legacy' ? '' : font });
      // Production names have at most two rows. Also guard a synthetic three-row
      // long label against unintended changes to the shared print line classes.
      const last = doc.querySelectorAll('.print-member__label')[names.length - 1];
      last.innerHTML = '<span class="print-member__label-line">あいう</span><span class="print-member__label-line">えおか</span><span class="print-member__label-line">きくけ</span>';
    }, { mode, font, small });
    const variants = [];
    for (const old of [true, false]) {
      await page.evaluate(async old => {
        const link = document.getElementById('sheet');
        await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = old ? '/__old.css' : '/src/styles.css'; });
        await document.fonts.ready;
      }, old);
      const measured = await page.evaluate(() => {
        const sheet = document.querySelector('.print-page'), b = sheet.getBoundingClientRect();
        const boxes = [...sheet.querySelectorAll('.print-stage .print-member')].map(icon => {
          const c = icon.getBoundingClientRect();
          return { name: icon.title, className: icon.className, circle: { x: c.x - b.x, y: c.y - b.y, width: c.width, height: c.height },
            lines: [...icon.querySelectorAll('.print-member__label-line')].map(line => {
              const range = document.createRange(); range.selectNodeContents(line); const r = range.getBoundingClientRect();
              return { text: line.textContent, x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height, centreError: (r.x + r.width / 2) - (c.x + c.width / 2) };
            }) };
        });
        return { boxes, clip: { x: b.x, y: b.y, width: sheet.scrollWidth, height: sheet.scrollHeight } };
      });
      const image = await page.screenshot({ clip: measured.clip });
      await writeFile(`${directory}/${name}-${old ? 'before' : 'after'}.png`, image);
      variants.push({ ...measured, image });
    }
    const [before, after] = variants;
    let shifted = 0;
    for (const [i, box] of after.boxes.entries()) {
      assert.deepEqual(box.circle, before.boxes[i].circle, `${name}: circle unchanged`);
      for (const [j, line] of box.lines.entries()) {
        const old = before.boxes[i].lines[j];
        assert.ok(Math.abs(line.centreError) < .025, `${name} ${box.name}: centred glyph range`);
        for (const key of ['text', 'y', 'width', 'height']) assert.equal(line[key], old[key], `${name}: only horizontal anchor may change`);
        if (Math.abs(line.x - old.x) > .025) shifted++;
        if (!small || box.className.includes('label-long')) assert.deepEqual(line, old, `${name}: fitting/multirow text unchanged`);
      }
    }
    // Exact native pixels, not the PDF AA tolerance: all changes must be inside
    // old/new glyph boxes of short names that overflow at the readable floor.
    const a = PNG.sync.read(before.image), b = PNG.sync.read(after.image);
    assert.equal(a.width, b.width); assert.equal(a.height, b.height);
    const allowed = after.boxes.flatMap((box, i) => small && !box.className.includes('label-long') ? [...box.lines, ...before.boxes[i].lines] : []);
    let changed = 0, outside = 0;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const index = (y * a.width + x) * 4;
      if ([0, 1, 2, 3].every(c => a.data[index + c] === b.data[index + c])) continue;
      changed++;
      if (!allowed.some(r => x >= r.x * 2 - 3 && x <= (r.x + r.width) * 2 + 3 && y >= r.y * 2 - 3 && y <= (r.y + r.height) * 2 + 3)) outside++;
    }
    assert.equal(outside, 0, `${name}: pixels outside corrected short text must be identical`);
    if (!small) assert.equal(changed, 0, `${name}: normal image hash unchanged`);
    results.push({ name, shifted, changed, outside, beforeHash: hash(before.image), afterHash: hash(after.image), boxes: after.boxes, pass: true });
  }
  assert.ok(results.some(r => r.shifted > 0), 'Negative control must reproduce original off-centre text');
  await writeFile(`${directory}/results.json`, JSON.stringify({ baseline: '78d7947', oldCssHash: hash(oldCss), results, pass: true }, null, 2));
  console.log(JSON.stringify({ pass: true, results: results.map(({ boxes, ...rest }) => rest) }, null, 2));
} finally { await browser?.close(); await server.close(); }
