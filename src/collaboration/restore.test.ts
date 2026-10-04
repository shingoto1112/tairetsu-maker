import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import projects from '../repositories/contract/fixtures/commitProjects.json';
import type { Project } from '../types';
import { MemoryProjectRepository } from '../repositories/contract/testing/MemoryProjectRepository';
import { RepositoryError } from '../repositories/types';
import { createSharedDocument, getModel, REMOTE_ORIGIN } from './model';
import { CollaborationCommands } from './commands';
import { checkpointFromConfirmedDocument, materializeCheckpoint, validateCheckpointDTO, type CheckpointDTO } from './checkpoint';
import { planSharedRestore, sharedDifferences, effectiveSharedContent } from './restorePlan';
import { buildRestoreOutput, observeRestore, type RestoreReceipt } from './restore';
import { CollaborationHistory, newRestoreRequest, parseRestoreReceipt, type HistoryTransport } from './historyApi';
import { TransportError } from './transport';
import { createRestoreHandler } from '../../supabase/functions/collab-restore/handler';
import { RpcError, type Backend } from '../../supabase/functions/collab-ingest/handler';
import { encodeBase64 } from './serverValidation';
import { orderKey, moveSlot } from './projectModel';
import { projectSharedDocument } from './projection';
import { SaveCoordinator } from '../storage/saveCoordinator';
import { SharedProjectEditor } from './editorSession';

const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', actor = '11111111-1111-4111-8111-111111111111';
const membership = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', snapshotId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const metadata = { documentId, generation: '1', confirmedSeq: '0', sharedSchemaVersion: 2 as const, reason: 'manual' as const,
  serverAt: '2026-10-05T00:00:00.000Z', requestedBy: actor, automatic: false };
const project = (): Project => {
  const p = structuredClone(projects.stage) as Project;
  return { ...p, audio: { id: 'device-private', name: '曲', type: 'audio/wav', size: 100, duration: 60 },
    frames: [{ ...p.frames[0], notes: '元のメモ😀', section: 'A' }, { ...p.frames[0], id: 'f_002', label: '第二', timeSec: 10, notes: '' }],
    movementPlans: [{ id: 'plan', fromFrameId: 'f_001', toFrameId: 'f_002', targetType: 'member', targetId: 'm_001', controlPoint: { x: 2, y: 3 }, note: '元の計画' }],
    movementPaths: [{ id: 'path', fromFrameId: 'f_001', toFrameId: 'f_002', targetType: 'object', targetId: 'o_001', pathType: 'curve', visible: false }],
    focusMemberId: 'm_002', viewerPerspective: 'performer' };
};
const checkpoint = (doc: Y.Doc) => checkpointFromConfirmedDocument(doc, metadata);
const cut = (doc: Y.Doc, seq = '0') => ({ documentId, generation: '1', cutSeq: seq, documentSchema: 2 as const,
  snapshot: { id: snapshotId, uptoSeq: seq, bytes: Y.encodeStateAsUpdate(doc) }, updates: [] });
const receipt = (request: ReturnType<typeof newRestoreRequest>, dto: CheckpointDTO): RestoreReceipt => ({ result: 'COMMITTED', ...Object.fromEntries(['documentId','generation','requestId','checkpointId'].map(k=>[k,request[k as keyof typeof request]])),
  targetSeq: dto.confirmedSeq, targetDigest: dto.digest, restoreSeq: '2', beforeSeq: '1', beforeCheckpointId: snapshotId, duplicate: false } as RestoreReceipt);
const transport = (overrides: Partial<HistoryTransport> = {}): HistoryTransport => ({ credential: async()=>({accountId:actor,accessToken:'token'}),
  list: async()=>[], get: async()=>null, restore: async()=>null, ...overrides });
const http = (request: ReturnType<typeof newRestoreRequest>) => new Request('http://test.invalid', { method: 'POST', headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });

