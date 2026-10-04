import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import fixture from '../repositories/contract/fixtures/collaboration.json';
import { decodeBase64, encodeBase64, validateState, documentCausality, SERVER_LIMITS } from './serverValidation';
import { buildMaintenanceOutput, type MaintenanceCut } from './maintenance';
import { canonicalCheckpointContent, projectCheckpointContent, createCheckpointDTO } from './checkpoint';
import { createMaintenanceHandler } from '../../supabase/functions/collab-maintenance/handler';
import { RpcError, type Backend } from '../../supabase/functions/collab-ingest/handler';

const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', actor = '11111111-1111-4111-8111-111111111111';
const membership = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const baseId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', serverAt = '2026-10-04T00:00:00.000Z';
const base = () => decodeBase64(fixture.initial.base, SERVER_LIMITS.snapshotBytes);
const initialCut = (): MaintenanceCut => ({ documentId, generation: '1', cutSeq: '0', documentSchema: 2,
  snapshot: { id: baseId, uptoSeq: '0', bytes: base() }, updates: [] });
const content = (doc: Y.Doc) => canonicalCheckpointContent({ formatVersion: 1, sharedSchemaVersion: 2, ...projectCheckpointContent(doc, 2) });
const request = (extra = {}) => new Request('http://test.invalid', { method: 'POST', headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'maintain', documentId, generation: '1', membershipGeneration: membership, ...extra }) });
describe('9b confirmed maintenance', () => {
  it('compacts deleted/overwritten history and preserves schema/content/clocks/deletions, plus an append beyond the cut', async () => {
    const doc = new Y.Doc({ gc: false }); Y.applyUpdate(doc, base());
    const updates: MaintenanceCut['updates'] = [];
    doc.on('update', bytes => updates.push({ seq: String(updates.length + 1), bytes }));
    const settings = doc.getMap('settings');
    for (let i = 0; i < 128; i++) doc.transact(() => {
      settings.set('title', { title: `更新 ${i}` });
      const notes = (doc.getMap('scenes').get('f_001') as Y.Map<unknown>).get('notes') as Y.Text;
      if (notes.length) notes.delete(0, notes.length); notes.insert(0, `共有メモ ${i}`);
    });
    const cut = { ...initialCut(), cutSeq: '128', updates: [...updates] }, expected = content(doc), causal = documentCausality(doc);
    settings.set('title', { title: '圧縮中の追記' }); const tail = updates[updates.length - 1].bytes;
    const expectedHead = content(doc); doc.destroy();
    const compact = await buildMaintenanceOutput(cut, 'compact', actor, serverAt);
    expect(compact.bytes.length).toBeLessThan(base().length + cut.updates.reduce((n, u) => n + u.bytes.length, 0));
    validateState(compact.bytes, [], undefined, 2);
    const reload = new Y.Doc(); Y.applyUpdate(reload, compact.bytes);
    expect(content(reload)).toEqual(expected); expect(documentCausality(reload)).toBe(causal);
    Y.applyUpdate(reload, tail); expect(content(reload)).toEqual(expectedHead); reload.destroy();
    const checkpoint = await buildMaintenanceOutput(cut, 'automatic', actor, serverAt);
    expect(checkpoint.bytes).toEqual(expected);
    const dto = await createCheckpointDTO(cut.snapshot, cut.updates, { documentId, generation:'1', confirmedSeq:'128', sharedSchemaVersion:2,
      reason:'automatic', automatic:true, serverAt, requestedBy:actor });
    expect(checkpoint.digest).toBe(dto.digest);
  });
  it('rejects a missing cut/dependency, malformed/oversized binary and hidden invalid fields before GC', async () => {
    await expect(buildMaintenanceOutput({ ...initialCut(), cutSeq:'1' }, 'compact', actor, serverAt)).rejects.toThrow('INCOMPLETE_SERVER_STATE');
    await expect(buildMaintenanceOutput({ ...initialCut(), snapshot:{ ...initialCut().snapshot, bytes:new Uint8Array(SERVER_LIMITS.snapshotBytes + 1) } }, 'compact', actor, serverAt)).rejects.toThrow('QUOTA_EXCEEDED');
    await expect(buildMaintenanceOutput({ ...initialCut(), snapshot:{ ...initialCut().snapshot, bytes:new Uint8Array([255]) } }, 'compact', actor, serverAt)).rejects.toThrow();
    const doc = new Y.Doc({ gc:false }); Y.applyUpdate(doc,base());
    doc.getMap('settings').set('accessToken', 'hidden secret'); doc.getMap('settings').delete('accessToken');
    const malicious = Y.encodeStateAsUpdate(doc); doc.destroy();
    await expect(buildMaintenanceOutput({ ...initialCut(),snapshot:{ ...initialCut().snapshot,bytes:malicious } },'compact',actor,serverAt)).rejects.toThrow();
    const unknown = new Y.Doc(), before = Y.encodeStateVector(unknown); unknown.getMap('settings').set('title',{title:'one'});
    unknown.getMap('settings').set('title',{title:'two'}); const delta = Y.encodeStateAsUpdate(unknown,before);
    // Keep only a causally dependent update, not its missing predecessor.
    const sv = Y.encodeStateVector(unknown); unknown.getMap('settings').set('title',{title:'three'});
    const dependent = Y.encodeStateAsUpdate(unknown,sv); unknown.destroy(); expect(delta.length).toBeGreaterThan(0);
    await expect(buildMaintenanceOutput({...initialCut(),cutSeq:'1',updates:[{seq:'1',bytes:dependent}]},'compact',actor,serverAt)).rejects.toThrow('MISSING_DEPENDENCIES');
  });
});
describe('9b dedicated Edge', () => {
  const claim = () => ({result:'CLAIMED',leaseToken:token,generation:'1',baseSnapshotId:baseId,cutSeq:'0',operation:'automatic',documentSchema:2,
    serverAt,snapshot:{id:baseId,uptoSeq:'0',bytes:fixture.initial.base},updates:[]});
  it('checks auth/origin/body, uses server cut, retries lost publish response with the same lease and logs only metrics', async () => {
    const calls: [string,Record<string,unknown>][] = [], metrics: unknown[] = [];
    let publishes=0;
    const backend: Backend = {authenticate:async()=>({id:actor,is_anonymous:true}),rpc:async(name,args)=>{
      calls.push([name,args]); if(name==='collab_v2_claim_maintenance')return claim();
      if(name==='collab_v2_publish_maintenance'){ if(!publishes++)throw new Error('lost ACK'); return {result:'STORED',maintenance:{checkpointDue:false,compactionRequired:false}}; }
      throw new Error('unexpected');
    }};
    const handler=createMaintenanceHandler(backend,[],v=>metrics.push(v));
    const result=await handler(request()); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({result:'STORED'});
    expect(calls.filter(([name])=>name==='collab_v2_publish_maintenance')[0][1]).toEqual(calls[calls.length - 1][1]);
    expect(calls[0][1]).toEqual({p_document:documentId,p_actor:actor,p_generation:'1',p_membership:membership,p_action:'maintain'});
    const text=JSON.stringify(metrics); for(const secret of [actor,token,'共有',fixture.initial.base,'descriptor'])expect(text).not.toContain(secret);
    expect(Object.keys(metrics[0] as object).sort()).toEqual(['bytes','elapsedMs','result','seq']);
    expect((await handler(request({cutSeq:'123'}))).status).toBe(400);
    expect((await handler(new Request('http://test.invalid',{method:'POST'}))).status).toBe(401);
    expect((await handler(new Request('http://test.invalid',{method:'POST',headers:{Origin:'https://outsider.invalid'}}))).status).toBe(403);
    expect((await handler(request({extra:'x'.repeat(1025)}))).status).toBe(413);
  });
  it('does no reconstruction for BUSY/rate/capacity and releases a bad server binary lease', async () => {
    let value: unknown={result:'BUSY',retryAfterMs:45000}, releases=0, published=0;
    const backend: Backend={authenticate:async()=>({id:actor,is_anonymous:false}),rpc:async(name)=>{
      if(name==='collab_v2_claim_maintenance')return value;
      if(name==='collab_v2_release_maintenance'){releases++;return null;}
      published++;throw new Error('never');
    }};
    const handler=createMaintenanceHandler(backend,[],()=>{});
    expect(await (await handler(request())).json()).toMatchObject({result:'BUSY'});
    value={result:'RATE_LIMIT',retryAfterMs:10000};expect((await handler(request())).status).toBe(429);
    value={result:'DEFERRED_CAPACITY'};expect(await (await handler(request())).json()).toMatchObject({result:'DEFERRED_CAPACITY'});
    value={...claim(),snapshot:{...claim().snapshot,bytes:encodeBase64(new Uint8Array([255]))}};
    expect((await handler(request())).status).toBe(400);expect(releases).toBe(1);expect(published).toBe(0);
    value={...claim(),snapshot:{...claim().snapshot,bytes:'A'.repeat(Math.ceil((SERVER_LIMITS.snapshotBytes+1)/3)*4)}};
    expect((await handler(request())).status).toBe(413);
  });
  it('rejects removed participants, manual capacity and a second concurrent worker request', async () => {
    let resolve!: (v:null)=>void;
    const backend:Backend={authenticate:()=>new Promise(r=>{resolve=r;}),rpc:async()=>null};
    const handler=createMaintenanceHandler(backend,[],()=>{}), pending=handler(request());
    expect((await handler(request())).status).toBe(429);resolve(null);expect((await pending).status).toBe(401);
    const denied=createMaintenanceHandler({authenticate:async()=>({id:actor,is_anonymous:false}),rpc:async()=>{throw new RpcError('42501','NOT_MEMBER');}},[],()=>{});
    expect((await denied(request())).status).toBe(403);
    const full=createMaintenanceHandler({authenticate:async()=>({id:actor,is_anonymous:false}),rpc:async()=>{throw new RpcError('54000','CHECKPOINT_QUOTA_EXCEEDED');}},[],()=>{});
    expect((await full(request({action:'manual'}))).status).toBe(413);
  });
});
