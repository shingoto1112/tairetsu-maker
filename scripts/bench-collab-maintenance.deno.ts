// Same anonymous Node-generated workloads; actual native Deno/Yjs execution.
import process from 'node:process';
import { buildMaintenanceOutput } from '../src/collaboration/maintenance.ts';
import { decodeBase64, SERVER_LIMITS } from '../src/collaboration/serverValidation.ts';
import { buildRestoreOutput } from '../src/collaboration/restore.ts';
const workload=Deno.args[0],operation=Deno.args[1];
if(!['regular','accumulated','boundary'].includes(workload)||!['compact','automatic','restore'].includes(operation))throw new Error('fixed workload required');
const input=JSON.parse(await Deno.readTextFile(`.tmp-maintenance-inputs/${workload}.json`));
const cut={documentId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',generation:'1',cutSeq:String(input.updates.length),documentSchema:2 as const,
  snapshot:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',uptoSeq:'0',bytes:decodeBase64(input.snapshot,SERVER_LIMITS.snapshotBytes)},
  updates:(input.updates as {seq:string;bytes:string}[]).map(u=>({seq:u.seq,bytes:decodeBase64(u.bytes,262144)}))};
input.snapshot='';input.updates=[];
const samples:number[]=[],cpus:number[]=[],rss:number[]=[],heaps:number[]=[],errors:string[]=[],rejected:string[]=[];let output=0;
const initialOutput=operation==='restore'?await buildMaintenanceOutput({...cut,cutSeq:'0',updates:[]},'manual','11111111-1111-4111-8111-111111111111','2026-10-05T00:00:00.000Z'):null;
const target=initialOutput?{...JSON.parse(new TextDecoder().decode(initialOutput.bytes)),digest:initialOutput.digest,
  documentId:cut.documentId,generation:'1',confirmedSeq:'0',reason:'manual',automatic:false,requestedBy:'11111111-1111-4111-8111-111111111111',serverAt:'2026-10-05T00:00:00.000Z'}:null;
for(let i=0;i<12;i++) {
  const cpu=process.cpuUsage(),start=performance.now();
  const sample=()=>{const m=Deno.memoryUsage();rss.push(m.rss);heaps.push(m.heapUsed);};sample();
  try{output=operation==='restore'?(await buildRestoreOutput(cut,target,sample)).update.length:
    (await buildMaintenanceOutput(cut,operation as 'compact'|'automatic','11111111-1111-4111-8111-111111111111','2026-10-04T00:00:00.000Z',sample)).bytes.length;}
  catch(e){const code=e instanceof Error?e.message:'FAILED';if(operation==='restore'&&workload==='boundary'&&code==='QUOTA_EXCEEDED')rejected.push(code);else errors.push(code);}
  const used=process.cpuUsage(cpu);cpus.push((used.user+used.system)/1000);samples.push(performance.now()-start);sample();
}
samples.sort((a,b)=>a-b);cpus.sort((a,b)=>a-b);
const peakRss=process.resourceUsage().maxRSS/1024,peakHeap=Math.max(...heaps)/1048576;
// Gate on the isolate heap (what the Edge memory limit governs) at 75% of the 256MB Edge limit;
// sampled heap includes uncollected garbage and varies by run (99-134MiB for the same case). Whole-process RSS also counts the
// Deno runtime/V8 platform, varies run to run, and is reported only. Real-Edge measurement stays a pre-release step.
const restoreMemoryBudget=operation==='restore'&&workload!=='boundary'?{heapMiB:192,rssMiBReported:peakRss,pass:peakHeap<=192}:null;
console.log(JSON.stringify({runtime:`Deno ${Deno.version.deno}`,workload,operation,trials:12,snapshotBytes:cut.snapshot.bytes.length,
  logBytes:cut.updates.reduce((n,u)=>n+u.bytes.length,0),outputBytes:output,cpuP95Ms:cpus[11],wallP95Ms:samples[11],
  maxSampledRssMiB:Math.max(...rss)/1048576,processPeakRssMiB:peakRss,maxSampledHeapMiB:peakHeap,restoreMemoryBudget,errors:[...new Set(errors)],expectedRejections:[...new Set(rejected)],scope:'native Deno; binary pipeline and input decode; no hosted network/DB'}));
if(errors.length||restoreMemoryBudget?.pass===false)Deno.exit(1);
