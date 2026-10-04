#!/usr/bin/env node
// Local/CI synthetic benchmark; no production data, environment or connections.
import * as Y from 'yjs';
import { loadCollabRuntime } from './testing/load-collab-runtime.mjs';

const loaded = await loadCollabRuntime();
try {
  const { validateState } = loaded.validation;
  const doc = new Y.Doc(); doc.getMap('metadata').set('schemaVersion',1); doc.getMap('metadata').set('projectId','benchmark');
  const members = doc.getMap('members'), scenes = doc.getMap('scenes');
  for (let m=0;m<146;m++) members.set(`m${m}`,new Y.Map());
  for (let s=0;s<18;s++) {
    const scene = new Y.Map(), positions = new Y.Map(); scenes.set(`s${s}`,scene); scene.set('positions',positions);
    for (let m=0;m<146;m++) positions.set(`m${m}`,{x:m/4,y:s/4});
  }
  const snapshot = Y.encodeStateAsUpdate(doc), history = [];
  let delta; doc.on('update',bytes=>{ delta=bytes; });
  for (let i=0;i<129;i++) {
    doc.transact(()=>{for(let m=0;m<146;m++) scenes.get(`s${i%18}`).get('positions').set(`m${m}`,{x:m/4+i+1,y:i/4});});
    if(i<128) history.push(delta);
  }
  for (const count of [0,128]) {
    const updates = count ? history : [], incoming = count ? delta : history[0];
    const samples=[],cpus=[],memory=[];
    for(let i=0;i<12;i++) {
      global.gc?.(); const before=process.memoryUsage().heapUsed, cpu=process.cpuUsage();
      samples.push(validateState(snapshot,updates,incoming).elapsedMs);
      const used=process.cpuUsage(cpu); cpus.push((used.user+used.system)/1000);
      memory.push(process.memoryUsage().heapUsed-before);
    }
    samples.sort((a,b)=>a-b);cpus.sort((a,b)=>a-b);
    console.log(JSON.stringify({workload:'146 members x 18 scenes',historyEntries:count,snapshotBytes:snapshot.length,
      logBytes:updates.reduce((n,b)=>n+b.length,0),updateBytes:incoming.length,medianMs:samples[6],p95Ms:samples[11],
      cpuP95Ms:cpus[11],maxObservedHeapIncreaseMiB:Math.max(...memory)/1048576,processRssMiB:process.memoryUsage().rss/1048576}));
  }
  doc.destroy();
} finally {
  await loaded.dispose();
}
