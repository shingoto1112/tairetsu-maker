import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { compare, compareGraphemes } from './vector-pdf-visual-diff.mjs';
import { PNG } from 'pngjs';

const pc = process.argv.includes('--pc');
const viewport = pc ? { width: 1440, height: 900 } : { width: 1180, height: 820 };
const dpr = pc ? 1 : 2;
const directory = `output/build31/vector-pdf-parade/${pc ? 'pc-1440-dpr1' : 'ipad-1180-dpr2'}`;
const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5396);
assert.ok(port >= 5395 && port <= 5399);
const origin = `http://127.0.0.1:${port}`, dpi = 144;
const only = process.argv.find(a => a.startsWith('--case='))?.slice(7);
const resume = process.argv.includes('--resume');
// Same measured pages, original TTF input: isolates this font-only change.
const headPrint = execFileSync('git',['show','HEAD:src/components/PrintPreview.tsx'],{encoding:'utf8'}).replace(/from "(\.[^"]+)"/g,(_m,source)=>'from "'+(source.startsWith('../')?'/src/'+source.slice(3):'/src/components/'+source.slice(2))+'"');
const server = await createServer({ configFile: false, envFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jspdf', 'html-to-image'] },
  plugins: [{ name: 'assignment-fix-harness',
    resolveId(id) { if(id==='/__head/PrintPreview.tsx') return id; if (id === '/__entry') return '\0entry'; },
    load(id) {
      if(id==='/__head/PrintPreview.tsx')return headPrint;
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
  'src/utils/vectorPdf/a4Document.ts', 'src/utils/vectorPdf/paradeFixture.ts', 'src/styles.css',
  'src/utils/vectorPdf/renderer.ts', 'src/utils/vectorPdf/hbSubset.ts', 'src/utils/vectorPdf/trueType.ts',
  'scripts/verify-vector-pdf-parade.mjs', 'scripts/vector-pdf-visual-diff.mjs', 'src/utils/paradeA4Limits.ts', 'src/utils/printLayout.ts', 'src/components/PrintPreview.tsx',
].map(file => readFile(file)))));
const cases = [
  { name:'100m-no-backward', assignments:true },
  { name:'100m-backward-zero-crossing', backward:12, crossing:true, assignments:true },
  { name:'decimal-100.3m', total:100.3, backward:10, crossing:true, assignments:true },
  { name:'cell-2m-normal', cell:2, horizontalMode:'normalMeter', assignments:true },
  { name:'cell-2m-split', cell:2, horizontalMode:'centerSplit' },
  { name:'emphasis-off', emphasisOff:true, assignments:true },
  { name:'grid-off', gridOff:true, assignments:true },
  { name:'grid-and-emphasis-off', gridOff:true, emphasisOff:true },
  { name:'rulers-off', rulersOff:true, assignments:true },
  { name:'long-one-scene', long:true, assignments:true },
  { name:'empty-scene', empty:true },
  { name:'empty-assignment-label', emptyAssignments:true, assignments:true },
  { name:'annotations-only', annotationsOnly:true },
  { name:'multi-7-scenes', count:7, assignments:true },
  { name:'many-146-members', many:true, count:1, assignments:true },
  { name:'emoji-names', emoji:true, assignments:true },
  { name:'legacy-1200m-600m', total:1200, backward:600, assignments:true },
  { name:'stacked-scenes', empty:true, width:16, count:3 },
  ...['both','left','right','none'].map(ruler=>({name:'editor-ruler-'+ruler,ruler,assignments:true})),
];
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
    const { PrintPreview } = await import('/src/components/PrintPreview.tsx'); const { PrintPreview: HeadPrintPreview } = await import('/__head/PrintPreview.tsx');
    const layout = await import('/src/utils/printLayout.ts'), fixtures = await import('/src/utils/vectorPdf/paradeFixture.ts');
    const vector = await import('/src/utils/vectorPdf/a4Document.ts');
    const { renderScenePages } = await import('/src/utils/vectorPdf/renderer.ts');
    const geometry = await import('/src/utils/vectorPdf/browserDocumentLayout.ts');
    const { elementToJpegDataUrl, withExportClone } = await import('/src/utils/exportImage.ts');
    const { jpegDataUrlsToPdfBlob } = await import('/src/utils/pdfExport.ts');
    const { fitPdfImage, a4PageSize } = await import('/src/utils/pdfPageLayout.ts');
    const pdfjs = await import('/__pdfjs/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/__pdfjs/pdf.worker.mjs';
    window.h = { React, root: createRoot(document.getElementById('root')), flushSync, PrintPreview, HeadPrintPreview, layout, fixtures, vector,
      renderScenePages, geometry, withExportClone, elementToJpegDataUrl, jpegDataUrlsToPdfBlob, fitPdfImage, a4PageSize, pdfjs };
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
      const rasterScale = spec.long ? 4 : 2;
      const h = window.h; await h.geometry.ensureBrowserFonts(['normal','bold']);
      const project = h.fixtures.vectorParadeFixture(spec);
      if (spec.ruler) project.paradeSettings.rulerPosition=spec.ruler;
      const original = JSON.stringify(project);
      const options = { ...h.layout.defaultPrintOptions, includeAssignments: !!spec.assignments, includeGrid: !spec.gridOff, includeMeterRulers: !spec.rulersOff, viewerPerspective: 'audience' };
      const canon = element => {
        const clone=element.cloneNode(true);
        [...clone.querySelectorAll('clipPath')].forEach((clip,i)=>{const old=clip.id;clip.id='clip-'+i;clone.querySelectorAll('[clip-path]').forEach(n=>{if(n.getAttribute('clip-path')==='url(#'+old+')')n.setAttribute('clip-path','url(#clip-'+i+')');});});
        return clone.innerHTML;
      };
      h.flushSync(()=>h.root.render(h.React.createElement(h.HeadPrintPreview,{project,options})));
      const headMarkup=canon(document.querySelector('.print-document'));
      h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project, options })));
      if(canon(document.querySelector('.print-document'))!==headMarkup)throw new Error('PrintPreview differs from HEAD');
      const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting');
      Object.assign(doc.style, { left: '0', top: '0', zIndex: '1', width: '' });
      const sourceSheets = [...doc.querySelectorAll('.print-page')];
      const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
      doc.style.fontFamily = '';
      const markup = doc.innerHTML, legacyImages = [], legacyHashes = [];
      const legacyStart = performance.now();
      for(const sheet of sourceSheets) legacyImages.push(await h.elementToJpegDataUrl(sheet));
      const legacy = await h.jpegDataUrlsToPdfBlob(legacyImages,project.title,'portrait');
      const legacyMs = performance.now()-legacyStart;
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
        result = await h.renderScenePages(models, { title: project.title, orientation: 'portrait', fillStrokes: true, clipPage: true });
        if (result.metrics.fontAttempts.join() !== 'subset') throw new Error('Unexpected subset retry: ' + result.metrics.retryReason);
        second = await h.renderScenePages(models, { title: project.title, orientation: 'portrait', fillStrokes: true, clipPage: true });
        if (second.metrics.fontAttempts.join() !== 'subset') throw new Error('Unexpected second subset retry');
        oldModels = models;
        old = await h.renderScenePages(models, { title: project.title, fontMode: 'original', orientation: 'portrait', fillStrokes: true, clipPage: true });
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
      const render = async (pdf, i) => { const p = await pdf.getPage(i + 1), viewport = p.getViewport({ scale: rasterScale }), c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
        await p.render({ canvasContext: c.getContext('2d'), viewport }).promise; const image = c.toDataURL('image/png'); c.width = c.height = 0; return image; };
      for (const [i, model] of models.entries()) {
        images.push(await render(pdf, i)); if (oldPdf) oldImages.push(await render(oldPdf, i));
        const mediaBox=(await pdf.getPage(i+1)).view;
        if(!(mediaBox[2]<mediaBox[3]))throw new Error('Expected portrait MediaBox');
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
      window.current = { doc:renderDoc, sheets, rasterScale };
      return { name:spec.name, spec, zoom:getComputedStyle(document.getElementById('root')).zoom, pages:models.length, images, oldImages, geometry, texts,
        legacyBytes:legacy.size, legacyMs, legacyHashes, afterHashes, domUnchanged:true, savedDataUnchanged:true, zoomGuard, metrics:result.metrics, secondMetrics:second.metrics, originalMetrics:old.metrics,
        vector:await window.encodeBlob(publicBlob), old:old && await window.encodeBlob(old.blob), legacy:legacy && await window.encodeBlob(legacy) };
    }, spec);
    await save(`${spec.name}-vector.pdf`, record.vector);
    if (record.old) await save(`${spec.name}-before-vector.pdf`, record.old);
    if (record.legacy) await save(`${spec.name}-legacy-image.pdf`, record.legacy);
    const comparisons = [];
    for (let i = 0; i < record.pages; i++) {
      // Preserve layout/DPR while capturing a 144dpi reference. At DPR1, scaling
      // a low-resolution screenshot afterwards introduces artificial text error.
      const clip = await page.evaluate(i => {
        const {doc,sheets}=window.current, s=sheets[i]; doc.style.top='0';
        const h=window.h,size=h.a4PageSize('portrait'),fit=h.fitPdfImage(s.scrollWidth,s.scrollHeight,size.width,size.height);
        window.current.capture={size,fit};
        doc.style.top=`${40-s.getBoundingClientRect().top}px`;
        const r=s.getBoundingClientRect();
        // CDP screenshot scale affects raster sampling, not the measured DOM.
        // Include scroll overflow, not just the border box, in the A4 fit.
        return {x:r.x,y:0,width:s.scrollWidth+4,height:s.scrollHeight+44,scale:window.current.rasterScale/devicePixelRatio};
      },i);
      const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
      const reference=await page.evaluate(async({data,i})=>{
        const {doc,sheets}=window.current,s=sheets[i],h=window.h,b=s.getBoundingClientRect();
        const {size,fit}=window.current.capture;
        const rs=window.current.rasterScale, scale=fit.width*rs/s.scrollWidth,c=document.createElement('canvas');c.width=Math.ceil(size.width*rs);c.height=Math.ceil(size.height*rs);
        const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);const image=new Image();image.src=data;await image.decode();
        ctx.save();ctx.beginPath();ctx.rect(fit.x*rs,fit.y*rs,fit.width*rs,fit.height*rs);ctx.clip();
        ctx.drawImage(image,fit.x*rs,fit.y*rs-b.y*scale,image.width*scale/rs,image.height*scale/rs);ctx.restore();
        const box=r=>({x:fit.x*rs+(r.x-b.x)*scale-2,y:fit.y*rs+(r.y-b.y)*scale-2,width:r.width*scale+4,height:r.height*scale+4});
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
      assert.ok(['text','lines'].every(k=>compared.result[k].pixels>0),'Reference regions must cover visible page content');
      const prefix=`${spec.name}-p${String(i+1).padStart(2,'0')}`;
      await writeFile(`${directory}/${prefix}-dom.png`,ref);await writeFile(`${directory}/${prefix}-vector.png`,actual);await writeFile(`${directory}/${prefix}-diff.png`,compared.diff);
      if(record.oldImages.length){await save(`${prefix}-before.png`,record.oldImages[i]);}
      const before = PNG.sync.read(Buffer.from(record.oldImages[i].split(',')[1],'base64')), after = PNG.sync.read(actual);
      const identicalPixels = before.width === after.width && before.height === after.height && before.data.equals(after.data);
      const originalDom = compare(ref, Buffer.from(record.oldImages[i].split(',')[1],'base64'), reference.regions);
      const originalSubset = compare(Buffer.from(record.oldImages[i].split(',')[1],'base64'), actual, reference.regions);
      comparisons.push({page:i+1,regions:compared.result,emoji:local?.glyphs,identicalPixels,originalDom:originalDom.result,originalSubset:originalSubset.result,
        pass:compared.pass&&(!local||local.pass)&&originalSubset.pass});
      console.log(spec.name,`p${i+1}`, 'pass=',comparisons.at(-1).pass, 'ratios=',JSON.stringify(Object.fromEntries(Object.entries(compared.result).map(([k,v])=>[k,v.ratio]))));
    }
    record.pageHashes=record.images.map(hash);
    delete record.images;delete record.oldImages;delete record.vector;delete record.old;delete record.legacy;
    record.comparisons=comparisons;record.implementationHash=implementationHash;
    record.legacyHashUnchanged=JSON.stringify(record.legacyHashes)===JSON.stringify(record.afterHashes);
    await page.evaluate(()=>{window.current.doc.remove();});
    record.pass=record.geometry.every(g=>g.pass)&&record.texts.every(t=>t.pass)&&comparisons.every(c=>c.pass)&&record.legacyHashUnchanged&&record.zoomGuard;
    await writeFile(`${directory}/${spec.name}-results.json`,JSON.stringify(record,null,2));results.push(record);
  }
  const rulerRecords = results.filter(r=>r.name.startsWith('editor-ruler-'));
  if(rulerRecords.length===4) {
    const layouts=rulerRecords.map(r=>JSON.stringify({g:r.geometry,t:r.texts,pixels:r.pageHashes,bytes:r.metrics.bytes}));
    assert.ok(layouts.every(x=>x===layouts[0]),'Editor ruler changed A4 layout');
  }
  const summary={viewport,dpr,dpi,thresholdUnchanged:.003,localGraphemeThreshold:.05,baselineRevision:'9b5f84d legacy image / original TTF reference',errors,
    results:results.map(r=>({name:r.name,pages:r.pages,zoom:r.zoom,pass:r.pass,geometry:r.geometry.every(g=>g.pass),text:r.texts.every(t=>t.pass),legacyHashUnchanged:r.legacyHashUnchanged}))};
  await writeFile(`${directory}/${only??'all'}-summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
  assert.equal(errors.length,0);assert.ok(results.length);assert.ok(results.every(r=>r.pass),'Assignment/visual regression checks failed');
} finally {await browser?.close();await server.close();}
