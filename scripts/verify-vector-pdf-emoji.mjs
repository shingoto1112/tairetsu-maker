import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import os from 'node:os';
import { compare, compareGraphemes } from './vector-pdf-visual-diff.mjs';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5398);
assert.ok(port >= 5392 && port <= 5399 && port !== 5393, 'Use an allowed local verification port');
const directory = 'output/build31/vector-pdf-emoji', origin = `http://127.0.0.1:${port}`, dpi = 144;
const only = process.argv.find(a => a.startsWith('--case='))?.slice(7);
const pageLimit = Number(process.argv.find(a => a.startsWith('--pages='))?.slice(8) ?? Infinity);
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'emoji-acceptance',
    resolveId(id) { if (id === '/__emoji-entry') return '\0emoji-entry'; },
    load(id) { if (id === '\0emoji-entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom';`; },
    configureServer(s) {
    s.middlewares.use('/__emoji', (_req, res) => { res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><body><div id="preview"></div></body></html>'); });
    s.middlewares.use('/__pdfjs/', async (req, res, next) => {
      if (!['/pdf.mjs', '/pdf.worker.mjs'].includes(req.url)) return next();
      res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(`node_modules/pdfjs-dist/build${req.url}`));
    });
  } }], server: { host: '127.0.0.1', port, strictPort: true } });
const save = async (name, data) => writeFile(`${directory}/${name}`, Buffer.from(data.split(',')[1], 'base64'));
let browser;
try {
  await mkdir(directory, { recursive: true }); await server.listen(); console.log('Owned verification PID:', process.pid);
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1600 }, deviceScaleFactor: 2 });
  await context.route('**/*', route => { const url = new URL(route.request().url());
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort(); });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await page.goto(`${origin}/__emoji`);
  await page.evaluate(async () => {
    const { React, createRoot, flushSync } = await import('/__emoji-entry');
    const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
    const layout = await import('/src/utils/printLayout.ts'), fixture = await import('/src/utils/vectorPdf/fixture.ts');
    const vector = await import('/src/utils/vectorPdf/a4Document.ts');
    const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts');
    const { ensureBrowserFonts } = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
    const { elementToJpegDataUrl } = await import('/src/utils/exportImage.ts');
    const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
    const { fitPdfImage, a4PageSize } = await import('/src/utils/pdfPageLayout.ts');
    const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
    const root = createRoot(document.getElementById('preview'));
    window.h = { React, root, flushSync, PrintPreview, layout, fixture, vector, renderScenePages, ensureBrowserFonts,
      elementToJpegDataUrl, jpegDataUrlsToPdfBlob, fitPdfImage, a4PageSize, pdfjs };
    window.encodeBlob = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  });
  const results = [];
  for (const spec of [{ name: 'mixed-audience', view: 'audience' }, { name: 'mixed-performer', view: 'performer' },
    { name: 'scale-18-146-18', view: 'audience', large: true }]) {
    if (only && only !== spec.name) continue;
    console.log('Generating', spec.name);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1600, deviceScaleFactor: 2, mobile: false });
    const record = await page.evaluate(async spec => {
      const h = window.h, start = performance.now(); await h.ensureBrowserFonts(['bold']);
      const project = h.fixture.vectorEmojiFixture(spec.large), before = JSON.stringify(project);
      const options = { ...h.layout.defaultPrintOptions, includeAssignments: true, viewerPerspective: spec.view };
      h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project, options })));
      const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting');
      Object.assign(doc.style, { left: '0', top: '0', zIndex: '1', fontFamily: 'BIZUDPGothic' });
      // Freeze shrink-to-fit width before CSS zoom, which otherwise changes title
      // wrapping against the viewport during reference capture.
      doc.style.width = `${doc.querySelector('.print-stage-with-assignments').getBoundingClientRect().width}px`;
      const initialMarkup = doc.innerHTML;
      const models = h.vector.buildA4Document(project, project.frames.map(f => f.id), doc, options);
      const result = await h.renderScenePages(models, { title: project.title });
      const firstMs = performance.now() - start;
      const warmStart = performance.now(), warmModels = h.vector.buildA4Document(project, project.frames.map(f => f.id), doc, options);
      const warm = await h.renderScenePages(warmModels, { title: project.title });
      const warmMs = performance.now() - warmStart;
      const pdf = await h.pdfjs.getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()), useSystemFonts: false }).promise;
      // An actual negative PDF omits only raster glyph ink; vector runs, advances,
      // shapes, clipping and shadows stay identical. No white rectangles erase backgrounds.
      const transparent = document.createElement('canvas'); transparent.width = transparent.height = 1;
      const transparentUrl = transparent.toDataURL('image/png');
      const omitted = await h.renderScenePages(models, { title: project.title, rasterize: (_text, line) => ({
        dataUrl: transparentUrl, left: 0, top: -line.size, width: line.size, height: line.size, pixels: 1 }) });
      const negativePdf = await h.pdfjs.getDocument({ data: new Uint8Array(await omitted.blob.arrayBuffer()), useSystemFonts: false }).promise;
      const images = [], negativeImages = [], texts = [], sheets = [...doc.querySelectorAll('.print-page')];
      for (let i = 0; i < pdf.numPages; i++) {
        const p = await pdf.getPage(i + 1), viewport = p.getViewport({ scale: 2 }), canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; images.push(canvas.toDataURL('image/png'));
        const negativePage = await negativePdf.getPage(i + 1);
        await negativePage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; negativeImages.push(canvas.toDataURL('image/png'));
        canvas.width = 0; canvas.height = 0;
        const actual = (await p.getTextContent()).items.filter(x => x.str !== undefined).map(x => x.str).join('').replace(/\s/g, '');
        const expected = result.vectorText[i].join('').replace(/\s/g, '');
        if (actual !== expected) throw new Error(`Vector-run extraction mismatch p${i + 1}: ${actual} / ${expected}`);
        texts.push({ page: i + 1, actual, expected, pass: true });
      }
      await pdf.loadingTask.destroy();
      await negativePdf.loadingTask.destroy();
      // Also exercise the public A4 path, which formerly fell back on any emoji.
      const publicBlob = await h.vector.createA4VectorPdf({ project, frameIds: project.frames.map(f => f.id), element: doc,
        options, title: project.title, fallback: async () => { throw new Error('Unexpected full-document fallback'); } });
      if (!(await publicBlob.text()).includes('/FontFile2')) throw new Error('Public path lost vector text');
      if (doc.innerHTML !== initialMarkup || doc.querySelector('[data-ephemeral]')) throw new Error('Measurement changed the print DOM');
      const raw = await result.blob.text(), aliases = result.metrics.graphemeImages;
      if (!raw.includes('/SMask') || aliases.imageUses <= aliases.imageTypes) throw new Error('Missing transparent/reused fallback images');
      // Old exporter: original system-font DOM, exactly as whole-document fallback.
      doc.style.fontFamily = ''; const legacyStart = performance.now(), legacyImages = [];
      for (const sheet of sheets) legacyImages.push(await h.elementToJpegDataUrl(sheet));
      const legacy = await h.jpegDataUrlsToPdfBlob(legacyImages, project.title, 'landscape');
      const legacyMs = performance.now() - legacyStart; doc.style.fontFamily = 'BIZUDPGothic';
      if (JSON.stringify(project) !== before) throw new Error('Saved data changed');
      window.current = { doc, sheets, project, options };
      return { name: spec.name, firstMs, warmMs, legacyMs, vectorBytes: result.blob.size, legacyBytes: legacy.size,
        metrics: result.metrics, pdfImages: { objects: (raw.match(/\/Subtype \/Image/g) ?? []).length, alphaMasks: (raw.match(/\/SMask/g) ?? []).length },
        texts, domRestored: true, pages: sheets.length, images, negativeImages, vector: await window.encodeBlob(result.blob),
        negativePdf: await window.encodeBlob(omitted.blob), legacy: await window.encodeBlob(legacy),
        source: { scenes: project.frames.length, members: project.members.length, objects: project.stageObjects.length,
          shapes: project.stageObjects.map(o => o.shape), emojiNames: project.members.filter(m => /🔥/u.test(m.name)).length } };
    }, spec);
    await save(`${spec.name}-vector.pdf`, record.vector); await save(`${spec.name}-old-image.pdf`, record.legacy);
    await save(`${spec.name}-missing-emoji-negative.pdf`, record.negativePdf);
    const comparisons = [];
    for (let i = 0; i < Math.min(record.pages, pageLimit); i++) {
      const captureScale = await page.evaluate(({ i, dpi }) => {
        const s = window.current.sheets[i], h = window.h, size = h.a4PageSize('landscape');
        return h.fitPdfImage(s.scrollWidth, s.scrollHeight, size.width, size.height).width * dpi / 72 / s.scrollWidth;
      }, { i, dpi });
      // Keep the measured DOM and DPR unchanged. Both CSS zoom and changing DPR
      // can round CSS borders again, changing wrapping/line boxes. Resample only
      // the captured bitmap to the physical PDF size, with the same AA limits.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      const clip = await page.evaluate(({ i, dpi, captureScale }) => {
        const { doc, sheets } = window.current, s = sheets[i], h = window.h;
        const size = h.a4PageSize('landscape'), fit = h.fitPdfImage(s.scrollWidth, s.scrollHeight, size.width, size.height);
        window.current.capture = { size, fit, factor: dpi / 72, scale: captureScale };
        doc.style.top = '0'; doc.style.top = `${40 - s.getBoundingClientRect().top}px`;
        const r = s.getBoundingClientRect(), y = Math.max(0, r.y - 40);
        window.current.capture.gutter = r.y - y;
        return { x: r.x, y,
          width: s.scrollWidth + 2, height: s.scrollHeight + 42 };
      }, { i, dpi, captureScale });
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
      const native = Buffer.from(capture.data, 'base64');
      const reference = await page.evaluate(async ({ data, i }) => {
        const { doc, sheets, capture: { size, fit, factor, gutter, scale } } = window.current, sheet = sheets[i];
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(size.width * factor); canvas.height = Math.ceil(size.height * factor);
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const image = new Image(); image.src = data; await image.decode();
        ctx.drawImage(image, fit.x * factor, fit.y * factor - gutter * scale,
          image.width * scale / devicePixelRatio, image.height * scale / devicePixelRatio);
        const b = sheet.getBoundingClientRect();
        const box = r => ({ x: fit.x * factor + (r.x - b.x) * scale - 2, y: fit.y * factor + (r.y - b.y) * scale - 2,
          width: r.width * scale + 4, height: r.height * scale + 4 });
        const rects = selector => [...sheet.querySelectorAll(selector)].map(el => box(el.getBoundingClientRect()));
        const emoji = [];
        const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT); let node;
        const segments = new Intl.Segmenter('ja', { granularity: 'grapheme' });
        while ((node = walker.nextNode())) for (const s of segments.segment(node.textContent ?? '')) {
          if (!/🔥|👩|❤️|𠮷|\p{Mark}|[\uac00-\ud7a3\u3130-\u318f]/u.test(s.segment)) continue;
          const range = document.createRange(); range.setStart(node, s.index); range.setEnd(node, s.index + s.segment.length);
          emoji.push({ ...box(range.getBoundingClientRect()), text: s.segment });
        }
        const result = { image: canvas.toDataURL('image/png'), regions: {
          text: rects('.print-scene-title h2, .print-member__label-line, .print-ruler span, .print-object span, .print-assignment-sheet__object'),
          lines: rects('.print-stage-guides'), shapes: rects('.print-stage .print-member, .print-object'), assignments: rects('.print-assignment-sheet') }, emoji };
        doc.style.top = '0'; return result;
      }, { data: `data:image/png;base64,${native.toString('base64')}`, i });
      const referenceBytes = Buffer.from(reference.image.split(',')[1], 'base64'), actualBytes = Buffer.from(record.images[i].split(',')[1], 'base64');
      const comparison = compare(referenceBytes, actualBytes, reference.regions);
      await writeFile(`${directory}/${spec.name}-p${i + 1}-regions.json`, JSON.stringify({ regions: reference.regions, emoji: reference.emoji }));
      const local = compareGraphemes(referenceBytes, actualBytes, reference.emoji);
      const prefix = `${spec.name}-p${String(i + 1).padStart(2, '0')}`;
      await writeFile(`${directory}/${prefix}-dom.png`, referenceBytes); await writeFile(`${directory}/${prefix}-vector.png`, actualBytes);
      await writeFile(`${directory}/${prefix}-diff.png`, comparison.diff); await writeFile(`${directory}/${prefix}-emoji-diff.png`, local.diff);
      const negative = record.negativeImages[i];
      const negativeCheck = compareGraphemes(referenceBytes, Buffer.from(negative.split(',')[1], 'base64'), reference.emoji);
      await save(`${prefix}-missing-emoji-negative.png`, negative);
      comparisons.push({ page: i + 1, global: comparison.result, local: local.glyphs, negative: negativeCheck.glyphs,
        pass: comparison.pass && local.pass && !negativeCheck.pass });
      console.log(spec.name, i + 1, JSON.stringify({ global: comparison.result, localMax: Math.max(...local.glyphs.map(g => g.ratio)),
        negativeRejected: !negativeCheck.pass, pass: comparisons.at(-1).pass }));
    }
    delete record.vector; delete record.legacy; delete record.images; delete record.negativeImages; delete record.negativePdf;
    record.comparisons = comparisons; record.pass = comparisons.every(c => c.pass); results.push(record);
    await writeFile(`${directory}/${spec.name}-results.json`, JSON.stringify(record, null, 2));
  }
  const summary = { dpi, thresholdUnchanged: .003, localPerGraphemeThreshold: .05, errors, machine: { platform: os.platform(), cpu: os.cpus()[0].model, node: process.version, browser: browser.version() }, results };
  await writeFile(`${directory}/${only ?? 'all'}-summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, results: results.map(({ name, pass, firstMs, warmMs, legacyMs, vectorBytes, legacyBytes, metrics, pdfImages }) =>
    ({ name, pass, firstMs, warmMs, legacyMs, vectorBytes, legacyBytes, metrics, pdfImages })) }, null, 2));
  assert.equal(errors.length, 0); assert.ok(results.every(r => r.pass), 'Visual comparison failed');
} finally { await browser?.close(); await server.close(); }
