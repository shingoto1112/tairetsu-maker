// Independent maintenance oracle. Real SQL races/roles are covered in Linux;
// this mock controls timing/failures for the provider and actual Edge handler.
import { randomUUID, createHash } from 'node:crypto';
import { MockCollabBackend, documentId } from './mock-collab-server.mjs';
export class MockMaintenanceBackend extends MockCollabBackend {
  constructor(base,RpcError) {
    super(base,RpcError);
    this.due=null;this.compactionRequired=false;this.lastCheckpointSeq='0';this.lastCheckpointAt=Date.now();
    this.lease=null;this.checkpoints=[];this.previous=null;this.workCount=0;this.checkpointCapacity=false;this.delayMaintenanceMs=0;
    const inherited=this.rpc;
    this.rpc=async(name,args)=>{
      if(!name.includes('_maintenance')) {
        if(name==='collab_v2_append' && Date.now()-this.lastCheckpointAt>=600000 && BigInt(this.head)>BigInt(this.lastCheckpointSeq) && !this.due)
          this.due={cut:this.head,generation:this.generation};
        const result=await inherited(name,args);
        if(name==='collab_v2_append') {
          const tail=this.log.filter(u=>BigInt(u.seq)>BigInt(this.snapshotSeq));
          this.compactionRequired ||= tail.length>=128 || tail.reduce((n,u)=>n+Buffer.from(u.bytes,'base64').length,0)>=524288;
          return {...result,maintenance:this.hint()};
        }
        return result;
      }
      this.check(args.p_actor,args.p_generation??this.generation,args.p_membership);
      if(name==='collab_v2_release_maintenance') {
        if(this.lease?.token===args.p_lease && !this.lease.result)this.lease=null;
        return null;
      }
      if(name==='collab_v2_claim_maintenance') {
        if(this.lease && !this.lease.result)return {result:'BUSY',retryAfterMs:10};
        const operation=args.p_action==='manual'?'manual':this.due?'automatic':this.compactionRequired?'compact':null;
        if(!operation)return {result:'NOOP'};
        const cut=operation==='automatic'?this.due.cut:this.head;
        this.lease={token:randomUUID(),base:this.snapshotId,cut,operation,actor:args.p_actor,generation:this.generation,result:null};this.workCount++;
        return {result:'CLAIMED',leaseToken:this.lease.token,generation:this.generation,baseSnapshotId:this.snapshotId,cutSeq:cut,operation,documentSchema:2,
          serverAt:new Date().toISOString(),snapshot:{id:this.snapshotId,uptoSeq:this.snapshotSeq,bytes:this.base},
          updates:this.log.filter(u=>BigInt(u.seq)>BigInt(this.snapshotSeq)&&BigInt(u.seq)<=BigInt(cut)).map(u=>({seq:u.seq,bytes:u.bytes}))};
      }
      if(name==='collab_v2_publish_maintenance') {
        const l=this.lease;
        if(!l||l.token!==args.p_lease||l.generation!==args.p_generation||l.base!==args.p_base_snapshot||l.cut!==args.p_cut)this.fail('40001','STALE_LEASE');
        if(l.result)return l.result;
        if(this.delayMaintenanceMs)await new Promise(r=>setTimeout(r,this.delayMaintenanceMs));
        const bytes=Buffer.from(args.p_bytes.slice(2),'hex');
        if('\\x'+createHash('sha256').update(bytes).digest('hex')!==args.p_digest)this.fail('22023','DIGEST_MISMATCH');
        if(l.operation==='compact') {
          if(this.snapshotId!==l.base)this.fail('40001','SNAPSHOT_CONFLICT');
          this.previous={id:this.snapshotId,seq:this.snapshotSeq,bytes:this.base};
          this.log=this.log.filter(u=>BigInt(u.seq)>BigInt(this.snapshotSeq));
          this.snapshotId=randomUUID();this.snapshotSeq=l.cut;this.base=bytes.toString('base64');this.compactionRequired=false;
          l.result={result:'COMPACTED',snapshotId:this.snapshotId,maintenance:this.hint()};
        } else if(this.checkpointCapacity) {
          if(l.operation==='manual')this.fail('54000','CHECKPOINT_QUOTA_EXCEEDED');
          l.result={result:'DEFERRED_CAPACITY',maintenance:this.hint(),retryAfterMs:10};
        } else {
          this.checkpoints.push({cut:l.cut,reason:l.operation,bytes:JSON.parse(bytes.toString('utf8'))});
          this.lastCheckpointSeq=l.cut;this.lastCheckpointAt=Date.now();if(l.operation==='automatic')this.due=null;
          l.result={result:'STORED',maintenance:this.hint()};
        }
        return l.result;
      }
      throw new Error('Unexpected maintenance RPC');
    };
  }
  hint(){return {checkpointDue:!!this.due,compactionRequired:this.compactionRequired};}
  page(cursor,limit,known){return {...super.page(cursor,limit,known),maintenance:this.hint()};}
}