describe('9c retained-map restore', () => {
  it('restores deleted scenes/members/objects, double deletion, hidden values, orders, assignments, paths, Y.Text, optional and song', async () => {
    const doc = createSharedDocument(project()), dto = await checkpoint(doc), target = materializeCheckpoint(dto), model = getModel(doc);
    const scene = model.scenes.get('f_001') as Y.Map<unknown>, notes = scene.get('notes') as Y.Text, member = model.members.get('m_001');
    doc.transact(()=>{
      for (const root of ['members','stageObjects','scenes','movementPlans','movementPaths'] as const) {
        const id = root === 'members' ? 'm_001' : root === 'stageObjects' ? 'o_001' : root === 'scenes' ? 'f_001' : root === 'movementPlans' ? 'plan' : 'path';
        model.tombstones.set(orderKey(root,id,'event-a'),true); model.tombstones.set(orderKey(root,id,'event-b'),true);
      }
      member!.set('name','削除中の変更'); member!.delete('visible');
      notes.delete(0,notes.length); notes.insert(0,'削除中のメモ'); scene.delete('section');
      (scene.get('positions') as Y.Map<unknown>).set('m_001',{x:98,y:99});
      (scene.get('objectAssignments') as Y.Map<unknown>).delete(orderKey('o_001','m_001'));
      model.memberGroups.get('g_001')!.get('memberIds');
      model.movementPlans.get('plan')!.set('note','削除中の計画'); model.movementPaths.get('path')!.delete('visible');
      model.settings.delete('song'); model.settings.set('has.animationSettings',true);
      moveSlot(doc,orderKey('members'),'m_002','m_001');
      model.members.set('only-now',new Y.Map([['name','今だけ'],['color','#fff']])); moveSlot(doc,orderKey('members'),'only-now');
    });
    const plan = planSharedRestore(doc,target); doc.transact(()=>plan.forEach(w=>w.write()));
    expect(model.members.get('m_001')).toBe(member); expect(model.scenes.get('f_001')).toBe(scene); expect(scene.get('notes')).toBe(notes);
    expect(model.tombstones.get(orderKey('members','m_001','event-a'))).toBe(false); expect(model.tombstones.get(orderKey('members','m_001','event-b'))).toBe(false);
    expect(sharedDifferences(doc,target)).toEqual([]); expect(projectSharedDocument(doc,project()).audio?.id).toBe('device-private');
    doc.destroy(); target.destroy();
  });
  it('creates IDs never retained in H, keeps past tombstoned entities invisible and does not add server updates to Undo', async () => {
    const original = createSharedDocument(project()), dto = await checkpoint(original);
    const empty = createSharedDocument({ ...project(), members: [], frames: [], stageObjects: [], memberGroups: [], objectGroups: [], movementPlans: [], movementPaths: [] });
    const output = await buildRestoreOutput(cut(empty),dto); Y.applyUpdate(empty,output.update,REMOTE_ORIGIN);
    const wanted = materializeCheckpoint(dto); expect(sharedDifferences(empty,wanted)).toEqual([]);
    const commands = new CollaborationCommands(original);
    const changed = { ...project(), title:'手元の編集' }; commands.applyRecipe(project(),changed);
    const undoBefore = commands.canUndo;
    const restore = await buildRestoreOutput(cut(original,'1'),dto); Y.applyUpdate(original,restore.update,REMOTE_ORIGIN);
    expect(commands.canUndo).toBe(undoBefore); expect(sharedDifferences(original,wanted)).toEqual([]);
    commands.destroy(); original.destroy(); empty.destroy(); wanted.destroy();
  });
  it('verifies equality at H, then reports later edits or unsent local differences only after durable receipt seq', async () => {
    const doc = createSharedDocument(project()), dto = await checkpoint(doc), req = newRestoreRequest(documentId,'1',membership,snapshotId), ack = receipt(req,dto);
    const state = { phase:'committed' as const, requestId:req.requestId, receipt:ack, message:'共有へ確定' };
    expect(observeRestore(state,{documentId,generation:'1',cursor:'1',doc,pending:0},dto)).toBe(state);
    expect(observeRestore(state,{documentId,generation:'1',cursor:'2',doc,pending:0},dto)).toMatchObject({phase:'applied',differences:[]});
    doc.getMap('settings').set('title',{title:'同時編集'});
    expect(observeRestore(state,{documentId,generation:'1',cursor:'3',doc,pending:0},dto).message).toBe('その後の共同編集により、指定した状態と異なる項目があります');
    expect(observeRestore(state,{documentId,generation:'1',cursor:'2',doc,pending:1},dto).hasUnsentChanges).toBe(true);
    doc.destroy();
  });
  it('rejects oversized single update before publication, cross-document DTO, topology mismatch and incomplete H', async () => {
    const p = project(), doc = createSharedDocument(p);
    const big = createSharedDocument({...p,members:[...p.members,...Array.from({length:10},(_,i)=>({id:`large-${i}`,name:'x'.repeat(35000),color:'#fff'}))]});
    const dto = await checkpoint(big); await expect(buildRestoreOutput(cut(doc),dto)).rejects.toThrow('RESTORE_UPDATE_TOO_LARGE');
    await expect(buildRestoreOutput({...cut(doc),documentId:snapshotId},dto)).rejects.toThrow('CHECKPOINT_DOCUMENT_MISMATCH');
    await expect(buildRestoreOutput({...cut(doc),cutSeq:'1'},dto)).rejects.toThrow('INCOMPLETE_SERVER_STATE');
    big.destroy(); doc.destroy();
  });
  it('keeps target-deleted entities deleted and rejects metadata changes without mutating source H', async()=>{
    const doc=createSharedDocument(project());doc.getMap('tombstones').set(orderKey('members','m_001','past'),true);
    const dto=await checkpoint(doc);doc.getMap('tombstones').set(orderKey('members','m_001','past'),false);
    const output=await buildRestoreOutput(cut(doc),dto);Y.applyUpdate(doc,output.update);const target=materializeCheckpoint(dto);
    expect(sharedDifferences(doc,target)).toEqual([]);
    const other=createSharedDocument({...project(),id:'another'}), otherDto=await checkpoint(other), before=Y.encodeStateAsUpdate(doc);
    await expect(buildRestoreOutput(cut(doc),otherDto)).rejects.toThrow('RESTORE_TOPOLOGY_MISMATCH');expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    target.destroy();doc.destroy();other.destroy();
  });
});

