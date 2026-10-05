import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { multiUseMigration, shutdownMigration, rescueListingMigration } from '../check-collab-v2.mjs';

export async function runMultiUseInvitesSqlSuite({ run, asUser, deny, create, join, invite, uid, q, json, scalar, identity, concurrent }) {
  // Match the three already-applied production migrations before this addition.
  run(readFileSync(shutdownMigration,'utf8'));
  run(readFileSync(rescueListingMigration,'utf8'));
  // Fresh users/documents isolate quotas and attempt counters from other suites.
  run(`insert into auth.users(id,email,is_anonymous) select
    ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'multi'||n||'@example.invalid',false
    from generate_series(100,240) n;`);
  const oldDoc = create(100).documentId;
  const legacy = Array.from({length:4}, () => invite(100, oldDoc));
  const consumed = join(101, legacy[1].token);
  run(`update public.collab_v2_invites set expires_at=now()-interval '1 second' where id=${q(legacy[2].inviteId)};
    update public.collab_v2_invites set revoked_at=now() where id=${q(legacy[3].inviteId)};`);
  const snapshot = () => scalar(`md5(coalesce(jsonb_agg(to_jsonb(i)-'multi_use' order by id)::text,'')) from public.collab_v2_invites i`);
  const before = snapshot();
  const migration = readFileSync(multiUseMigration,'utf8');
  // A forced mid-transaction failure leaves no column/table/DDL behind.
  try { run(migration.replace('commit;', `select 1/0; commit;`)); assert.fail('expected rollback'); }
  catch (e) { assert.match(e.stderr ?? e.message,/division by zero/); }
  assert.equal(scalar(`to_regclass('collab_v2_private.invite_uses') is null`),'t');
  assert.equal(scalar(`count(*) from pg_attribute where attrelid='public.collab_v2_invites'::regclass and attname='multi_use' and not attisdropped`),'0');
  assert.equal(snapshot(),before);
  run(migration);
  assert.equal(snapshot(),before);
  assert.equal(scalar(`count(*) from public.collab_v2_invites where multi_use`),'0');
  assert.equal(join(101,legacy[1].token).membershipGeneration,consumed.membershipGeneration);
  assert.equal(join(102,legacy[1].token).error,'INVALID_INVITE');
  assert.equal(join(102,legacy[2].token).error,'INVALID_INVITE');
  assert.equal(join(102,legacy[3].token).error,'INVALID_INVITE');
  assert(join(102,legacy[0].token).membershipGeneration);
  assert.equal(join(103,legacy[0].token).error,'INVALID_INVITE');
  const id=create(110).documentId, shared=invite(110,id);
  const count = () => scalar(`count(*) from collab_v2_private.invite_uses where invite_id=${q(shared.inviteId)}`);
  const acl = () => scalar(`acl_generation from public.collab_v2_documents where id=${q(id)}`);
  assert.equal(scalar(`multi_use and expires_at=issued_at+interval '7 days' from public.collab_v2_invites where id=${q(shared.inviteId)}`),'t');
  const race = (users,tokens) => Promise.all(users.map((n,i) => concurrent(`begin; ${identity(n)} select public.collab_v2_join(${q(tokens[i])},'race'); commit;`)));
  const results = responses => responses.map(r=> {assert.equal(r.code,0,r.stderr); return json(r.stdout);});
  const initialAcl=acl();
  const same=results(await race([111,111],[shared.token,shared.token]));
  assert.equal(same[0].membershipGeneration,same[1].membershipGeneration); assert.equal(count(),'1');
  assert.equal(BigInt(acl()),BigInt(initialAcl)+1n);
  const first=join(111,shared.token), stableAcl=acl();
  for(let n=112;n<=116;n++) assert(join(n,shared.token).membershipGeneration);
  const last=results(await race([117,118],[shared.token,shared.token]));
  assert.equal(last.filter(r=>!r.error).length,1); assert(last.some(r=>r.error==='MEMBER_LIMIT'));
  assert.equal(count(),'7');
  const fullAcl=acl(); assert.equal(join(111,shared.token).membershipGeneration,first.membershipGeneration); assert.equal(acl(),fullAcl);
  assert(BigInt(fullAcl)>BigInt(stableAcl));
  // Already-member valid use is receipt-only and does not consume history.
  const other=invite(110,id); assert(join(111,other.token).membershipGeneration);
  assert.equal(scalar(`count(*) from collab_v2_private.invite_uses where invite_id=${q(other.inviteId)}`),'0');
  run(`update public.collab_v2_invites set expires_at=now()-interval '1 second' where id=${q(shared.inviteId)};`);
  assert.equal(join(111,shared.token).membershipGeneration,first.membershipGeneration); assert.equal(acl(),fullAcl);
  run(`update public.collab_v2_invites set revoked_at=now() where id=${q(shared.inviteId)};`);
  assert.equal(join(111,shared.token).membershipGeneration,first.membershipGeneration); assert.equal(acl(),fullAcl);
  assert.equal(join(119,shared.token).error,'INVALID_INVITE');
  asUser(110,`select public.collab_v2_remove_member(${q(id)},${q(uid(111))})`);
  run(`update public.collab_v2_invites set expires_at=issued_at+interval '7 days',revoked_at=null where id=${q(shared.inviteId)};`);
  assert.equal(join(111,shared.token).error,'INVALID_INVITE');
  const newMembership=join(111,other.token); assert(newMembership.membershipGeneration);
  assert.notEqual(newMembership.membershipGeneration,first.membershipGeneration);
  assert.equal(join(111,shared.token).error,'INVALID_INVITE');
  const list=json(asUser(110,`select public.collab_v2_list_invites(${q(id)})`));
  assert(list.every(i=>Object.keys(i).sort().join()==='expiresAt,inviteId,joinedCount,multiUse,status'));
  assert.equal(list.find(i=>i.inviteId===shared.inviteId).joinedCount,7);
  assert.equal(list.find(i=>i.inviteId===shared.inviteId).status,'active');
  // Distinct-link competition for the last slot.
  asUser(110,`select public.collab_v2_remove_member(${q(id)},${q(uid(112))})`);
  const links=[invite(110,id),invite(111,id)];
  assert.equal(results(await race([120,121],links.map(i=>i.token))).filter(r=>!r.error).length,1);
  // Same person, different links: only one membership/ACL rotation and one history row.
  const duplicateDoc=create(122).documentId, duplicateLinks=[invite(122,duplicateDoc),invite(122,duplicateDoc)];
  const duplicateAcl=scalar(`acl_generation from public.collab_v2_documents where id=${q(duplicateDoc)}`);
  const duplicate=results(await race([123,123],duplicateLinks.map(i=>i.token)));
  assert.equal(duplicate[0].membershipGeneration,duplicate[1].membershipGeneration);
  assert.equal(scalar(`count(*) from collab_v2_private.invite_uses u join public.collab_v2_invites i on i.id=u.invite_id where i.document_id=${q(duplicateDoc)}`),'1');
  assert.equal(BigInt(scalar(`acl_generation from public.collab_v2_documents where id=${q(duplicateDoc)}`)),BigInt(duplicateAcl)+1n);
  // 64 successful memberships, real removals, no history deletion on exit.
  const budgetDoc=create(130).documentId, budget=invite(130,budgetDoc);
  for(let n=131;n<=194;n++) {
    assert(join(n,budget.token).membershipGeneration);
    if (n < 194) asUser(130,`select public.collab_v2_remove_member(${q(budgetDoc)},${q(uid(n))})`);
  }
  assert.equal(join(195,budget.token).error,'INVALID_INVITE');
  const exhausted=json(asUser(130,`select public.collab_v2_list_invites(${q(budgetDoc)})`))[0];
  assert.equal(exhausted.status,'used'); assert.equal(exhausted.joinedCount,64);
  assert(join(194,budget.token).membershipGeneration); // Receipt remains valid at 64.
  run(`update public.collab_v2_invites set expires_at=now()-interval '1 second' where id=${q(budget.inviteId)}`);
  assert.equal(json(asUser(130,`select public.collab_v2_list_invites(${q(budgetDoc)})`))[0].status,'expired');
  run(`delete from auth.users where id=${q(uid(131))}`);
  assert.equal(scalar(`count(*) from collab_v2_private.invite_uses where invite_id=${q(budget.inviteId)}`),'64');
  deny(null,`select * from collab_v2_private.invite_uses`,'permission denied','anon');
  for(const role of ['authenticated','service_role']) deny(110,`select * from collab_v2_private.invite_uses`,'permission denied',role);
  for(const [name,args] of [['create_invite',q(id)],['list_invites',q(id)],['join',`${q(shared.token)},'name'`]])
    deny(null,`select public.collab_v2_${name}(${args})`,'permission denied','anon');
  deny(null,`update public.collab_v2_invites set expires_at=issued_at+interval '7 days 1 second' where id=${q(other.inviteId)}`,'check constraint','postgres');
  // Join versus invalidation, with the invalidating transaction holding the document first.
  for(const action of ['revoke','leave','account','document']) {
    const owner=200+['revoke','leave','account','document'].indexOf(action)*3;
    const d=create(owner).documentId, initial=invite(owner,d);
    join(owner+1,initial.token); const issued=invite(owner+1,d);
    const mutation=action==='revoke' ? `select public.collab_v2_revoke_invite(${q(d)},${q(issued.inviteId)})` :
      action==='leave' ? `select public.collab_v2_leave(${q(d)})` : action==='account' ? `delete from auth.users where id=${q(uid(owner+1))}` :
      `select public.collab_v2_delete_document(${q(d)})`;
    // Direct delete uses the real BEFORE DELETE trigger, no artificial document lock.
    const a=concurrent(`begin; ${action==='account'?'':identity(action==='document'?owner:owner+1)} ${mutation}; select pg_sleep(0.3); commit;`);
    const b=concurrent(`begin; ${identity(owner+2)} select public.collab_v2_join(${q(issued.token)},'race'); commit;`);
    for(const r of await Promise.all([a,b])) assert.equal(r.code,0,r.stderr);
    assert.equal(join(owner+2,issued.token).error ?? 'receipt',action==='document'?'INVALID_INVITE':
      scalar(`count(*) from public.collab_v2_members where document_id=${q(d)} and user_id=${q(uid(owner+2))}`)==='1'?'receipt':'INVALID_INVITE');
  }
  const state=()=>scalar(`md5(jsonb_build_object('invites',(select jsonb_agg(to_jsonb(i) order by id) from public.collab_v2_invites i),
    'uses',(select jsonb_agg(to_jsonb(u) order by invite_id,user_id,membership_generation) from collab_v2_private.invite_uses u),
    'acl',(select jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity) order by c.oid) from pg_class c
      where c.oid in ('public.collab_v2_invites'::regclass,'collab_v2_private.invite_uses'::regclass)),
    'functions',(select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl) order by p.oid) from pg_proc p
      where p.pronamespace in ('public'::regnamespace,'collab_v2_private'::regnamespace)))::text)`);
  const populated=state(); run(migration); assert.equal(state(),populated);
  console.log('PASS: additive migration rollback/rerun; legacy invites; 7-day multi-use; replay/removal/capacity/64-use; private ACL; invalidation races');
}
