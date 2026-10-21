import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { compare } from './vector-pdf-visual-diff.mjs';

const directory = 'output/build31/prop-labels', port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5397), origin = `http://127.0.0.1:${port}`;
assert.ok(port >= 5395 && port <= 5399, 'Use only the allocated verification ports');
const headPrint = execFileSync('git', ['show', 'HEAD:src/components/PrintPreview.tsx'], { encoding: 'utf8' })
  .replace(/from "(\.[^"]+)"/g, (_m, source) => 'from "' + (source.startsWith('../') ? '/src/' + source.slice(3) : '/src/components/' + source.slice(2)) + '"');
const headCss = execFileSync('git', ['show', 'HEAD:src/styles.css'], { encoding: 'utf8' });
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'prop-label-harness', resolveId(id) { if (id === '/__head.tsx' || id === '/__entry') return id; },
    load(id) { if (id === '/__head.tsx') return headPrint;
      if (id === '/__entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom';`; },
    configureServer(s) {
      s.middlewares.use('/__labels', (_req, res) => { res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link id="styles" rel="stylesheet" href="/src/styles.css"><div id="root"></div></html>'); });
      s.middlewares.use('/__head.css', (_req, res) => { res.setHeader('Content-Type', 'text/css'); res.end(headCss); });
      s.middlewares.use('/__pdfjs/', async (req, res, next) => {
        if (!['/pdf.mjs', '/pdf.worker.mjs'].includes(req.url)) return next();
        res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(`node_modules/pdfjs-dist/build${req.url}`));
      });
    } }], server: { host: '127.0.0.1', port, strictPort: true } });
const save = (name, data) => writeFile(`${directory}/${name}`, Buffer.from(data.split(',')[1], 'base64'));
const results = [], errors = [];
let browser;
try {
  await mkdir(directory, { recursive: true }); await server.listen(); console.log('Owned local verification PID:', process.pid);
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
  for (const screen of [{ name: 'pc', width: 1440, height: 900, dpr: 1 }, { name: 'ipad', width: 1180, height: 820, dpr: 2 }]) {
    const selectedScreen = process.argv.find(a => a.startsWith('--screen='))?.slice(9);
    if (selectedScreen && screen.name !== selectedScreen) continue;
    const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: screen.dpr });
    await context.route('**/*', route => { const u = new URL(route.request().url()); return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.text().startsWith('[labels]')) console.log(m.text()); });
    await page.goto(`${origin}/__labels`);
    await page.evaluate(async () => {
      const { React, createRoot, flushSync } = await import('/__entry');
      const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
      const { PrintPreview: HeadPrint } = await import('/__head.tsx');
      const { StaticStagePreview } = await import('/src/components/StaticStagePreview.tsx');
      const { formationExportFixture } = await import('/src/utils/formationExportFixture.ts');
      const geometry = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
      const vector = await import('/src/utils/vectorPdf/a4Document.ts');
      const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts');
      const layout = await import('/src/utils/printLayout.ts');
      const labels = await import('/src/utils/printObjectLabelBrowser.ts');
      const pureLabels = await import('/src/utils/printObjectLabel.ts');
      const { withExportClone, elementToJpegDataUrl, elementToPngBlob } = await import('/src/utils/exportImage.ts');
      const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
      const { generateA4Images } = await import('/src/utils/a4ImageExport.ts');
      const { generateA4Pdf } = await import('/src/utils/a4PdfExport.ts');
      const { fitPdfImage, a4PageSize } = await import('/src/utils/pdfPageLayout.ts');
      const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
      window.h = { React, root: createRoot(document.getElementById('root')), flushSync, PrintPreview, HeadPrint, StaticStagePreview,
        formationExportFixture, geometry, vector, renderScenePages, layout, labels, pureLabels, withExportClone, elementToJpegDataUrl,
        jpegDataUrlsToPdfBlob, elementToPngBlob, generateA4Images, generateA4Pdf, fitPdfImage, a4PageSize, pdfjs };
      window.encode = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
      await geometry.ensureBrowserFonts(['normal', 'bold']);
    });
    if (process.argv.includes('--detail')) {
      const { verifyDetails } = await import('./verify-prop-labels-detail-build31.mjs');
      results.push(...await verifyDetails(page, context, screen, directory));
      await context.close();
      continue;
    }
    for (const mode of ['stage', 'parade']) for (const assignments of [false, true]) {
      const name = `${screen.name}-${mode}-${assignments ? 'assignments' : 'plain'}`;
      const only = process.argv.find(a => a.startsWith('--case='))?.slice(7);
      if (only && name !== only) continue;
      console.log('Generating', name);
      const record = await page.evaluate(async ({ mode, assignments }) => {
        const h = window.h, MM = 25.4 / 96, p = h.formationExportFixture(); p.mode = mode; p.title = '道具名の出力検証';
        p.stage = { ...p.stage, widthMeters: mode === 'stage' ? 12 : 8, depthMeters: mode === 'stage' ? 16 : 80,
          gridSizeMeters: .5, memberDiameterMeters: .45, frontDirection: 'bottom' };
        p.paradeSettings = { totalDistance: 80, backwardDistanceMeters: 5, width: 8, cellSizeMeters: 1, direction: 'up',
          rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
        const names = ['みかん箱1', 'みかん箱2', 'みかん箱準備', '大旗①', '舞妓台', '襖幕2', '箱', '旗👩🏽‍🎤', '箱한글', '箱e\u0301',
          '細長い幕12', '小道具1', '小道具2', 'みかん箱（12）'];
        p.stageObjects = Array.from({ length: 28 }, (_, i) => ({ id: `o${i}`, type: 'prop', name: names[i % names.length],
          color: ['#2563eb', '#a855f7', '#ea580c'][i % 3], shape: i === 10 || i === 24 ? 'curtain' : i % 7 === 3 ? 'circle' : 'rectangle',
          widthMeters: i % 14 === 10 ? 3.8 : i % 14 === 11 || i % 14 === 12 ? .08 : 1.2,
          heightMeters: i % 14 === 10 ? .16 : i % 14 === 11 || i % 14 === 12 ? .06 : .8,
          defaultX: .8 + i % 4 * (mode === 'stage' ? 2.8 : 1.7), defaultY: 1 + Math.floor(i / 4) * (mode === 'stage' ? 2 : 10),
          defaultRotation: [0, 45, 90, 137, 180][i % 5], visible: true, locked: false, zIndex: 0 }));
        p.members = Array.from({ length: 163 }, (_, i) => ({ id: `m${i}`, name: `人${i + 1}`, color: '#0d8b78' }));
        p.frames = Array.from({ length: 3 }, (_, k) => ({ id: `s${k}`, label: `道具検証${k + 1}`, timeSec: k * 20,
          positions: Object.fromEntries(p.members.map((m, i) => [m.id, { x: .3 + i % 8 * (p.stage.widthMeters - .6) / 7,
            y: .3 + Math.floor(i / 8) * (mode === 'stage' ? 15 / 20 : 84 / 20) }])),
          objectStates: Object.fromEntries(p.stageObjects.map(o => [o.id, { objectId: o.id, x: o.defaultX, y: o.defaultY,
            widthMeters: o.widthMeters, heightMeters: o.heightMeters, rotation: o.defaultRotation, visible: true, zIndex: 0 }])),
          objectAssignments: assignments ? { o0: ['m0', 'm1'], o3: ['m2'], o10: ['m3'], o11: ['m4'], o13: ['m5'] } : {} }));
        const original = JSON.stringify(p), options = { ...h.layout.defaultPrintOptions, includeAssignments: assignments };
        const css = document.getElementById('styles');
        const style = href => new Promise(resolve => { css.onload = resolve; css.href = href; });
        const canon = doc => {
          const clone = doc.cloneNode(true);
          clone.querySelectorAll('.print-object,.print-assignment-sheet__object').forEach(e => e.replaceChildren());
          return clone.innerHTML;
        };
        await style('/__head.css'); h.flushSync(() => h.root.render(h.React.createElement(h.HeadPrint, { project: p, options })));
        let doc = document.querySelector('.print-document'); doc.classList.add('is-exporting'); doc.style.fontFamily = 'BIZUDPGothic';
        const oldHtml = canon(doc);
        let oldGeometry;
        await h.withExportClone(doc, async clone => {
          oldGeometry = [...clone.querySelectorAll('.print-page,.print-scene-block,.print-stage,.print-member,.print-object,.print-assignment-sheet__object')]
            .map(e => ({ cls: e.className, w: e.offsetWidth, h: e.offsetHeight, left: e.offsetLeft, top: e.offsetTop }));
        });
        await style('/src/styles.css'); h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project: p, options })));
        doc = document.querySelector('.print-document'); doc.classList.add('is-exporting'); doc.style.fontFamily = 'BIZUDPGothic';
        if (canon(doc) !== oldHtml) throw new Error('Non-label HTML differs from HEAD');
        let models, result, renderDoc, checks = [], geometrySame;
        await h.withExportClone(doc, async clone => {
          clone.style.fontFamily = 'BIZUDPGothic'; models = h.vector.buildA4Document(p, p.frames.map(f => f.id), clone, options);
          const geometry = [...clone.querySelectorAll('.print-page,.print-scene-block,.print-stage,.print-member,.print-object,.print-assignment-sheet__object')]
            .map(e => ({ cls: e.className, w: e.offsetWidth, h: e.offsetHeight, left: e.offsetLeft, top: e.offsetTop }));
          geometrySame = JSON.stringify(geometry) === JSON.stringify(oldGeometry);
          if (!geometrySame) throw new Error('Non-label geometry differs from HEAD: ' + JSON.stringify(geometry.map((g, i) => ({ old: oldGeometry[i], current: g })).filter(pair => JSON.stringify(pair.old) !== JSON.stringify(pair.current)).slice(0, 12)));
          for (const label of clone.querySelectorAll('[data-print-object-label]')) {
            const { input, style } = h.labels.labelInput(label), fitted = h.labels.createPrintObjectLabelMeasurer()(input, style);
            const rows = [...label.querySelectorAll('.print-object-label__line')];
            if (rows.map(e => e.textContent).join('') !== input.text) throw new Error('DOM lost full name');
            if (rows.length > 2) throw new Error('More than two lines');
            if (fitted.size < 1.8 - 1e-6 || fitted.size > input.maxSize + 1e-6) throw new Error('Size outside floor/cap');
            if (!fitted.overflow && !h.pureLabels.printObjectLabelFits(input, fitted)) throw new Error('Fitted text outside shape');
            if (fitted.overflow && fitted.size !== 1.8) throw new Error('Overflow above floor');
            checks.push({ text: input.text, width: input.width, height: input.height, radius: input.radius,
              size: fitted.size, lines: fitted.lines, overflow: fitted.overflow, assignment: label.parentElement.classList.contains('print-assignment-sheet__object') });
          }
          const walk = nodes => nodes.forEach(n => { if (n.kind === 'group') {
            if (n.id.endsWith('-label') && n.clip) throw new Error('Prop text is clipped'); walk(n.children);
          } }); models.forEach(m => walk(m.drawings));
          result = await h.renderScenePages(models, { title: p.title, orientation: h.layout.getPrintOrientation(p), fillStrokes: mode === 'parade', clipPage: mode === 'parade' });
          renderDoc = clone.cloneNode(true);
        });
        const publicResult = await h.generateA4Pdf({ project: p, frameIds: p.frames.map(f => f.id), element: doc, options, title: p.title });
        const diagnostics = h.vector.vectorPdfDiagnostics();
        if (diagnostics.some(d => d.reason !== 'controlled label verification')) throw new Error('Unexpected vector fallback: ' + JSON.stringify(diagnostics));
        const pdf = await h.pdfjs.getDocument({ data: new Uint8Array(await publicResult.blob.arrayBuffer()), useSystemFonts: false }).promise;
        if (pdf.numPages !== models.length) throw new Error('Page count differs');
        const pdfImages = [], extracted = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i), viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          pdfImages.push(canvas.toDataURL('image/png')); extracted.push((await page.getTextContent()).items.filter(x => 'str' in x).map(x => x.str));
          canvas.width = 0; canvas.height = 0;
        }
        // Raster fallback graphemes have no extractable Unicode; validate every
        // ordinary prop name in model line order before PDF reading-order changes.
        const modelText = [];
        const collect = nodes => nodes.forEach(n => { if (n.kind === 'text') modelText.push(n.text); else if (n.kind === 'group') collect(n.children); });
        models.forEach(m => collect(m.drawings));
        for (const name of names.filter(s => !/👩|한|\u0301/u.test(s))) {
          if (!modelText.join('').includes(name)) throw new Error('Model name incomplete: ' + name);
        }
        const pdfPlain = extracted.flat().join('').replace(/\s/g, '');
        for (const piece of ['みかん', '箱1', '箱2', '準備', '①', '舞妓', '襖', '小道具1', '小道具2'])
          if (!pdfPlain.includes(piece)) throw new Error('PDF text missing: ' + piece);
        if (JSON.stringify(p) !== original) throw new Error('Project mutated');
        Object.assign(renderDoc.style, { position: 'fixed', left: '0', top: '0', zIndex: '10000' }); document.body.append(renderDoc);
        window.renderDoc = renderDoc; window.models = models; window.pdfImages = pdfImages;
        const a4 = h.a4PageSize(h.layout.getPrintOrientation(p)), dpi = 144;
        window.screenshotPlans = models.map((m, i) => {
          const w = Math.ceil(m.width / MM - 1e-7), height = Math.ceil(m.height / MM - 1e-7);
          const fit = h.fitPdfImage(w, height, a4.width, a4.height);
          return { width: Math.ceil(a4.width * 2), height: Math.ceil(a4.height * 2),
            transform: `translate(${fit.x * 2}px,${fit.y * 2}px) scale(${fit.width * 2 / w})`,
            sourceWidth: w, sourceHeight: height, fit };
        });
        const images = await h.generateA4Images(doc, h.layout.getPrintOrientation(p), 'labels');
        // Forced failure exercises the existing full-document image fallback.
        const fallback = await h.vector.withVectorFallback(async () => { throw new Error('controlled label verification'); }, async () => {
          const data = []; for (const sheet of doc.querySelectorAll('.print-page')) data.push(await h.elementToJpegDataUrl(sheet));
          return h.jpegDataUrlsToPdfBlob(data, p.title, h.layout.getPrintOrientation(p));
        });
        return { mode, assignments, geometrySame, pages: models.length, checks, extracted,
          vector: await window.encode(publicResult.blob), fallback: await window.encode(fallback),
          png: await window.encode(images.files[0]), preview: await window.encode(publicResult.preview), pdfImages,
          diagnostics: diagnostics.slice(), plans: window.screenshotPlans };
      }, { mode, assignments });
      await save(`${name}.pdf`, record.vector); await save(`${name}-fallback.pdf`, record.fallback);
      await save(`${name}-a4.png`, record.png); await save(`${name}-preview.jpg`, record.preview);
      const comparisons = [];
      for (let i = 0; i < record.pages; i++) {
        const plan = record.plans[i];
        await save(`${name}-pdf-${i + 1}.png`, record.pdfImages[i]);
        // Native Chromium rendering supplies the new DOM reference; never use
        // the changed old labels as the visual reference for this comparison.
        await page.evaluate(({ i, plan }) => {
          document.querySelectorAll('[data-sheet-reference]').forEach(e => e.remove());
          const wrapper = document.createElement('div'); wrapper.dataset.sheetReference = '';
          Object.assign(wrapper.style, { position: 'fixed', left: '0', top: '0', width: plan.width + 'px', height: plan.height + 'px', background: 'white', overflow: 'hidden', zIndex: '20000' });
          const sheet = window.renderDoc.querySelectorAll('.print-page')[i].cloneNode(true);
          Object.assign(sheet.style, { position: 'absolute', left: '0', top: '0', margin: '0', transformOrigin: '0 0', transform: plan.transform, fontFamily: 'BIZUDPGothic' });
          wrapper.append(sheet); document.body.append(wrapper);
        }, { i, plan });
        // captureBeyondViewport uses the requested CSS dimensions in this CDP
        // session. Dividing by DPR would incorrectly halve the DPR2 reference.
        const cdp = await context.newCDPSession(page);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: plan.width, height: plan.height, scale: 1 }, captureBeyondViewport: true });
        const reference = Buffer.from(shot.data, 'base64');
        await writeFile(`${directory}/${name}-dom-${i + 1}.png`, reference);
        const actual = Buffer.from(record.pdfImages[i].split(',')[1], 'base64');
        const diff = compare(reference, actual, { page: [{ x: 0, y: 0, width: plan.width, height: plan.height }] });
        await writeFile(`${directory}/${name}-diff-${i + 1}.png`, diff.diff); comparisons.push(diff.result);
        await cdp.detach();
      }
      await page.evaluate(() => { window.renderDoc.remove(); document.querySelectorAll('[data-sheet-reference]').forEach(e => e.remove()); });
      const { vector, fallback, png, preview, pdfImages, ...data } = record;
      data.name = name; data.comparisons = comparisons; data.pass = comparisons.every(c => Object.values(c).every(r => r.pass));
      results.push(data); await writeFile(`${directory}/${name}-results.json`, JSON.stringify(data, null, 2));
      console.log(name, 'pass:', data.pass, 'pages:', data.pages, 'geometry:', data.geometrySame, comparisons);
      // Controlled fallback diagnostics must not leak into the next verification.
    }
    await context.close();
  }
  await writeFile(`${directory}/${process.argv.includes('--detail') ? 'detail-summary' : process.argv.includes('--screen=ipad') ? 'ipad-summary' : 'summary'}.json`, JSON.stringify({ results, errors, pass: results.every(r => r.pass) && !errors.length }, null, 2));
  assert.equal(errors.length, 0); assert.ok(results.every(r => r.pass), 'DOM/PDF visual difference exceeded the existing 0.3% threshold');
} finally { await browser?.close(); await server.close(); }
