import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { jsPDF } from 'jspdf';
import { compare } from './vector-pdf-visual-diff.mjs';

// Local-only acceptance matrix. Baseline modules/CSS are read from HEAD without
// changing the working tree. Existing artifacts are never used as writable inputs.
const directory = 'output/build31/empty-assignment-label';
const origin = 'http://127.0.0.1:5396';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const baseline = Object.fromEntries(['src/styles.css', 'src/components/PrintPreview.tsx'].map(file =>
  [file, execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' })]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fontBytes = await readFile('public/fonts/biz-udp-gothic/BIZUDPGothic-Bold.ttf');
const fontPdf = new jsPDF({ unit: 'mm' });
fontPdf.addFileToVFS('bold.ttf', fontBytes.toString('binary'));
fontPdf.addFont('bold.ttf', 'BIZ', 'bold', 'Identity-H'); fontPdf.setFont('BIZ', 'bold'); fontPdf.setFontSize(10.5);
const labels = { stage: 'このシーンの道具割当はありません', parade: '道具割当なし' };
const advances = Object.fromEntries(Object.entries(labels).map(([mode, text]) => [mode,
  { text, em: fontPdf.getStringUnitWidth(text), mm: fontPdf.getTextWidth(text) }]));
assert.ok(28.47 - advances.parade.mm > 5, 'Parade label must retain substantial width headroom');
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/ttf-advances.json`, JSON.stringify({ fontSha256: sha(fontBytes), fontPt: 10.5, advances }, null, 2));
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'empty-assignment-label-harness',
    resolveId(id) { if (id === '/__entry') return '\0entry'; if (id === '/__before/PrintPreview.tsx') return id; },
    load(id) {
      if (id === '\0entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom';`;
      if (id === '/__before/PrintPreview.tsx') return baseline['src/components/PrintPreview.tsx'].replace(/from "(\.[^"]+)"/g,
        (_m, source) => `from "/${path.posix.normalize('src/components/' + source)}"`);
    },
    configureServer(s) {
      s.middlewares.use('/__empty', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link id="styles" rel="stylesheet" href="/src/styles.css"><div id="root"></div></html>');
      });
      s.middlewares.use('/__before/styles.css', (_req, res) => { res.setHeader('Content-Type', 'text/css'); res.end(baseline['src/styles.css']); });
      s.middlewares.use('/__pdfjs/', async (req, res, next) => {
        if (!['/pdf.mjs', '/pdf.worker.mjs'].includes(req.url)) return next();
        res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(`node_modules/pdfjs-dist/build${req.url}`));
      });
    },
  }], server: { host: '127.0.0.1', port: 5396, strictPort: true } });

