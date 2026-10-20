import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import os from 'node:os';

const directory = 'output/build31/vector-pdf-prototype';
const origin = 'http://127.0.0.1:5397';
const fontAssetRoot = process.argv.includes('--dist-fonts') ? 'dist' : 'public';
// No app startup, saved projects, remote services or external requests in this harness.
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'warn', publicDir: fontAssetRoot,
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'vector-prototype-harness',
    resolveId(id) { if (id === '/__vector-entry') return '\0vector-entry'; },
    load(id) { if (id === '\0vector-entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom'; export { jsPDF } from 'jspdf';`; },
    configureServer(server) {
    server.middlewares.use('/__vector', (_req, res) => { res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><body><div id="preview"></div></body></html>'); });
  } }], server: { host: '127.0.0.1', port: 5397, strictPort: true } });
let browser;
try {
  await mkdir(directory, { recursive: true }); await vite.listen();
  console.log('Owned local verification PID:', process.pid);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${origin}/__vector`);
  const result = await page.evaluate(async () => {
    const { React, createRoot, flushSync, jsPDF } = await import('/__vector-entry');
    const { PrintPreview, defaultPrintOptions } = await import('/src/components/PrintPreview.tsx');
    const { vectorPdfFixture } = await import('/src/utils/vectorPdf/fixture.ts');
    const { buildScenePage, visibleTextLines, CSS_PX_MM } = await import('/src/utils/vectorPdf/model.ts');
    const { measurePropText, measurePrintPageExtent } = await import('/src/utils/vectorPdf/browserTextLayout.ts');
    const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts');
    const { createVectorPdfPrototype } = await import('/src/utils/vectorPdf/index.ts');
    const { elementToJpegDataUrl } = await import('/src/utils/exportImage.ts');
    const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
    const { registerFonts } = await import('/src/utils/vectorPdf/fonts.ts');
    // First font request in this fresh browser context: local asset load plus jsPDF parse.
    const coldFonts = await registerFonts(new jsPDF());
    const options = { ...defaultPrintOptions, viewerPerspective: 'performer' };
    const root = createRoot(document.getElementById('preview'));
    const encode = blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    const started = performance.now();
    const faces = await Promise.all(['Regular', 'Bold'].map(async (weight, i) => {
      const face = new FontFace('BIZUDPGothic', `url(/fonts/biz-udp-gothic/BIZUDPGothic-${weight}.ttf?v=20261021)`, { weight: i ? '700 1000' : '100 600' });
      await face.load(); document.fonts.add(face); return face;
    }));
    const browserFontFaceMs = performance.now() - started;
    const outputs = [], measurements = [];
    for (const [label, width, depth, count] of [['festival-1', 9, 5.5, 1], ['decimal-1', 9.3, 5.4, 1], ['decimal-7', 9.3, 5.4, 7]]) {
      const project = vectorPdfFixture(width, depth, count);
      const vectorStart = performance.now();
      const models = project.frames.map(f => {
        flushSync(() => root.render(React.createElement(PrintPreview, { project, scope: 'current', selectedFrameId: f.id, options })));
        document.querySelector('.print-document').classList.add('is-exporting');
        return buildScenePage(project, f.id, options, measurePropText, measurePrintPageExtent(document.querySelector('.print-page')));
      });
      const modelMs = performance.now() - vectorStart;
      const vector = count === 1 ? await createVectorPdfPrototype({ project, frameIds: ['s0'], options,
        propText: measurePropText, pageExtent: { width: models[0].width, height: models[0].height },
        fallback: async () => { throw new Error('Supported fixture unexpectedly fell back'); },
      }) : await renderScenePages(models);
      const vectorTotalMs = performance.now() - vectorStart;
      outputs.push({ file: `${label}-vector.pdf`, data: await encode(vector.blob) });
      const oldStart = performance.now(), urls = [], sizes = [];
      for (const frame of project.frames) {
        flushSync(() => root.render(React.createElement(PrintPreview, { project, scope: 'current', selectedFrameId: frame.id, options })));
        const documentRoot = document.querySelector('.print-document');
        documentRoot.classList.add('is-exporting');
        const sheet = documentRoot.querySelector('.print-page');
        sizes.push({ width: sheet.scrollWidth, height: sheet.scrollHeight });
        urls.push(await elementToJpegDataUrl(sheet));
      }
      const rasterMs = performance.now() - oldStart;
      const oldPdfStart = performance.now();
      const old = await jpegDataUrlsToPdfBlob(urls, '隊列メーカー 従来画像PDF', 'landscape');
      const oldPdfMs = performance.now() - oldPdfStart;
      outputs.push({ file: `${label}-image.pdf`, data: await encode(old) });
      outputs.push({ file: `${label}-image-first-page.jpg`, data: urls[0] });
      measurements.push({ label, width, depth, count, members: 32, sizes, modelMs, vectorTotalMs, ...vector.metrics,
        legacy: { bytes: old.size, rasterMs, pdfMs: oldPdfMs, totalMs: rasterMs + oldPdfMs },
        visibleText: visibleTextLines(models[0].drawings).map(l => l.text) });
    }
    // Warm repeat is independent serialization with the browser's local asset cache.
    const p = vectorPdfFixture(), model = buildScenePage(p, 's0', options, measurePropText);
    const warm = await renderScenePages([model]);
    // Same-font diagnostic isolates geometry from the approved system-font → BIZ change.
    flushSync(() => root.render(React.createElement(PrintPreview, { project: p, scope: 'current', selectedFrameId: 's0', options })));
    const doc = document.querySelector('.print-document');
    doc.classList.add('is-exporting'); doc.style.fontFamily = 'BIZUDPGothic';
    const sheet = doc.querySelector('.print-page');
    const stageBox = sheet.querySelector('.print-stage').getBoundingClientRect();
    const sheetBox = sheet.getBoundingClientRect();
    const layoutChecks = { page: { width: sheet.scrollWidth * CSS_PX_MM, height: sheet.scrollHeight * CSS_PX_MM },
      model: { width: model.width, height: model.height },
      stage: { x: (stageBox.x - sheetBox.x) * CSS_PX_MM, y: (stageBox.y - sheetBox.y) * CSS_PX_MM },
      members: [...sheet.querySelectorAll('.print-member')].map(el => {
        const r = el.getBoundingClientRect();
        return { name: el.title, x: (r.x + r.width / 2 - stageBox.x) * CSS_PX_MM,
          y: (r.y + r.height / 2 - stageBox.y) * CSS_PX_MM,
          size: parseFloat(getComputedStyle(el).fontSize) * CSS_PX_MM,
          lines: [...el.querySelectorAll('.print-member__label-line')].map(l => { const r = l.getBoundingClientRect();
            return { text: l.textContent, y: (r.y + r.height / 2 - (el.getBoundingClientRect().y + el.getBoundingClientRect().height / 2)) * CSS_PX_MM }; }) };
      }) };
    const find = (nodes, id) => {
      for (const n of nodes) if (n.kind === 'group') { if (n.id === id) return n; const f = find(n.children, id); if (f) return f; }
    };
    let maxPositionErrorMm = 0, maxLineErrorMm = 0;
    layoutChecks.members.forEach((actual, i) => {
      const expected = find(model.drawings, `m${i}`), lines = visibleTextLines(expected.children);
      maxPositionErrorMm = Math.max(maxPositionErrorMm, Math.abs(actual.x - expected.x), Math.abs(actual.y - expected.y));
      if (Math.abs(actual.size - lines[0].size) > .01 || actual.lines.map(l => l.text).join('|') !== lines.map(l => l.text).join('|')) throw new Error('Member name layout mismatch');
      actual.lines.forEach((line, j) => { maxLineErrorMm = Math.max(maxLineErrorMm, Math.abs(line.y - lines[j].y)); });
    });
    if (maxPositionErrorMm > .02 || maxLineErrorMm > .02) throw new Error('Member coordinate/line offset mismatch');
    layoutChecks.maxPositionErrorMm = maxPositionErrorMm; layoutChecks.maxLineErrorMm = maxLineErrorMm;
    const longName = '上'.repeat(20) + '中央' + '下'.repeat(20);
    const clipped = measurePropText(longName, 10, 5, 0).map(l => l.text).join('');
    const flippedClip = measurePropText(longName, 10, 5, 180).map(l => l.text).join('');
    if (!clipped.length || clipped.length >= longName.length || flippedClip !== clipped) throw new Error('CSS clip text filtering failed');
    layoutChecks.clippedProp = { originalLength: longName.length, visible: clipped, flipped: flippedClip };
    // Keep this diagnostic alive until Playwright captures the browser's real glyphs.
    // ForeignObject rasterization can substitute fonts even when document.fonts is ready.
    Object.assign(doc.style, { left: '0', top: '0', zIndex: '1' });
    return { outputs, measurements, coldFonts, warm: warm.metrics, browserFontFaceMs, layoutChecks, userAgent: navigator.userAgent };
  });
  if (errors.length) throw new Error(errors.join('\n'));
  const clip = await page.locator('.print-page').evaluate(el => { const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: el.scrollWidth, height: el.scrollHeight }; });
  await page.screenshot({ path: `${directory}/festival-1-same-font-browser.png`, clip });
  for (const { file, data } of result.outputs) await writeFile(`${directory}/${file}`, Buffer.from(data.split(',')[1], 'base64'));
  delete result.outputs;
  result.fontAssetRoot = fontAssetRoot;
  result.machine = { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, node: process.version };
  await writeFile(`${directory}/measurements.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); await vite.close(); }
