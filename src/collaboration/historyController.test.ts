import { describe, it, expect, vi } from 'vitest';
import projects from '../repositories/contract/fixtures/commitProjects.json';
import type { Project } from '../types';
import { RepositoryError } from '../repositories/types';
import { MemoryProjectRepository } from '../repositories/contract/testing/MemoryProjectRepository';
import { createSharedDocument } from './model';
import { createCollaborationData } from './persistence';
import { checkpointFromConfirmedDocument } from './checkpoint';
import { HistoryController, historyError } from './historyController';
import { CollaborationHistory, type HistoryTransport, type RestoreRequest } from './historyApi';
import type { HistoryJournal, HistoryOperation } from './historyJournal';
import { TransportError } from './transport';
vi.mock('../utils/audioStorage', () => ({ listDeviceAudio: vi.fn(async () => []) }));
const documentId='dddddddd-dddd-4ddd-8ddd-dddddddddddd', accountId='11111111-1111-4111-8111-111111111111', membershipGeneration='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', checkpointId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
async function setup() {
  const repository = new MemoryProjectRepository(), project = structuredClone(projects.stage) as Project, doc=createSharedDocument(project);
  const identity={...createCollaborationData(doc),sharedDocumentId:documentId,transportBinding:{accountId,membershipGeneration}};
  await repository.commit({project,collaboration:identity,localRevision:'1',expectedRepositoryRevision:null,operationId:'seed'});
  const target=await checkpointFromConfirmedDocument(doc,{documentId,generation:'1',confirmedSeq:'0',sharedSchemaVersion:2,reason:'manual',automatic:false,requestedBy:accountId,serverAt:'2026-10-05T00:00:00Z'}); doc.destroy();
  let value:HistoryOperation|null=null, storageFail=false, confirmFail=false, repliesLost=false, publications=0, rejected=false;
  const receipts=new Map<string,unknown>(), requests:RestoreRequest[]=[], confirms:string[]=[], events:string[]=[];
  const journal:HistoryJournal={read:async()=>structuredClone(value),write:async(_key,expected,next)=>{events.push('journal');if(storageFail)throw new RepositoryError('IO_ERROR');if((value?.revision??0)!==expected)throw new RepositoryError('CONFLICT');value=structuredClone(next);}};
  const transport:HistoryTransport={credential:async()=>({accountId,accessToken:'test'}),list:async()=>[],get:async()=>target,restore:async request=>{
    requests.push(structuredClone(request));events.push(request.action);
    if(receipts.has(request.requestId))return receipts.get(request.requestId);
    if(request.action==='accept')return{result:'ACCEPTED',requestId:request.requestId,targetSeq:'0'};
    if(rejected)throw new TransportError('validation','RESTORE_UPDATE_TOO_LARGE');
    publications++;const receipt={result:'COMMITTED',documentId,generation:'1',requestId:request.requestId,checkpointId,targetSeq:'0',targetDigest:target.digest,restoreSeq:'1',beforeSeq:'0',beforeCheckpointId:membershipGeneration,duplicate:false};receipts.set(request.requestId,receipt);
    if(repliesLost)throw new TransportError('network','NETWORK_UNAVAILABLE');return receipt;
  },confirmRestore:async request=>{events.push('confirm');confirms.push(request.requestId);expect(value?.restore?.state.phase).toBe('applied');expect((await repository.get(project.id!))?.collaboration?.serverCursor).toBe('1');if(confirmFail)throw new TransportError('network','NETWORK_UNAVAILABLE');return{requestId:request.requestId,confirmed:true,reclaimedThrough:'1'};},
    manual:async()=>({result:'DEFERRED_CAPACITY'})};
  const history=new CollaborationHistory(repository,transport), options={localId:project.id!,repository,history,identity,valid:()=>true,wake:vi.fn(),journal};
  return {repository,project,identity,history,options,journal,requests,confirms,events,target,make:()=>new HistoryController(options),get value(){return value;},get publications(){return publications;},
    failStorage:(v:boolean)=>{storageFail=v;},failConfirm:(v:boolean)=>{confirmFail=v;},loseReplies:()=>{repliesLost=true;},
    rejectRestore:()=>{rejected=true;},
    durable:async()=>{const r=(await repository.get(project.id!))!;await repository.commit({project:r.project,collaboration:{...r.collaboration!,serverCursor:'1'},localRevision:'2',expectedRepositoryRevision:r.repositoryRevision,operationId:'received'});}};
}
describe('9d durable operation owner',()=>{
  it('does not send a restore when the initial operation record cannot be saved',async()=>{
    const s=await setup(),c=s.make();s.failStorage(true);await c.run(()=>c.restore(checkpointId));
    expect(s.requests).toEqual([]);expect(c.getSnapshot().error).toContain('保存できません');expect(s.value).toBeNull();c.stop();
  });
  it('restarts after a lost publish reply with the same request and never publishes twice; waits for durable cursor',async()=>{
    const s=await setup(),first=s.make();s.loseReplies();await first.run(()=>first.restore(checkpointId));first.stop();
    expect(s.publications).toBe(1);expect(s.events[0]).toBe('journal');expect(s.confirms).toEqual([]);
    const restarted=s.make();await restarted.run(()=>restarted.restore());expect(s.publications).toBe(1);expect(new Set(s.requests.map(r=>r.requestId)).size).toBe(1);
    expect(restarted.getSnapshot().restore?.phase).toBe('committed');expect(s.confirms).toEqual([]);
    await s.durable();await restarted.run(()=>restarted.restore());expect(s.value?.restore).toMatchObject({confirmed:true,state:{phase:'applied'}});expect(s.confirms).toHaveLength(1);restarted.stop();
  });
  it('persists applied before confirmation, retries failed confirmation after restart without another restore call',async()=>{
    const s=await setup(),c=s.make();await c.run(()=>c.restore(checkpointId));await s.durable();s.failConfirm(true);await c.run(()=>c.restore());
    expect(s.value?.restore).toMatchObject({confirmed:false,state:{phase:'applied'}});c.stop();
    const count=s.requests.length;s.failConfirm(false);const restart=s.make();await restart.run(()=>restart.restore());expect(s.requests.length).toBe(count);expect(s.value?.restore?.confirmed).toBe(true);restart.stop();
  });
  it('a conflicting journal CAS cannot introduce a second restore in another tab',async()=>{
    const s=await setup(),a=s.make(),b=s.make();await b.run(()=>b.list());await a.run(()=>a.restore(checkpointId));await b.run(()=>b.restore(checkpointId));
    expect(s.publications).toBe(1);expect(b.getSnapshot().error).toContain('操作記録を保存できません');a.stop();b.stop();
  });
  it('retains the exact independent commit across response loss and restart, strips shared credentials',async()=>{
    const s=await setup(),c=s.make(),original=s.repository.commit.bind(s.repository),seen:string[]=[];let lost=true;
    vi.spyOn(s.repository,'commit').mockImplementation(async request=>{if(request.collaboration===null){seen.push(JSON.stringify(request));const result=await original(request);if(lost){lost=false;throw new RepositoryError('IO_ERROR');}return result;}return original(request);});
    await c.run(()=>c.copy(checkpointId,async()=>true));expect(s.value?.copy?.saved).toBe(false);expect(s.value?.copy?.request.collaboration).toBeNull();c.stop();
    const restart=s.make(),opened=vi.fn(async()=>true);await restart.run(()=>restart.copy(checkpointId,opened));expect(seen[0]).toBe(seen[1]);expect(opened).toHaveBeenCalledOnce();expect(s.value?.copy).toMatchObject({saved:true,opened:true});restart.stop();
    const completedId=s.value!.copy!.request.project.id,again=s.make();await again.run(()=>again.copy(checkpointId,opened));
    expect(s.value?.copy?.request.project.id).not.toBe(completedId);expect(opened).toHaveBeenCalledTimes(2);again.stop();
  });
  it('does not report manual capacity or rate limit failures as successful',async()=>{
    const s=await setup(),c=s.make();await c.run(()=>c.manual());expect(c.getSnapshot().notice).toBeNull();expect(c.getSnapshot().error).toContain('容量がいっぱい');
    expect(historyError(new TransportError('rate-limit','RATE_LIMIT'))).toContain('時間をおいて');expect(historyError({code:'CHECKPOINT_PROTECTED'})).toContain('削除できません');c.stop();
  });
  it('does not automatically retry a definitive size rejection after restart',async()=>{
    const s=await setup(),first=s.make();s.rejectRestore();await first.run(()=>first.restore(checkpointId));
    expect(s.value?.restore?.failed).toBe('RESTORE_UPDATE_TOO_LARGE');expect(first.getSnapshot().retry).toBe(false);first.stop();
    const count=s.requests.length,restart=s.make();await restart.run(()=>restart.restore());expect(s.requests).toHaveLength(count);
    expect(s.publications).toBe(0);expect(restart.getSnapshot().error).toContain('新しい隊列表として開く');restart.stop();
  });
});
