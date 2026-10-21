import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { compare, compareGraphemes } from './vector-pdf-visual-diff.mjs';
import { PNG } from 'pngjs';

const pc = process.argv.includes('--pc');
const contentOnly = process.argv.includes('--content-only');
const viewport = pc ? { width: 1440, height: 900 } : { width: 1180, height: 820 };
const dpr = pc ? 1 : 2;
const directory = `output/build31/vector-pdf-parade/stage-regressions/${pc ? 'pc-1440-dpr1' : 'ipad-1180-dpr2'}${contentOnly ? '/content-only' : ''}`;
const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5397);
assert.ok(port >= 5395 && port <= 5399);
const origin = `http://127.0.0.1:${port}`, dpi = 144;
const only = process.argv.find(a => a.startsWith('--case='))?.slice(7);
const resume = process.argv.includes('--resume');
// Same measured pages, original TTF input: isolates this font-only change.
const baselineFiles=['a4Document.ts','model.ts','renderer.ts'];
const baseline=Object.fromEntries(baselineFiles.map(name=>[name,execFileSync('git',['show','HEAD:src/utils/vectorPdf/'+name],{encoding:'utf8'})]));
const rewrite=(source)=>source.replace(/(from |import\()"(\.[^"]+)"/g,(_m,kind,dep)=>kind+'"'+(dep.startsWith('./')&&baselineFiles.includes(dep.slice(2)+'.ts')?'/__head/'+dep.slice(2)+'.ts':'/'+path.posix.normalize('src/utils/vectorPdf/'+dep))+'"');
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'assignment-fix-harness',
    resolveId(id) { if(id.startsWith('/__head/'))return id; if (id === '/__entry') return '\0entry'; },
    load(id) {
      if(id.startsWith('/__head/'))return rewrite(baseline[id.split('/').pop()]);
      if (id === '\0entry') return `export { default as React } from 'react'; export { createRoot } from 'react-dom/client'; export { flushSync } from 'react-dom';`;
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
  }], server: { host: '127.0.0.1', port, strictPort: true } });
