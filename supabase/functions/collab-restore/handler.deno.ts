import * as Y from 'yjs';
import { createRestoreHandler } from './handler.ts';
import { RpcError, type Backend } from '../collab-ingest/handler.ts';
import { checkpointFromConfirmedDocument, materializeCheckpoint } from '../../../src/collaboration/checkpoint.ts';
import { buildRestoreOutput } from '../../../src/collaboration/restore.ts';
import { sharedDifferences } from '../../../src/collaboration/restorePlan.ts';
import { decodeBase64, encodeBase64, SERVER_LIMITS } from '../../../src/collaboration/serverValidation.ts';
import { moveSlot, orderKey } from '../../../src/collaboration/projectModel.ts';
const actor='11111111-1111-4111-8111-111111111111',documentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const member='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',token='cccccccc-cccc-4ccc-8ccc-cccccccccccc',baseId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const assert=(value:unknown)=>{if(!value)throw new Error('assertion failed');};
const input={action:'restore',documentId,generation:'1',membershipGeneration:member,checkpointId:baseId,requestId:token};
const request=(extra={})=>new Request('http://offline.invalid',{method:'POST',headers:{Authorization:`Bearer ${actor}`,'Content-Type':'application/json'},body:JSON.stringify({...input,...extra})});
async function fixture() {
  const f=JSON.parse(await Deno.readTextFile(new URL('../../../src/repositories/contract/fixtures/collaboration.json',import.meta.url)));
  const doc=new Y.Doc({gc:false});Y.applyUpdate(doc,decodeBase64(f.initial.base,SERVER_LIMITS.snapshotBytes));
  const target=await checkpointFromConfirmedDocument(doc,{documentId,generation:'1',confirmedSeq:'0',sharedSchemaVersion:2,reason:'manual',automatic:false,requestedBy:actor,serverAt:'2026-10-05T00:00:00.000Z'});
  return {doc,target};
}
Deno.test('restore native Deno graph, double deletion, retained Map/Text, new edits, optional/song and equality',async()=>{
  const {doc,target}=await fixture(),scene=doc.getMap<Y.Map<unknown>>('scenes').get('f_001')!,text=scene.get('notes') as Y.Text;
  doc.getMap('tombstones').set(JSON.stringify(['scenes','f_001','one']),true);doc.getMap('tombstones').set(JSON.stringify(['scenes','f_001','two']),true);
  text.insert(0,'deleted value');scene.set('section','changed');doc.getMap('settings').set('song',null);
  const cut={documentId,generation:'1',cutSeq:'1',documentSchema:2 as const,snapshot:{id:baseId,uptoSeq:'1',bytes:Y.encodeStateAsUpdate(doc)},updates:[]};
  const output=await buildRestoreOutput(cut,target);Y.applyUpdate(doc,output.update);
  const wanted=materializeCheckpoint(target);assert(sharedDifferences(doc,wanted).length===0);assert(doc.getMap<Y.Map<unknown>>('scenes').get('f_001')===scene);assert(scene.get('notes')===text);
  wanted.destroy();doc.destroy();
});
Deno.test('restore Auth, tiny body, lease, atomic publication, identical lost-ACK retry and safe metrics',async()=>{
  const {doc,target}=await fixture();doc.getMap('settings').set('title',{title:'new H'});
  const writes:Record<string,unknown>[]=[];const metrics:unknown[]=[];
  const backend:Backend={authenticate:async()=>({id:actor,is_anonymous:true}),rpc:async(name,args)=>{
    if(name==='collab_v2_accept_restore')return{result:'ACCEPTED',requestId:token,targetSeq:'0'};
    if(name==='collab_v2_restore_state')return{result:'READY',leaseToken:token,checkpoint:target,state:{documentId,generation:'1',headSeq:'1',documentSchema:2,snapshot:{id:baseId,uptoSeq:'1',bytes:encodeBase64(Y.encodeStateAsUpdate(doc))},updates:[]}};
    if(name==='collab_v2_release_restore')return null;
    assert(name==='collab_v2_publish_restore');writes.push(args);if(writes.length===1)throw new Error('lost ACK');
    return{result:'COMMITTED',restoreSeq:'2'};
  }};
  const handler=createRestoreHandler(backend,[],v=>metrics.push(v));assert((await handler(request())).status===200);assert(writes.length===2);assert(JSON.stringify(writes[0])===JSON.stringify(writes[1]));
  for(const secret of [actor,token,documentId])assert(!JSON.stringify(metrics).includes(secret));
  assert((await handler(request({bytes:'forbidden'}))).status===400);assert((await handler(request({requestId:'x'.repeat(1100)}))).status===413);
  const denied=createRestoreHandler({...backend,rpc:async()=>{throw new RpcError('42501','NOT_MEMBER');}},[],()=>{});assert((await denied(request())).status===403);
  doc.destroy();
});
Deno.test('native restore refuses an update above 256KiB before publish and recommends an independent copy',async()=>{
  const {doc,target}=await fixture(),base=Y.encodeStateAsUpdate(doc);
  for(let i=0;i<10;i++){const id=`large-${i}`;doc.getMap('members').set(id,new Y.Map([['name','x'.repeat(35000)],['color','#fff']]));moveSlot(doc,orderKey('members'),id);}
  const large=await checkpointFromConfirmedDocument(doc,{...target,sharedSchemaVersion:2});let published=0;
  const handler=createRestoreHandler({authenticate:async()=>({id:actor,is_anonymous:false}),rpc:async name=>{
    if(name==='collab_v2_accept_restore')return{result:'ACCEPTED',requestId:token,targetSeq:'0'};
    if(name==='collab_v2_release_restore')return null;
    if(name==='collab_v2_restore_state')return{result:'READY',leaseToken:token,checkpoint:large,state:{documentId,generation:'1',headSeq:'0',documentSchema:2,snapshot:{id:baseId,uptoSeq:'0',bytes:encodeBase64(base)},updates:[]}};
    published++;throw new Error('must not publish');
  }},[],()=>{});
  const response=await handler(request());assert(response.status===413);assert((await response.json()).independentCopyRecommended===true);assert(published===0);doc.destroy();
});
