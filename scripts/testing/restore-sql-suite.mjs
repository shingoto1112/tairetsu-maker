import assert from 'node:assert/strict';

/** Disposable Linux DB only. Logical binary validation belongs to the Edge
 * tests; this suite exercises actual transactions, roles, CAS and rollback. */
export async function runRestoreSqlSuite(h) {
  const {run,service,asUser,deny,create,join,invite,membership,uid,q,json,scalar,identity,concurrent,initial,pbytes}=h;
  const id=create(32).documentId, actor=uid(32), member=membership(id,32);
  for(const who of [31,33,34,10])join(who,invite(32,id).token);
  asUser(32,`select public.collab_v2_remove_member(${q(id)},${q(uid(34))})`);
  const target=json(service(`select public.collab_v2_store_checkpoint(${q(id)},${q(actor)},1,0,${pbytes},extensions.digest(${pbytes},'sha256'),'manual')`)).id;
  let requestNo=1200,normalSeq=0;
  const reset=()=>run(`update public.collab_v2_documents set next_restore_at=null,next_maintenance_at=null where id=${q(id)};
    update collab_v2_private.maintenance_rates set next_restore_at=null,next_at=now()-interval '1 minute' where document_id=${q(id)};
    update collab_v2_private.restore_requests set next_attempt_at=null where document_id=${q(id)};`);
  const acceptSql=(request,who=32,checkpoint=target,mem=membership(id,who))=>`select public.collab_v2_accept_restore(${q(id)},${q(uid(who))},1,${q(mem)},${q(checkpoint)},${q(request)})`;
  const stateSql=(request,who=32)=>`select public.collab_v2_restore_state(${q(id)},${q(uid(who))},1,${q(membership(id,who))},${q(request)})`;
  const publishSql=(request,state,who=32,update="'\\x0000'::bytea",before=pbytes)=>`select public.collab_v2_publish_restore(${q(id)},${q(uid(who))},1,${q(membership(id,who))},${q(request)},${q(state.leaseToken)},
    ${state.state.headSeq},${q(state.state.snapshot.id)},${before},extensions.digest(${before},'sha256'),${update},extensions.digest(${update},'sha256'),'restored')`;
  const accept=(who=32)=>{reset();const request=uid(requestNo++);assert.equal(json(service(acceptSql(request,who))).result,'ACCEPTED');return request;};
  const claim=(request,who=32)=>{const s=json(service(stateSql(request,who)));assert.equal(s.result,'READY');return s;};
  const append=head=>service(`select public.collab_v2_append(${q(id)},${q(actor)},1,${q(member)},${head},'ordinary-${++normalSeq}','\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256'),'concurrent',${q(uid(950))},${normalSeq})`);
  for(const who of [32,31,10])deny(who,acceptSql(uid(requestNo),who),'permission denied');
  deny(null,acceptSql(uid(requestNo)),'permission denied','anon');
  for(const who of [9,34])deny(null,acceptSql(uid(requestNo),who,target,uid(999)),'NOT_MEMBER','service_role');
  deny(null,acceptSql(uid(requestNo),32,uid(1234)),'CHECKPOINT_NOT_FOUND','service_role');
  // A target belonging to another document is never fetched/restored by UUID.
  const other=create(35).documentId,otherTarget=json(service(`select public.collab_v2_store_checkpoint(${q(other)},${q(uid(35))},1,0,${pbytes},extensions.digest(${pbytes},'sha256'),'manual')`)).id;
  deny(null,acceptSql(uid(requestNo),32,otherTarget),'CHECKPOINT_NOT_FOUND','service_role');
  const req=accept();assert.equal(json(service(acceptSql(req))).result,'ACCEPTED','same intent skips rate');
  assert.equal(json(service(acceptSql(uid(requestNo++)))).result,'RATE_LIMIT');
  deny(null,acceptSql(req,31),'RESTORE_ACTOR_MISMATCH','service_role');
  deny(null,acceptSql(req,32,otherTarget),'RESTORE_REQUEST_CONFLICT','service_role');
  const oldLease=json(service(`select public.collab_v2_claim_maintenance(${q(id)},${q(actor)},1,${q(member)},'maintain')`));assert.equal(oldLease.result,'CLAIMED');
  let state=claim(req);
  assert.equal(json(service(stateSql(req))).result,'BUSY');
  assert.equal(scalar(`count(*) from collab_v2_private.work_reservations where document_id=${q(id)}`),'2');
  const counts=()=>scalar(`(select count(*) from public.collab_v2_checkpoints where document_id=${q(id)})||':'||
    (select count(*) from public.collab_v2_updates where document_id=${q(id)})||':'||
    (select count(*) from public.collab_v2_update_receipts where document_id=${q(id)})||':'||
    (select head_seq from public.collab_v2_documents where id=${q(id)})`);
  let before=counts();
  // Force failure AFTER the mandatory protected checkpoint has been inserted.
  // The trigger also verifies protection on every successful publication.
  run(`create or replace function test_support.restore_protection() returns trigger language plpgsql as $$ begin
    if new.document_id=${q(id)}::uuid and new.client_update_id like 'restore-%' then
      if not exists(select 1 from public.collab_v2_checkpoints where document_id=new.document_id and confirmed_seq=new.seq-1 and reason='before-restore' and protected) then raise exception 'UNPROTECTED_RESTORE'; end if;
      if current_setting('test.fail_restore',true)='on' then raise exception 'TEST_AFTER_BEFORE'; end if;
    end if; return new; end $$;
    create trigger test_restore_protection before insert on public.collab_v2_updates for each row execute function test_support.restore_protection();`);
  try{run(`begin; set local test.fail_restore='on'; ${identity(null,'service_role')} ${publishSql(req,state)}; commit;`);assert.fail('forced atomic failure');}
  catch(e){assert.match(e.stderr??e.message,/TEST_AFTER_BEFORE/);}
  assert.equal(counts(),before,'before checkpoint, update, receipt, head all rollback');
  assert.equal(scalar(`result is null from collab_v2_private.restore_requests where document_id=${q(id)} and request_id=${q(req)}`),'t');
  assert.equal(scalar(`count(*) from collab_v2_private.work_reservations where document_id=${q(id)}`),'2','failed transaction keeps leases');
  const oversized="decode(repeat('00',262145),'hex')";
  deny(null,publishSql(req,state,32,oversized),'RESTORE_UPDATE_TOO_LARGE','service_role');assert.equal(counts(),before);
  try{run(`begin; update collab_v2_private.budget_settings set checkpoint_bytes=1; ${identity(null,'service_role')} ${publishSql(req,state)}; commit;`);assert.fail('mandatory budget');}
  catch(e){assert.match(e.stderr??e.message,/PROJECT_QUOTA_EXCEEDED/);}assert.equal(counts(),before);
  append(0);before=counts();
  deny(null,publishSql(req,state),'HEAD_CONFLICT','service_role');assert.equal(counts(),before,'public CAS cannot leave a checkpoint');
  service(`select public.collab_v2_release_restore(${q(id)},${q(actor)},${q(req)},${q(state.leaseToken)})`);reset();state=claim(req);assert.equal(state.state.headSeq,'1');
  const committed=json(service(publishSql(req,state)));assert.equal(committed.result,'COMMITTED');assert.equal(committed.beforeSeq,'1');assert.equal(committed.restoreSeq,'2');assert.equal(committed.targetSeq,'0');
  assert.equal(scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)} and confirmed_seq=1 and reason='before-restore'`),'1');
  assert.equal(scalar(`count(*) from public.collab_v2_update_receipts where document_id=${q(id)} and seq=2 and writer_seq=1 and writer_id is not null`),'1');
  assert.equal(scalar(`count(*) from public.collab_v2_writers where document_id=${q(id)} and server_owned and accepted_through=1`),'1');
  for(const table of ['history_due','maintenance_leases','work_reservations'])assert.equal(scalar(`count(*) from collab_v2_private.${table} where document_id=${q(id)}`),'0',`old ${table} cleaned atomically`);
  assert.equal(scalar(`protected from public.collab_v2_checkpoints where id=${q(committed.beforeCheckpointId)}`),'f','ordinary retention starts only after complete transaction');
  assert.equal(json(service(publishSql(req,state))).restoreSeq,'2','lost publish ACK returns same seq');
  assert.equal(json(service(acceptSql(req))).duplicate,true);assert.equal(json(service(stateSql(req))).restoreSeq,'2');
  // Normal client cannot reclaim/use the server-owned restore writer.
  const writer=scalar(`writer_id from public.collab_v2_writers where document_id=${q(id)} and server_owned`);
  deny(32,`select public.collab_v2_confirm_writer(${q(id)},1,${q(member)},${q(writer)},1)`,'WRITER_MISMATCH');
  deny(null,`select public.collab_v2_probe_writer(${q(id)},${q(actor)},1,${q(member)},${q(writer)},1)`,'WRITER_MISMATCH','service_role');
  deny(null,`select public.collab_v2_publish_maintenance(${q(id)},${q(actor)},1,${q(member)},${q(oldLease.leaseToken)},${q(oldLease.baseSnapshotId)},${oldLease.cutSeq},${pbytes},extensions.digest(${pbytes},'sha256'))`,'STALE_LEASE','service_role');
  // Guest and normal participant have the same restore rights as the creator.
  const completed=new Map();
  for(const who of [31,10]){const r=accept(who),s=claim(r,who);assert.equal(json(service(publishSql(r,s,who))).result,'COMMITTED');completed.set(who,r);}
  // A not-yet-saved fixed cut survives with its old lease cleared. A newer H
  // checkpoint is not evidence that the older due content has been stored.
  const dueHead=scalar(`head_seq from public.collab_v2_documents where id=${q(id)}`);
  run(`insert into collab_v2_private.history_due(document_id,generation,cut_seq,lease_id,lease_until) values(${q(id)},1,${dueHead},${q(uid(1490))},now()+interval '1 minute')`);
  append(dueHead);
  const keepDue=accept(32),keepState=claim(keepDue);service(publishSql(keepDue,keepState));
  assert.equal(scalar(`cut_seq from collab_v2_private.history_due where document_id=${q(id)}`),dueHead);
  assert.equal(scalar(`lease_id is null and lease_until is null and retry_at is null from collab_v2_private.history_due where document_id=${q(id)}`),'t');
  // Two publications race with the same expected H: exactly one commits.
  const r1=accept(32),s1=claim(r1);service(`select public.collab_v2_release_restore(${q(id)},${q(actor)},${q(r1)},${q(s1.leaseToken)})`);reset();
  const r2=accept(31),s2=claim(r2,31);
  // Stale lease is rejected before it can win. The accepted loser replans later.
  deny(null,publishSql(r1,s1),'STALE_LEASE','service_role');
  const race=await Promise.all([1,2].map(()=>concurrent(`begin; ${identity(null,'service_role')} ${publishSql(r2,s2,31)}; commit;`)));
  for(const result of race){assert.equal(result.code,0);assert.equal(json(result.stdout).restoreSeq,String(Number(s2.state.headSeq)+1));}
  assert.equal(race.map(r=>json(r.stdout).duplicate).filter(Boolean).length,1,'concurrent same-key publish applies once');
  const confirm=(request,who)=>`select public.collab_v2_confirm_restore(${q(id)},1,${q(membership(id,who))},${q(request)})`;
  deny(32,confirm(r2,32),'RESTORE_ACTOR_MISMATCH');
  deny(null,confirm(r2,31),'permission denied','anon');
  assert.equal(json(asUser(31,confirm(r2,31))).reclaimedThrough,'0','confirmation never jumps an earlier restore receipt');
  assert.equal(json(asUser(31,confirm(completed.get(31),31))).reclaimedThrough,'2');
  assert.equal(scalar(`count(*) from public.collab_v2_update_receipts where document_id=${q(id)} and writer_id=(select writer_id from collab_v2_private.restore_requests where document_id=${q(id)} and request_id=${q(r2)})`),'0');
  assert.equal(json(service(acceptSql(r2,31))).duplicate,true,'collected writer receipt still has an immutable restore intent fence');
  assert.equal(json(asUser(31,confirm(r2,31))).reclaimedThrough,'2','lost confirmation response is idempotent');
  const removed=accept(33),removedState=claim(removed,33),removedMember=membership(id,33);
  asUser(32,`select public.collab_v2_remove_member(${q(id)},${q(uid(33))})`);
  deny(null,`select public.collab_v2_publish_restore(${q(id)},${q(uid(33))},1,${q(removedMember)},${q(removed)},${q(removedState.leaseToken)},${removedState.state.headSeq},${q(removedState.state.snapshot.id)},${pbytes},extensions.digest(${pbytes},'sha256'),'\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256'),'restored')`,'NOT_MEMBER','service_role');
  deny(null,stateSql(req,32).replace(',1,',',2,'),'STALE_GENERATION','service_role');
  run('drop trigger test_restore_protection on public.collab_v2_updates');
  asUser(32,`select public.collab_v2_delete_document(${q(id)})`);
  assert.equal(scalar(`count(*) from collab_v2_private.restore_requests where document_id=${q(id)}`),'0');
  console.log('PASS: 9c atomic protected-before/update/writer-receipt/head, rollback, CAS/replan, lost ACK, roles, oversize, lease/due cleanup');
}