const save = async (name, data) => writeFile(`${directory}/${name}`, Buffer.from(data.split(',')[1], 'base64'));
const hash = data => createHash('sha256').update(data).digest('hex');
const implementationHash = hash(Buffer.concat(await Promise.all([
  'src/utils/vectorPdf/a4Document.ts', 'src/utils/vectorPdf/fixture.ts', 'src/styles.css',
  'src/utils/vectorPdf/renderer.ts', 'src/utils/vectorPdf/hbSubset.ts', 'src/utils/vectorPdf/trueType.ts',
  'scripts/verify-vector-pdf-parade-stage.mjs', 'scripts/vector-pdf-visual-diff.mjs',
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
const normalizePdf = bytes => bytes.toString('latin1').replace(/\/CreationDate \(D:[^)]*\)/g,'/CreationDate (NORMALIZED)').replace(/\/ID\s*\[\s*<[0-9a-f]+>\s*<[0-9a-f]+>\s*\]/gi,'/ID [NORMALIZED]');
if(process.argv.includes('--audit-saved')) {
  const audited=[];let pixelMismatchPages=0,maximumChannelDifference=0,maximumDifferentPixels=0;
  for(const spec of cases) {
    const r=JSON.parse(await readFile(directory+'/'+spec.name+'-results.json','utf8'));
    const [current,head]=await Promise.all(['vector','before-vector'].map(label=>readFile(directory+'/'+spec.name+'-'+label+'.pdf')));
    r.documentIdentityWithoutMetadata=normalizePdf(current)===normalizePdf(head);
    assert.ok(r.documentIdentityWithoutMetadata,'PDF bytes differ beyond creation date / random ID: '+spec.name);
    for(const c of r.comparisons) {
      if(!c.identicalPixels){
        pixelMismatchPages++;
        const prefix=directory+'/'+spec.name+'-p'+String(c.page).padStart(2,'0');
        const [a,b]=await Promise.all(['vector','before'].map(async label=>PNG.sync.read(await readFile(prefix+'-'+label+'.png'))));
        let changed=0,max=0;for(let i=0;i<a.data.length;i+=4){let d=0;for(let k=0;k<4;k++)d=Math.max(d,Math.abs(a.data[i+k]-b.data[i+k]));if(d){changed++;max=Math.max(max,d);}}
        c.rawPixelDifference={changed,maxChannelDifference:max};maximumChannelDifference=Math.max(maximumChannelDifference,max);maximumDifferentPixels=Math.max(maximumDifferentPixels,changed);
      }
      c.pass=Object.values(c.regions).every(x=>x.pass)&&Object.values(c.originalSubset).every(x=>x.pass)&&(!c.emoji||c.emoji.every(x=>x.pass))&&r.documentIdentityWithoutMetadata;
    }
    r.pass=r.documentIdentityWithoutMetadata&&r.geometry.every(x=>x.pass)&&r.texts.every(x=>x.pass)&&r.comparisons.every(x=>x.pass)&&r.legacyHashUnchanged&&r.zoomGuard;
    r.savedPdfAudit={normalization:['CreationDate','random document ID'],implementationHash};
    await writeFile(directory+'/'+spec.name+'-results.json',JSON.stringify(r,null,2));audited.push(r);
  }
  const summary={viewport,dpr,dpi,thresholdUnchanged:.003,localGraphemeThreshold:.05,baselineRevision:'HEAD 9b5f84d, exact PDF content excluding CreationDate / ID',errors:[],pdfContentIdentical:true,pixelMismatchPages,maximumChannelDifference,maximumDifferentPixels,
    results:audited.map(r=>({name:r.name,pages:r.pages,zoom:r.zoom,pass:r.pass,geometry:r.geometry.every(g=>g.pass),text:r.texts.every(t=>t.pass),documentIdentityWithoutMetadata:r.documentIdentityWithoutMetadata,legacyHashUnchanged:r.legacyHashUnchanged}))};
  await writeFile(directory+'/all-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));assert.ok(audited.every(x=>x.pass));process.exit(0);
}
let browser;
const results = [], errors = [];
try {
  await mkdir(directory, { recursive: true }); await server.listen(); console.log('Owned verification PID:', process.pid);
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] });
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  await context.route('**/*', route => { const u = new URL(route.request().url());
    return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort(); });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m=>{if(m.text().startsWith('[assignment]'))console.log(m.text());});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor:dpr, mobile:false });
  await page.goto(`${origin}/__assignment`, { timeout:120000 });
  await page.evaluate(async () => {
    const { React, createRoot, flushSync } = await import('/__entry');
    const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
    const layout = await import('/src/utils/printLayout.ts'), fixtures = await import('/src/utils/vectorPdf/fixture.ts');
    const vector = await import('/src/utils/vectorPdf/a4Document.ts');
    const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts'); const { renderScenePages: headRender } = await import('/__head/renderer.ts'); const headVector = await import('/__head/a4Document.ts');
    const geometry = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
    const { elementToJpegDataUrl, withExportClone } = await import('/src/utils/exportImage.ts');
    const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
    const { fitPdfImage, a4PageSize } = await import('/src/utils/pdfPageLayout.ts');
    const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
    window.h = { React, root: createRoot(document.getElementById('root')), flushSync, PrintPreview, layout, fixtures, vector,
      renderScenePages, headRender, headVector, geometry, withExportClone, elementToJpegDataUrl, jpegDataUrlsToPdfBlob, fitPdfImage, a4PageSize, pdfjs };
    window.encodeBlob = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  });
  for (const spec of cases) {
    if (only && only !== spec.name) continue;
    if(resume && !only) {
      try { const previous=JSON.parse(await readFile(`${directory}/${spec.name}-results.json`,'utf8'));
        if(previous.pass && previous.implementationHash===implementationHash){results.push(previous);console.log('Verified, preserved',spec.name);continue;}
      } catch(error) { if(error.code!=='ENOENT')throw error; }
    }
    console.log('Generating', spec.name);
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
      const legacy = null;
      console.log('[assignment] legacy ready', spec.name);
      doc.style.fontFamily = 'BIZUDPGothic';
      const frameIds = project.frames.map(f => f.id);
      let oldModels = null, old = null, second = null;
      let zoomGuard = true;
      if (getComputedStyle(document.getElementById('root')).zoom !== '1') {
        try { h.vector.buildA4Document(project, frameIds, doc, options); zoomGuard = false; }
        catch (error) { if (!error.message.includes('複製DOM')) throw error; }
      }
      console.log('[assignment] baseline ready', spec.name);
      let models, result, renderDoc;
      await h.withExportClone(doc, async clone => {
        clone.style.fontFamily = 'BIZUDPGothic';
        models = h.vector.buildA4Document(project, frameIds, clone, options);
        result = await h.renderScenePages(models, { title: project.title });
        if (result.metrics.fontAttempts.join() !== 'subset') throw new Error('Unexpected subset retry: ' + result.metrics.retryReason);
        second = await h.renderScenePages(models, { title: project.title });
        if (second.metrics.fontAttempts.join() !== 'subset') throw new Error('Unexpected second subset retry');
        oldModels = h.headVector.buildA4Document(project,frameIds,clone,options);
        if(JSON.stringify(models)!==JSON.stringify(oldModels))throw new Error("Stage model differs from HEAD");
        old = await h.headRender(oldModels, { title: project.title });
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
        if (!spec.contentOnly) { images.push(await render(pdf, i)); if (oldPdf) oldImages.push(await render(oldPdf, i)); }
        const actual = (await (await pdf.getPage(i + 1)).getTextContent()).items.filter(x => x.str !== undefined).map(x => x.str).join('').replace(/\s/g, '');
        const textGeometry = async p => (await p.getTextContent()).items.filter(x => x.str !== undefined).map(({str,transform,width,height})=>({str,transform,width,height}));
        const sameTextGeometry = JSON.stringify(await textGeometry(await pdf.getPage(i+1))) === JSON.stringify(await textGeometry(await oldPdf.getPage(i+1)));
        const expected = result.vectorText[i].join('').replace(/\s/g, '');
        texts.push({ page: i + 1, sameTextGeometry, pass: actual === expected && sameTextGeometry });
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
          geometry.push({ page:i+1, frameId:scene.id, stageRightMm:right, panelLeftMm:panel?.x, gapMm:panel ? panel.x-right : null,
            oldPanelLeftMm:oldPanel?.x, oldOverlapMm:oldPanel ? right-oldPanel.x : null, coordinateError, emptyLines:emptyLines.map(({text,x,y,size})=>({text,x,y,size})),
            emptyInside, linesSeparated, pass:coordinateError<.025 && (!panel || right<panel.x) && emptyInside && linesSeparated });
        }
      }
      await pdf.loadingTask.destroy(); await oldPdf?.loadingTask.destroy();
      // Verify public path, DOM restoration, and the actual legacy image bytes.
      doc.style.fontFamily = '';
      const afterHashes = [];
      console.log('[assignment] hash verification ready', spec.name);
      if (markup !== doc.innerHTML || original !== JSON.stringify(project)) throw new Error('Print DOM or saved data changed');
      doc.style.fontFamily = 'BIZUDPGothic';
      doc.style.left = '-100000px';
      window.current = { doc:renderDoc, sheets };
      return { name:spec.name, spec, zoom:getComputedStyle(document.getElementById('root')).zoom, pages:models.length, images, oldImages, geometry, texts,
        legacyHashes, afterHashes, domUnchanged:true, savedDataUnchanged:true, zoomGuard, metrics:result.metrics, secondMetrics:second.metrics, originalMetrics:old.metrics,
        vector:await window.encodeBlob(publicBlob), old:old && await window.encodeBlob(old.blob), legacy:legacy && await window.encodeBlob(legacy) };
    }, { ...spec, contentOnly });
    record.documentIdentityWithoutMetadata=normalizePdf(Buffer.from(record.vector.split(',')[1],'base64'))===normalizePdf(Buffer.from(record.old.split(',')[1],'base64'));
    assert.ok(record.documentIdentityWithoutMetadata,'HEAD PDF content differs');
    await save(`${spec.name}-vector.pdf`, record.vector);
    if (record.old) await save(`${spec.name}-before-vector.pdf`, record.old);
    if (record.legacy) await save(`${spec.name}-legacy-image.pdf`, record.legacy);
    const comparisons = [];
    for (let i = 0; !contentOnly && i < record.pages; i++) {
      // Preserve layout/DPR while capturing a 144dpi reference. At DPR1, scaling
      // a low-resolution screenshot afterwards introduces artificial text error.
      const clip = await page.evaluate(i => {
        const {doc,sheets}=window.current, s=sheets[i]; doc.style.top='0';
        const h=window.h,size=h.a4PageSize('landscape'),fit=h.fitPdfImage(s.scrollWidth,s.scrollHeight,size.width,size.height);
        window.current.capture={size,fit};
        doc.style.top=`${40-s.getBoundingClientRect().top}px`;
        const r=s.getBoundingClientRect();
        // CDP screenshot scale affects raster sampling, not the measured DOM.
        // Include scroll overflow, not just the border box, in the A4 fit.
        return {x:r.x,y:0,width:s.scrollWidth+4,height:s.scrollHeight+44,scale:2/devicePixelRatio};
      },i);
      const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
      const reference=await page.evaluate(async({data,i})=>{
        const {doc,sheets}=window.current,s=sheets[i],h=window.h,b=s.getBoundingClientRect();
        const {size,fit}=window.current.capture;
        const scale=fit.width*2/s.scrollWidth,c=document.createElement('canvas');c.width=Math.ceil(size.width*2);c.height=Math.ceil(size.height*2);
        const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);const image=new Image();image.src=data;await image.decode();
        ctx.drawImage(image,fit.x*2,fit.y*2-b.y*scale,image.width*scale/2,image.height*scale/2);
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
      if(record.oldImages.length){await save(`${prefix}-before.png`,record.oldImages[i]);}
      const before = PNG.sync.read(Buffer.from(record.oldImages[i].split(',')[1],'base64')), after = PNG.sync.read(actual);
      const identicalPixels = before.width === after.width && before.height === after.height && before.data.equals(after.data);
      const originalDom = compare(ref, Buffer.from(record.oldImages[i].split(',')[1],'base64'), reference.regions);
      const originalSubset = compare(Buffer.from(record.oldImages[i].split(',')[1],'base64'), actual, reference.regions);
      comparisons.push({page:i+1,regions:compared.result,emoji:local?.glyphs,identicalPixels,originalDom:originalDom.result,originalSubset:originalSubset.result,
        pass:compared.pass&&(!local||local.pass)&&originalSubset.pass&&record.documentIdentityWithoutMetadata});
      console.log(spec.name,`p${i+1}`, 'pass=',comparisons.at(-1).pass,'HEAD pixels identical=',identicalPixels);
    }
    delete record.images;delete record.oldImages;delete record.vector;delete record.old;delete record.legacy;
    record.comparisons=comparisons;record.implementationHash=implementationHash;
    record.legacyHashUnchanged=JSON.stringify(record.legacyHashes)===JSON.stringify(record.afterHashes);
    await page.evaluate(()=>{window.current.doc.remove();});
    record.pass=record.geometry.every(g=>g.pass)&&record.texts.every(t=>t.pass)&&comparisons.every(c=>c.pass)&&record.legacyHashUnchanged&&record.zoomGuard;
    await writeFile(`${directory}/${spec.name}-results.json`,JSON.stringify(record,null,2));results.push(record);
  }
  const summary={viewport,dpr,dpi,contentOnly,thresholdUnchanged:.003,localGraphemeThreshold:.05,baselineRevision:'HEAD 9b5f84d, exact PDF content excluding CreationDate / ID',errors,
    results:results.map(r=>({name:r.name,pages:r.pages,zoom:r.zoom,pass:r.pass,geometry:r.geometry.every(g=>g.pass),text:r.texts.every(t=>t.pass),legacyHashUnchanged:r.legacyHashUnchanged}))};
  await writeFile(`${directory}/${only??'all'}-summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
  assert.equal(errors.length,0);assert.ok(results.length);assert.ok(results.every(r=>r.pass),'Assignment/visual regression checks failed');
} finally {await browser?.close();await server.close();}
