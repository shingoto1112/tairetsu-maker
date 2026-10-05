import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { storagePerformanceServer } from './testing/storage-performance-server.mjs';

// Local checks only. Every browser script uses anonymous isolated contexts.
// No installs, cloud SQL, workflow, gh or production commands are invoked.
const root=process.cwd(), result=[], phase=process.env.CHECK_PHASE ?? 'all';
assert(['all','unit','browser'].includes(phase), 'CHECK_PHASE must be all, unit or browser');
// Child suites provide their own loopback mocks. Inherited provider settings
// and partial-case switches must not turn this full check into another task.
for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_COLLABORATION_V2','PERF_BASELINE_RAIL','BUILD22_KIND','BUILD22_SIZE','APP_STORAGE_CASE']) delete process.env[key];
await mkdir('output/storage-performance',{recursive:true});
async function run(name,args,npm=false) {
  const started=Date.now();let log='';
  const command=npm ? (process.platform==='win32'?'powershell.exe':'npm') : process.execPath;
  const argv=npm&&process.platform==='win32'?['-NoProfile','-Command',`npm.cmd ${args.join(' ')}`]:args;
  console.log(`START ${name}`);
  const exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(command,argv,{cwd:root,windowsHide:true,env:{...process.env,REPOSITORY_TEST_ORIGIN:'http://127.0.0.1:5197',ROUND12_SHOT_DIR:path.join(root,'output/playwright/round11',name)}});
    for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{const text=data.toString();log+=text;process.stdout.write(text);});
    child.on('error',reject);child.on('exit',resolve);
  });
  await writeFile(`output/storage-performance/check-${name}.log`,log);
  result.push({name,exitCode,elapsedMs:Date.now()-started});
  await writeFile('output/storage-performance/checks.json',JSON.stringify(result,null,2)+'\n');
  if(exitCode!==0)process.exitCode=1; // Complete independent checks even after a failure.
}
if(['all','unit'].includes(phase)) {
  for(let i=1;i<=2;i++)await run(`unit-${i}`,['test','--','--maxWorkers','2'],true);
  await run('typecheck',['run','typecheck'],true);
  const previousNodeEnv = process.env.NODE_ENV;
  const temporary=await mkdtemp(path.join(root,'.tmp-storage-round11-build-'));
  try {
    const {build}=await import('vite');
    const buildResult=await build({envFile:false,build:{outDir:temporary,emptyOutDir:true},logLevel:'warn'});
    const chunks=(Array.isArray(buildResult)?buildResult:[buildResult]).flatMap(r=>r.output);
    const main=chunks.find(c=>c.type==='chunk'&&c.isEntry&&c.facadeModuleId?.endsWith('index.html'));
    assert(main);const bytes=(await readFile(path.join(temporary,main.fileName))).length;
    console.log('MAIN_JS',JSON.stringify({file:main.fileName,bytes,baseline:370075,delta:bytes-370075}));
    result.push({name:'vite-build',exitCode:0,mainBytes:bytes,delta:bytes-370075});
  } catch(e) {result.push({name:'vite-build',exitCode:1,error:e.message});process.exitCode=1;}
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    const relative=path.relative(root,temporary);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(temporary).startsWith('.tmp-storage-round11-build-'));
    await rm(temporary,{recursive:true,force:true});
  }
  await run('collaboration-bundle',['scripts/check-collaboration-bundle.mjs']);
  await run('native-repository',['scripts/check-native-repository.mjs']);
}
if(['all','browser'].includes(phase)) {
  // Vite build mutates NODE_ENV. DEV guards enable runtime previews and the
  // local mock adapters; never inherit production mode into browser checks.
  process.env.NODE_ENV = 'development';
  const server=await storagePerformanceServer({port:5197});
  try {
    for(let i=1;i<=2;i++)await run(`build22-${i}`,['scripts/test-build22-browser.mjs']);
    for(const script of ['app-storage','indexeddb','legacy-import','legacy-local','help-page','collaboration-ui','shared-session-app','collaboration-history','collaboration-presence']) await run(script,[`scripts/test-${script}-browser.mjs`]);
    await run('repository-browser',['run','test:repository:browser'],true);
    for(let i=1;i<=2;i++)await run(`scene-previews-${i}`,['scripts/test-scene-previews-browser.mjs']);
  } finally {await server.close();}
}
await writeFile('output/storage-performance/checks.json',JSON.stringify(result,null,2)+'\n');
console.log('ROUND11_CHECKS',JSON.stringify(result));
