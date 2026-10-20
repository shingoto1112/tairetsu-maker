import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { compare } from './vector-pdf-visual-diff.mjs';
import os from 'node:os';

const curtains = process.argv.includes('--curtains');
const directory = `output/build31/vector-pdf-stage2${curtains ? '/curtain-addendum' : ''}`;
const origin = 'http://127.0.0.1:5396';
const dpi = 144;
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image', 'lucide-react'] },
  plugins: [{ name: 'vector-stage2-harness',
    resolveId(id) { if (id === '/__stage2-entry') return '\0stage2-entry'; },
    load(id) { if (id === '\0stage2-entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom';`; },
    configureServer(server) {
      server.middlewares.use('/__stage2', (_req, res) => { res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><body><div id="preview"></div></body></html>'); });
      server.middlewares.use('/__pdfjs/', async (req, res, next) => {
        if (!['/pdf.mjs', '/pdf.worker.mjs'].includes(req.url)) return next();
        res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(`node_modules/pdfjs-dist/build${req.url}`));
      });
    } }], server: { host: '127.0.0.1', port: 5396, strictPort: true } });
const onlyCase = process.argv.find(a => a.startsWith('--case='))?.slice(7);
const resume = process.argv.includes('--resume');
// Targeted repair/recheck preserves the other already-verified fixtures and UI.
const previousSummary = onlyCase || resume ? JSON.parse(await readFile(`${directory}/summary.json`, 'utf8')) : null;
const results = onlyCase || resume ? JSON.parse(await readFile(`${directory}/comparisons.json`, 'utf8')) : [];
const ui = previousSummary?.ui ?? [], fallbackResults = previousSummary?.fallbackResults ?? [], errors = [];
let browser;
async function saveData(file, data) { await writeFile(`${directory}/${file}`, Buffer.from(data.split(',')[1], 'base64')); }

// Symmetric local color-distance comparison. A 2px search permits only rasterizer AA
// differences, not changed geometry; exact DOM/model/PDF text checks run alongside it.

try {
  await mkdir(directory, { recursive: true }); await vite.listen();
  console.log('Owned local verification PID:', process.pid);
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1600 }, deviceScaleFactor: 2, acceptDownloads: true });
  await context.route('**/*', route => { const u = new URL(route.request().url());
    return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/__stage2`);
  await page.evaluate(async () => {
    const { React, createRoot, flushSync } = await import('/__stage2-entry');
    const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
    const layout = await import('/src/utils/printLayout.ts');
    const fixture = await import('/src/utils/vectorPdf/fixture.ts');
    const vector = await import('/src/utils/vectorPdf/a4Document.ts');
    const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts');
    const { ensureBrowserFonts } = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
    const { visibleTextLines, CSS_PX_MM } = await import('/src/utils/vectorPdf/model.ts');
    const { elementToJpegDataUrl } = await import('/src/utils/exportImage.ts');
    const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
    const { fitPdfImage, a4PageSize } = await import('/src/utils/pdfPageLayout.ts');
    const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
    const root = createRoot(document.getElementById('preview'));
    window.h = { React, root, flushSync, PrintPreview, layout, fixture, vector, renderScenePages, ensureBrowserFonts, visibleTextLines, CSS_PX_MM,
      elementToJpegDataUrl, jpegDataUrlsToPdfBlob, fitPdfImage, a4PageSize, pdfjs };
    window.encodeBlob = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
  });
  if (onlyCase) await page.evaluate(async () => { await window.h.ensureBrowserFonts(['bold']); });
  const cases = [
    { name: 'festival-all-performer', width: 9, depth: 5.5, count: 7, assignments: true, view: 'performer', mode: 'centerSplit' },
    { name: 'festival-current-performer', width: 9, depth: 5.5, count: 1, assignments: true, view: 'performer', mode: 'centerSplit' },
    { name: 'festival-audience', width: 9, depth: 5.5, count: 7, assignments: true, view: 'audience', mode: 'centerSplit' },
    { name: 'decimal-performer', width: 9.3, depth: 5.4, count: 7, assignments: false, view: 'performer', mode: 'meters' },
    { name: 'decimal-audience', width: 9.3, depth: 5.4, count: 7, assignments: true, view: 'audience', mode: 'meters' },
    { name: 'mixed-multi-scene', width: 9, depth: 1.4, count: 7, assignments: false, view: 'performer', mode: 'centerSplit', mixed: true },
    { name: 'empty-assignments', width: 9, depth: 5.4, count: 1, assignments: true, view: 'performer', mode: 'meters', empty: true },
  ];
  for (const spec of cases) {
    if (resume && results.some(r => r.name === spec.name && r.pass)) continue;
    if (onlyCase && spec.name !== onlyCase) continue;
    if (process.argv.includes('--ui-only')) continue;
    console.log('Generating', spec.name);
    const record = await page.evaluate(async ({ spec, curtains }) => {
      const h = window.h, started = performance.now();
      const resourcesBefore = performance.getEntriesByType('resource').filter(e => e.name.includes('BIZUDPGothic-'));
      await h.ensureBrowserFonts(['bold']);
      const project = (curtains ? h.fixture.vectorCurtainFixture : h.fixture.vectorStage2Fixture)(spec.width, spec.depth, spec.count);
      project.stage.horizontalGuideMode = spec.mode;
      // Also exercise two compact prop cards in the same CSS grid row.
      if (spec.name === 'festival-audience') project.frames.forEach(f => { f.objectStates.edge.widthMeters = 1; });
      if (spec.mixed) {
        project.stageObjects = []; project.useGlobalStageSize = false;
        project.frames.forEach((f, i) => { f.objectAssignments = {}; f.stageWidthMeters = 7 + i % 3; f.stageDepthMeters = 1.1 + i % 3 * .15;
          f.positions = Object.fromEntries(project.members.map((m, j) => [m.id, { x: .4 + j % 8 * (f.stageWidthMeters - .8) / 7, y: .25 + Math.floor(j / 8) * .2 }])); });
      }
      if (spec.empty) project.frames.forEach(f => { f.objectAssignments = {}; });
      if (spec.name === 'decimal-audience') {
        project.stageObjects.find(o => o.id === 'edge').name = '折り返す道具の長い名前';
        project.stage.emphasizeVerticalNumbers = true;
        project.stage.emphasizeHorizontalEvery5 = true; project.stage.emphasizeHorizontalEvery10 = true;
      }
      const options = { ...h.layout.defaultPrintOptions, includeAssignments: spec.assignments, viewerPerspective: spec.view, sceneGapRows: spec.mixed ? 1 : 5 };
      h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project, options })));
      const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting');
      Object.assign(doc.style, { left: '0', top: '0', zIndex: '1', fontFamily: 'BIZUDPGothic' });
      const models = h.vector.buildA4Document(project, project.frames.map(f => f.id), doc, options);
      const result = await h.renderScenePages(models, { title: project.title });
      const firstMs = performance.now() - started;
      const warmStart = performance.now();
      h.vector.buildA4Document(project, project.frames.map(f => f.id), doc, options);
      const warm = await h.renderScenePages(models, { title: project.title });
      const secondMs = performance.now() - warmStart;
      const pdf = await h.pdfjs.getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()), useSystemFonts: false, isEvalSupported: false }).promise;
      const sheets = [...doc.querySelectorAll('.print-page')], checks = [], pageSizes = [], images = [], text = [];
      function group(nodes, id) { for (const n of nodes) if (n.kind === 'group') { if (n.id === id) return n; const found = group(n.children, id); if (found) return found; } }
      let maxCoordinateMm = 0, maxLineMm = 0;
      for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i], b = sheet.getBoundingClientRect(), model = models[i];
        for (const [blockIndex, block] of [...sheet.querySelectorAll('.print-scene-block')].entries()) {
          const sceneNode = model.drawings[blockIndex], stageNode = group(sceneNode.children, 'stage');
          const stageEl = block.querySelector('.print-stage'), sb = stageEl.getBoundingClientRect();
          maxCoordinateMm = Math.max(maxCoordinateMm, Math.abs((sb.x - b.x) * h.CSS_PX_MM - sceneNode.x - stageNode.x), Math.abs((sb.y - b.y) * h.CSS_PX_MM - sceneNode.y - stageNode.y));
          const frame = project.frames.find(f => f.id === sceneNode.id);
          const visible = project.members.filter(m => frame.positions[m.id] && h.layout.isPrintMemberVisible(frame, m));
          const members = [...block.querySelectorAll('.print-stage .print-member')];
          if (members.length !== visible.length) throw new Error('Visible member count mismatch');
          members.forEach((el, j) => {
            const n = group(stageNode.children, visible[j].id), r = el.getBoundingClientRect(), lines = h.visibleTextLines(n.children);
            maxCoordinateMm = Math.max(maxCoordinateMm, Math.abs((r.x + r.width / 2 - sb.x) * h.CSS_PX_MM - n.x), Math.abs((r.y + r.height / 2 - sb.y) * h.CSS_PX_MM - n.y));
            const domLines = [...el.querySelectorAll('.print-member__label-line')];
            if (domLines.map(l => l.textContent).join('|') !== lines.map(l => l.text).join('|')) throw new Error('Member wrap mismatch');
            domLines.forEach((l, k) => { const r = l.getBoundingClientRect(); maxLineMm = Math.max(maxLineMm, Math.abs((r.y + r.height / 2 - sb.y) * h.CSS_PX_MM - n.y - lines[k].y)); });
          });
        }
        const pdfPage = await pdf.getPage(i + 1), viewport = pdfPage.getViewport({ scale: 144 / 72 });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        images.push(canvas.toDataURL('image/png')); canvas.width = 0; canvas.height = 0;
        const content = await pdfPage.getTextContent();
        const expected = h.visibleTextLines(model.drawings).map(l => l.text).join('').replace(/\s/g, '');
        const actual = content.items.filter(x => x.str !== undefined).map(x => x.str).join('').replace(/\s/g, '');
        if (expected !== actual) throw new Error(`PDF text mismatch page ${i + 1}: expected ${expected} actual ${actual}`);
        text.push({ expected, actual });
        pageSizes.push({ width: sheet.scrollWidth, height: sheet.scrollHeight });
        checks.push({ frameIds: model.frameId.split(','), textCharacters: expected.length });
      }
      if (maxCoordinateMm > .025 || maxLineMm > .025) throw new Error(`Strict layout mismatch: ${maxCoordinateMm} / ${maxLineMm}`);
      // Old output deliberately uses the original system-font DOM.
      doc.style.fontFamily = '';
      const legacyStart = performance.now(), legacyImages = [];
      for (const sheet of sheets) legacyImages.push(await h.elementToJpegDataUrl(sheet));
      const legacy = await h.jpegDataUrlsToPdfBlob(legacyImages, project.title, 'landscape');
      const legacyMs = performance.now() - legacyStart;
      doc.style.fontFamily = 'BIZUDPGothic';
      const oldPdf = await h.pdfjs.getDocument({ data: new Uint8Array(await legacy.arrayBuffer()), useSystemFonts: false }).promise;
      const oldImages = [];
      for (const i of [...new Set([0, oldPdf.numPages - 1])]) {
        const oldPage = await oldPdf.getPage(i + 1), viewport = oldPage.getViewport({ scale: 144 / 72 });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await oldPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const oldImage = canvas.toDataURL('image/png');
        const newImage = new Image(); newImage.src = images[i]; await newImage.decode();
        const overview = document.createElement('canvas'); overview.width = 1684; overview.height = 632;
        const ctx = overview.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, overview.width, overview.height);
        ctx.fillStyle = '#172033'; ctx.font = 'bold 18px BIZUDPGothic';
        ctx.fillText('従来の画像PDF', 18, 24); ctx.fillText('ベクターPDF', 860, 24);
        ctx.drawImage(canvas, 0, 36, 842, 596); ctx.drawImage(newImage, 842, 36, 842, 596);
        oldImages.push({ page: i + 1, image: oldImage, comparison: overview.toDataURL('image/png') });
        canvas.width = 0; canvas.height = 0; overview.width = 0; overview.height = 0;
      }
      await oldPdf.loadingTask.destroy(); await pdf.loadingTask.destroy();
      const resourcesAfter = performance.getEntriesByType('resource').filter(e => e.name.includes('BIZUDPGothic-'));
      window.current = { project, options, models, sheets, doc };
      return { name: spec.name, spec, vectorBytes: result.blob.size, legacyBytes: legacy.size, firstMs, secondMs, legacyMs,
        metrics: result.metrics, warmMetrics: warm.metrics,
        fontRequests: resourcesAfter.slice(resourcesBefore.length).map(r => ({ name: r.name.split('/').pop(), transferSize: r.transferSize, decodedBodySize: r.decodedBodySize })),
        checks, pageSizes, maxCoordinateMm, maxLineMm, text,
        vector: await window.encodeBlob(result.blob), legacy: await window.encodeBlob(legacy), images, oldImages };
    }, { spec, curtains });
    await saveData(`${spec.name}-vector.pdf`, record.vector); await saveData(`${spec.name}-image.pdf`, record.legacy);
    for (const old of record.oldImages) {
      const suffix = String(old.page).padStart(2, '0');
      await saveData(`${spec.name}-p${suffix}-legacy.png`, old.image);
      await saveData(`${spec.name}-p${suffix}-old-new.png`, old.comparison);
    }
    const comparisons = [];
    for (let i = 0; i < record.pageSizes.length; i++) {
      // Rasterize DOM glyphs at the final 144dpi size. CSS zoom scales CSS pixels
      // (including non-scaling SVG strokes) before rasterization; no bitmap resize
      // or CSS transform changes the font hinting relative to PDF.js.
      const clip = await page.evaluate(({ i, dpi }) => { const s = window.current.sheets[i], h = window.h;
        const size = h.a4PageSize('landscape'), fit = h.fitPdfImage(s.scrollWidth, s.scrollHeight, size.width, size.height);
        const zoom = fit.width * dpi / 72 / s.scrollWidth / devicePixelRatio;
        window.current.capture = { size, fit, zoom, factor: dpi / 72 };
        window.current.doc.style.zoom = String(zoom); window.current.doc.style.top = '0';
        const offset = s.getBoundingClientRect().top; window.current.doc.style.top = `${-offset / zoom}px`;
        const r = s.getBoundingClientRect();
        // Zoom can round CSS borders up by a device pixel. Include a 4px capture
        // gutter so right/bottom edges are not cut off by screenshot clip rounding.
        return { x: r.x, y: Math.max(0, r.y), width: fit.width * dpi / 72 / devicePixelRatio + 2, height: fit.height * dpi / 72 / devicePixelRatio + 2 }; }, { i, dpi });
      const native = await page.screenshot({ clip });
      const reference = await page.evaluate(async ({ data, i, dpi }) => {
        const sheet = window.current.sheets[i], { size, fit, factor } = window.current.capture;
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(size.width * factor); canvas.height = Math.ceil(size.height * factor);
        const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        const image = new Image(); image.src = data; await image.decode();
        ctx.drawImage(image, fit.x * factor, fit.y * factor);
        const b = sheet.getBoundingClientRect(); const scale = devicePixelRatio;
        const rects = selector => [...sheet.querySelectorAll(selector)].map(el => { const r = el.getBoundingClientRect();
          return { x: fit.x * factor + (r.x - b.x) * scale - 2, y: fit.y * factor + (r.y - b.y) * scale - 2,
            width: r.width * scale + 4, height: r.height * scale + 4 }; });
        const result = { image: canvas.toDataURL('image/png'), regions: {
          text: rects('.print-scene-title h2, .print-member__label-line, .print-ruler span, .print-object span, .print-assignment-sheet__object, .print-assignment-sheet__empty'),
          lines: rects('.print-stage-guides'), shapes: rects('.print-stage .print-member, .print-object'), assignments: rects('.print-assignment-sheet') } };
        window.current.doc.style.zoom = ''; window.current.doc.style.top = '0';
        return result;
      }, { data: `data:image/png;base64,${native.toString('base64')}`, i, dpi });
      const refBytes = Buffer.from(reference.image.split(',')[1], 'base64'), vectorBytes = Buffer.from(record.images[i].split(',')[1], 'base64');
      const comparison = compare(refBytes, vectorBytes, reference.regions);
      const prefix = `${spec.name}-p${String(i + 1).padStart(2, '0')}`;
      await writeFile(`${directory}/${prefix}-dom.png`, refBytes);
      await writeFile(`${directory}/${prefix}-vector.png`, vectorBytes);
      await writeFile(`${directory}/${prefix}-diff.png`, comparison.diff);
      comparisons.push({ page: i + 1, ...comparison.result, pass: comparison.pass });
    }
    delete record.vector; delete record.legacy; delete record.images; delete record.oldImages;
    record.comparisons = comparisons; record.pass = comparisons.every(c => c.pass);
    const existing = results.findIndex(r => r.name === record.name);
    if (existing >= 0) results[existing] = record; else results.push(record);
    await writeFile(`${directory}/comparisons.json`, JSON.stringify(results, null, 2));
    console.log(spec.name, JSON.stringify({ vectorBytes: record.vectorBytes, legacyBytes: record.legacyBytes, maxCoordinateMm: record.maxCoordinateMm, maxLineMm: record.maxLineMm, comparisons }));
    if (process.argv.includes('--first')) break;
  }
  if (!process.argv.includes('--first') && !process.argv.some(a => a.startsWith('--case='))) {
    for (const mode of ['glyph', 'shape', 'parade']) {
      const check = await page.evaluate(async mode => {
        const h = window.h, { generateA4Pdf } = await import('/src/utils/a4PdfExport.ts');
        const project = h.fixture.vectorStage2Fixture(9, 5.5, 2);
        if (mode === 'glyph') project.frames[1].label += '𠮷';
        // Unknown runtime values still reject the entire document, even on page 2.
        if (mode === 'shape') {
          project.stageObjects[0].shape = 'unknown-shape';
          project.frames[0].objectStates.panel.visible = false;
          delete project.frames[0].objectAssignments.panel;
        }
        if (mode === 'parade') {
          project.mode = 'parade'; project.paradeSettings = { width: 9, totalDistance: 10.4, cellSizeMeters: .5,
            direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
        }
        const options = { ...h.layout.defaultPrintOptions, includeAssignments: true, viewerPerspective: 'performer' };
        const before = JSON.stringify(project);
        h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project, options })));
        const element = document.querySelector('.print-document'); element.classList.add('is-exporting'); element.style.fontFamily = '';
        const result = await generateA4Pdf({ project, element, options, frameIds: project.frames.map(f => f.id), title: 'Fallback verification' });
        if (element.style.fontFamily || before !== JSON.stringify(project)) throw new Error('Fallback changed source DOM font or saved data');
        const pdf = await h.pdfjs.getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()), useSystemFonts: false }).promise;
        const pages = pdf.numPages; await pdf.loadingTask.destroy();
        const raw = await result.blob.text();
        if (raw.includes('/FontFile2') || pages !== result.pageCount || (raw.match(/\/Subtype \/Image/g) ?? []).length !== pages)
          throw new Error('Full-document image fallback failed');
        return { mode, pages, bytes: result.blob.size, reason: h.vector.vectorPdfDiagnostics()[0].reason, pass: true, data: await window.encodeBlob(result.blob) };
      }, mode);
      await saveData(`${mode}-fallback.pdf`, check.data);
      // Supersede the old curtain fallback example with the unknown-shape example.
      if (curtains && mode === 'shape') await saveData('../shape-fallback.pdf', check.data);
      delete check.data; fallbackResults.push(check);
      if (curtains && mode === 'shape') {
        // Keep the replaced example's metadata consistent, retaining other results.
        for (const file of ['fallback-results.json', 'summary.json']) {
          const path = `${directory}/../${file}`, old = JSON.parse(await readFile(path, 'utf8'));
          const replace = rows => rows.map(row => row.mode === 'shape' ? check : row);
          await writeFile(path, JSON.stringify(Array.isArray(old) ? replace(old) : { ...old, fallbackResults: replace(old.fallbackResults) }, null, 2));
        }
      }
    }
    await writeFile(`${directory}/fallback-results.json`, JSON.stringify(fallbackResults, null, 2));
  }
  // A separate empty context exercises the actual App -> ShareExportModal -> normal
  // generator -> completion -> browser download, without using any real saved data.
  if (!process.argv.includes('--no-ui') && !process.argv.includes('--first') && !process.argv.some(a => a.startsWith('--case='))) {
    for (const [orientation, viewport] of [['landscape', { width: 1180, height: 820 }], ['portrait', { width: 820, height: 1180 }]]) {
    const appContext = await browser.newContext({ viewport, acceptDownloads: true });
    let releaseFont, holdFont = true, failFont = false;
    await appContext.route('**/*', async route => { const u = new URL(route.request().url());
      if (u.origin !== origin && !['data:', 'blob:'].includes(u.protocol)) return route.abort();
      if (u.pathname.endsWith('BIZUDPGothic-Bold.ttf') && holdFont) {
        holdFont = false; await new Promise(resolve => { releaseFont = resolve; });
      }
      if (u.pathname.endsWith('BIZUDPGothic-Bold.ttf') && failFont) {
        failFont = false; return route.fulfill({ status: 503, body: 'Local test: font temporarily unavailable' });
      }
      try { await route.continue(); } catch { /* cancellation aborts its own pending font fetch */ }
    });
    await appContext.addInitScript(() => { window.showSaveFilePicker = undefined; });
    const app = await appContext.newPage(); app.on('pageerror', e => errors.push(e.message));
    await app.goto(origin);
    await app.evaluate(async () => {
      const { vectorStage2Fixture } = await import('/src/utils/vectorPdf/fixture.ts');
      const { normalizeProject } = await import('/src/project/normalizeProject.ts');
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const repo = new IndexedDbProjectRepository(); await repo.initialize();
      const p = normalizeProject(vectorStage2Fixture()); p.id = 'vector-stage2-ui'; p.title = '架空・学祭Ｂ型・段階②';
      await repo.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: 'stage2-seed' }); repo.close();
    });
    await app.reload();
    await app.getByRole('button', { name: '架空・学祭Ｂ型・段階②を開く', exact: true }).click();
      for (const scope of orientation === 'landscape' ? ['cancel', 'font-fallback', 'all', 'current'] : ['cancel', 'all', 'current']) {
        await app.getByRole('button', { name: '共有と書き出し', exact: true }).click();
        const share = app.getByRole('dialog', { name: '共有と書き出し' });
        await share.getByRole('button', { name: scope === 'current' ? /^このシーンを書き出す/ : /^すべてのシーンを書き出す/ }).click();
        await share.getByRole('checkbox', { name: /道具割当も右側に表示する/ }).check();
        await expect(share.getByRole('radio', { name: '踊る人側から見た向き' })).toBeChecked();
        await app.screenshot({ path: `${directory}/ui-${orientation}-${scope}-options.png` });
        if (scope === 'font-fallback') failFont = true;
        const generationStart = performance.now();
        await share.getByRole('button', { name: 'PDFを作成', exact: true }).click();
        if (scope === 'cancel') {
          await app.locator('.export-progress-card').screenshot({ path: `${directory}/ui-${orientation}-progress-cancel.png` });
          await app.keyboard.press('Tab'); await expect(app.getByRole('button', { name: '取消', exact: true })).toBeFocused();
          if (orientation === 'portrait') await app.keyboard.press('Escape');
          else await app.getByRole('button', { name: '取消', exact: true }).click();
          releaseFont?.(); holdFont = false;
          await expect(app.locator('.export-progress-card')).toHaveCount(0, { timeout: 90000 });
          await expect(app.getByRole('dialog', { name: '書き出し完了' })).toHaveCount(0);
          await app.screenshot({ path: `${directory}/ui-${orientation}-cancelled.png` });
          const diagnosticCount = await app.evaluate(async () => (await import('/src/utils/vectorPdf/a4Document.ts')).vectorPdfDiagnostics().length);
          assert.equal(diagnosticCount, 0);
          ui.push({ orientation, scope, pass: true, elapsedMs: performance.now() - generationStart,
            method: orientation === 'portrait' ? 'Escape' : 'button', fallbackDiagnosticCount: diagnosticCount }); continue;
        }
        const completion = app.getByRole('dialog', { name: '書き出し完了' });
        await expect(completion).toBeVisible({ timeout: 90000 });
        const generationMs = performance.now() - generationStart;
        await expect(completion.locator('img')).toBeVisible();
        const description = await completion.innerText();
        await app.screenshot({ path: `${directory}/ui-${orientation}-${scope}-completion.png` });
        const downloadEvent = app.waitForEvent('download'); await completion.getByRole('button', { name: '保存する', exact: true }).click();
        const download = await downloadEvent, file = `${directory}/ui-${orientation}-${scope}.pdf`; await download.saveAs(file);
        const raw = await readFile(file, 'latin1');
        if (scope === 'font-fallback') {
          assert.ok(!raw.includes('/FontFile2')); assert.equal((raw.match(/\/Subtype \/Image/g) ?? []).length, 7);
          const diagnostics = await app.evaluate(async () => (await import('/src/utils/vectorPdf/a4Document.ts')).vectorPdfDiagnostics());
          assert.ok(diagnostics[0].reason.includes('503'));
          ui.push({ orientation, scope, description, generationMs, bytes: (await stat(file)).size, diagnostics, pass: true });
        } else {
          assert.ok(raw.includes('/FontFile2')); assert.ok(raw.includes('/ToUnicode'));
          ui.push({ orientation, scope, description, generationMs, bytes: (await stat(file)).size, pass: true });
        }
        await completion.getByRole('button', { name: '閉じる', exact: true }).click();
      }
    await appContext.close();
    }
    await writeFile(`${directory}/ui-results.json`, JSON.stringify(ui, null, 2));
  }
  const summary = { dpi, antialiasRadiusPx: 2, colorTolerance: 32, maximumRegionBadRatio: .003,
    results: results.map(r => ({ name: r.name, pass: r.pass, pages: r.checks.length })), ui, fallbackResults, errors,
    machine: { platform: os.platform(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, node: process.version } };
  await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(errors.length, 0, 'Browser runtime errors'); assert.ok(results.every(r => r.pass), 'Region comparisons failed');
} finally { await browser?.close(); await vite.close(); }