describe('9c client history/copy/results',()=>{
  it('validates body/digest/list keyset and bounds; removed users cannot fetch new history',async()=>{
    const doc=createSharedDocument(project()),dto=await checkpoint(doc),{content:_content,song:_song,...summary}=dto;
    const repo=new MemoryProjectRepository(), api=new CollaborationHistory(repo,transport({get:async()=>dto,list:async()=>[{...summary,id:snapshotId}]}));
    expect(await api.get(documentId,snapshotId)).toEqual(dto);expect((await api.list(documentId,1)).nextCursor).toEqual({documentId,serverAt:dto.serverAt,id:snapshotId});
    await expect(api.list(documentId,65)).rejects.toThrow('INVALID_ARGUMENT');await expect(api.list(documentId,1,{documentId:snapshotId,serverAt:dto.serverAt,id:snapshotId})).rejects.toThrow('INVALID_ARGUMENT');
    await expect(api.list(documentId,1,{documentId,serverAt:dto.serverAt,id:snapshotId})).rejects.toThrow('INVALID_HISTORY_RESPONSE');
    await expect(validateCheckpointDTO({...dto,digest:'0'.repeat(64)})).rejects.toThrow('CHECKPOINT_DIGEST_MISMATCH');
    const denied=new CollaborationHistory(repo,transport({get:async()=>{throw new TransportError('permission','NOT_MEMBER');}}));await expect(denied.get(documentId,snapshotId)).rejects.toThrow('NOT_MEMBER');doc.destroy();
  });
  it('makes a detached fresh ID, resolves only explicit device audio, preserves same commit request on storage failure/response loss',async()=>{
    const doc=createSharedDocument(project()),dto=await checkpoint(doc),repo=new MemoryProjectRepository();await repo.initialize();
    const api=new CollaborationHistory(repo,transport());
    const unresolved=await api.prepareIndependentCopy(dto,[],async()=>null);expect(unresolved.songUnresolved).toBe(true);expect(unresolved.request.project.audio).toBeNull();
    expect(unresolved.request.project.id).not.toBe(project().id);expect(unresolved.request.collaboration).toBeNull();expect(JSON.stringify(unresolved.request)).not.toContain('transportBinding');
    const audio={...project().audio!,id:'resolved-device'};const matched=await api.prepareIndependentCopy(dto,[],async()=>audio);expect(matched.request.project.audio).toEqual(audio);expect(matched.songUnresolved).toBe(false);
    const real=repo.commit.bind(repo);let calls=0;const seen:unknown[]=[];
    vi.spyOn(repo,'commit').mockImplementation(async req=>{seen.push(req);if(!calls++)throw new RepositoryError('NO_SPACE');const r=await real(req);if(calls++===2)throw new RepositoryError('IO_ERROR');return r;});
    await expect(api.saveIndependentCopy(matched.request)).rejects.toThrow();await expect(api.saveIndependentCopy(matched.request)).rejects.toThrow();
    await api.saveIndependentCopy(matched.request);expect(seen.every(r=>r===matched.request)).toBe(true);expect((await repo.list({limit:100})).items).toHaveLength(1);doc.destroy();
  });
  it('distinguishes accepted/committed/applied, retries head CAS in another invocation, and retries lost response with same request ID',async()=>{
    const doc=createSharedDocument(project()),dto=await checkpoint(doc),req=newRestoreRequest(documentId,'1',membership,snapshotId),ack=receipt(req,dto);
    const calls:unknown[]=[];let publishes=0, committed=false;
    const api=new CollaborationHistory(new MemoryProjectRepository(),transport({restore:async r=>{calls.push(r);if(committed)return{...ack,duplicate:true};if(r.action==='accept')return{result:'ACCEPTED',requestId:req.requestId,targetSeq:'0'};if(!publishes++)throw new TransportError('temporary','HEAD_CONFLICT');committed=true;throw new TransportError('network','NETWORK_UNAVAILABLE');}}));
    const states: string[]=[];await expect(api.restore(req,s=>states.push(s.phase))).rejects.toThrow('NETWORK_UNAVAILABLE');expect(states).toEqual(['requesting','accepted']);
    const state=await api.restore(req,s=>states.push(s.phase));expect(state.phase).toBe('committed');expect(state.receipt?.duplicate).toBe(true);expect(calls.every(v=>(v as typeof req).requestId===req.requestId)).toBe(true);
    expect(()=>parseRestoreReceipt({...ack,restoreSeq:'99'},req)).toThrow('INVALID_HISTORY_RESPONSE');doc.destroy();
  });
  it('merges the server restore through existing receive/save, keeps unsent edits on commit failure, and does not replace local view/audio',async()=>{
    const p=project(),server=createSharedDocument(p),dto=await checkpoint(server);
    server.getMap('settings').set('title',{title:'最新H'});const output=await buildRestoreOutput(cut(server,'1'),dto);
    const repo=new MemoryProjectRepository();await repo.initialize();
    const {createCollaborationData,encodeUpdate}=await import('./persistence');
    await repo.commit({project:projectSharedDocument(server,p),collaboration:createCollaborationData(server),localRevision:'1',expectedRepositoryRevision:null,operationId:'seed'});
    const coordinator=new SaveCoordinator(repo,()=>{});coordinator.activate((await repo.get(p.id!))!);
    const editor=await SharedProjectEditor.create(coordinator,p,()=>{},()=>{});const before=editor.project!;
    editor.edit(() => ({...before,title:'未送信の編集'})); editor.stagePending();
    const commit=repo.commit.bind(repo);let failed=false;vi.spyOn(repo,'commit').mockImplementation(async r=>{if(!failed){failed=true;throw new RepositoryError('NO_SPACE');}return commit(r);});
    const updates=[{updateId:'restore-server',bytes:encodeUpdate(output.update),source:'remote' as const}];
    expect(await coordinator.receiveCollaborationSnapshot(encodeUpdate(Y.encodeStateAsUpdate(server)),updates,'2')).toBe(false);expect(coordinator.state?.dirty).toBe(true);expect(editor.project?.audio?.id).toBe('device-private');
    expect(coordinator.collaborationProjection?.outbox.some(e=>e.status==='pending')).toBe(true);expect(await coordinator.flush()).toBe(true);
    editor.destroy();server.destroy();
  });
  it('confirms only after applied state and retries the same confirmation; never couples receipt collection to ordinary outbox',async()=>{
    const doc=createSharedDocument(project()),dto=await checkpoint(doc),request=newRestoreRequest(documentId,'1',membership,snapshotId),ack=receipt(request,dto);
    const committed={phase:'committed' as const,requestId:request.requestId,receipt:ack,message:'committed'},calls:string[]=[];
    const api=new CollaborationHistory(new MemoryProjectRepository(),transport({confirmRestore:async r=>{
      calls.push(r.requestId);if(calls.length===1)throw new TransportError('network','NETWORK_UNAVAILABLE');return{requestId:r.requestId,confirmed:true,reclaimedThrough:'1'};
    }}));
    await expect(api.confirmApplied(request,committed)).rejects.toThrow('RESTORE_NOT_APPLIED');expect(calls).toEqual([]);
    const applied=observeRestore(committed,{documentId,generation:'1',cursor:'2',doc,pending:0},dto);
    await expect(api.confirmApplied(request,applied)).rejects.toThrow('NETWORK_UNAVAILABLE');await api.confirmApplied(request,applied);
    expect(calls).toEqual([request.requestId,request.requestId]);doc.destroy();
  });
});

