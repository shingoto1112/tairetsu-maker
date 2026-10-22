import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quotaAccessMigration } from '../check-collab-v2.mjs';

// Only the fixed disposable Linux PostgreSQL harness calls this suite.
export async function runQuotaAndEndedAccessSqlSuite(h) {
  const { run, service, asUser, deny, create, join, invite, uid, q, json, scalar, identity, initial, pbytes } = h;
  // require_service() reads the JWT role claim, so switch with the harness identity, not just SET ROLE.
  const asService = identity(null, 'service_role');
  const migration = readFileSync(quotaAccessMigration, 'utf8');
  const tables = ['documents', 'members', 'updates', 'sync_snapshots', 'checkpoints', 'checkpoint_contents'];
  const state = () => scalar(`md5(jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proacl,p.proowner) order by p.oid)
      from pg_proc p where p.pronamespace in ('public'::regnamespace,'collab_v2_private'::regnamespace)),
    'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
    'documents',(select jsonb_agg(to_jsonb(d) order by id) from public.collab_v2_documents d))::text)`);
  const before = state();
  try { run(migration.replace('commit;', 'select 1/0; commit;')); assert.fail('Expected migration rollback'); }
  catch (error) { assert.match(error.stderr ?? error.message, /division by zero/); }
  assert.equal(state(), before, 'Failed application rolls back functions, ACLs, policies and data');
  assert.equal(scalar("to_regprocedure('collab_v2_private.can_read_document(uuid)') is null"), 't');
  const historyPolicies = () => scalar(`jsonb_agg(to_jsonb(p) order by tablename,policyname)::text from pg_policies p
    where schemaname='public' and tablename in ('collab_v2_checkpoints','collab_v2_checkpoint_contents')`);
  const historyBefore = historyPolicies();
  run(migration);
  assert.equal(historyPolicies(), historyBefore);
  assert.equal(scalar(`(select proowner from pg_proc where oid='collab_v2_private.can_read_document(uuid)'::regprocedure)
    = (select proowner from pg_proc where oid='collab_v2_private.is_member(uuid)'::regprocedure)`), 't');
  for (const [signature, allowed] of [
    ['public.collab_v2_create_document(uuid,text,bytea,text,bytea,bytea)', 'service_role'],
    ['collab_v2_private.can_read_document(uuid)', 'authenticated'],
    ['public.collab_v2_get_updates(uuid,bigint,bigint,integer,uuid)', 'authenticated'],
    ['public.collab_v2_list_members(uuid)', 'authenticated'],
  ]) {
    for (const role of ['anon', 'authenticated', 'service_role'])
      assert.equal(scalar(`has_function_privilege(${q(role)},${q(signature)},'EXECUTE')`), role === allowed ? 't' : 'f');
    assert.equal(scalar(`exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=${q(signature)}::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')`), 'f');
  }
  run(`insert into auth.users(id,email,is_anonymous) select
    ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'quota'||n||'@example.invalid',false
    from generate_series(300,320) n;`);
  const createSql = (owner, number) => `select public.collab_v2_create_document(${q(uid(owner))},'quota',convert_to(${q(`quota-${owner}-${number}`)},'UTF8'))`;
  const createOne = (owner, number) => json(service(createSql(owner, number)));
  const own = [];
  for (let number = 1; number <= 20; number++) own.push(createOne(300, number));
  assert.equal(scalar(`count(*) from public.collab_v2_documents where creator_id=${q(uid(300))} and deleted_at is null`), '20');
  deny(null, createSql(300, 21), 'DOCUMENT_QUOTA_EXCEEDED', 'service_role');
  assert.equal(createOne(300, 1).documentId, own[0].documentId, 'Replay at 20 active documents succeeds');
  // Lower the state budget only inside a rolled-back fixture transaction.
  const fullBudget = 'update collab_v2_private.budget_settings set state_bytes=1;';
  const replayAtBudget = run(`begin; ${fullBudget} ${asService} ${createSql(300, 1)}; rollback;`);
  assert.equal(json(replayAtBudget).documentId, own[0].documentId, 'Replay bypasses both document count and byte budget');
  try { run(`begin; ${fullBudget} ${asService} ${createSql(300, 21)}; rollback;`); assert.fail('quota precedence'); }
  catch (error) { assert.match(error.stderr ?? error.message, /DOCUMENT_QUOTA_EXCEEDED/); }
  asUser(300, `select public.collab_v2_delete_document(${q(own[0].documentId)})`);
  deny(null, createSql(300, 1), 'DOCUMENT_DELETED', 'service_role');
  assert(createOne(300, 21).documentId, 'Ending one document frees a slot');
  deny(null, createSql(300, 1), 'DOCUMENT_DELETED', 'service_role');
  for (let owner = 301; owner <= 305; owner++) for (let number = 1; number <= 20; number++) createOne(owner, number);
  assert(Number(scalar('count(*) from public.collab_v2_documents where deleted_at is null')) > 100, 'No global live-document cap');
  assert(createOne(306, 1).documentId, 'New creator can create above 100 live documents');
  // New requests still enforce byte budgets independently of creation slots.
  try { run(`begin; update collab_v2_private.budget_settings set state_bytes=1;
    ${asService} ${createSql(306, 2)}; rollback;`); assert.fail('Expected project quota'); }
  catch (error) { assert.match(error.stderr ?? error.message, /PROJECT_QUOTA_EXCEEDED/); }

  // Retain body AND history rows: an empty result must be caused by RLS.
  const id = create(310).documentId;
  for (const who of [311, 312, 313, 10]) join(who, invite(310, id).token);
  asUser(312, `select public.collab_v2_leave(${q(id)})`);
  asUser(310, `select public.collab_v2_remove_member(${q(id)},${q(uid(313))})`);
  run(`insert into public.collab_v2_updates(document_id,seq,generation,client_update_id,actor_id,bytes,digest)
    values(${q(id)},1,1,'retained',${q(uid(310))},${q(initial)}::bytea,extensions.digest(${q(initial)}::bytea,'sha256'));`);
  assert.equal(json(service(`select public.collab_v2_store_checkpoint(${q(id)},${q(uid(310))},1,0,${pbytes},extensions.digest(${pbytes},'sha256'),'automatic')`)).result, 'STORED');
  const count = (table, who) => asUser(who, `select count(*) from public.collab_v2_${table} where ${table === 'documents' ? 'id' : 'document_id'}=${q(id)}`);
  for (const table of tables) for (const who of [310, 311, 10]) assert(Number(count(table, who)) > 0, `Active ${table}: ${who}`);
  const rowsBefore = tables.map(table => scalar(`count(*) from public.collab_v2_${table} where ${table === 'documents' ? 'id' : 'document_id'}=${q(id)}`));
  run(`update public.collab_v2_documents set deleted_at=now() where id=${q(id)};`);
  for (const [i, table] of tables.entries()) {
    assert.equal(scalar(`count(*) from public.collab_v2_${table} where ${table === 'documents' ? 'id' : 'document_id'}=${q(id)}`), rowsBefore[i], 'Bodies remain in fixture');
    for (const who of [310, 311, 312, 313, 10, 314]) assert.equal(count(table, who), '0', `Ended ${table}: ${who}`);
    deny(null, `select * from public.collab_v2_${table}`, 'permission denied', 'anon');
  }
  for (const who of [310, 311, 10]) {
    assert.equal(json(asUser(who, `select public.collab_v2_access_status(${q(id)})`)).status, 'ended');
    for (const rpc of [`get_updates(${q(id)},1,0)`, `list_members(${q(id)})`]) deny(who, `select public.collab_v2_${rpc}`, 'DOCUMENT_DELETED');
  }
  for (const who of [312, 313, 314]) for (const rpc of [`get_updates(${q(id)},1,0)`, `list_members(${q(id)})`])
    deny(who, `select public.collab_v2_${rpc}`, 'NOT_MEMBER');
  assert.equal(json(asUser(313, `select public.collab_v2_access_status(${q(id)})`)).status, 'removed');
  assert.equal(json(asUser(314, `select public.collab_v2_access_status(${q(id)})`)).status, 'unavailable');
  // Normal end RPC still reports ended to both members and former members.
  const normal = create(315).documentId;
  for (const who of [316, 317, 10]) join(who, invite(315, normal).token);
  asUser(315, `select public.collab_v2_remove_member(${q(normal)},${q(uid(317))})`);
  asUser(315, `select public.collab_v2_delete_document(${q(normal)})`);
  for (const who of [315, 316, 317, 10]) assert.equal(json(asUser(who, `select public.collab_v2_access_status(${q(normal)})`)).status, 'ended');
  for (const who of [315, 316, 10]) for (const rpc of [`get_updates(${q(normal)},1,0)`, `list_members(${q(normal)})`])
    deny(who, `select public.collab_v2_${rpc}`, 'DOCUMENT_DELETED');
  for (const who of [317, 318]) for (const rpc of [`get_updates(${q(normal)},1,0)`, `list_members(${q(normal)})`])
    deny(who, `select public.collab_v2_${rpc}`, 'NOT_MEMBER');
  for (const table of tables) for (const who of [315, 316, 317, 10, 318])
    assert.equal(asUser(who, `select count(*) from public.collab_v2_${table} where ${table === 'documents' ? 'id' : 'document_id'}=${q(normal)}`), '0');
  const populated = state(); run(migration); assert.equal(state(), populated, 'Reapplication preserves data, definitions and ACLs');
  console.log('PASS: quota 20/21/free-slot/>100/replay/budget/tombstone; ended six-table RLS with retained bodies/history; RPC errors/status; ACL/owner; rollback/rerun');
}
