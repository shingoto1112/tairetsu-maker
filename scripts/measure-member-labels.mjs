// Production-only, anonymous, isolated Chromium contexts. No external requests.
import { build, preview, loadConfigFromFile, mergeConfig } from 'vite';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { report } from './report-member-labels.mjs';

export function fixture(count, mode = 'stage') {
  const members = Array.from({length:count},(_,i)=>({id:`m${i}`,name:`架空${String(i+1).padStart(3,'0')}`,color:'#2563eb',visible:true}));
  const positions=Object.fromEntries(members.map((m,i)=>[m.id,{x:1+(i%20)*.6,y:mode==='parade'?25-Math.floor(i/20)*.55:1+Math.floor(i/20)*.55}]));
  positions.m0={x:6,y:mode==='parade'?25:5};positions.m1={x:7,y:mode==='parade'?25:5};
  return {id:`labels-${mode}-${count}`,version:1,title:`測定${mode}${count}`,mode,updatedAt:'2026-10-06T00:00:00Z',
    stage:{widthMeters:14,depthMeters:10,gridSizeMeters:.1,showGrid:true,showCenterLine:true,showStageLabels:true,audienceSide:'bottom',horizontalGuideMode:'meters',memberDiameterMeters:.4},
    paradeSettings:{width:14,totalDistance:30,cellSizeMeters:.5,direction:'up',rulerPosition:'both',horizontalMeasureMode:'normalMeter',emphasizeEvery5m:true,emphasizeEvery10m:true},
    members,memberGroups:[{id:'pair',name:'測定ペア',memberIds:['m0','m1']}],stageObjects:[],frames:[{id:'s0',label:'シーン1',timeSec:0,positions,objectStates:{},sceneViewState:{zoom:1,scrollTop:0,scrollLeft:0}}]};
}
export async function openFixture(browser,origin,project,size,native = true) {
  const context=await browser.newContext({viewport:size,hasTouch:true});
  await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||['data:','blob:'].includes(u.protocol)?r.continue():r.abort();});
  await context.addInitScript(p=>{if(!localStorage.getItem('label-seeded')){localStorage.setItem('stageflow.projects.v1',JSON.stringify([p]));localStorage.setItem('label-seeded','1');}},project);
  const page=await context.newPage();await page.goto(origin+(native?'/?runtime=capacitor-ios':'/'));
  await page.getByRole('button',{name:project.title+'を開く',exact:true}).click();
  await expect(page.locator('.toolbar')).toBeVisible();
  const close=page.getByRole('button',{name:'お知らせを閉じる',exact:true});if(await close.count())await close.click();
  await page.waitForTimeout(350);
  if(project.mode==='parade'){
    await page.locator('.parade-viewport').evaluate(owner=>{
      const member=owner.querySelector('.parade-member'),r=member.getBoundingClientRect(),v=owner.getBoundingClientRect();
      owner.scrollLeft+=r.left+r.width/2-v.left-v.width/2;
      owner.scrollTop+=r.top+r.height/2-v.top-v.height/2;
    });await page.waitForTimeout(150);
  }
  return {context,page};
}
const percentile=(xs,p)=>{const a=[...xs].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(a.length*p))]??0;};
const stats=s=>({frames:s.frames.length,p50:percentile(s.frames,.5),p95:percentile(s.frames,.95),p99:percentile(s.frames,.99),over33:s.frames.filter(x=>x>33.3).length/Math.max(1,s.frames.length)*100,over50:s.frames.filter(x=>x>50).length/Math.max(1,s.frames.length)*100,longCount:s.long.length,longTotal:s.long.reduce((a,b)=>a+b,0),longMax:Math.max(0,...s.long),longOver100:s.long.filter(x=>x>=100).length,latency95:percentile(s.latency,.95)});
export async function gesture(page,cdp,mode,operation,record) {
  const token=mode==='stage'?'.member-token':'.parade-member';
  const area=mode==='stage'?'.stage-fit-area':'.parade-viewport';
  if(operation==='multi'){
    await page.locator('.group-card').filter({has:page.getByRole('textbox',{name:'グループ名',exact:true})}).getByRole('button',{name:'選択',exact:true}).first().click();
    await expect(page.locator(token+'.is-selected')).toHaveCount(2);
    await page.locator('.tab-panel__content').evaluate(e=>e.scrollTop=0);
  }
  const point=await page.evaluate(({token,area,operation})=>{
    const owner=document.querySelector(area),r=owner.getBoundingClientRect();
    if(operation!=='pan'){
      const e=[...document.querySelectorAll(token)].find(e=>{const b=e.getBoundingClientRect();return (operation!=='multi'||e.classList.contains('is-selected'))&&b.left>r.left+2&&b.right<r.right-30&&b.top>r.top+2&&b.bottom<r.bottom-30;});
      if(!e)throw Error('No visible member '+JSON.stringify({area:r.toJSON(),selected:[...document.querySelectorAll(token+'.is-selected')].map(e=>e.getBoundingClientRect().toJSON())}));const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};
    }
    for(const fx of [.95,.9,.05,.5,.15,.25,.75])for(const fy of [.9,.95,.5,.1,.05,.2,.3,.7]){
      const x=r.left+r.width*fx,y=r.top+r.height*fy;
      if([-16,0,16].every(dx=>[-16,0,16].every(dy=>{const e=document.elementFromPoint(x+dx,y+dy);return e&&owner.contains(e)&&!e.closest(token+',button,input,.stage-object,.parade-object');})))return{x,y};
    }throw Error('No finger-sized pan space');
  },{token,area,operation});
  await page.evaluate(record=>{
    window.labelProbe={start:performance.now(),stop:false,frames:[],frameTimes:[],long:[],longTimes:[],latency:[],latencyTimes:[],last:null,pending:[],moveTimes:[]};
    const s=window.labelProbe;
    s.pointer=e=>{if(e.isTrusted){const t=performance.now();s.moveTimes.push(t);s.pending.push(t);}};document.addEventListener('pointermove',s.pointer,{capture:true});
    s.observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){s.long.push(e.duration);s.longTimes.push(e.startTime);}});s.observer.observe({type:'longtask',buffered:false});
    const tick=t=>{if(s.last!==null){s.frames.push(t-s.last);s.frameTimes.push(t);}s.last=t;for(const p of s.pending){s.latency.push(performance.now()-p);s.latencyTimes.push(performance.now());}s.pending=[];if(!s.stop)requestAnimationFrame(tick);};requestAnimationFrame(tick);
  },record);
  const send=(type,x=point.x,y=point.y)=>operation==='pan'
    ? cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{id:1,x,y,radiusX:2,radiusY:2,force:1}]})
    : cdp.send('Input.dispatchMouseEvent',{type:{touchStart:'mousePressed',touchMove:'mouseMoved',touchEnd:'mouseReleased'}[type],x,y,button:'left',buttons:type==='touchEnd'?0:1,clickCount:type==='touchMove'?0:1});
  await send('touchStart',point.x,point.y);
  const start=performance.now(),pending=[],sent=[];
  for(let i=1;i<=60;i++){
    const due=start+i*16.67;const pause=due-performance.now();if(pause>4)await new Promise(r=>setTimeout(r,pause-4));
    // Windows timers can wake one tick late. Yield cooperatively for the final
    // few milliseconds; do not wait for each CDP acknowledgement to send.
    while(performance.now()<due)await new Promise(r=>setImmediate(r));
    const d=20*Math.sin(i/60*Math.PI*2);sent.push(performance.now());pending.push(send('touchMove',point.x+d,point.y+d*.5));
  }
  await Promise.all(pending);
  const labels=await page.locator(token+'__label').count();
  const selected=await page.locator(token+'.is-selected').count();
  if(operation==='multi')assert(selected>=2,'Multi drag must retain two selected members');
  if(operation==='pan'&&mode==='stage'){
    assert(await page.locator('.stage-fit-area.is-stage-panning').count()===1,'Stage pan must be active');
    assert(await page.locator(area).evaluate(e=>e.scrollWidth>e.clientWidth||e.scrollHeight>e.clientHeight),'Pan must have a scrollable zoomed viewport');
  }
  await send('touchEnd');await page.waitForTimeout(120);
  const samples=await page.evaluate(()=>{const s=window.labelProbe;s.stop=true;s.observer.disconnect();document.removeEventListener('pointermove',s.pointer,true);return {frames:s.frames,frameTimes:s.frameTimes,long:s.long,longTimes:s.longTimes,latency:s.latency,latencyTimes:s.latencyTimes,moveTimes:s.moveTimes};});
  assert(samples.moveTimes.length>0,'Trusted pointer input must reach the page');
  // Chromium coalesces queued moves under CPU throttling. Split by the actual
  // received gesture duration instead of assuming that all 60 events arrive.
  const first=samples.moveTimes[0],span=samples.moveTimes.at(-1)-first;
  const phase=t=>t<first+span*.2?'start':t<first+span*.9?'steady':'end';
  const sections=Object.fromEntries(['start','steady','end'].map(name=>[name,stats({frames:samples.frames.filter((_,i)=>phase(samples.frameTimes[i])===name),long:samples.long.filter((_,i)=>phase(samples.longTimes[i])===name),latency:samples.latency.filter((_,i)=>phase(samples.latencyTimes[i])===name)})]));
  const intervals=sent.slice(1).map((t,i)=>t-sent[i]);
  return {...stats(samples),sections,labels,selected,moves:samples.moveTimes.length,inputInterval50:percentile(intervals,.5),inputInterval95:percentile(intervals,.95),inputDuration:sent.at(-1)-sent[0]};
}
async function main(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'tairetsu-label-ab-'));
  const config=(await loadConfigFromFile({command:'build',mode:'production'})).config;
  // Both variants compile an identical source snapshot even if another editor
  // writes to the worktree between the two production builds.
  const sources=new Map();
  for(const file of await fs.readdir('src',{recursive:true})){
    const target=path.resolve('src',file);
    if(/\.(?:[cm]?[jt]sx?|css)$/.test(file)&&(await fs.stat(target)).isFile())sources.set(target.replaceAll('\\','/'),await fs.readFile(target,'utf8'));
  }
  const sourceHash=createHash('sha256').update([...sources].map(([file,code])=>file+'\n'+code).join('\n')).digest('hex');
  console.log(`SOURCE_HASH ${sourceHash}`);
  const baseline=execFileSync('git',['show','b5f4076:src/components/StageCanvas.tsx'],{encoding:'utf8'});
  const resultFile=path.join(os.tmpdir(),`tairetsu-member-label-results-${Date.now()}-${process.pid}.json`);
  console.log(`RESULT_FILE ${resultFile}`);
  const servers=[];const results=[];const browser=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  try{
    for(const variant of ['A','B']){
      const outDir=path.join(tmp,variant);
      await build(mergeConfig(config,{envFile:false,logLevel:'warn',plugins:[{name:'labels-comparison',enforce:'pre',transform(code,id){const key=id.split('?')[0].replaceAll('\\','/');const frozen=sources.get(key);if(key.endsWith('/src/components/StageCanvas.tsx'))return variant==='A'?baseline:(frozen??code).replace('isDenseProject && (isMemberDragging || isStagePanning)','false');return frozen;}}],build:{outDir,emptyOutDir:true}}));
      const server=await preview({configFile:false,envFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});servers.push(server);
    }
    for(const mode of ['stage','parade'])for(const count of [200,300])for(const [width,height] of [[1376,1032]])for(const cpu of [4])for(const operation of (process.env.LABEL_PROBE_ONLY?['multi']:['single','multi','pan'])){
      if(results.filter(r=>r.mode===mode&&r.count===count&&r.width===width&&r.height===height&&r.cpu===cpu&&r.operation===operation).length===6)continue;
      const sessions={};for(const variant of ['A','B']){const origin=servers[variant==='A'?0:1].resolvedUrls.local[0].replace(/\/$/,'');const p=fixture(count,mode);p.frames[0].sceneViewState.zoom=1.5;const s=await openFixture(browser,origin,p,{width,height});s.cdp=await s.context.newCDPSession(s.page);await s.cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});sessions[variant]=s;await gesture(s.page,s.cdp,mode,operation,false);}
      for(let repeat=0;repeat<3;repeat++)for(const variant of repeat%2?['B','A']:['A','B']){const s=sessions[variant];await s.page.bringToFront();const metrics=await gesture(s.page,s.cdp,mode,operation,true);if(variant==='B'||mode==='parade')assert.equal(metrics.labels,count,'All labels must remain during the operation');else assert(metrics.labels<count,'A must simplify labels during the operation');results.push({mode,count,width,height,cpu,operation,repeat,variant,...metrics});}
      for(const s of Object.values(sessions))await s.context.close();
      console.log(JSON.stringify({mode,count,width,height,cpu,operation,done:results.length}));
      await fs.writeFile(resultFile,JSON.stringify(results,null,2));
      if(process.env.LABEL_PROBE_ONLY)return;
    }
    await report(results);
  }catch(error){console.error(error);throw error;}finally{await browser.close();for(const s of servers){s.httpServer.closeAllConnections();s.httpServer.close();}const resolved=path.resolve(tmp);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(resolved,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
