#!/usr/bin/env node
// Offline: fixture construction, TS compilation and each measured operation use
// separate processes. Actual input base64 decoding is included in worker RSS.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadCollabRuntime } from './testing/load-collab-runtime.mjs';
const loaded=await loadCollabRuntime();
const directory=fileURLToPath(new URL('./',loaded.moduleUrls[0]));
const run=(workload,operation,file)=>new Promise((resolve,reject)=>{
  const child=fork(fileURLToPath(new URL('./testing/maintenance-benchmark-worker.mjs',import.meta.url)),[workload,operation,file,...loaded.moduleUrls],
    {execArgv:['--expose-gc'],stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code?reject(new Error('benchmark failed')):resolve());
});
try {
  const fixturesOnly=process.argv[2]==='--fixtures-only';
  if(fixturesOnly)await mkdir('.tmp-maintenance-inputs',{recursive:true});
  for(const workload of ['regular','accumulated','boundary']) {
    const file=fixturesOnly?path.resolve('.tmp-maintenance-inputs',workload+'.json'):directory+workload+'.json';await run(workload,'fixture',file);
    if(fixturesOnly)continue;
    for(const operation of ['compact','automatic','restore'])await run(workload,operation,file);
  }
} finally {await loaded.dispose();}
