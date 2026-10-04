// Timing/fault oracle for real Edge handlers and actual App. SQL authorization
// and transactions remain covered independently by the Linux SQL suite.
import { randomUUID, createHash } from 'node:crypto';
import { MockMaintenanceBackend } from './mock-maintenance-backend.mjs';
import { documentId } from './mock-collab-server.mjs';
export class MockHistoryBackend extends MockMaintenanceBackend {
  constructor(base, RpcError) {
    super(base, RpcError); this.restores = new Map(); this.restorePublications = 0;
    this.manualRateLimit = false; this.delayRestoreMs = 0; this.confirmations = [];
    const inherited = this.rpc;
    this.rpc = async (name, args) => {
      const history = ['collab_v2_list_checkpoints', 'collab_v2_get_checkpoint', 'collab_v2_delete_checkpoint'];
      if (history.includes(name)) {
        this.requireMember(args.p_actor);
        if (args.p_document !== documentId) this.fail('42501', 'NOT_MEMBER');
        if (name.endsWith('list_checkpoints')) return [...this.checkpoints].sort((a,b) => b.serverAt.localeCompare(a.serverAt) || b.id.localeCompare(a.id))
          .filter(c => !args.p_before_at || c.serverAt < args.p_before_at || c.serverAt === args.p_before_at && c.id < args.p_before_id)
          .slice(0, args.p_limit).map(c => { const {content,song,...summary} = this.dto(c); return { ...summary, id:c.id }; });
        const entry = this.checkpoints.find(c => c.id === args.p_checkpoint);
        if (name.endsWith('get_checkpoint')) return entry ? this.dto(entry) : null;
        if (args.p_actor !== this.creator) this.fail('42501', 'CREATOR_ONLY');
        if (entry?.protected) this.fail('42501', 'CHECKPOINT_PROTECTED');
        this.checkpoints = this.checkpoints.filter(c => c !== entry); return null;
      }
      if (name === 'collab_v2_claim_maintenance' && args.p_action === 'manual' && this.manualRateLimit) return {result:'RATE_LIMIT',retryAfterMs:60000};
      if (!name.includes('_restore')) return inherited(name,args);
      this.check(args.p_actor, args.p_generation, args.p_membership);
      if (args.p_document !== documentId) this.fail('42501','NOT_MEMBER');
      let r = this.restores.get(args.p_request);
      if (r && (r.actor !== args.p_actor || r.membership !== args.p_membership)) this.fail('42501','NOT_MEMBER');
      if (name === 'collab_v2_accept_restore') {
        if (r) {
          if (r.receipt && this.restoreResultUnavailable) this.fail('SERVER_UNAVAILABLE','SERVER_UNAVAILABLE');
          if (r.checkpoint.id !== args.p_checkpoint) this.fail('22023','INVALID_ARGUMENT');
          return r.receipt ? {...r.receipt,duplicate:true} : {result:'ACCEPTED',requestId:args.p_request,targetSeq:r.checkpoint.cut};
        }
        const checkpoint = this.checkpoints.find(c => c.id === args.p_checkpoint);
        if (!checkpoint) this.fail('22023','CHECKPOINT_NOT_FOUND');
        r = {actor:args.p_actor,membership:args.p_membership,checkpoint:structuredClone(checkpoint)}; this.restores.set(args.p_request,r);
        return {result:'ACCEPTED',requestId:args.p_request,targetSeq:checkpoint.cut};
      }
      if (!r) this.fail('22023','INVALID_ARGUMENT');
      if (name === 'collab_v2_restore_state') {
        if (r.receipt) return {...r.receipt,duplicate:true};
        r.lease = randomUUID();
        return {result:'READY',leaseToken:r.lease,checkpoint:this.dto(r.checkpoint),state:{documentId,generation:this.generation,headSeq:this.head,documentSchema:2,
          snapshot:{id:this.snapshotId,uptoSeq:this.snapshotSeq,bytes:this.base},updates:this.log.filter(u=>BigInt(u.seq)>BigInt(this.snapshotSeq)).map(u=>({seq:u.seq,bytes:u.bytes}))}};
      }
      if (name === 'collab_v2_publish_restore') {
        if (r.receipt) return {...r.receipt,duplicate:true};
        if (r.lease !== args.p_lease || this.head !== args.p_expected_head) this.fail('40001','HEAD_CONFLICT');
        if (this.checkpointCapacity) this.fail('54000','CHECKPOINT_QUOTA_EXCEEDED');
        if (this.delayRestoreMs) await new Promise(resolve=>setTimeout(resolve,this.delayRestoreMs));
        if (this.head !== args.p_expected_head) this.fail('40001','HEAD_CONFLICT');
        const before = Buffer.from(args.p_before.slice(2),'hex'), update=Buffer.from(args.p_update.slice(2),'hex');
        if (createHash('sha256').update(before).digest('hex') !== args.p_before_digest.slice(2) || createHash('sha256').update(update).digest('hex') !== args.p_update_digest.slice(2)) this.fail('22023','DIGEST_MISMATCH');
        const id=randomUUID(), beforeSeq=this.head;
        this.checkpoints.push({id,cut:beforeSeq,reason:'before-restore',bytes:JSON.parse(before.toString('utf8')),digest:args.p_before_digest.slice(2),requestedBy:args.p_actor,serverAt:new Date().toISOString()});
        this.head=String(BigInt(this.head)+1n); this.title=args.p_title;
        this.log.push({seq:this.head,updateId:randomUUID(),actor:args.p_actor,bytes:update.toString('base64')}); this.restorePublications++;
        r.receipt={result:'COMMITTED',documentId,generation:this.generation,requestId:args.p_request,checkpointId:r.checkpoint.id,targetSeq:r.checkpoint.cut,targetDigest:r.checkpoint.digest,
          restoreSeq:this.head,beforeCheckpointId:id,beforeSeq,duplicate:false};
        const event={topic:this.topic,notice:{documentId,generation:this.generation,headSeq:this.head,aclGeneration:this.acl}};
        this.notices.push(event); if (!this.dropNotices) this.deliver(event);
        await this.afterRestore?.(r.receipt); return r.receipt;
      }
      if (name === 'collab_v2_release_restore') return null;
      if (name === 'collab_v2_confirm_restore') {
        if (!r.receipt) this.fail('22023','RESTORE_NOT_COMMITTED');
        this.confirmations.push(args.p_request); return {requestId:args.p_request,confirmed:true,reclaimedThrough:'1'};
      }
      throw new Error(`Unexpected history RPC ${name}`);
    };
  }
  dto(c) { return {...c.bytes,documentId,generation:this.generation,confirmedSeq:c.cut,digest:c.digest,reason:c.reason,serverAt:c.serverAt,requestedBy:c.requestedBy,automatic:c.reason==='automatic'}; }
}
