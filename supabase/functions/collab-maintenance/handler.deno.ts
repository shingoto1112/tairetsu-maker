// Offline Deno runtime tests: no service configuration, credentials or network.
import { createMaintenanceHandler } from './handler.ts';
import { RpcError, type Backend } from '../collab-ingest/handler.ts';
const actor='11111111-1111-4111-8111-111111111111',documentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const member='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',token='cccccccc-cccc-4ccc-8ccc-cccccccccccc',baseId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const assert=(value:unknown)=>{if(!value)throw new Error('assertion failed');};
const request=(extra={})=>new Request('http://offline.invalid',{method:'POST',headers:{Authorization:`Bearer ${actor}`,'Content-Type':'application/json'},
  body:JSON.stringify({action:'maintain',documentId,generation:'1',membershipGeneration:member,...extra})});
Deno.test('maintenance authentication, fixed cut, DTO import, lost ACK and private metrics',async()=>{
  const fixture=JSON.parse(await Deno.readTextFile(new URL('../../../src/repositories/contract/fixtures/collaboration.json',import.meta.url)));
  let publishes=0;const metrics:unknown[]=[];
  const backend:Backend={authenticate:async()=>({id:actor,is_anonymous:true}),rpc:async(name,args)=>{
    if(name==='collab_v2_claim_maintenance')return {result:'CLAIMED',leaseToken:token,generation:'1',baseSnapshotId:baseId,cutSeq:'0',operation:'automatic',documentSchema:2,
      serverAt:'2026-10-04T00:00:00.000Z',snapshot:{id:baseId,uptoSeq:'0',bytes:fixture.initial.base},updates:[]};
    assert(name==='collab_v2_publish_maintenance');assert(args.p_cut==='0');assert(args.p_lease===token);
    if(!publishes++)throw new Error('lost response');return {result:'STORED'};
  }};
  const handler=createMaintenanceHandler(backend,[],m=>metrics.push(m));
  const result=await handler(request());assert(result.status===200);assert((await result.json()).result==='STORED');assert(publishes===2);
  for(const secret of [actor,token,fixture.initial.base])assert(!JSON.stringify(metrics).includes(secret));
  assert((await handler(request({confirmedSeq:'999'}))).status===400);
});
Deno.test('maintenance no binary for rate/capacity; manual denial and bounded request',async()=>{
  let result:unknown={result:'RATE_LIMIT',retryAfterMs:10000};
  const handler=createMaintenanceHandler({authenticate:async()=>({id:actor,is_anonymous:false}),rpc:async()=>{
    if(result instanceof Error)throw result;return result;
  }},[],()=>{});
  assert((await handler(request())).status===429);result={result:'DEFERRED_CAPACITY'};
  assert((await (await handler(request())).json()).result==='DEFERRED_CAPACITY');result=new RpcError('42501','NOT_MEMBER');
  assert((await handler(request())).status===403);
  assert((await handler(request({extra:'x'.repeat(2048)}))).status===413);
});
