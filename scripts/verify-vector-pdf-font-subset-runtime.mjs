import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';

const directory = 'output/build31/vector-pdf-font-subset/runtime';
await mkdir(directory, { recursive: true });
const origin = 'http://127.0.0.1:5398';
const server = await createServer({ configFile: false, envFile: false, cacheDir:directory+'/.vite', logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'subset-runtime',
    resolveId(id) { if (id === '/__entry') return '\0entry'; },
    load(id) { if (id === '\0entry') return `export {default as React} from 'react'; export {createRoot} from 'react-dom/client'; export {flushSync} from 'react-dom';`; },
    configureServer(s) { s.middlewares.use('/__runtime', (_req, res) => {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><div id="root"></div>');
    }); },
  }], server: { host: '127.0.0.1', port: 5398, strictPort: true } });
const browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
const contexts = [];
const results = [];
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }); contexts.push(context);
  await context.route('**/*', route => { const u = new URL(route.request().url());
    return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
  return context.newPage();
}
try {
  await server.listen(); console.log('Owned verification PID:', process.pid);
  for (const fixture of ['festival-1', 'festival-7', 'scale-18-146-18', 'square-19x18']) {
    const page = await newPage(); await page.goto(origin + '/__runtime');
    const result = await page.evaluate(async fixture => {
      const { React, createRoot, flushSync } = await import('/__entry');
      const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
      const f = await import('/src/utils/vectorPdf/fixture.ts');
      const { defaultPrintOptions } = await import('/src/utils/printLayout.ts');
      const { ensureBrowserFonts } = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
      const { buildA4Document } = await import('/src/utils/vectorPdf/a4Document.ts');
      const { withExportClone } = await import('/src/utils/exportImage.ts');
      const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts');
      const project = fixture === 'square-19x18' ? f.vectorAssignmentFixture() : fixture.startsWith('scale') ? f.vectorEmojiFixture(true)
        : f.vectorStage2Fixture(9, 5.5, fixture === 'festival-1' ? 1 : 7);
      await ensureBrowserFonts(['bold']);
      const root = createRoot(document.getElementById('root')), options = { ...defaultPrintOptions, includeAssignments: true, viewerPerspective: 'performer' };
      flushSync(() => root.render(React.createElement(PrintPreview, { project, options })));
      const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting');
      return withExportClone(doc, async clone => {
        clone.style.fontFamily = 'BIZUDPGothic';
        const pages = buildA4Document(project, project.frames.map(f=>f.id), clone, options);
        // A separate context for EACH fixture measures a genuinely cold engine/source cache.
        const first = await renderScenePages(pages), second = await renderScenePages(pages);
        const original = await renderScenePages(pages, { fontMode: 'original' });
        // Measure the non-interruptible call itself, independently of fetch/compile/yields.
        const { createHbSubsetter } = await import('/src/utils/vectorPdf/hbSubset.ts');
        const { cachedFontBytes, fetchFontBytes, fontFileName } = await import('/src/utils/vectorPdf/fonts.ts');
        const { visibleTextLines } = await import('/src/utils/vectorPdf/model.ts');
        const wasm = await (await fetch('/node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm')).arrayBuffer();
        const { instance } = await WebAssembly.instantiate(wasm), subset = createHbSubsetter(instance.exports);
        const { bytes } = await cachedFontBytes(fetchFontBytes, fontFileName('bold'));
        const codes = [...new Set(pages.flatMap(p=>visibleTextLines(p.drawings)).flatMap(l=>[...l.text].map(c=>c.charCodeAt(0)))).values()]
          .filter(c=>c<0xd800 || c>0xdfff); // never include the emoji's UTF-16 surrogate
        const syncTimes = []; let size = 0;
        for (let i=0;i<10;i++) { const start = performance.now(); size = subset(bytes, codes).length; syncTimes.push(performance.now()-start); }
        return { fixture, first:first.metrics, second:second.metrics, original:original.metrics, syncTimes, syncSubsetBytes:size,
          wasmMemoryBytes:instance.exports.memory.buffer.byteLength,
          firstPdf:Array.from(new Uint8Array(await first.blob.arrayBuffer())), originalPdf:Array.from(new Uint8Array(await original.blob.arrayBuffer())) };
      });
    }, fixture);
    await writeFile(`${directory}/${fixture}-subset.pdf`, Buffer.from(result.firstPdf));
    await writeFile(`${directory}/${fixture}-original.pdf`, Buffer.from(result.originalPdf));
    delete result.firstPdf; delete result.originalPdf;
    assert.deepEqual(result.first.fontAttempts, ['subset']); assert.deepEqual(result.second.fontAttempts, ['subset']);
    assert.ok(result.first.bytes < result.original.bytes);
    results.push(result); console.log(fixture, result.original.bytes, '->', result.first.bytes, 'sync ms:', result.syncTimes);
    await page.context().close();
  }
} catch(error) {
  await Promise.allSettled(contexts.map(c=>c.close())); await browser.close(); throw error;
} finally { await server.close(); }

// Production build smoke: actual built asset URL, no startup WASM, MIME fallback.
let production;
try {
  production = await preview({ configFile: false, envFile: false, logLevel:'warn', preview: { host:'127.0.0.1', port:5398, strictPort:true } });
  const chunks = await readdir('dist/assets');
  const chunk = chunks.find(n=>/^hbSubsetBrowser-.*\.js$/.test(n)), wasm = chunks.find(n=>/^harfbuzz-subset-.*\.wasm$/.test(n));
  assert.ok(chunk && wasm); assert.equal((await readFile('dist/assets/'+wasm)).length, 667183);
  const page = await newPage(), requests = [];
  page.on('request', r=>requests.push(r.url()));
  await page.goto(origin, { waitUntil:'networkidle' });
  assert.ok(!requests.some(u=>u.endsWith('.wasm') || u.includes('hbSubsetBrowser-')), 'No WASM/chunk during normal app startup');
  // Simulate a bundled-origin server with an incorrect MIME type.
  await page.route('**/*.wasm', async route => { const response = await route.fetch();
    await route.fulfill({ response, headers:{...response.headers(),'content-type':'application/octet-stream'} }); });
  const smoke = await page.evaluate(async chunk => {
    const module = await import('/assets/'+chunk), subset = Object.values(module).find(v=>typeof v==='function');
    const bytes = new Uint8Array(await (await fetch('/fonts/biz-udp-gothic/BIZUDPGothic-Bold.ttf')).arrayBuffer());
    const result = await subset(bytes, [65, 0x65e5, 0x672c]);
    return { bytes:result.length, signature:[...result.slice(0,4)] };
  }, chunk);
  assert.deepEqual(smoke.signature,[0,1,0,0]); assert.ok(smoke.bytes<10_000);
  assert.equal(requests.filter(u=>u.endsWith('.wasm')).length, 1);
  results.push({ production:{chunk,wasm,wasmBytes:667183, startupWasm:false, mimeFallback:true, smoke} });
  for (const name of ['subset-font.txt','harfbuzzjs.txt']) assert.ok((await readFile('dist/licenses/'+name)).length>500);
} finally {
  production?.httpServer.close();
  await Promise.allSettled(contexts.map(c=>c.close())); await browser.close();
}
await writeFile(directory+'/results.json', JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
