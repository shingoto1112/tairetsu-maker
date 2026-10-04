import assert from 'node:assert/strict';

/** Invoked only by the fixed, disposable Linux PostgreSQL harness. SQL-level
 * tests deliberately use tiny payloads; logical Yjs validation is tested at Edge. */
export async function runMaintenanceSqlSuite(h) {
  const {run,service,asUser,deny,create,join,invite,membership,uid,q,json,scalar,identity,concurrent,initial,pbytes}=h;
  const created=create(28), id=created.documentId, member=membership(id,28), actor=uid(28);
  join(29,invite(28,id).token); join(10,invite(28,id).token);
  const claimSql=(who=28,action='maintain')=>`select public.collab_v2_claim_maintenance(${q(id)},${q(uid(who))},1,${q(membership(id,who))},${q(action)})`;
  const claim=(who=28,action='maintain')=>json(service(claimSql(who,action)));
  const reset=()=>run(`update public.collab_v2_documents set next_maintenance_at=null,next_manual_at=null where id=${q(id)};
    update collab_v2_private.maintenance_rates set next_at=now()-interval '1 minute',next_manual_at=null where document_id=${q(id)};`);
  const publishSql=(l,who=28,bytes=initial)=>`select public.collab_v2_publish_maintenance(${q(id)},${q(uid(who))},1,${q(membership(id,who))},${q(l.leaseToken)},${q(l.baseSnapshotId)},${l.cutSeq},${q(bytes)}::bytea,extensions.digest(${q(bytes)}::bytea,'sha256'))`;
  const checkpointSql=l=>`select public.collab_v2_publish_maintenance(${q(id)},${q(actor)},1,${q(member)},${q(l.leaseToken)},${q(l.baseSnapshotId)},${l.cutSeq},${pbytes},extensions.digest(${pbytes},'sha256'))`;
  const append=(label,head)=>service(`select public.collab_v2_append(${q(id)},${q(actor)},1,${q(member)},${head},${q(label)},'\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256'),'maintenance')`);
  assert.equal(scalar(`cut_seq from collab_v2_private.history_due where document_id=${q(id)}`),'0','creation retains an initial checkpoint cut');
  for(const who of [28,29,10]) deny(who,claimSql(who),'permission denied');
  deny(null,claimSql(),'permission denied','anon');
  deny(null,`select public.collab_v2_claim_maintenance(${q(id)},${q(uid(9))},1,${q(uid(999))},'maintain')`,'NOT_MEMBER','service_role');
  const initialLease=claim();assert.equal(initialLease.operation,'automatic');assert.equal(initialLease.cutSeq,'0');
  assert.equal(claim(29).result,'RATE_LIMIT');reset();assert.equal(claim(29).result,'BUSY');
  assert.equal(json(service(checkpointSql(initialLease))).result,'STORED');
  assert.equal(json(service(checkpointSql(initialLease))).result,'STORED','ACK-lost publication is idempotent');
  assert.equal(scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)}`),'1');
  assert.equal(scalar(`count(*) from collab_v2_private.history_due where document_id=${q(id)}`),'0');
  assert.equal(scalar(`count(*) from collab_v2_private.work_reservations where document_id=${q(id)}`),'0');
  assert.equal(claim(28,'manual').result,'RATE_LIMIT');reset();
  append('maintenance-a',0);append('maintenance-b',1);
  run(`update public.collab_v2_documents set compaction_required=true where id=${q(id)}`);
  // Two claim transactions race; one does the work, the other returns BUSY.
  const leases=await Promise.all([28,29].map(who=>concurrent(`begin; ${identity(null,'service_role')} ${claimSql(who)}; commit;`)));
  const vals=leases.map(r=>{assert.equal(r.code,0);return json(r.stdout);});
  assert.equal(vals.filter(v=>v.result==='CLAIMED').length,1);assert.equal(vals.filter(v=>['BUSY','RATE_LIMIT'].includes(v.result)).length,1);
  const l=vals.find(v=>v.result==='CLAIMED'), who=vals[0].result==='CLAIMED'?28:29;
  assert.equal(l.cutSeq,'2');append('during-compaction',2);
  const publication=service(publishSql(l,who));assert.equal(json(publication).result,'COMPACTED');
  assert.equal(scalar(`head_seq from public.collab_v2_documents where id=${q(id)}`),'3','head need not equal the fixed cut');
  const state=json(asUser(28,`select public.collab_v2_get_updates(${q(id)},1,0)`));assert.equal(state.snapshot.uptoSeq,'2');assert.deepEqual(state.updates.map(u=>u.seq),['3']);
  assert.equal(scalar(`count(*) from public.collab_v2_updates where document_id=${q(id)}`),'3','P=0 requires all later logs');
  assert.equal(json(service(publishSql(l,who))).snapshotId,json(publication).snapshotId);
  reset();run(`update public.collab_v2_documents set compaction_required=true where id=${q(id)}`);
  const newer=claim();assert.equal(newer.cutSeq,'3');
  deny(null,publishSql(l,who),'STALE_LEASE','service_role');
  // Hold publication open, then append: both commits preserve the continuous tail.
  const pub=concurrent(`begin; set local application_name='maintenance-publish'; ${identity(null,'service_role')} ${publishSql(newer)}; select pg_sleep(1); commit;`);
  let barrier=false;
  for(let i=0;i<100;i++){if(scalar("exists(select 1 from pg_stat_activity where application_name='maintenance-publish' and wait_event='PgSleep')")==='t'){barrier=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert(barrier);
  const ap=concurrent(`begin; ${identity(null,'service_role')} select public.collab_v2_append(${q(id)},${q(actor)},1,${q(member)},3,'publish-race','\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256'),'race'); commit;`);
  const raced=await Promise.all([pub,ap]);for(const r of raced)assert.equal(r.code,0,r.stderr);
  assert.equal(scalar(`log_bytes from public.collab_v2_documents where id=${q(id)}`),'4');
  assert.deepEqual(json(run(`select coalesce(json_agg(seq::text order by seq),'[]') from public.collab_v2_updates where document_id=${q(id)}`)),['3','4']);
  assert.equal(scalar(`s.upto_seq from public.collab_v2_documents d join public.collab_v2_sync_snapshots s on s.id=d.previous_snapshot_id where d.id=${q(id)}`),'2','P plus seq 3,4 reaches head');
  reset();run(`update public.collab_v2_documents set compaction_required=true where id=${q(id)}`);
  const expired=claim();run(`update collab_v2_private.maintenance_leases set expires_at=now()-interval '1 second' where document_id=${q(id)};
    update collab_v2_private.work_reservations set expires_at=now()-interval '1 second' where document_id=${q(id)};`);
  deny(null,publishSql(expired),'LEASE_EXPIRED','service_role');reset();const replacement=claim();
  assert.notEqual(replacement.leaseToken,expired.leaseToken);deny(null,publishSql(expired),'STALE_LEASE','service_role');
  assert.equal(scalar(`count(*) from collab_v2_private.work_reservations where document_id=${q(id)}`),'1','expired work released only by real cleanup');
  service(`select public.collab_v2_release_maintenance(${q(id)},${q(actor)},${q(replacement.leaseToken)})`);
  assert.equal(scalar(`count(*) from collab_v2_private.work_reservations where document_id=${q(id)}`),'0');
  // Due freezes pre-append head, and automatic capacity rolls thinning back.
  run(`update public.collab_v2_documents set last_checkpoint_at=now()-interval '11 minutes',compaction_required=false where id=${q(id)}`);
  append('due-cut',4);append('due-not-overwritten',5);
  assert.equal(scalar(`cut_seq from collab_v2_private.history_due where document_id=${q(id)}`),'4');reset();const due=claim();
  assert.equal(due.cutSeq,'4');assert.equal(due.operation,'automatic');
  const deferred=json(run(`begin; update collab_v2_private.budget_settings set document_checkpoint_bytes=1;
    ${identity(null,'service_role')} ${checkpointSql(due)}; commit;`));assert.equal(deferred.result,'DEFERRED_CAPACITY');
  assert.equal(scalar(`cut_seq from collab_v2_private.history_due where document_id=${q(id)}`),'4');
  assert.equal(scalar(`lease_id is null from collab_v2_private.history_due where document_id=${q(id)}`),'t');
  assert.equal(scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)}`),'1');
  append('edits-continue-after-deferred',6);
  run(`update collab_v2_private.budget_settings set document_checkpoint_bytes=2097152; update collab_v2_private.history_due set retry_at=null where document_id=${q(id)}`);reset();
  const dueAgain=claim();assert.equal(dueAgain.cutSeq,'4');service(checkpointSql(dueAgain));
  assert.equal(scalar(`last_checkpoint_seq from public.collab_v2_documents where id=${q(id)}`),'4');
  // A manual cut is the server's head and never thins an existing checkpoint.
  reset();const manual=claim(28,'manual');assert.equal(manual.cutSeq,'7');
  const beforeCount=scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)}`);
  try{run(`begin; update collab_v2_private.budget_settings set document_checkpoint_count=1; ${identity(null,'service_role')} ${checkpointSql(manual)}; commit;`);assert.fail('manual capacity');}
  catch(e){assert.match(e.stderr??e.message,/CHECKPOINT_QUOTA_EXCEEDED/);}
  assert.equal(scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)}`),beforeCount);
  service(checkpointSql(manual));assert.equal(claim(28,'manual').result,'RATE_LIMIT');
  reset();run(`update public.collab_v2_documents set compaction_required=true where id=${q(id)}`);
  const atCapacity=claim();
  const stateUsed=scalar(`(select coalesce(sum(log_bytes+receipt_count*512::bigint+512),0) from public.collab_v2_documents)+
    (select count(*)*512 from public.collab_v2_updates)+(select coalesce(sum(octet_length(bytes)+512),0) from public.collab_v2_sync_snapshots)+
    (select count(*)*512 from public.collab_v2_writers)+(select count(*)*512 from collab_v2_private.history_due)`);
  const reduced=json(run(`begin; update collab_v2_private.budget_settings set state_bytes=${stateUsed};
    ${identity(null,'service_role')} ${publishSql(atCapacity)}; commit;`));
  assert.equal(reduced.result,'COMPACTED','work pool and final negative replacement delta allow a full-state compression');
  run(`update collab_v2_private.budget_settings set state_bytes=83886080`);
  // Removal/generation/delete during a lease invalidate publication.
  reset();const guestMember=membership(id,10),guest=claim(10,'manual');asUser(28,`select public.collab_v2_remove_member(${q(id)},${q(uid(10))})`);
  deny(null,`select public.collab_v2_publish_maintenance(${q(id)},${q(uid(10))},1,${q(guestMember)},${q(guest.leaseToken)},${q(guest.baseSnapshotId)},${guest.cutSeq},${pbytes},extensions.digest(${pbytes},'sha256'))`,'NOT_MEMBER','service_role');
  service(`select public.collab_v2_release_maintenance(${q(id)},${q(uid(10))},${q(guest.leaseToken)})`);reset();
  const generation=claim(28,'manual');run(`update public.collab_v2_documents set generation=2 where id=${q(id)}`);
  deny(null,checkpointSql(generation),'STALE_GENERATION','service_role');run(`update public.collab_v2_documents set generation=1 where id=${q(id)}`);
  service(`select public.collab_v2_release_maintenance(${q(id)},${q(actor)},${q(generation.leaseToken)})`);reset();
  // Buckets prefer manual/before-restore; automatic removed first; protected never removed.
  run(`insert into public.collab_v2_checkpoints(document_id,generation,confirmed_seq,content_id,reason,requested_by,automatic,server_at,protected)
    select ${q(id)},1,0,(select content_id from public.collab_v2_checkpoints where document_id=${q(id)} limit 1),
      reason,${q(actor)},reason='automatic',now()-age,reason='before-restore'
      from unnest(array['automatic','automatic','manual','before-restore']) reason
      cross join unnest(array[interval '30 minutes',interval '3 hours',interval '3 days']) age;
    select collab_v2_private.thin_checkpoints(${q(id)},${pbytes});`);
  for(const range of ["server_at>=now()-interval '2 hours' and server_at<now()-interval '10 minutes'",
    "server_at>=now()-interval '24 hours' and server_at<now()-interval '2 hours'","server_at<now()-interval '24 hours'"]) {
    assert.equal(scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)} and (${range}) and automatic`),'0');
    assert.equal(scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)} and (${range}) and reason='manual'`),'1');
  }
  assert.equal(scalar(`count(*) from public.collab_v2_checkpoints where document_id=${q(id)} and protected`),'3');
  const protectedId=scalar(`id from public.collab_v2_checkpoints where document_id=${q(id)} and protected order by id limit 1`);
  deny(28,`select public.collab_v2_delete_checkpoint(${q(id)},${q(protectedId)})`,'CHECKPOINT_PROTECTED');
  const deleted=claim(28,'manual');asUser(28,`select public.collab_v2_delete_document(${q(id)})`);
  deny(null,publishSql(deleted),'DOCUMENT_DELETED','service_role');
  assert.equal(scalar(`count(*) from collab_v2_private.work_reservations where document_id=${q(id)}`),'0');
  // Actual append threshold detection, using lowered settings for the byte case.
  const threshold=create(31),tid=threshold.documentId,tm=membership(tid,31);
  run(`delete from collab_v2_private.history_due where document_id=${q(tid)};
    update collab_v2_private.budget_settings set compact_updates=64,compact_bytes=262144;`);
  const tappend=(i)=>service(`select public.collab_v2_append(${q(tid)},${q(uid(31))},1,${q(tm)},${i-1},${q('threshold-'+i)},'\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256'),'threshold')`);
  for(let i=1;i<=63;i++)tappend(i);
  assert.equal(scalar(`compaction_required from public.collab_v2_documents where id=${q(tid)}`),'f');
  assert.equal(json(tappend(64)).maintenance.compactionRequired,true);
  run(`update public.collab_v2_documents set compaction_required=false where id=${q(tid)};
    update collab_v2_private.budget_settings set compact_updates=1000,compact_bytes=128;`);
  // 65 updates x 2 bytes = 130 bytes: below the 1000-update count, above the 128-byte limit.
  assert.equal(json(tappend(65)).maintenance.compactionRequired,true,'byte threshold is independent of the count threshold');
  run(`update collab_v2_private.budget_settings set compact_updates=64,compact_bytes=262144`);
  asUser(31,`select public.collab_v2_delete_document(${q(tid)})`);
  console.log('PASS: 9b initial/due atomicity, double lease, append/publish race, P+logs, expiry/release/lost ACK, capacity, role/removal/generation/delete, thinning/protected checkpoint');
}