const results = [], regressions = [], errors = [], networkBlocked = [];
let browser;
try {
  await server.listen(); console.log('Owned verification PID:', process.pid, 'Baseline:', revision, 'TTF:', advances);
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
  for (const screen of [{ width: 1440, height: 900, dpr: 1 }, { width: 1180, height: 820, dpr: 2 }]) {
    const context = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, deviceScaleFactor: screen.dpr });
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin === origin || ['data:', 'blob:'].includes(u.protocol)) return route.continue();
      networkBlocked.push(u.origin); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/__empty`, { timeout: 120000 });
    const cdp = await context.newCDPSession(page);
    await page.evaluate(async () => {
      const { React, createRoot, flushSync } = await import('/__entry');
      const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
      const { PrintPreview: BeforePreview } = await import('/__before/PrintPreview.tsx');
      const layout = await import('/src/utils/printLayout.ts');
      const fixtures = await import('/src/utils/vectorPdf/fixture.ts');
      const geometry = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
      const vector = await import('/src/utils/vectorPdf/a4Document.ts');
      const { generateA4Pdf } = await import('/src/utils/a4PdfExport.ts');
      const { withExportClone, elementToJpegDataUrl } = await import('/src/utils/exportImage.ts');
      const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
      const { a4PageSize, fitPdfImage } = await import('/src/utils/pdfPageLayout.ts');
      const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
      window.h = { React, root: createRoot(document.getElementById('root')), flushSync, PrintPreview, BeforePreview,
        layout, fixtures, geometry, vector, generateA4Pdf, withExportClone, elementToJpegDataUrl, jpegDataUrlsToPdfBlob, a4PageSize, fitPdfImage, pdfjs };
      window.encodeBlob = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
      window.renderPdf = async blob => {
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false }).promise;
        const images = [], texts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i), viewport = p.getViewport({ scale: 2 }), c = document.createElement('canvas');
          c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
          await p.render({ canvasContext: c.getContext('2d'), viewport }).promise;
          images.push(c.toDataURL('image/png'));
          texts.push((await p.getTextContent()).items.filter(x => x.str !== undefined).map(x => x.str));
          c.width = c.height = 0;
        }
        await pdf.loadingTask.destroy(); return { images, texts };
      };
      window.makeProject = spec => {
        const p = fixtures.vectorStage2Fixture(spec.tall ? 10 : 9, spec.tall ? 20 : 5.4, 3);
        if (spec.mode === 'parade') {
          p.mode = 'parade'; p.paradeSettings = { totalDistance: 25, width: 9, cellSizeMeters: 1,
            direction: 'up', rulerPosition: 'both', emphasizeEvery5m: true, emphasizeEvery10m: true };
        }
        if (spec.empty) p.frames.forEach(f => { f.objectAssignments = {}; });
        return p;
      };
      window.mount = (p, spec, before = false) => {
        const options = { ...layout.defaultPrintOptions, includeAssignments: spec.assignments !== false,
          includeMeterRulers: spec.rulers, viewerPerspective: 'performer' };
        const frameIds = (spec.scope === 'current' ? [p.frames[1]] : p.frames).map(f => f.id);
        flushSync(() => window.h.root.render(React.createElement(before ? BeforePreview : PrintPreview,
          { project: p, options, scope: spec.scope, selectedFrameId: p.frames[1].id })));
        const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting');
        return { doc, options, frameIds };
      };
      window.setBaselineCss = async before => {
        const link = document.getElementById('styles');
        await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject;
          link.href = before ? '/__before/styles.css' : '/src/styles.css'; });
      };
    });
    for (const mode of ['stage', 'parade']) for (const tall of [false, true])
      for (const rulers of [true, false]) for (const scope of ['current', 'all']) {
        const spec = { mode, tall, rulers, scope, empty: true };
        const name = `${screen.width}-dpr${screen.dpr}-${mode}-${tall ? 'tall' : 'normal'}-rulers-${rulers}-${scope}`;
        console.log('Generating', name);
        const record = await page.evaluate(async ({ spec, labels }) => {
          const h = window.h, project = window.makeProject(spec), original = JSON.stringify(project);
          const { doc, options, frameIds } = window.mount(project, spec);
          const markup = doc.outerHTML, zoom = Number(getComputedStyle(document.getElementById('root')).zoom);
          const orientation = h.layout.getPrintOrientation(project), geometry = [], clones = [], legacyImages = [];
          await h.geometry.ensureBrowserFonts(['bold']);
          // Measure the exact unzoomed clone used by each production exporter.
          for (const flavor of (spec.mode === 'stage' ? ['legacy', 'vector'] : ['legacy'])) {
            await h.withExportClone(doc, async clone => {
              if (flavor === 'vector') clone.style.fontFamily = 'BIZUDPGothic';
              const sheets = [...clone.querySelectorAll('.print-page')];
              const size = h.a4PageSize(orientation);
              for (const [pageIndex, sheet] of sheets.entries()) {
                const fit = h.fitPdfImage(sheet.scrollWidth, sheet.scrollHeight, size.width, size.height);
                const paperScale = fit.width / sheet.scrollWidth * 96/72;
                for (const empty of sheet.querySelectorAll('.print-assignment-sheet__empty')) {
                  const panel = empty.closest('.print-assignment-sheet'), style = getComputedStyle(panel);
                  const p = panel.getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(empty);
                  const rects = [...r.getClientRects()].filter(x => x.width > 0), box = r.getBoundingClientRect(), u = 25.4/96;
                  const left = p.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
                  const right = p.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
                  const top = p.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
                  const bottom = p.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
                  const lines = h.geometry.measureTextLines(empty, sheet), centerErrorMm = (box.left + box.width/2 - p.left - p.width/2)*u;
                  const entry = { flavor, page: pageIndex+1, text: empty.textContent, lineCount: rects.length,
                    fontPt: parseFloat(getComputedStyle(empty).fontSize)*72/96, panelMm: p.width*u, effectiveMm: (right-left)*u,
                    textMm: box.width*u, headroomMm: (right-left-box.width)*u, centerErrorMm,
                    leftClearanceMm: (box.left-left)*u, rightClearanceMm: (right-box.right)*u,
                    topClearanceMm: (box.top-top)*u, bottomClearanceMm: (bottom-box.bottom)*u,
                    measuredLines: lines.map(({ text, x, y, size }) => ({ text, x, y, size })),
                    paperScale, paperTextMm: box.width*u*paperScale, paperEffectiveMm: (right-left)*u*paperScale,
                    // measureTextLines returns contiguous text runs. Fractional
                    // glyph rounding can split a run without creating a new line.
                    pass: empty.textContent === labels[spec.mode] && rects.length === 1 && lines.length > 0
                      && lines.every(l => Math.abs(l.y-lines[0].y) < .01)
                      && lines.map(l => l.text).join('') === labels[spec.mode] && Math.abs(centerErrorMm) <= .5
                      && box.left >= left-.05 && box.right <= right+.05 && box.top >= top-.05 && box.bottom <= bottom+.05
                      && Math.abs(parseFloat(getComputedStyle(empty).fontSize)-14) < .01 };
                  geometry.push(entry);
                }
              }
              const retained = clone.cloneNode(true);
              Object.assign(retained.style, { position: 'fixed', left: '0', top: '0', zIndex: '10000' });
              document.body.append(retained); clones.push({ flavor, doc: retained, sheets: [...retained.querySelectorAll('.print-page')] });
            });
          }
          for (const sheet of doc.querySelectorAll('.print-page')) legacyImages.push(await h.elementToJpegDataUrl(sheet));
          const legacyBlob = await h.jpegDataUrlsToPdfBlob(legacyImages, project.title, orientation);
          const publicResult = await h.generateA4Pdf({ element: doc, project, frameIds, options, title: project.title });
          const legacy = await window.renderPdf(legacyBlob), actual = await window.renderPdf(publicResult.blob);
          const diagnostics = h.vector.vectorPdfDiagnostics();
          const expectedEmptyCount = frameIds.length * (spec.mode === 'stage' ? 2 : 1);
          if (geometry.length !== expectedEmptyCount) throw new Error('Missing empty assignment panels');
          if (doc.outerHTML !== markup || JSON.stringify(project) !== original) throw new Error('Source DOM/project mutated');
          if (spec.mode === 'stage' && diagnostics.length) throw new Error('Unexpected stage fallback: ' + JSON.stringify(diagnostics));
          if (spec.mode === 'parade' && !diagnostics[0]?.reason.includes('パレード')) throw new Error('Parade did not use image fallback');
          if (spec.mode === 'stage') for (const strings of actual.texts) {
            const full = strings.join('');
            if (!full.includes(labels.stage)) throw new Error('PDF extraction lost the complete empty label');
          }
          if (spec.mode === 'parade' && actual.texts.some(t => t.some(Boolean))) throw new Error('Parade unexpectedly vectorized');
          window.current = { clones, orientation };
          return { spec, zoom, geometry, pages: legacy.images.length, actual, legacy,
            legacyPdf: await window.encodeBlob(legacyBlob), actualPdf: await window.encodeBlob(publicResult.blob),
            domUnchanged: true, savedDataUnchanged: true };
        }, { spec, labels });
        assert.equal(record.zoom, screen.width === 1440 ? .8 : 1, 'Exercise actual root CSS zoom');
        assert.ok(record.geometry.every(g => g.pass), `${name}: empty label geometry failed: ${JSON.stringify(record.geometry)}`);
        const saveData = (suffix, data) => writeFile(`${directory}/${name}-${suffix}`, Buffer.from(data.split(',')[1], 'base64'));
        await saveData('legacy-image.pdf', record.legacyPdf);
        await saveData(spec.mode === 'stage' ? 'vector.pdf' : 'public-image.pdf', record.actualPdf);
        const comparisons = [];
        for (const flavor of (mode === 'stage' ? ['legacy', 'vector'] : ['legacy'])) {
          for (let i = 0; i < record.pages; i++) {
            const clip = await page.evaluate(({ flavor, i }) => {
              const { clones, orientation } = window.current;
              for (const c of clones) c.doc.style.left = '-100000px';
              const c = clones.find(c => c.flavor === flavor), s = c.sheets[i]; c.doc.style.left = '0'; c.doc.style.top = '0';
              const size = window.h.a4PageSize(orientation), fit = window.h.fitPdfImage(s.scrollWidth, s.scrollHeight, size.width, size.height);
              c.doc.style.top = `${40-s.getBoundingClientRect().top}px`;
              const r = s.getBoundingClientRect(); window.current.capture = { c, s, size, fit };
              return { x: r.x, y: 0, width: s.scrollWidth+4, height: s.scrollHeight+44, scale: 1 };
            }, { flavor, i });
            const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
            const ref = await page.evaluate(async data => {
              const { s, size, fit } = window.current.capture, b = s.getBoundingClientRect();
              const c = document.createElement('canvas'); c.width = Math.ceil(size.width*2); c.height = Math.ceil(size.height*2);
              const ctx = c.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,c.width,c.height);
              const img = new Image(); img.src = data; await img.decode(); const scale = fit.width*2/s.scrollWidth;
              ctx.drawImage(img, fit.x*2, fit.y*2-b.y*scale, img.width*scale/devicePixelRatio, img.height*scale/devicePixelRatio);
              const boxes = selector => [...s.querySelectorAll(selector)].map(el => { const r = el.getBoundingClientRect();
                return { x: fit.x*2+(r.x-b.x)*scale-2, y: fit.y*2+(r.y-b.y)*scale-2, width: r.width*scale+4, height: r.height*scale+4 }; });
              return { image: c.toDataURL('image/png'), regions: { empty: boxes('.print-assignment-sheet__empty'), assignments: boxes('.print-assignment-sheet') } };
            }, `data:image/png;base64,${capture.data}`);
            const reference = Buffer.from(ref.image.split(',')[1], 'base64');
            const image = (flavor === 'legacy' ? record.legacy : record.actual).images[i];
            const compared = compare(reference, Buffer.from(image.split(',')[1], 'base64'), ref.regions);
            await saveData(`${flavor}-p${i+1}-dom.png`, ref.image);
            await saveData(`${flavor}-p${i+1}-pdf.png`, image);
            await writeFile(`${directory}/${name}-${flavor}-p${i+1}-diff.png`, compared.diff);
            comparisons.push({ flavor, page: i+1, regions: compared.result, pass: compared.pass });
          }
        }
        if (mode === 'parade') assert.deepEqual(record.actual.images, record.legacy.images, 'Public parade fallback must match legacy PDF');
        await page.evaluate(() => { window.current.clones.forEach(c => c.doc.remove()); });
        delete record.actual; delete record.legacy; delete record.actualPdf; delete record.legacyPdf;
        record.name = name; record.screen = screen; record.comparisons = comparisons;
        record.pass = record.geometry.every(g => g.pass) && comparisons.every(c => c.pass);
        results.push(record);
        await writeFile(`${directory}/${name}-results.json`, JSON.stringify(record, null, 2));
        console.log(name, 'pass:', record.pass, 'geometry:', record.geometry.length, 'ratios:', comparisons.map(c => c.regions.empty.ratio));
      }
    // Actual pre-change/current render comparison, with assigned panels and with
    // panels disabled, both modes and screen conditions. Exact bytes are stricter
    // than the existing visual threshold; compare PDF raster pages, not metadata.
    for (const mode of ['stage', 'parade']) for (const assignments of [true, false]) {
      const spec = { mode, tall: false, rulers: true, scope: 'all', assignments, empty: false };
      const record = await page.evaluate(async spec => {
        const h = window.h, project = window.makeProject(spec), renders = [];
        for (const before of [true, false]) {
          await window.setBaselineCss(before);
          const { doc, options, frameIds } = window.mount(project, spec, before);
          const images = [];
          for (const sheet of doc.querySelectorAll('.print-page')) images.push(await h.elementToJpegDataUrl(sheet));
          const result = await h.generateA4Pdf({ element: doc, project, options, frameIds, title: project.title });
          // Mounting a different component creates fresh React useId values.
          // Canonicalize only annotation clip IDs and their matching references;
          // retain every geometric/style/content attribute for exact comparison.
          const canonical = doc.cloneNode(true);
          [...canonical.querySelectorAll('clipPath[id]')].forEach((clip, i) => {
            const oldId = clip.id, id = `annotation-clip-${i}`;
            for (const g of canonical.querySelectorAll('[clip-path]'))
              if (g.getAttribute('clip-path') === `url(#${oldId})`) g.setAttribute('clip-path', `url(#${id})`);
            clip.id = id;
          });
          renders.push({ html: canonical.innerHTML, images, pdf: (await window.renderPdf(result.blob)).images });
        }
        return { spec, markupUnchanged: renders[0].html === renders[1].html,
          imagesUnchanged: JSON.stringify(renders[0].images) === JSON.stringify(renders[1].images),
          pdfUnchanged: JSON.stringify(renders[0].pdf) === JSON.stringify(renders[1].pdf) };
      }, spec);
      record.screen = screen; record.pass = record.markupUnchanged && record.imagesUnchanged && record.pdfUnchanged;
      regressions.push(record); console.log('HEAD regression:', JSON.stringify(record));
    }
    await context.close();
  }
  const summary = { revision, advances, thresholdUnchanged: .003, centerToleranceMm: .5, results: results.map(r =>
    ({ name: r.name, pages: r.pages, pass: r.pass })), regressions, errors, networkBlocked,
    pass: results.length === 32 && results.every(r => r.pass) && regressions.length === 8 && regressions.every(r => r.pass) && errors.length === 0 && networkBlocked.length === 0 };
  await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2)); assert.ok(summary.pass, 'Empty label acceptance checks failed');
} finally { await browser?.close(); await server.close(); }
