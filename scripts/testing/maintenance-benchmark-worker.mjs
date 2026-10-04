import { readFile, writeFile } from 'node:fs/promises';
import * as Y from 'yjs';
const worker=process.argv[2];
const operation=process.argv[3],fixturePath=process.argv[4],urls=process.argv.slice(5);
let loaded;
if(operation==='fixture') {
  const [runtime,normalization]=await Promise.all(urls.slice(0,2).map(url=>import(url)));loaded={runtime,normalization};
  const fixture=await createFixture();
  await writeFile(fixturePath,JSON.stringify({...fixture,snapshot:Buffer.from(fixture.snapshot).toString('base64'),
    updates:fixture.updates.map(u=>({...u,bytes:Buffer.from(u.bytes).toString('base64')}))}));
} else {
  const [validation,maintenance]=await Promise.all(urls.slice(2).map(url=>import(url)));loaded={validation,maintenance};
  const input=JSON.parse(await readFile(fixturePath,'utf8'));
  const snapshot=validation.decodeBase64(input.snapshot,8388608),updates=input.updates.map(u=>({seq:u.seq,bytes:validation.decodeBase64(u.bytes,262144)}));
  input.snapshot='';input.updates=[];global.gc?.();
  await measure(snapshot,updates,input.members,input.scenes);
}
async function createFixture() {
    const raw=JSON.parse(await readFile('src/repositories/contract/fixtures/projects.json','utf8')).large;
    const project=loaded.normalization.normalizeProject(raw), initial=loaded.runtime.createSharedDocument(project);
    const doc=new Y.Doc({gc:false});Y.applyUpdate(doc,Y.encodeStateAsUpdate(initial));initial.destroy();
    const settings=doc.getMap('settings'),orders=doc.getMap('orders');
    const memberOrder=orders.get(JSON.stringify(['members'])),slots=memberOrder.get('slots'),active=memberOrder.get('active');
    const change=(i,people=146)=>doc.transact(()=>{
      const scene=doc.getMap('scenes').get(project.frames[i%project.frames.length].id);
      // Scalar position changes retain bounded history; deleted visibility and
      // old order slots exercise both GC and the logical tombstone semantics.
      for(let m=0;m<people;m++)scene.get('positions').set(project.members[m].id,{x:m/4+i/10,y:i%18});
      const id=project.members[i%146].id,slotId=`bench-${i}`;slots.push([{elementId:id,slotId}]);active.set(id,slotId);
      scene.get('memberVisibility').set(id,false);if(i%2)scene.get('memberVisibility').delete(id);
      settings.set('title',{title:`更新 ${i}`});
      if(i%8===0)doc.getMap('tombstones').set(JSON.stringify(['members',id,`deleted-${i}`]),true);
    });
    if(worker==='accumulated')for(let i=0;i<1024;i++)change(i,8);
    if(worker==='boundary') {
      const target=8388608;
      while(Y.encodeStateAsUpdate(doc).length+65580<target)settings.set('title',{title:'b'.repeat(65536)});
      const prefix=Y.encodeStateAsUpdate(doc);let length=target-prefix.length-30,exact;
      for(let attempt=0;attempt<6;attempt++) {
        const candidate=new Y.Doc({gc:false});Y.applyUpdate(candidate,prefix);candidate.clientID=12345;
        candidate.getMap('settings').set('title',{title:'b'.repeat(length)});exact=Y.encodeStateAsUpdate(candidate);candidate.destroy();
        if(exact.length===target)break;length+=target-exact.length;
      }
      if(exact.length!==target)throw new Error('boundary snapshot not exact');
      doc.destroy();
      const continued=new Y.Doc({gc:false});Y.applyUpdate(continued,exact);continued.clientID=54321;
      const logs=[];continued.on('update',bytes=>logs.push({seq:String(logs.length+1),bytes}));
      for(let i=0;i<64;i++)continued.getMap('settings').set('title',{title:'l'.repeat(65000)});
      let total=logs.reduce((n,u)=>n+u.bytes.length,0), remaining=4194304-total,sv=Y.encodeStateVector(continued);
      // A final update brings the log to the exact 4MiB boundary.
      let size=remaining-25,final;
      const prefixLog=Y.encodeStateAsUpdate(continued);
      for(let attempt=0;attempt<6;attempt++) {
        const candidate=new Y.Doc({gc:false});Y.applyUpdate(candidate,prefixLog);candidate.clientID=54321;
        candidate.getMap('settings').set('title',{title:'l'.repeat(size)});final=Y.encodeStateAsUpdate(candidate,sv);candidate.destroy();
        if(final.length===remaining)break;size+=remaining-final.length;
      }
      if(final.length!==remaining)throw new Error('boundary logs not exact');
      logs.push({seq:String(logs.length+1),bytes:final});continued.destroy();
      return {snapshot:exact,updates:logs,members:project.members.length,scenes:project.frames.length};
    } else {
      const snapshot=Y.encodeStateAsUpdate(doc),updates=[];
      doc.on('update',bytes=>updates.push({seq:String(updates.length+1),bytes}));
      for(let i=0;i<128;i++)change(worker==='accumulated'?1024+i:i);
      doc.destroy();return {snapshot,updates,members:project.members.length,scenes:project.frames.length};
    }
}
    async function measure(snapshot,updates,members,scenes) {
      const operation=process.argv[3],samples=[],cpus=[],rss=[],heaps=[],cut={documentId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',generation:'1',cutSeq:String(updates.length),
        documentSchema:2,snapshot:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',uptoSeq:'0',bytes:snapshot},updates};
      let output=0,errors=[];
      for(let i=0;i<12;i++) {
        global.gc?.();const cpu=process.cpuUsage(),start=performance.now();
        const sample=()=>{const m=process.memoryUsage();rss.push(m.rss);heaps.push(m.heapUsed);};sample();
        try{output=(await loaded.maintenance.buildMaintenanceOutput(cut,operation,'11111111-1111-4111-8111-111111111111','2026-10-04T00:00:00.000Z',sample)).bytes.length;}
        catch(e){errors.push(e.code??e.message);}
        const used=process.cpuUsage(cpu);cpus.push((used.user+used.system)/1000);samples.push(performance.now()-start);sample();
      }
      samples.sort((a,b)=>a-b);cpus.sort((a,b)=>a-b);
      console.log(JSON.stringify({runtime:`Node ${process.version}`,workload:worker,operation,members,scenes,trials:12,
        snapshotBytes:snapshot.length,logBytes:updates.reduce((n,u)=>n+u.bytes.length,0),updates:updates.length,outputBytes:output,cpuP95Ms:cpus[11],wallP95Ms:+samples[11].toFixed(2),
        maxSampledRssMiB:+(Math.max(...rss)/1048576).toFixed(2),processPeakRssMiB:+(process.resourceUsage().maxRSS/1024).toFixed(2),maxSampledHeapMiB:+(Math.max(...heaps)/1048576).toFixed(2),
        errors:[...new Set(errors)],scope:'binary validation/GC/DTO, includes input base64 decoding; network/DB excluded; fixture/TS compiler in separate processes'}));
    }