describe('9c dedicated restore Edge',()=>{
  it('uses verified Auth, replays H only, publishes atomically, retries identical publication after lost ACK, and bounds/logs inputs',async()=>{
    const doc=createSharedDocument(project()),dto=await checkpoint(doc),req=newRestoreRequest(documentId,'1',membership,snapshotId),ack=receipt(req,dto);
    doc.getMap('settings').set('title',{title:'最新H'});const calls:[string,Record<string,unknown>][]=[];let publishes=0;
    const backend:Backend={authenticate:async()=>({id:actor,is_anonymous:true}),rpc:async(name,args)=>{
      calls.push([name,args]);if(name==='collab_v2_accept_restore')return{result:'ACCEPTED',requestId:req.requestId,targetSeq:'0'};
      if(name==='collab_v2_restore_state')return{result:'READY',leaseToken:membership,checkpoint:dto,state:{documentId,generation:'1',headSeq:'1',documentSchema:2,snapshot:{id:snapshotId,uptoSeq:'1',bytes:encodeBase64(Y.encodeStateAsUpdate(doc))},updates:[]}};
      if(name==='collab_v2_publish_restore'){if(!publishes++)throw new Error('lost ACK');return{...ack,duplicate:true};}throw new Error(name);
    }};
    const metrics:unknown[]=[];const handler=createRestoreHandler(backend,[],v=>metrics.push(v));expect((await handler(http(req))).status).toBe(200);
    const writes=calls.filter(([n])=>n==='collab_v2_publish_restore');expect(writes).toHaveLength(2);expect(writes[0][1]).toEqual(writes[1][1]);expect(writes[0][1].p_expected_head).toBe('1');
    expect(Object.keys(metrics[0] as object).sort()).toEqual(['bytes','elapsedMs','result','seq']);expect(JSON.stringify(metrics)).not.toContain(documentId);
    expect((await handler(new Request('http://test.invalid',{method:'POST'}))).status).toBe(401);
    expect((await handler(http({...req,actor:'spoof'} as typeof req))).status).toBe(400);expect((await handler(http({...req,requestId:'x'.repeat(1100)}))).status).toBe(413);doc.destroy();
  });
  it('replans with a new H after a public CAS conflict; required checkpoint failure never claims success',async()=>{
    const doc=createSharedDocument(project()),dto=await checkpoint(doc),req=newRestoreRequest(documentId,'1',membership,snapshotId),ack=receipt(req,dto);
    let reads=0,pubs=0;const heads:string[]=[];
    const backend:Backend={authenticate:async()=>({id:actor,is_anonymous:false}),rpc:async(name,args)=>{
      if(name==='collab_v2_accept_restore')return{result:'ACCEPTED',requestId:req.requestId,targetSeq:'0'};
      if(name==='collab_v2_restore_state'){reads++;doc.getMap('settings').set('title',{title:`H ${reads}`});return{result:'READY',leaseToken:membership,checkpoint:dto,state:{documentId,generation:'1',headSeq:String(reads),documentSchema:2,snapshot:{id:snapshotId,uptoSeq:String(reads),bytes:encodeBase64(Y.encodeStateAsUpdate(doc))},updates:[]}};}
      if(name==='collab_v2_publish_restore'){heads.push(args.p_expected_head as string);if(!pubs++)throw new RpcError('40001','HEAD_CONFLICT');throw new RpcError('54000','CHECKPOINT_QUOTA_EXCEEDED');}throw new Error(name);
    }};
    const handler=createRestoreHandler(backend,[],()=>{}); expect((await handler(http(req))).status).toBe(409); const response=await handler(http(req));expect(response.status).toBe(413);expect(reads).toBe(2);expect(heads).toEqual(['1','2']);
    const denied=createRestoreHandler({...backend,rpc:async()=>{throw new RpcError('42501','NOT_MEMBER');}},[],()=>{});expect((await denied(http(req))).status).toBe(403);expect(ack.result).toBe('COMMITTED');doc.destroy();
  });
});
