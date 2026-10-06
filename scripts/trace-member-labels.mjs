import { build, preview, loadConfigFromFile, mergeConfig } from 'vite';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixture, openFixture, gesture } from './measure-member-labels.mjs';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'tairetsu-label-trace-'));
const config=(await loadConfigFromFile({command:'build',mode:'production'})).config;
const baseline=execFileSync('git',['show','b5f4076:src/components/StageCanvas.tsx'],{encoding:'utf8'});
const browser=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const summaries=[];let server;
try{
 for(const variant of ['A','B']){
  const outDir=path.join(tmp,variant);await build(mergeConfig(config,{envFile:false,logLevel:'warn',plugins:[{name:'trace-labels',enforce:'pre',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/components/StageCanvas.tsx'))return variant==='A'?baseline:code.replace('isDenseProject && (isMemberDragging || isStagePanning)','false');}}],build:{outDir,emptyOutDir:true}}));
  server=await preview({configFile:false,envFile:false,build:{outDir},preview:{host:'127.0.0.1',port:0,strictPort:true}});
  const p=fixture(300);p.frames[0].sceneViewState.zoom=1.5;const {page,context}=await openFixture(browser,server.resolvedUrls.local[0].slice(0,-1),p,{width:1376,height:1032});const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await gesture(page,cdp,'stage','single',false);
  await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires,disabled-by-default-devtools.timeline',transferMode:'ReturnAsStream'});
  await gesture(page,cdp,'stage','single',true);const done=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const {stream}=await done;let raw='';
  for(;;){const chunk=await cdp.send('IO.read',{handle:stream});raw+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString('utf8'):chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});
  const traceFile=path.join(os.tmpdir(),`tairetsu-label-trace-${Date.now()}-${process.pid}-${variant}.json.gz`);await fs.writeFile(traceFile,gzipSync(raw));
  const events=JSON.parse(raw).traceEvents,profiles=new Map();
  for(const e of events.filter(e=>e.name==='ProfileChunk')){const key=String(e.id??e.id2?.local??e.pid),data=e.args.data;let profile=profiles.get(key);if(!profile)profiles.set(key,profile={nodes:new Map(),samples:[]});for(const node of data.cpuProfile?.nodes??[])profile.nodes.set(node.id,node);for(const [i,id] of (data.cpuProfile?.samples??[]).entries())profile.samples.push({id,us:data.timeDeltas?.[i]??1000});}
  const weights=new Map();for(const profile of profiles.values())for(const {id,us} of profile.samples){const node=profile.nodes.get(id),call=node?.callFrame;if(!call)continue;const key=`${call.functionName||'(anonymous)'} @ ${call.url?.split('/').at(-1)||'(native)'}:${call.lineNumber}`;weights.set(key,(weights.get(key)||0)+us/1000);}
  const phases=['RunTask','FunctionCall','UpdateLayoutTree','Layout','Paint'].map(name=>({name,count:events.filter(e=>e.ph==='X'&&e.name===name).length,totalMs:events.filter(e=>e.ph==='X'&&e.name===name).reduce((n,e)=>n+(e.dur||0)/1000,0),maxMs:Math.max(0,...events.filter(e=>e.ph==='X'&&e.name===name).map(e=>(e.dur||0)/1000))}));
  summaries.push({variant,traceFile,phases,hotspots:[...weights].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([name,sampledMs])=>({name,sampledMs}))});
  await context.close();server.httpServer.closeAllConnections();await new Promise(r=>server.httpServer.close(r));server=null;
 }
 await fs.writeFile('docs/member-label-trace-summary.json',JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries,null,2));
}finally{await browser.close();if(server){server.httpServer.closeAllConnections();server.httpServer.close();}assert(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(tmp,{recursive:true,force:true});}
