import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { compare } from './vector-pdf-visual-diff.mjs';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';

const baseline = process.argv.includes('--baseline');
const pdfOnly = process.argv.includes('--pdf-only');
const runtimeOnly = process.argv.includes('--runtime-only');
const skipRuntime = process.argv.includes('--skip-runtime');
const pngOnly = process.argv.includes('--png-only');
const directory = 'output/build31/roster-pdf';
const headXlsx=execFileSync('git',['show','HEAD:src/utils/rosterXlsx.ts'],{encoding:'utf8'}).replace(/from "\.\/([^\"]+)"/g,'from "/src/utils/$1"');
await mkdir(directory, { recursive: true });
const server = await createServer({ configFile:false, envFile:false, logLevel:'warn', esbuild:{jsx:'automatic'},
  optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','jspdf','html-to-image','jszip','lucide-react']},
  plugins:[{name:'roster-harness',resolveId(id){if(id==='/__head/rosterXlsx.ts')return id;if(id==='/__entry')return '\0entry';},load(id){if(id==='/__head/rosterXlsx.ts')return headXlsx;if(id==='\0entry')return "export {default as React} from 'react';export {createRoot} from 'react-dom/client';export {flushSync} from 'react-dom';";},configureServer(s){
    s.middlewares.use('/__roster',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><div id="root"></div>');});
    s.middlewares.use('/__pdfjs/',async(req,res,next)=>{if(!['/pdf.mjs','/pdf.worker.mjs'].includes(req.url))return next();res.setHeader('Content-Type','application/javascript');res.end(await readFile('node_modules/pdfjs-dist/build'+req.url));});
  }}],server:{host:'127.0.0.1',port:5395,strictPort:true}});
const cases = [
  {name:'five',count:5,groups:0}, {name:'sixty',count:60,groups:3},
  {name:'146-twelve',count:146,groups:12}, {name:'300',count:300,groups:3},
  {name:'empty',count:0,groups:0}, {name:'empty-groups',count:0,groups:3},
  {name:'mixed',count:5,groups:3,mixed:true},
  {name:'long-wrap',count:5,groups:3,long:true,pdfOnly:true},
];
const decode = s=>Buffer.from(s.split(',')[1],'base64');
const results=[];
let browser;
try {
  await server.listen(); console.log('Owned harness PID:',process.pid);
  browser=await chromium.launch({headless:true,args:['--disable-lcd-text']});
  for(const [width,height,dpr] of [[1440,900,1],[1180,820,2]]){
    const tag=`${width}-dpr${dpr}`;
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
    await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin==='http://127.0.0.1:5395'||['blob:','data:'].includes(u.protocol)?r.continue():r.abort();});
    const page=await context.newPage(); await page.goto('http://127.0.0.1:5395/__roster');
    await page.evaluate(async()=>{
      window.encode=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b);});
      window.fixtures=spec=>{
        const members=Array.from({length:spec.count},(_,i)=>({id:`p${i}`,name:`出演${String(i+1).padStart(4,'0')}`,color:'#ff0000'}));
        if(spec.count>=60)members[1].name='長い名前七文字';
        if(spec.mixed)members.forEach((m,i)=>m.name=['あいうえおか','あいうえおかき','花👨‍👩‍👧‍👦子','山田葛󠄀子','한글이름'][i]);
        if(spec.long)members.forEach((m,i)=>m.name=['同じ名前','同じ名前','ab cd ef','伊藤'.repeat(70),'1234567'][i]);
        const groups=Array.from({length:spec.groups},(_,i)=>({id:`g${i}`,name:i===1?'とても長い見出しを省略せず全部折り返すグループ':'組'+(i+1),color:['#f35','rgba(20,80,150,.6)','blue'][i%3],memberIds:members.filter((_,j)=>j%spec.groups===i).map(m=>m.id)}));
        if(groups.length){groups.push({id:'empty',name:'空グループ',memberIds:[],color:'#abc'});groups.at(-1).memberIds=['missing',members[0]?.id].filter(Boolean);}
        return {members,groups};
      };
    });
    for(const spec of cases){
      if(runtimeOnly||((baseline||pngOnly)&&spec.pdfOnly))continue;
      const id=`${tag}-${spec.name}`; console.log(baseline?'Baseline':'Verify',id);
      const record=await page.evaluate(async({spec,baseline,pdfOnly,pngOnly})=>{
        const {createRosterExportSnapshot}=await import('/src/utils/rosterExportSnapshot.ts');
        const {generateDocumentExport}=await import('/src/utils/mobileExport.ts');
        const f=window.fixtures(spec),snapshot=createRosterExportSnapshot('架空演目','members',f.members,f.groups,new Date('2026-10-21T00:00:00Z'));
        const options={signal:new AbortController().signal,onProgress:()=>{}};
        const pngs={};
        for(const [key,purpose,memberOverflow] of (pdfOnly||spec.pdfOnly?[]:[['a4','a4'],['mobile','mobile','single'],['readable','mobile','readable']])){
          const r=await generateDocumentExport({target:'members',data:snapshot},{target:'members',scope:'current',format:'png',purpose,memberOverflow},options);
          pngs[key]=await Promise.all(r.files.map(window.encode));
        }
        if(pngOnly)return {pngs};
        const start=performance.now();
        const pdf=await generateDocumentExport({target:'members',data:snapshot},{target:'members',scope:'current',format:'pdf',purpose:'a4'},options);
        const ms=performance.now()-start;
        if(baseline)return {pngs,pdf:await window.encode(pdf.files[0]),bytes:pdf.files[0].size,ms,pages:pdf.pageCount};
        const {measureRosterPdf,drawRosterPdfPage,measureRosterPdfPage,captureRosterPdfPage,rosterPdfFontCss}=await import('/src/utils/rosterPdf.ts');
        const {chooseRosterTablePlan,planRosterPdf,rosterPdfInterior}=await import('/src/utils/rosterPdfLayout.ts');
        const {elementToCanvas}=await import('/src/utils/exportRaster.ts');
        const {a4PageSize,fitPdfImage}=await import('/src/utils/pdfPageLayout.ts');
        const {prepareTextDrawings}=await import('/src/utils/vectorPdf/renderer.ts');
        const fonts=await import('/src/utils/vectorPdf/fonts.ts'), {sourceTrueType}=await import('/src/utils/vectorPdf/trueType.ts');
        const {visibleTextLines}=await import('/src/utils/vectorPdf/model.ts');
        const infos=new Map(await Promise.all(['normal','bold'].map(async w=>[w,sourceTrueType((await fonts.cachedFontBytes(fonts.fetchFontBytes,fonts.fontFileName(w))).bytes)])));
        const coverage=(w,c)=>!!infos.get(w).glyph(c);
        const columns=await measureRosterPdf(snapshot,options),plan=chooseRosterTablePlan(columns),size=rosterPdfInterior(plan.orientation);
        const fontCss=await rosterPdfFontCss(columns);
        const pdfjs=await import('/__pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/__pdfjs/pdf.worker.mjs';
        const doc=await pdfjs.getDocument({data:new Uint8Array(await pdf.files[0].arrayBuffer()),useSystemFonts:false}).promise;
        const a4=a4PageSize(plan.orientation),comparisons=[],models=[],texts=[],ids=[];
        const fit=fitPdfImage(Math.ceil(size.width/(25.4/96)-1e-7)*(25.4/96),Math.ceil(size.height/(25.4/96)-1e-7)*(25.4/96),a4.width,a4.height);
        const host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0;background:white;z-index:10000';document.body.append(host);
        try{
          for(const [i,p]of plan.pages.entries()){
            const sheet=drawRosterPdfPage(p,plan.orientation);host.replaceChildren(sheet);
            ids.push(...[...sheet.querySelectorAll('[data-member-id]')].map(e=>e.dataset.memberId));
            models.push(measureRosterPdfPage(sheet,String(i),coverage));
            const source=await captureRosterPdfPage(sheet,fontCss),page=await doc.getPage(i+1),v=page.getViewport({scale:2});
            const actual=document.createElement('canvas');actual.width=Math.ceil(v.width);actual.height=Math.ceil(v.height);
            await page.render({canvasContext:actual.getContext('2d'),viewport:v}).promise;
            const ref=document.createElement('canvas');ref.width=actual.width;ref.height=actual.height;const ctx=ref.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,ref.width,ref.height);ctx.drawImage(source,fit.x*2,fit.y*2,fit.width*2,fit.height*2);
            const rect=sheet.getBoundingClientRect(),unit=fit.width/rect.width*2;
            const boxes=[...sheet.querySelectorAll('[data-pdf-run]')].filter(e=>e.textContent).map(e=>{const r=e.getBoundingClientRect();return {x:fit.x*2+(r.x-rect.x)*unit-1,y:fit.y*2+(r.y-rect.y)*unit-1,width:r.width*unit+2,height:r.height*unit+2};});
            comparisons.push({ref:ref.toDataURL(),actual:actual.toDataURL(),boxes});
            const content=await page.getTextContent();texts.push(content.items.filter(i=>'str'in i).map(i=>i.str));
            if(Math.abs(Math.min(...page.view.slice(2))-595.28)>.1||Math.abs(Math.max(...page.view.slice(2))-841.89)>.1)throw new Error('Not A4');
            source.width=source.height=actual.width=actual.height=ref.width=ref.height=0;
          }
          const prepared=await prepareTextDrawings(coverage,models,{orientation:plan.orientation});
          const expected=prepared.pages.map(p=>visibleTextLines(p.drawings).map(l=>l.text).join('').replace(/\s/gu,''));
          if(expected.some((s,i)=>s!==texts[i].join('').replace(/\s/gu,'')))throw new Error('PDF extracted content/order differs: '+JSON.stringify({expected,texts}));
          const expectedIds=plan.pages.flatMap(p=>p.columns.flatMap(c=>c.items.slice(p.start,p.end).map(i=>i.id)));
          if(JSON.stringify(ids)!==JSON.stringify(expectedIds)||new Set(ids).size!==f.members.length)throw new Error('Member IDs missing, repeated or reordered');
        }finally{host.remove();await doc.cleanup();}
        return {pngs,pdf:await window.encode(pdf.files[0]),bytes:pdf.files[0].size,ms,pages:pdf.pageCount,comparisons,
          orientation:plan.orientation,portraitPages:planRosterPdf(columns,'portrait').pages.length,landscapePages:planRosterPdf(columns,'landscape').pages.length,texts};
      },{spec,baseline,pdfOnly,pngOnly});
      if(baseline){
        for(const [kind,images]of Object.entries(record.pngs))for(const [i,img]of images.entries())await writeFile(`${directory}/${id}-before-${kind}-${i}.png`,decode(img));
        await writeFile(`${directory}/${id}-before.pdf`,decode(record.pdf));
        await writeFile(`${directory}/${id}-before.json`,JSON.stringify({bytes:record.bytes,ms:record.ms,pages:record.pages}));
      }else{
        for(const [kind,images]of Object.entries(record.pngs))for(const [i,img]of images.entries()){
          const old=PNG.sync.read(await readFile(`${directory}/${id}-before-${kind}-${i}.png`)),now=PNG.sync.read(decode(img));
          assert.equal(now.width,old.width);assert.equal(now.height,old.height);assert.deepEqual(now.data,old.data,`${id} ${kind} PNG pixels`);
        }
        const existing=await readdir(directory);
        for(const [kind,images]of Object.entries(record.pngs))assert.equal(images.length,existing.filter(f=>f.startsWith(`${id}-before-${kind}-`)&&f.endsWith('.png')).length,`${id} ${kind} PNG page count`);
        if(pngOnly){results.push({id,pngPixelMatch:true,pngPageCountMatch:true,pages:Object.fromEntries(Object.entries(record.pngs).map(([k,v])=>[k,v.length]))});continue;}
        await writeFile(`${directory}/${id}.pdf`,decode(record.pdf));
        const visual=[];
        for(const [i,c]of record.comparisons.entries()){
          const ref=decode(c.ref),actual=decode(c.actual);
          const p=PNG.sync.read(ref);
          const diff=compare(ref,actual,{page:[{x:0,y:0,width:p.width,height:p.height}],text:c.boxes});
          await writeFile(`${directory}/${id}-${i+1}-reference.png`,ref);await writeFile(`${directory}/${id}-${i+1}-pdf.png`,actual);
          await writeFile(`${directory}/${id}-${i+1}-diff.png`,diff.diff);visual.push(diff.result);
          assert.ok(diff.pass,`${id} page ${i+1} visual: ${JSON.stringify(diff.result)}`);
        }
        record.visual=visual;
      }
      results.push({id,bytes:record.bytes,ms:record.ms,pages:record.pages,pngPixelMatch:baseline||pdfOnly||spec.pdfOnly?undefined:true,orientation:record.orientation,
        portraitPages:record.portraitPages,landscapePages:record.landscapePages,visual:record.visual,texts:record.texts});
    }
    if(!baseline&&!skipRuntime&&!pngOnly){
      const runtime=await page.evaluate(async()=>{
        const api=await import('/src/utils/rosterPdf.ts'),layout=await import('/src/utils/rosterPdfLayout.ts');
        const {createRosterExportSnapshot:snap}=await import('/src/utils/rosterExportSnapshot.ts');
        const {renderScenePages}=await import('/src/utils/vectorPdf/renderer.ts');
        const fonts=await import('/src/utils/vectorPdf/fonts.ts'),{sourceTrueType}=await import('/src/utils/vectorPdf/trueType.ts');
        const f=window.fixtures({count:60,groups:3}),s=snap('架空演目','members',f.members,f.groups);
        const noHosts=()=>{if(document.querySelector('[data-roster-pdf-host],[data-roster-pdf-measure]'))throw new Error('Leaked DOM');};
        const options={signal:new AbortController().signal,onProgress:()=>{}};
        for(const phase of ['文字幅','共通フォント']){
          const c=new AbortController();let cancelled=false;
          try{await api.generateRosterPdf(s,{signal:c.signal,onProgress:m=>{if(m.includes(phase))c.abort();}});}catch(e){if(e.name!=='AbortError')throw e;cancelled=true;}
          if(!cancelled)throw new Error('Cancellation did not reject '+phase);noHosts();
        }
        const original=HTMLCanvasElement.prototype.toBlob;let failed=false;
        HTMLCanvasElement.prototype.toBlob=function(){throw new Error('injected capture failure');};
        try{await api.generateRosterPdf(s,options);}catch(e){if(!e.message.includes('injected'))throw e;failed=true;}
        finally{HTMLCanvasElement.prototype.toBlob=original;}
        if(!failed)throw new Error('Capture failure not propagated');noHosts();
        const retried=await api.generateRosterPdf(s,options);if(retried.mode!=='vector')throw new Error('Retry did not produce vector');noHosts();
        for(const [names,reason]of [[['あ'.repeat(1800)],'A4'],[Array(1000).fill('محمد'),'画素数上限']]){
          let failed=false;try{await api.generateRosterPdf(snap('t','members',names.map((name,i)=>({id:String(i),name})),[]),options);}catch(e){if(!e.message.includes(reason))throw e;failed=true;}if(!failed)throw new Error('Expected '+reason);noHosts();
        }
        const arabic=await api.generateRosterPdf(snap('t','members',[{id:'a',name:'محمد'},{id:'b',name:'한'}],[]),options);
        if(arabic.mode!=='raster')throw new Error('Contextual text did not select whole new table raster');
        const columns=await api.measureRosterPdf(s,options),plan=layout.chooseRosterTablePlan(columns);
        const infos=new Map(await Promise.all(['normal','bold'].map(async w=>[w,sourceTrueType((await fonts.cachedFontBytes(fonts.fetchFontBytes,fonts.fontFileName(w))).bytes)])));
        const coverage=(w,c)=>!!infos.get(w).glyph(c),host=document.createElement('div');host.style.cssText='position:fixed;left:0;top:0';document.body.append(host);
        const models=[];try{for(const [i,p]of plan.pages.entries()){const e=api.drawRosterPdfPage(p,plan.orientation);host.replaceChildren(e);models.push(api.measureRosterPdfPage(e,String(i),coverage));}}finally{host.remove();}
        const first=await renderScenePages(models,{orientation:plan.orientation}),second=await renderScenePages(models,{orientation:plan.orientation});
        if(first.metrics.weights.join()!=='bold,normal'||second.metrics.fontAttempts.join()!=='subset')throw new Error('Regular/Bold repeat failed');
        const repaired=await renderScenePages(models,{orientation:plan.orientation,subsetFont:async()=>{throw new Error('injected subset failure');}});
        if(repaired.metrics.fontAttempts.join()!=='subset,original')throw new Error('No original-font reconstruction');
        const reader=async(name,signal)=>{if(!reader.failed){reader.failed=true;throw new Error('injected font read failure');}return fonts.fetchFontBytes(name,signal);};
        let readFailed=false;try{await renderScenePages(models,{orientation:plan.orientation,readFontBytes:reader});}catch(e){readFailed=e.message.includes('injected');}
        const readRetry=await renderScenePages(models,{orientation:plan.orientation,readFontBytes:reader});if(!readFailed||!readRetry.blob.size)throw new Error('Font retry failed');
        const xlsx=await import('/src/utils/rosterXlsx.ts'),head=await import('/__head/rosterXlsx.ts');
        const source={projectTitle:'架空',members:f.members,memberGroups:f.groups,objects:[{id:'o',name:'道具<&'}],objectGroups:[{id:'og',name:'道具組',objectIds:['o'],color:'rgba(20,30,40,.5)'}]};
        const date=new Date('2026-10-21T00:00:00Z');
        const before=await head.generateRosterXlsx(source,true,undefined,date),after=await xlsx.generateRosterXlsx(source,true,undefined,date);
        const {React,createRoot,flushSync}=await import('/__entry');
        const {DocumentExportSheet}=await import('/src/components/DocumentExportSheet.tsx');
        const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(DocumentExportSheet,{initialTarget:'members',initialFormat:'pdf',viewport:true,getSource:()=>source,onClose:()=>{}})));
        const dialog=document.querySelector('.document-export-sheet');if(dialog.textContent.includes('用途')||dialog.textContent.includes('1枚の名簿')||dialog.querySelector('.document-export-create').disabled)throw new Error('PDF UI preflight gate');
        return {cancelPhases:2,captureRetry:true,fontReadRetry:true,regularBoldRepeat:true,subsetRetry:repaired.metrics.fontAttempts,
          contextualMode:arabic.mode,limits:true,beforeXlsx:await window.encode(before.files[0]),afterXlsx:await window.encode(after.files[0]),contextualPdf:await window.encode(arabic.blob)};
      });
      const before=await JSZip.loadAsync(decode(runtime.beforeXlsx)),after=await JSZip.loadAsync(decode(runtime.afterXlsx));
      assert.deepEqual(Object.keys(after.files),Object.keys(before.files));
      for(const file of Object.keys(before.files).filter(f=>!before.files[f].dir))assert.equal(await after.file(file).async('string'),await before.file(file).async('string'),'Excel regression '+file);
      await page.screenshot({path:`${directory}/${tag}-pdf-ui.png`});
      await writeFile(`${directory}/${tag}-contextual.pdf`,decode(runtime.contextualPdf));
      delete runtime.beforeXlsx;delete runtime.afterXlsx;delete runtime.contextualPdf;
      await writeFile(`${directory}/${tag}-runtime.json`,JSON.stringify({...runtime,xlsxCellStyleMatch:true},null,2));
      console.log('Runtime and Excel regression passed',tag);
    }
    await context.close();
  }
  if(!runtimeOnly)await writeFile(`${directory}/${baseline?'baseline':pngOnly?'png-results':'results'}.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(({texts,visual,...r})=>({...r,visualPass:visual?.every(p=>Object.values(p).every(v=>v.pass))})),null,2));
}finally{await browser?.close();await server.close();}
