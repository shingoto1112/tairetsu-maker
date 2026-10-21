import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5395);
assert.ok(port >= 5395 && port <= 5399);
const origin = `http://127.0.0.1:${port}`;
const directory = 'output/build31/vector-pdf-parade/drawing-budget-regression';
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  cacheDir: `${directory}/vite-cache`,
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image', 'lucide-react'] },
  plugins: [{ name: 'large-parade-ui-harness',
    resolveId(id) { if (id === '/__entry') return '\0entry'; },
    load(id) { if (id === '\0entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom';`; },
    configureServer(s) {
      s.middlewares.use('/__large', (_req, res) => { res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><div id="root"></div><div id="print"></div></html>'); });
      s.middlewares.use('/__pdfjs/', async (req, res, next) => {
        if (!['/pdf.mjs', '/pdf.worker.mjs'].includes(req.url)) return next();
        res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(`node_modules/pdfjs-dist/build${req.url}`));
      });
    },
  }], server: { host: '127.0.0.1', port, strictPort: true } });
let browser;
const results = [], errors = [];
try {
  await mkdir(directory, { recursive: true }); await server.listen(); console.log('Owned large-project verification PID:', process.pid);
  browser = await chromium.launch({ headless: true });
  for (const spec of [{ name: 'pc-1440-dpr1', width: 1440, height: 900, dpr: 1 }, { name: 'ipad-1180-dpr2', width: 1180, height: 820, dpr: 2 }]) {
    const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: spec.dpr });
    await context.route('**/*', route => { const u = new URL(route.request().url());
      return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/__large`);
    await page.evaluate(async () => {
      const { React, createRoot, flushSync } = await import('/__entry');
      const { ShareExportModal } = await import('/src/components/ShareExportModal.tsx');
      const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
      const { vectorLargeParadeFixture } = await import('/src/utils/vectorPdf/paradeFixture.ts');
      const { generateA4Pdf } = await import('/src/utils/a4PdfExport.ts');
      const { validateParadeA4Export } = await import('/src/utils/paradeA4Limits.ts');
      const { vectorPdfDiagnostics } = await import('/src/utils/vectorPdf/a4Document.ts');
      const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
      const project = vectorLargeParadeFixture(), before = JSON.stringify(project);
      const root = createRoot(document.getElementById('root')), printRoot = createRoot(document.getElementById('print'));
      flushSync(() => root.render(React.createElement(ShareExportModal, { stage: project.stage, isOpen: true, isParade: true,
        projectTitle: project.title, currentSceneLabel: project.frames[0].label, onClose() {},
        async onExport(request) {
          window.exportPromise = (async () => {
            if (request.scope !== 'all' || request.format !== 'pdf' || !request.options.includeAssignments) throw new Error('UI request mismatch');
            const frameIds = project.frames.map(f => f.id);
            const estimate = validateParadeA4Export(project, frameIds, request.options);
            const mountStart = performance.now();
            flushSync(() => printRoot.render(React.createElement(PrintPreview, { project, scope: request.scope, options: request.options })));
            const element = document.querySelector('.print-document'); element.classList.add('is-exporting');
            const mountMs = performance.now() - mountStart, start = performance.now();
            const result = await generateA4Pdf({ project, frameIds, element, options: request.options, title: project.title });
            const ms = performance.now() - start;
            const pdf = await pdfjs.getDocument({ data: new Uint8Array(await result.blob.arrayBuffer()), useSystemFonts: false }).promise;
            if (pdf.numPages !== 60 || result.pageCount !== 60) throw new Error(`Expected 60 pages, got ${pdf.numPages}`);
            const textCounts = [];
            for (let i = 1; i <= pdf.numPages; i++) {
              const p = await pdf.getPage(i), text = (await p.getTextContent()).items.map(x => x.str ?? '').join('').replace(/\s/g, '');
              if (p.view[2] >= p.view[3] || !text.includes(project.frames[i - 1].label) || !text.includes('架空146')) throw new Error(`Page content missing: ${i}`);
              textCounts.push(text.length);
              // Inspect first/last representative renderings; the shared layout is unchanged.
              if (i === 1 || i === pdf.numPages) {
                const viewport = p.getViewport({ scale: 1.5 }), c = document.createElement('canvas');
                c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
                await p.render({ canvasContext: c.getContext('2d'), viewport }).promise;
                (window.renderings ??= []).push({ page: i, png: c.toDataURL() }); c.width = c.height = 0;
              }
            }
            await pdf.loadingTask.destroy();
            if (JSON.stringify(project) !== before || vectorPdfDiagnostics().length) throw new Error('Source mutated or unexpected raster fallback');
            const encode = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
            const bitmap = await createImageBitmap(result.preview), preview = { width: bitmap.width, height: bitmap.height, bytes: result.preview.size }; bitmap.close();
            return { pages: result.pageCount, bytes: result.blob.size, ms, mountMs, estimate, textCounts, preview, fallback: false,
              pdf: await encode(result.blob), renderings: window.renderings };
          })();
          // Keep failures observable by the outer test rather than a React event rejection.
          await window.exportPromise.catch(() => {});
        },
      })));
    });
    await page.getByRole('button', { name: /すべてのシーンを書き出す/ }).click();
    await page.getByRole('checkbox', { name: /道具割当も右側に表示する/ }).check();
    await page.screenshot({ path: `${directory}/${spec.name}-ui.png` });
    await page.getByRole('button', { name: 'PDFを作成', exact: true }).click();
    const record = await page.evaluate(async () => await window.exportPromise);
    await writeFile(`${directory}/${spec.name}.pdf`, Buffer.from(record.pdf.split(',')[1], 'base64'));
    for (const r of record.renderings) await writeFile(`${directory}/${spec.name}-p${r.page}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    delete record.pdf; delete record.renderings; results.push({ ...spec, ...record });
    console.log(JSON.stringify(results.at(-1), null, 2)); await context.close();
  }
  await writeFile(`${directory}/results.json`, JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, []); assert.equal(results.length, 2);
} finally { await browser?.close(); await server.close(); }
