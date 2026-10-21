import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { compare, compareGraphemes } from './vector-pdf-visual-diff.mjs';

const unzoomed = process.argv.includes('--unzoomed');
const quick = process.argv.includes('--quick');
const directory = process.argv.find(a => a.startsWith('--output='))?.slice(9)
  ?? `output/build31/vector-pdf-assignment-fix${unzoomed ? '/unzoomed' : ''}${quick ? '/quick' : ''}`;
const origin = 'http://127.0.0.1:5397', dpi = 144;
const only = process.argv.find(a => a.startsWith('--case='))?.slice(7);
const regressionOnly = process.argv.includes('--regressions');
const resume = process.argv.includes('--resume');
// Read-only baseline from the reported HEAD; no checkout/stash or user files changed.
const baselineFiles = ['a4Document.ts', 'browserDocumentLayout.ts', 'browserMixedText.ts'];
const baseline = Object.fromEntries(baselineFiles.map(name => [name,
  execFileSync('git', ['show', `78d7947:src/utils/vectorPdf/${name}`], { encoding: 'utf8' })]));
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'assignment-fix-harness',
    resolveId(id) { if (id === '/__entry') return '\0entry'; if (id.startsWith('/__baseline/')) return id; },
    load(id) {
      if (id === '\0entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom';`;
      if (id.startsWith('/__baseline/')) return baseline[id.split('/').pop()].replace(/from "(\.[^"]+)"/g, (_m, source) => {
        const name = `${source.split('/').pop()}.ts`;
        return `from "${source.startsWith('./') && baselineFiles.includes(name) ? `/__baseline/${name}` : '/' + path.posix.normalize('src/utils/vectorPdf/' + source)}"`;
      });
    },
    configureServer(s) {
      s.middlewares.use('/__assignment', (_req, res) => { res.setHeader('Content-Type', 'text/html');
        // #root is essential: the previous harnesses omitted desktop zoom:0.8.
        res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><div id="root"></div></html>'); });
      s.middlewares.use('/__pdfjs/', async (req, res, next) => {
        if (!['/pdf.mjs', '/pdf.worker.mjs'].includes(req.url)) return next();
        res.setHeader('Content-Type', 'application/javascript'); res.end(await readFile(`node_modules/pdfjs-dist/build${req.url}`));
      });
    },
  }], server: { host: '127.0.0.1', port: 5397, strictPort: true } });
const save = async (name, data) => writeFile(`${directory}/${name}`, Buffer.from(data.split(',')[1], 'base64'));
const hash = data => createHash('sha256').update(data).digest('hex');
const implementationHash = hash(Buffer.concat(await Promise.all([
  'src/utils/vectorPdf/a4Document.ts', 'src/utils/vectorPdf/fixture.ts', 'src/styles.css',
  'scripts/verify-vector-pdf-assignment-fix.mjs', 'scripts/vector-pdf-visual-diff.mjs',
].map(file => readFile(file)))));
const newCases = [
  ...['audience', 'performer'].map(view => ({ name: `square-19x18-${view}`, width: 19, depth: 18, count: 18, view, assignment: true })),
  ...['audience', 'performer'].map(view => ({ name: `tall-10x20-${view}`, width: 10, depth: 20, count: 2, view, assignment: true })),
  ...['audience', 'performer'].map(view => ({ name: `wide-30x12-${view}`, width: 30, depth: 12, count: 2, view, assignment: true })),
];
const stageCases = [
  { name: 'festival-all-performer', width: 9, depth: 5.5, count: 7, assignments: true, view: 'performer', mode: 'centerSplit' },
  { name: 'festival-current-performer', width: 9, depth: 5.5, count: 1, assignments: true, view: 'performer', mode: 'centerSplit' },
  { name: 'festival-audience', width: 9, depth: 5.5, count: 7, assignments: true, view: 'audience', mode: 'centerSplit' },
  { name: 'decimal-performer', width: 9.3, depth: 5.4, count: 7, assignments: false, view: 'performer', mode: 'meters' },
  { name: 'decimal-audience', width: 9.3, depth: 5.4, count: 7, assignments: true, view: 'audience', mode: 'meters' },
  { name: 'mixed-multi-scene', width: 9, depth: 1.4, count: 7, assignments: false, view: 'performer', mode: 'centerSplit', mixed: true },
  { name: 'empty-assignments', width: 9, depth: 5.4, count: 1, assignments: true, view: 'performer', mode: 'meters', empty: true },
];
const cases = [...newCases, ...stageCases, ...stageCases.map(s => ({ ...s, name: `curtain-${s.name}`, curtain: true })),
  { name: 'emoji-mixed-audience', emoji: true, view: 'audience', assignments: true },
  { name: 'emoji-mixed-performer', emoji: true, view: 'performer', assignments: true },
  { name: 'emoji-scale-18-146-18', emoji: true, large: true, view: 'audience', assignments: true }];
let browser;
const results = [], errors = [];
try {
  await mkdir(directory, { recursive: true }); await server.listen(); console.log('Owned verification PID:', process.pid);
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1600 }, deviceScaleFactor: 2 });
  await context.route('**/*', route => { const u = new URL(route.request().url());
    return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m=>{if(m.text().startsWith('[assignment]'))console.log(m.text());});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width:1600, height:1600, deviceScaleFactor:2, mobile:false });
  await page.goto(`${origin}/__assignment`, { timeout:120000 });
  if (unzoomed) await page.evaluate(()=>{document.getElementById('root').style.zoom='1';});
  await page.evaluate(async () => {
    const { React, createRoot, flushSync } = await import('/__entry');
    const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
    const layout = await import('/src/utils/printLayout.ts'), fixtures = await import('/src/utils/vectorPdf/fixture.ts');
    const vector = await import('/src/utils/vectorPdf/a4Document.ts'), baseline = await import('/__baseline/a4Document.ts');
    const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts');
    const geometry = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
    const { elementToJpegDataUrl, withExportClone } = await import('/src/utils/exportImage.ts');
    const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
    const { fitPdfImage, a4PageSize } = await import('/src/utils/pdfPageLayout.ts');
    const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
    window.h = { React, root: createRoot(document.getElementById('root')), flushSync, PrintPreview, layout, fixtures, vector, baseline,
      renderScenePages, geometry, withExportClone, elementToJpegDataUrl, jpegDataUrlsToPdfBlob, fitPdfImage, a4PageSize, pdfjs };
    window.encodeBlob = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  });
  for (const spec of cases) {
    if (only && only !== spec.name || regressionOnly && spec.assignment) continue;
    if(resume && !only) {
      try { const previous=JSON.parse(await readFile(`${directory}/${spec.name}-results.json`,'utf8'));
        if(previous.pass && previous.implementationHash===implementationHash){results.push(previous);console.log('Verified, preserved',spec.name);continue;}
      } catch(error) { if(error.code!=='ENOENT')throw error; }
    }
    console.log('Generating', spec.name);
    if (quick && spec.assignment) spec.count=2;
    const record = await page.evaluate(async spec => {
      const h = window.h; await h.geometry.ensureBrowserFonts(['bold']);
      const project = spec.assignment ? h.fixtures.vectorAssignmentFixture(spec.width, spec.depth, spec.count)
        : spec.emoji ? h.fixtures.vectorEmojiFixture(spec.large) : (spec.curtain ? h.fixtures.vectorCurtainFixture : h.fixtures.vectorStage2Fixture)(spec.width, spec.depth, spec.count);
      if (spec.mode) project.stage.horizontalGuideMode = spec.mode;
      if (spec.name.replace('curtain-', '') === 'festival-audience') project.frames.forEach(f => { f.objectStates.edge.widthMeters = 1; });
      if (spec.mixed) {
        project.stageObjects = []; project.useGlobalStageSize = false;
        project.frames.forEach((f, i) => { f.objectAssignments = {}; f.stageWidthMeters = 7 + i % 3; f.stageDepthMeters = 1.1 + i % 3 * .15;
          f.positions = Object.fromEntries(project.members.map((m, j) => [m.id, { x: .4 + j % 8 * (f.stageWidthMeters - .8) / 7, y: .25 + Math.floor(j / 8) * .2 }])); });
      }
      if (spec.empty) project.frames.forEach(f => { f.objectAssignments = {}; });
      if (spec.name.replace('curtain-', '') === 'decimal-audience') {
        project.stageObjects.find(o => o.id === 'edge').name = '折り返す道具の長い名前';
        project.stage.emphasizeVerticalNumbers = true; project.stage.emphasizeHorizontalEvery5 = true; project.stage.emphasizeHorizontalEvery10 = true;
      }
      const original = JSON.stringify(project);
      const options = { ...h.layout.defaultPrintOptions, includeAssignments: spec.assignment || spec.assignments, viewerPerspective: spec.view, sceneGapRows: spec.mixed ? 1 : 5 };
      h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project, options })));
      const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting');
      Object.assign(doc.style, { left: '0', top: '0', zIndex: '1', width: '' });
      const sourceSheets = [...doc.querySelectorAll('.print-page')];
      const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
      doc.style.fontFamily = '';
      const markup = doc.innerHTML, legacyImages = [], legacyHashes = [];
      if (spec.assignment || spec.empty) for (const sheet of sourceSheets) { const img = await h.elementToJpegDataUrl(sheet); legacyImages.push(img); legacyHashes.push(await hash(img)); }
      const legacy = legacyImages.length ? await h.jpegDataUrlsToPdfBlob(legacyImages, project.title, 'landscape') : null;
      console.log('[assignment] legacy ready', spec.name);
      doc.style.fontFamily = 'BIZUDPGothic';
      const frameIds = project.frames.map(f => f.id);
      const oldModels = spec.assignment ? h.baseline.buildA4Document(project, frameIds, doc, options) : null;
      let zoomGuard = true;
      if (getComputedStyle(document.getElementById('root')).zoom !== '1') {
        try { h.vector.buildA4Document(project, frameIds, doc, options); zoomGuard = false; }
        catch (error) { if (!error.message.includes('複製DOM')) throw error; }
      }
      const old = oldModels ? await h.renderScenePages(oldModels, { title: project.title }) : null;
      console.log('[assignment] baseline ready', spec.name);
      let models, result, renderDoc;
      await h.withExportClone(doc, async clone => {
        clone.style.fontFamily = 'BIZUDPGothic';
        models = h.vector.buildA4Document(project, frameIds, clone, options);
        result = await h.renderScenePages(models, { title: project.title });
        // Retain an identical copy for native screenshots after withExportClone's
        // host is removed; it stays outside the app's zoomed root, like legacy PDF.
        renderDoc = clone.cloneNode(true);
      });
      Object.assign(renderDoc.style, { position:'fixed', left:'0', top:'0', zIndex:'10000' });
      document.body.append(renderDoc);
      const sheets = [...renderDoc.querySelectorAll('.print-page')];
      const sourceStyle = doc.style.cssText;
      const publicBlob = await h.vector.createA4VectorPdf({ project, frameIds, element:doc, options, title:project.title,
        fallback:async()=>{throw new Error('Unexpected image fallback');} });
      if(doc.style.cssText !== sourceStyle) throw new Error('Public path changed source styles');
      console.log('[assignment] public vector ready', spec.name);
      const images = [], oldImages = [], geometry = [], texts = [];
      const pdf = await h.pdfjs.getDocument({ data: new Uint8Array(await publicBlob.arrayBuffer()), useSystemFonts: false }).promise;
      const oldPdf = old ? await h.pdfjs.getDocument({ data: new Uint8Array(await old.blob.arrayBuffer()), useSystemFonts: false }).promise : null;
      const render = async (pdf, i) => { const p = await pdf.getPage(i + 1), viewport = p.getViewport({ scale: 2 }), c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
        await p.render({ canvasContext: c.getContext('2d'), viewport }).promise; const image = c.toDataURL('image/png'); c.width = c.height = 0; return image; };
      for (const [i, model] of models.entries()) {
        images.push(await render(pdf, i)); if (oldPdf) oldImages.push(await render(oldPdf, i));
        const actual = (await (await pdf.getPage(i + 1)).getTextContent()).items.filter(x => x.str !== undefined).map(x => x.str).join('').replace(/\s/g, '');
        const expected = result.vectorText[i].join('').replace(/\s/g, '');
        texts.push({ page: i + 1, pass: actual === expected });
        const blocks = [...sheets[i].querySelectorAll('.print-scene-block')];
        for (const [j, scene] of model.drawings.entries()) {
          const block = blocks[j], stage = scene.children.find(d => d.id === 'stage');
          const sr = h.geometry.relativeRect(block.querySelector('.print-stage'), block), unit = 25.4/96;
          const panelEl = block.querySelector('.print-assignment-sheet'), panel = panelEl && h.geometry.relativeRect(panelEl, block);
          const pr = scene.children.find(d => d.kind === 'shape' && d.fill === '#ffffff');
          const border = stage.children[0], right = stage.x + border.x + border.width + border.lineWidth / 2;
          const oldScene = oldModels?.[i].drawings[j], oldPanel = oldScene?.children.find(d => d.kind === 'shape' && d.fill === '#ffffff');
          const empty = block.querySelector('.print-assignment-sheet__empty');
          const emptyLines = empty ? h.geometry.measureTextLines(empty, block) : [];
          const emptyRanges = [];
          if (empty) { const range = document.createRange(); range.selectNodeContents(empty);
            for (const r of range.getClientRects()) if (r.width) { const b = block.getBoundingClientRect(); emptyRanges.push({ x: (r.x-b.x)*unit, y:(r.y-b.y)*unit, width:r.width*unit, height:r.height*unit }); } }
          const coordinateError = Math.max(Math.abs(sr.x-stage.x), Math.abs(sr.y-stage.y), Math.abs(sr.width-border.width-border.lineWidth), Math.abs(sr.height-border.height-border.lineWidth),
            panel ? Math.abs(panel.x-pr.x) : 0, panel ? Math.abs(panel.width-pr.width) : 0);
          const emptyInside = emptyRanges.every(r => r.x >= panel.x && r.x+r.width <= panel.x+panel.width+.025 && r.y >= panel.y && r.y+r.height <= panel.y+panel.height+.025);
          const lineYs = [...new Set(emptyLines.map(l=>l.y))];
          const linesSeparated = lineYs.every((y,k) => !k || y-lineYs[k-1] >= emptyLines[0].size*.9);
          const contentInset = empty ? getComputedStyle(panelEl) : null;
          const leftInset = contentInset ? (parseFloat(contentInset.paddingLeft) + parseFloat(contentInset.borderLeftWidth))*unit : 0;
          const rightInset = contentInset ? (parseFloat(contentInset.paddingRight) + parseFloat(contentInset.borderRightWidth))*unit : 0;
          const emptyLabelPass = !empty || (empty.textContent === 'このシーンの道具割当はありません'
            && emptyLines.length > 0 && lineYs.length === 1 && emptyLines.map(l => l.text).join('') === empty.textContent && emptyRanges.length === 1
            && Math.abs(emptyRanges[0].x + emptyRanges[0].width/2 - panel.x - panel.width/2) <= .5
            && emptyRanges[0].x >= panel.x + leftInset - .025
            && emptyRanges[0].x + emptyRanges[0].width <= panel.x + panel.width - rightInset + .025);
          geometry.push({ page:i+1, frameId:scene.id, stageRightMm:right, panelLeftMm:panel?.x, gapMm:panel ? panel.x-right : null,
            oldPanelLeftMm:oldPanel?.x, oldOverlapMm:oldPanel ? right-oldPanel.x : null, coordinateError, emptyLines:emptyLines.map(({text,x,y,size})=>({text,x,y,size})),
            emptyInside, linesSeparated, emptyLabelPass, pass:coordinateError<.025 && (!panel || right<panel.x) && emptyInside && linesSeparated && emptyLabelPass });
        }
      }
      await pdf.loadingTask.destroy(); await oldPdf?.loadingTask.destroy();
      // Verify public path, DOM restoration, and the actual legacy image bytes.
      doc.style.fontFamily = '';
      const afterHashes = [];
      if (spec.assignment || spec.empty) for (const sheet of sourceSheets) afterHashes.push(await hash(await h.elementToJpegDataUrl(sheet)));
      console.log('[assignment] hash verification ready', spec.name);
      if (markup !== doc.innerHTML || original !== JSON.stringify(project)) throw new Error('Print DOM or saved data changed');
      doc.style.fontFamily = 'BIZUDPGothic';
      doc.style.left = '-100000px';
      window.current = { doc:renderDoc, sheets };
      return { name:spec.name, spec, zoom:getComputedStyle(document.getElementById('root')).zoom, pages:models.length, images, oldImages, geometry, texts,
        legacyHashes, afterHashes, domUnchanged:true, savedDataUnchanged:true, zoomGuard, metrics:result.metrics,
        vector:await window.encodeBlob(publicBlob), old:old && await window.encodeBlob(old.blob), legacy:legacy && await window.encodeBlob(legacy) };
    }, spec);
    await save(`${spec.name}-vector.pdf`, record.vector);
    if (record.old) await save(`${spec.name}-before-vector.pdf`, record.old);
    if (record.legacy) await save(`${spec.name}-legacy-image.pdf`, record.legacy);
    const comparisons = [];
    for (let i = 0; i < record.pages; i++) {
      // Changing CSS zoom (just like changing DPR) reflows/rounds line boxes.
      // Capture at the measured DPR/zoom, then fit the bitmap onto A4 once.
      const clip = await page.evaluate(i => {
        const {doc,sheets}=window.current, s=sheets[i]; doc.style.top='0';
        const h=window.h,size=h.a4PageSize('landscape'),fit=h.fitPdfImage(s.scrollWidth,s.scrollHeight,size.width,size.height);
        window.current.capture={size,fit};
        doc.style.top=`${40-s.getBoundingClientRect().top}px`;
        const r=s.getBoundingClientRect();
        // Keep the measured DPR/zoom unchanged, as in the existing emoji harness.
        // CDP scale != 1 temporarily re-snaps CSS borders at a different DPR.
        // Include scroll overflow, not just the border box, in the A4 fit.
        return {x:r.x,y:0,width:s.scrollWidth+4,height:s.scrollHeight+44,scale:1};
      },i);
      const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
      const reference=await page.evaluate(async({data,i})=>{
        const {doc,sheets}=window.current,s=sheets[i],h=window.h,b=s.getBoundingClientRect();
        const {size,fit}=window.current.capture;
        const scale=fit.width*2/s.scrollWidth,c=document.createElement('canvas');c.width=Math.ceil(size.width*2);c.height=Math.ceil(size.height*2);
        const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);const image=new Image();image.src=data;await image.decode();
        ctx.drawImage(image,fit.x*2,fit.y*2-b.y*scale,image.width*scale/devicePixelRatio,image.height*scale/devicePixelRatio);
        const box=r=>({x:fit.x*2+(r.x-b.x)*scale-2,y:fit.y*2+(r.y-b.y)*scale-2,width:r.width*scale+4,height:r.height*scale+4});
        const rects=sel=>[...s.querySelectorAll(sel)].map(el=>box(el.getBoundingClientRect()));
        const emoji=[],walker=document.createTreeWalker(s,NodeFilter.SHOW_TEXT),segments=new Intl.Segmenter('ja',{granularity:'grapheme'});let n;
        while((n=walker.nextNode()))for(const g of segments.segment(n.textContent??'')){if(!/🔥|👩|❤️|𠮷|\p{Mark}|[\uac00-\ud7a3\u3130-\u318f]/u.test(g.segment))continue;
          const r=document.createRange();r.setStart(n,g.index);r.setEnd(n,g.index+g.segment.length);emoji.push(box(r.getBoundingClientRect()));}
        const shadow=[...s.querySelectorAll('.print-assignment-sheet__member')].map(el=>{const r=box(el.getBoundingClientRect()),p=9/(25.4/96)*scale;return{x:r.x-p,y:r.y-p,width:r.width+2*p,height:r.height+2*p};});
        const result={image:c.toDataURL('image/png'),regions:{text:rects('.print-scene-title h2,.print-member__label-line,.print-ruler span,.print-object span,.print-assignment-sheet__object,.print-assignment-sheet__empty'),
          lines:rects('.print-stage-guides'),shapes:rects('.print-stage .print-member,.print-object'),assignments:rects('.print-assignment-sheet'),
          shadow},emoji};doc.style.zoom='';doc.style.top='0';return result;
      },{data:`data:image/png;base64,${capture.data}`,i});
      const ref=Buffer.from(reference.image.split(',')[1],'base64'),actual=Buffer.from(record.images[i].split(',')[1],'base64');
      const compared=compare(ref,actual,reference.regions),local=reference.emoji.length?compareGraphemes(ref,actual,reference.emoji):null;
      assert.ok(['text','lines','shapes'].every(k=>compared.result[k].pixels>0),'Reference regions must cover visible page content');
      const prefix=`${spec.name}-p${String(i+1).padStart(2,'0')}`;
      await writeFile(`${directory}/${prefix}-dom.png`,ref);await writeFile(`${directory}/${prefix}-vector.png`,actual);await writeFile(`${directory}/${prefix}-diff.png`,compared.diff);
      let negative;
      if(record.oldImages.length){await save(`${prefix}-before.png`,record.oldImages[i]);}
      if(record.oldImages.length && (i<2 || i===record.pages-1)){const old=compare(ref,Buffer.from(record.oldImages[i].split(',')[1],'base64'),reference.regions);negative=!old.pass;
        await writeFile(`${directory}/${prefix}-before-diff.png`,old.diff);}
      comparisons.push({page:i+1,regions:compared.result,emoji:local?.glyphs,baselineRejected:negative,pass:compared.pass&&(!local||local.pass)});
      console.log(spec.name,`p${i+1}`,JSON.stringify(comparisons.at(-1)));
    }
    delete record.images;delete record.oldImages;delete record.vector;delete record.old;delete record.legacy;
    record.comparisons=comparisons;record.implementationHash=implementationHash;
    record.legacyHashUnchanged=JSON.stringify(record.legacyHashes)===JSON.stringify(record.afterHashes);
    await page.evaluate(()=>{window.current.doc.remove();});
    record.pass=record.geometry.every(g=>g.pass)&&record.texts.every(t=>t.pass)&&comparisons.every(c=>c.pass)&&record.legacyHashUnchanged&&record.zoomGuard;
    await writeFile(`${directory}/${spec.name}-results.json`,JSON.stringify(record,null,2));results.push(record);
  }
  const summary={dpi,thresholdUnchanged:.003,localGraphemeThreshold:.05,baselineRevision:'78d7947',baselineHashes:Object.fromEntries(Object.entries(baseline).map(([n,s])=>[n,hash(s)])),errors,
    results:results.map(r=>({name:r.name,pages:r.pages,zoom:r.zoom,pass:r.pass,geometry:r.geometry.every(g=>g.pass),text:r.texts.every(t=>t.pass),legacyHashUnchanged:r.legacyHashUnchanged}))};
  await writeFile(`${directory}/${only??(regressionOnly?'regressions':'all')}-summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
  assert.equal(errors.length,0);assert.ok(results.length);assert.ok(results.every(r=>r.pass),'Assignment/visual regression checks failed');
} finally {await browser?.close();await server.close();}
