import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { compare, compareGraphemes } from './vector-pdf-visual-diff.mjs';
import { PNG } from 'pngjs';

const pc = true;
const viewport = pc ? { width: 1440, height: 900 } : { width: 1180, height: 820 };
const dpr = pc ? 1 : 2;
const directory = `output/build31/vector-pdf-parade/runtime`;
const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5395);
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

let browser;
const results=[],errors=[];
try {
 await mkdir(directory,{recursive:true});await server.listen();console.log('Owned runtime PID:',process.pid);
 browser=await chromium.launch({headless:true,args:['--disable-lcd-text']});
 for(const spec of [{name:'one-scene',assignments:true},{name:'seven-scenes',count:7,assignments:true},{name:'long-scene',long:true,assignments:true},{name:'many-146-members',many:true,assignments:true}]) {
 const context=await browser.newContext({viewport,deviceScaleFactor:dpr});
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

 const record=await page.evaluate(async spec=>{
  const h=window.h, {generateA4Pdf}=await import('/src/utils/a4PdfExport.ts');
  const project=h.fixtures.vectorParadeFixture(spec), options={...h.layout.defaultPrintOptions,includeAssignments:true};
  const mount=p=>{h.flushSync(()=>h.root.render(h.React.createElement(h.PrintPreview,{project:p,options})));const el=document.querySelector('.print-document');el.classList.add('is-exporting');return el;};
  const element=mount(project),frameIds=project.frames.map(f=>f.id), before=JSON.stringify(project),markup=element.innerHTML;
  const encode=window.encodeBlob;
  async function legacy(){const start=performance.now(),images=[];for(const pg of element.querySelectorAll('.print-page'))images.push(await h.elementToJpegDataUrl(pg));const blob=await h.jpegDataUrlsToPdfBlob(images,project.title,'portrait');return {blob,ms:performance.now()-start};}
  const old1=await legacy(),old2=await legacy();
  const run=async()=>{const start=performance.now();const result=await generateA4Pdf({element,project,frameIds,options,title:project.title});return{...result,ms:performance.now()-start};};
  const first=await run(),second=await run();
  const image=await createImageBitmap(first.preview);const preview={width:image.width,height:image.height,bytes:first.preview.size};image.close();
  if(preview.width>2048||preview.height>2048||preview.width*preview.height>2000000)throw new Error('Preview limit exceeded');
  if(before!==JSON.stringify(project)||markup!==element.innerHTML)throw new Error('Changed source');
  const doc=await h.pdfjs.getDocument({data:new Uint8Array(await first.blob.arrayBuffer())}).promise;
  if(doc.numPages!==first.pageCount)throw new Error('Page count mismatch');
  for(let i=1;i<=doc.numPages;i++){const v=(await doc.getPage(i)).view;if(v[2]>=v[3])throw new Error('Portrait missing');}
  await doc.loadingTask.destroy();
  let metrics;await h.withExportClone(element,async clone=>{clone.style.fontFamily='BIZUDPGothic';const models=h.vector.buildA4Document(project,frameIds,clone,options);const r=await h.renderScenePages(models,{title:project.title,orientation:'portrait',fillStrokes:true,clipPage:true});metrics=r.metrics;});
  const result={name:spec.name,legacyBytes:old1.blob.size,vectorBytes:first.blob.size,legacyFirstMs:old1.ms,legacySecondMs:old2.ms,vectorFirstMs:first.ms,vectorSecondMs:second.ms,pages:first.pageCount,preview,metrics,
   vector:await encode(first.blob),legacy:await encode(old1.blob),previewImage:await encode(first.preview)};
  // Public cancellation, including an event-loop cancellation during font/text work.
  const cancellation=[];
  for(const phase of ['before','during','preview']){
   const controller=new AbortController();let abortedAt;
   if(phase==='before'){controller.abort();abortedAt=performance.now();}
   else if(phase==='during')setTimeout(()=>{controller.abort();abortedAt=performance.now();},0);
   try{await generateA4Pdf({element,project,frameIds,options,title:project.title,signal:controller.signal,onProgress:message=>{if(phase==='preview'&&message==='プレビューを準備中'){controller.abort();abortedAt=performance.now();}}});throw new Error('Cancellation returned a file');}
   catch(error){if(error.name!=='AbortError')throw error;cancellation.push({phase,responseMs:performance.now()-abortedAt});}
  }
  result.cancellation=cancellation;
  return result;
 },spec);
 await save(spec.name+'-vector.pdf',record.vector);await save(spec.name+'-legacy-image.pdf',record.legacy);await save(spec.name+'-preview.jpg',record.previewImage);
 delete record.vector;delete record.legacy;delete record.previewImage;results.push(record);console.log(JSON.stringify(record));await context.close();
 }
 // Continue in a new context to test whole-document fallback and alternating modes.
 const context=await browser.newContext({viewport,deviceScaleFactor:dpr});
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

 const regressions=await page.evaluate(async()=>{
  const h=window.h,{generateA4Pdf,A4_FALLBACK_LIMITS}=await import('/src/utils/a4PdfExport.ts');
  const {vectorStage2Fixture}=await import('/src/utils/vectorPdf/fixture.ts');
  const options={...h.layout.defaultPrintOptions,includeAssignments:true};
  const mount=p=>{h.flushSync(()=>h.root.render(h.React.createElement(h.PrintPreview,{project:p,options})));const el=document.querySelector('.print-document');el.classList.add('is-exporting');return el;};
  const encode=window.encodeBlob,alternating=[];
  let firstStage;
  for(const mode of ['stage','parade','stage']) {
   const p=mode==='stage'?vectorStage2Fixture(9.3,5.4,1):h.fixtures.vectorParadeFixture({assignments:true});const element=mount(p);
   const blob=await h.vector.createA4VectorPdf({project:p,element,frameIds:p.frames.map(f=>f.id),options,title:p.title,fallback:async()=>{throw new Error('Unexpected image fallback');}});
   const pdf=await h.pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;const pg=await pdf.getPage(1),viewport=pg.getViewport({scale:2}),c=document.createElement('canvas');c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);await pg.render({canvasContext:c.getContext('2d'),viewport}).promise;const pixels=c.toDataURL();const text=(await pg.getTextContent()).items.map(x=>x.str??'').join('');
   if((mode==='parade')!==(pg.view[2]<pg.view[3]))throw new Error('Orientation leaked');
   if(mode==='stage'&&firstStage&&firstStage!==pixels)throw new Error('Stage pixels changed after parade');if(mode==='stage')firstStage=pixels;
   alternating.push({mode,bytes:blob.size,mediaBox:pg.view,text});await pdf.loadingTask.destroy();
  }
  const p=h.fixtures.vectorParadeFixture({count:3,assignments:true});p.stageObjects[0].shape='unknown'; // unsupported on all scenes for separate complete fallback
  p.frames[0].objectStates[p.stageObjects[0].id].visible=false;
  const element=mount(p),ids=p.frames.map(f=>f.id);let calls=0;
  const fallback=await h.vector.createA4VectorPdf({project:p,element,frameIds:ids,options,title:p.title,fallback:async()=>{calls++;const images=[];for(const pg of element.querySelectorAll('.print-page'))images.push(await h.elementToJpegDataUrl(pg,A4_FALLBACK_LIMITS));return h.jpegDataUrlsToPdfBlob(images,p.title,'portrait');}});
  if(calls!==1)throw new Error('Whole-document fallback count');
  const pdf=await h.pdfjs.getDocument({data:new Uint8Array(await fallback.arrayBuffer())}).promise;const texts=[];for(let i=1;i<=pdf.numPages;i++)texts.push((await (await pdf.getPage(i)).getTextContent()).items.length);
  if(pdf.numPages!==3||texts.some(n=>n!==0))throw new Error('Partial fallback document');await pdf.loadingTask.destroy();
  const publicResult=await generateA4Pdf({project:p,element,frameIds:ids,options,title:p.title});const preview=await createImageBitmap(publicResult.preview);const previewSize={width:preview.width,height:preview.height};preview.close();
  const unsafe=h.fixtures.vectorParadeFixture({total:100000,long:true,count:3}),unsafeBefore=JSON.stringify(unsafe);let unsafeFallback=0,reason;
  try{await h.vector.createA4VectorPdf({project:unsafe,element,frameIds:unsafe.frames.map(f=>f.id),options,title:unsafe.title,fallback:async()=>{unsafeFallback++;return new Blob();}});throw new Error('Unsafe output succeeded');}
  catch(error){if(error.name!=='Error'&&error.constructor.name!=='UnsafeParadeA4Export')throw error;reason=error.message;if(!reason.includes('安全上限'))throw error;}
  if(unsafeFallback||unsafeBefore!==JSON.stringify(unsafe))throw new Error('Unsafe fallback or mutation');
  const negative=h.fixtures.vectorParadeFixture({assignments:true,count:2});negative.members[0].name='العربية';const negEl=mount(negative);let complexFallback=0;
  await h.vector.createA4VectorPdf({project:negative,element:negEl,frameIds:negative.frames.map(f=>f.id),options,title:negative.title,fallback:async()=>{complexFallback++;return new Blob(['fallback']);}});
  if(complexFallback!==1)throw new Error('Contextual text fallback');
  return{alternating,wholeDocumentFallback:{calls,pages:3,textItems:texts,reason:h.vector.vectorPdfDiagnostics().map(x=>x.reason),previewSize},unsafe:{reason,unsafeFallback},complexFallback,fallback:await encode(fallback)};
 });
 await save('whole-document-fallback.pdf',regressions.fallback);delete regressions.fallback;
 await writeFile(directory+'/results.json',JSON.stringify({results,regressions,errors},null,2));console.log(JSON.stringify({regressions,errors},null,2));assert.equal(errors.length,0);await context.close();
}finally{await browser?.close();await server.close();}
