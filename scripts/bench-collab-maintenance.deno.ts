// Same anonymous Node-generated workloads; actual native Deno/Yjs execution.
import process from 'node:process';
import { buildMaintenanceOutput } from '../src/collaboration/maintenance.ts';
import { decodeBase64 } from '../src/collaboration/serverValidation.ts';
const workload=Deno.args[0],operation=Deno.args[1];
if(!['regular','accumulated','boundary'].includes(workload)||!['compact','automatic'].includes(operation))throw new Error('fixed workload required');
const input=JSON.parse(await Deno.readTextFile(`.tmp-maintenance-inputs/${workload}.json`));
const cut={documentId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',generation:'1',cutSeq:String(input.updates.length),documentSchema:2 as const,
  snapshot:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',uptoSeq:'0',bytes:decodeBase64(input.snapshot,8388608)},
  updates:(input.updates as {seq:string;bytes:string}[]).map(u=>({seq:u.seq,bytes:decodeBase64(u.bytes,262144)}))};
input.snapshot='';input.updates=[];
const samples:number[]=[],cpus:number[]=[],rss:number[]=[],heaps:number[]=[],errors:string[]=[];let output=0;
for(let i=0;i<12;i++) {
  const cpu=process.cpuUsage(),start=performance.now();
  const sample=()=>{const m=Deno.memoryUsage();rss.push(m.rss);heaps.push(m.heapUsed);};sample();
  try{output=(await buildMaintenanceOutput(cut,operation as 'compact'|'automatic','11111111-1111-4111-8111-111111111111','2026-10-04T00:00:00.000Z',sample)).bytes.length;}
  catch(e){errors.push(e instanceof Error?e.message:'FAILED');}
  const used=process.cpuUsage(cpu);cpus.push((used.user+used.system)/1000);samples.push(performance.now()-start);sample();
}
samples.sort((a,b)=>a-b);cpus.sort((a,b)=>a-b);
console.log(JSON.stringify({runtime:`Deno ${Deno.version.deno}`,workload,operation,trials:12,snapshotBytes:cut.snapshot.bytes.length,
  logBytes:cut.updates.reduce((n,u)=>n+u.bytes.length,0),outputBytes:output,cpuP95Ms:cpus[11],wallP95Ms:samples[11],
  maxSampledRssMiB:Math.max(...rss)/1048576,maxSampledHeapMiB:Math.max(...heaps)/1048576,errors:[...new Set(errors)],scope:'native Deno; binary pipeline and input decode; no hosted network/DB'}));
if(errors.length)Deno.exit(1);
