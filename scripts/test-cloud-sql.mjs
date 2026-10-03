#!/usr/bin/env node
// Fixed disposable Linux PostgreSQL. No CLI URL, .env, Supabase or GH access.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { migration, preflight } from './check-collab-v2.mjs';

assert.equal(process.platform, 'linux', 'Linux CI only'); assert.equal(process.argv.length, 2, 'No overrides accepted');
const files = preflight();
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^PG/i.test(name)));
Object.assign(env, { PGPASSWORD: 'local-test-only', PGSSLMODE: 'disable',
  PGOPTIONS: '-c statement_timeout=20000 -c lock_timeout=10000' });
const args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'cloud_collab_test'];
const run = sql => execFileSync('psql', args, { input: sql, encoding: 'utf8', env, timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const concurrent = sql => new Promise(resolve => {
  const process = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
  process.stdout.on('data', c => { stdout += c; }); process.stderr.on('data', c => { stderr += c; });
  process.on('error', error => resolve({ code: -1, stderr: error.message, stdout }));
  process.on('close', code => resolve({ code, stderr, stdout })); process.stdin.end(sql);
});
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const identity = (n, role = 'authenticated') => `set local role ${role}; set local request.jwt.claim.sub = ${q(n === null ? '' : uid(n))};
  set local request.jwt.claims = ${q(JSON.stringify({ sub: n === null ? null : uid(n), role, is_anonymous: n === 10 }))};`;
const asUser = (n, sql) => run(`begin; ${identity(n)} ${sql}; commit;`);
const service = sql => run(`begin; ${identity(null, 'service_role')} ${sql}; commit;`);
const deny = (n, sql, message, role = 'authenticated') => {
  try { run(`begin; ${identity(n, role)} ${sql}; commit;`); assert.fail(`Expected denial: ${message}`); }
  catch (error) { assert.match(error.stderr ?? error.message, new RegExp(message), sql); }
};
const json = text => JSON.parse(text.split('\n').at(-1));
const scalar = sql => run(`select ${sql};`);

assert.equal(scalar("to_regclass('public.projects') is null and not exists(select 1 from pg_namespace where nspname = 'auth')"), 't', 'Fresh disposable database required');
run(readFileSync('supabase/tests/bootstrap.sql', 'utf8'));
for (const f of files.filter(f => f < '20261004')) { run(readFileSync(`supabase/migrations/${f}`, 'utf8')); console.log(`Applied ${f}`); }
// Compare old function definitions AND grants across the new migration/rerun.
run(`create schema test_support;
  create table test_support.legacy_functions as select p.oid, pg_get_functiondef(p.oid) definition, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
  create table test_support.legacy_tables as select c.oid, c.relacl, c.relrowsecurity from pg_class c
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';`);
run(readFileSync(migration, 'utf8'));
run(`insert into auth.users(id,email,is_anonymous,raw_user_meta_data) select
  ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  case when n=10 then null else 'user' || n || '@example.invalid' end, n=10,
  jsonb_build_object('display_name','Test ' || n) from generate_series(1,35) n;`);
const doc = new Y.Doc(); doc.getMap('metadata').set('schemaVersion', 1); doc.getMap('metadata').set('projectId', 'sql-fixture');
doc.getMap('members').set('m', new Y.Map()); const scene = new Y.Map(), positions = new Y.Map();
doc.getMap('scenes').set('s', scene); scene.set('positions', positions); positions.set('m', { x: 0, y: 0 });
const initial = '\\x' + Buffer.from(Y.encodeStateAsUpdate(doc)).toString('hex'); doc.destroy();
const create = n => json(service(`select public.collab_v2_create_document(${q(uid(n))},'作成者',${q(initial)}::bytea)`));
const invite = (n, id) => json(asUser(n, `select public.collab_v2_create_invite(${q(id)}::uuid)`));
const join = (n, token) => json(asUser(n, `select public.collab_v2_join(${q(token)},'参加者')`));
const membership = (id, n) => scalar(`membership_generation::text from public.collab_v2_members where document_id=${q(id)} and user_id=${q(uid(n))}`);
const d = create(1), id = d.documentId;
assert.equal(create(1).documentId, id, 'stable creator/initial bytes creation retry');
deny(10, `select public.collab_v2_create_document(${q(uid(10))},'guest',${q(initial)}::bytea)`, 'PERMANENT_ACCOUNT_REQUIRED', 'service_role');
deny(1, `select public.collab_v2_create_document(${q(uid(1))},'name',${q(initial)}::bytea)`, 'permission denied');
deny(null, 'select public.collab_v2_create_invite(null)', 'NOT_AUTHENTICATED');
deny(2, `select public.collab_v2_create_invite(${q(id)})`, 'NOT_MEMBER');
deny(1, 'select public.collab_v2_create_invite(null)', 'INVALID_ARGUMENT');
for (const n of [2,3,4,5,6,10]) join(n, invite(1, id).token); // 7 distinct users, including guest.
assert.equal(scalar(`is_guest from public.collab_v2_members where document_id=${q(id)} and user_id=${q(uid(10))}`), 't');
const a = invite(2, id), b = invite(3, id);
const race = await Promise.all([[7, a.token], [8, b.token]].map(([n, token]) => concurrent(`begin; ${identity(n)} select public.collab_v2_join(${q(token)},'同時参加'); commit;`)));
assert.equal(race.filter(r => r.code === 0).length, 1); assert.match(race.find(r => r.code !== 0).stderr, /MEMBER_LIMIT/);
assert.equal(scalar(`count(*) from public.collab_v2_members where document_id=${q(id)}`), '8');
const used = race[0].code === 0 ? a : b;
deny(9, `select public.collab_v2_join(${q(used.token)},'再利用')`, 'INVALID_INVITE');
// Expired/revoked invites tested with otherwise-valid membership capacity.
asUser(2, `select public.collab_v2_remove_member(${q(id)},${q(uid(3))})`);
const expired = invite(1, id); run(`update public.collab_v2_invites set expires_at=now()-interval '1 second' where id=${q(expired.inviteId)};`);
deny(9, `select public.collab_v2_join(${q(expired.token)},'期限切れ')`, 'INVALID_INVITE');
const revoked = invite(2, id); asUser(10, `select public.collab_v2_revoke_invite(${q(id)},${q(revoked.inviteId)})`);
deny(9, `select public.collab_v2_join(${q(revoked.token)},'失効')`, 'INVALID_INVITE');
deny(9, "select public.collab_v2_join(null,'NULL')", 'INVALID_ARGUMENT');
deny(9, `select public.collab_v2_join(${q('f'.repeat(64))},null)`, 'INVALID_ARGUMENT');
deny(9, `select public.collab_v2_join(${q('f'.repeat(64))},'推測')`, 'INVALID_INVITE');
deny(2, `select public.collab_v2_remove_member(${q(id)},${q(uid(1))})`, 'CREATOR_PROTECTED');
deny(1, `select public.collab_v2_leave(${q(id)})`, 'CREATOR_PROTECTED');
deny(2, `select public.collab_v2_delete_document(${q(id)})`, 'CREATOR_ONLY');
deny(2, `select public.collab_v2_remove_member(${q(id)},null)`, 'INVALID_ARGUMENT');

// Old topic + broad legacy policy must not authorize a v2 channel.
const topic = scalar(`private_topic from public.collab_v2_documents where id=${q(id)}`);
const realtimeCount = (n, t) => asUser(n, `set local realtime.topic=${q(t)}; select count(*) from realtime.messages`);
run(`insert into realtime.messages(topic,extension,payload) values(${q(topic)},'broadcast','{}');`);
assert.equal(realtimeCount(2, topic), '1'); assert.equal(realtimeCount(9, topic), '0');
deny(2, `set local realtime.topic=${q(topic)}; insert into realtime.messages(topic,extension,payload) values(${q(topic)},'broadcast','{}')`, 'row-level security');
const m2 = membership(id, 2), abandoned = invite(2, id);
asUser(10, `select public.collab_v2_remove_member(${q(id)},${q(uid(2))})`);
assert.equal(realtimeCount(1, topic), '0');
const nextTopic = scalar(`private_topic from public.collab_v2_documents where id=${q(id)}`); assert.notEqual(nextTopic, topic);
run(`insert into realtime.messages(topic,extension,payload) values(${q(nextTopic)},'broadcast','{}');`);
assert.equal(realtimeCount(2, nextTopic), '0'); assert.equal(realtimeCount(1, nextTopic), '1');
deny(9, `select public.collab_v2_join(${q(abandoned.token)},'旧発行者')`, 'INVALID_INVITE');
const rejoined = join(2, invite(1, id).token); assert.notEqual(rejoined.membershipGeneration, m2);
const guestMember = membership(id,10);
const guestAck = json(run(`begin; ${identity(null,'service_role')}
  select public.collab_v2_append(${q(id)},${q(uid(10))},1,${q(guestMember)},0,'guest-update',
    '\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256')); rollback;`));
assert.equal(guestAck.seq,'1', 'anonymous member may append through Edge');
asUser(10, `select public.collab_v2_leave(${q(id)})`);
deny(10, `select public.collab_v2_get_updates(${q(id)},1,0)`, 'NOT_MEMBER');
deny(9, `select public.collab_v2_get_updates(${q(id)},1,0)`, 'NOT_MEMBER');
deny(null, `select public.collab_v2_get_updates(${q(id)},1,0)`, 'NOT_AUTHENTICATED');
for (const args of [`null,1,0`, `${q(id)},null,0`, `${q(id)},1,null`, `${q(id)},1,0,null`]) deny(1, `select public.collab_v2_get_updates(${args})`, 'INVALID_ARGUMENT');
deny(1, `select public.collab_v2_get_updates(${q(id)},2,0)`, 'STALE_GENERATION');
deny(1, `select public.collab_v2_get_updates(${q(id)},1,9)`, 'INVALID_CURSOR');

const appendSql = (updateId, head = 0, actor = 1, member = membership(id, actor), bytes = '\\x0000', digest = null) =>
  `select public.collab_v2_append(${q(id)},${q(uid(actor))},1,${q(member)},${head},${q(updateId)},${bytes === null ? 'null' : q(bytes)}::bytea,${digest ?? `extensions.digest(${bytes === null ? 'null' : q(bytes)}::bytea,'sha256')`})`;
for (const n of [1,2,9,null]) {
  deny(n, appendSql('forged'), 'permission denied');
  deny(n, `select public.collab_v2_ingest_state(${q(id)},${q(uid(1))},1,${q(d.membershipGeneration)})`, 'permission denied');
}
deny(null, appendSql('fake-actor',0,9,uid(900)), 'NOT_MEMBER', 'service_role');
deny(null, appendSql('old-membership',0,2,m2), 'NOT_MEMBER', 'service_role');
deny(null, appendSql('null-head','null'), 'INVALID_ARGUMENT', 'service_role');
deny(null, appendSql('null-bytes',0,1,d.membershipGeneration,null), 'INVALID_ARGUMENT', 'service_role');
deny(null, appendSql('bad-digest',0,1,d.membershipGeneration,'\\x0000',`decode('${'00'.repeat(32)}','hex')`), 'DIGEST_MISMATCH', 'service_role');
deny(null, 'select public.collab_v2_append(null,null,null,null,null,null,null,null)', 'INVALID_ARGUMENT', 'service_role');
deny(null, 'select public.collab_v2_ingest_state(null,null,null,null)', 'INVALID_ARGUMENT', 'service_role');
deny(null, 'select public.collab_v2_create_document(null,null,null)', 'INVALID_ARGUMENT', 'service_role');
deny(null, `select public.collab_v2_create_invite(${q(id)})`, 'permission denied', 'anon');
deny(1, `select collab_v2_private.require_budget(0)`, 'permission denied');
deny(1, `select collab_v2_private.member_changed()`, 'permission denied');
for (const table of ['documents','members','invites','updates','update_receipts','sync_snapshots']) {
  deny(1, `delete from public.collab_v2_${table}`, 'permission denied');
  deny(1, `update public.collab_v2_${table} set ${table === 'documents' ? 'head_seq=99' : table === 'members' ? "display_name='forged'" : table === 'invites' ? 'used_at=now()' : table === 'updates' ? 'seq=99' : table === 'update_receipts' ? 'seq=99' : 'upto_seq=99'}`, 'permission denied');
  assert.equal(scalar(`has_table_privilege('authenticated','public.collab_v2_${table}','INSERT')`), 'f');
  assert.equal(scalar(`has_table_privilege('anon','public.collab_v2_${table}','SELECT')`), 'f');
}

// Keep transaction 1 open after seq allocation. Transaction 2 must wait and then
// reject its stale head, not commit a larger seq while seq 1 remains invisible.
const first = concurrent(`begin; set local application_name='collab-v2-seq-a'; ${identity(null,'service_role')} ${appendSql('parallel-a')}; select pg_sleep(2); commit;`);
// Observable barrier, not a guess about which process wins the race.
let barrier = false;
for (let i = 0; i < 50; i++) {
  if (scalar("exists(select 1 from pg_stat_activity where application_name='collab-v2-seq-a' and wait_event='PgSleep')") === 't') { barrier = true; break; }
  await new Promise(resolve => setTimeout(resolve, 20));
}
assert(barrier, 'append transaction must hold lock before racing');
assert.equal(json(asUser(1, `select public.collab_v2_get_updates(${q(id)},1,0)`)).headSeq, '0', 'uncommitted seq must not be advertised');
const second = concurrent(`begin; ${identity(null,'service_role')} ${appendSql('parallel-b')}; commit;`);
const results = await Promise.all([first, second]); assert.equal(results[0].code, 0); assert.match(results[1].stderr, /HEAD_CONFLICT/);
assert.equal(json(service(appendSql('parallel-b',1))).seq, '2');
assert.equal(json(service(appendSql('parallel-a',0))).duplicate, true);
deny(null, appendSql('parallel-a',2,1,d.membershipGeneration,'\\x0100'), 'UPDATE_ID_CONFLICT', 'service_role');
deny(null, appendSql('parallel-a',2,2,rejoined.membershipGeneration), 'ACTOR_MISMATCH', 'service_role');
const page = json(asUser(1, `select public.collab_v2_get_updates(${q(id)},1,0,1)`));
assert.equal(page.headSeq,'2'); assert.deepEqual(page.updates.map(u=>u.seq),['1']);
const page2 = json(asUser(1, `select public.collab_v2_get_updates(${q(id)},1,1)`)); assert.deepEqual(page2.updates.map(u=>u.seq),['2']);
assert.equal(scalar(`head_seq=(select count(*) from public.collab_v2_updates where document_id=${q(id)}) from public.collab_v2_documents where id=${q(id)}`),'t');
assert.equal(scalar(`count(*) from realtime.messages where payload->>'headSeq' in ('1','2')`), '2');
// Receipt survives simulated log compaction. Do not remove receipt with the log.
// Updates here are valid Yjs no-ops: the original base also represents seq 1.
run(`begin; update public.collab_v2_sync_snapshots set upto_seq=1 where document_id=${q(id)};
  delete from public.collab_v2_updates where document_id=${q(id)} and seq=1;
  update public.collab_v2_documents set log_bytes=log_bytes-2 where id=${q(id)}; commit;`);
assert.equal(json(service(appendSql('parallel-a',0))).seq, '1');
const compacted = json(asUser(1, `select public.collab_v2_get_updates(${q(id)},1,0)`));
assert.equal(compacted.snapshot.uptoSeq,'1'); assert.deepEqual(compacted.updates.map(u=>u.seq),['2']);
for (const mutation of ['log_bytes=4194304', 'receipt_count=4096']) {
  try { run(`begin; update public.collab_v2_documents set ${mutation} where id=${q(id)}; ${identity(null,'service_role')} ${appendSql('quota',2)}; commit;`); assert.fail('quota'); }
  catch (error) { assert.match(error.stderr ?? error.message, /QUOTA_EXCEEDED/); }
}
const oversize = `decode(repeat('00',262145),'hex')`;
deny(null, `select public.collab_v2_append(${q(id)},${q(uid(1))},1,${q(d.membershipGeneration)},2,'big',${oversize},extensions.digest(${oversize},'sha256'))`, 'QUOTA_EXCEEDED', 'service_role');
deny(null, `select public.collab_v2_create_document(${q(uid(1))},'big',decode(repeat('00',8388609),'hex'))`, 'QUOTA_EXCEEDED', 'service_role');
try {
  run(`begin; insert into public.collab_v2_documents(creator_id,initial_digest,log_bytes)
    select ${q(uid(30))},extensions.digest(n::text,'sha256'),4194304 from generate_series(1,32) n;
    ${identity(null,'service_role')} ${appendSql('project-quota',2)}; commit;`);
  assert.fail('project quota');
} catch(error) { assert.match(error.stderr ?? error.message,/PROJECT_QUOTA_EXCEEDED/); }
try {
  run(`begin; insert into public.collab_v2_documents(creator_id,initial_digest)
    select ${q(uid(31))},extensions.digest(n::text,'sha256') from generate_series(1,20) n;
    ${identity(null,'service_role')} select public.collab_v2_create_document(${q(uid(31))},'quota',${q(initial)}::bytea); commit;`);
  assert.fail('creator quota');
} catch(error) { assert.match(error.stderr ?? error.message,/QUOTA_EXCEEDED/); }

// Account deletion: creator docs physically disappear, other participation and
// issuer invites are revoked, old audit actors become NULL; terminal JWT denied.
const owner = create(20); join(21, invite(20, owner.documentId).token); join(20, invite(1,id).token);
assert.equal(json(service(appendSql('account-history',2,20))).seq,'3');
const accountTopic = scalar(`private_topic from public.collab_v2_documents where id=${q(id)}`);
const accountInvite = invite(20,id);
run(`insert into public.projects(title,created_by) values('legacy account fixture',${q(uid(20))});`);
const deletion = json(asUser(20, "select row_to_json(t) from public.delete_current_account('DELETE_MY_ACCOUNT') t")); assert.equal(deletion.success,true);
assert.equal(scalar(`count(*) from public.collab_v2_documents where id=${q(owner.documentId)}`),'0');
assert.equal(scalar(`count(*) from public.collab_v2_members where user_id=${q(uid(20))}`),'0');
assert.equal(scalar(`actor_id is null from public.collab_v2_updates where document_id=${q(id)} and seq=3`),'t');
assert.equal(scalar(`actor_id is null from public.collab_v2_update_receipts where document_id=${q(id)} and seq=3`),'t');
assert.equal(scalar(`count(*) from public.projects where created_by=${q(uid(20))}`),'0');
assert.notEqual(scalar(`private_topic from public.collab_v2_documents where id=${q(id)}`),accountTopic);
deny(9, `select public.collab_v2_join(${q(accountInvite.token)},'deleted issuer')`, 'INVALID_INVITE');
deny(20, `select public.collab_v2_create_invite(${q(id)})`, 'NOT_AUTHENTICATED');
const cascade = create(22); run(`delete from auth.users where id=${q(uid(22))};`);
assert.equal(scalar(`count(*) from public.collab_v2_documents where id=${q(cascade.documentId)}`),'0');

// Rerun with populated v2 tables. Confirm content, state, legacy function ACLs.
const before = scalar(`md5(row_to_json(d)::text) from public.collab_v2_documents d where id=${q(id)}`);
run(readFileSync(migration,'utf8'));
assert.equal(scalar(`md5(row_to_json(d)::text) from public.collab_v2_documents d where id=${q(id)}`),before);
assert.equal(scalar(`count(*) from test_support.legacy_functions b join pg_proc p on p.oid=b.oid where b.definition is distinct from pg_get_functiondef(p.oid) or b.proacl is distinct from p.proacl`),'0');
assert.equal(scalar(`count(*) from test_support.legacy_tables b join pg_class c on c.oid=b.oid where b.relacl is distinct from c.relacl or b.relrowsecurity is distinct from c.relrowsecurity`),'0');
asUser(1,`select public.collab_v2_delete_document(${q(id)})`);
assert.equal(scalar(`deleted_at is not null and latest_snapshot_id is null from public.collab_v2_documents where id=${q(id)}`),'t');
for (const table of ['updates','update_receipts','sync_snapshots','invites']) assert.equal(scalar(`count(*) from public.collab_v2_${table} where document_id=${q(id)}`),'0');
deny(2,`select public.collab_v2_get_updates(${q(id)},1,0)`,'DOCUMENT_DELETED');
deny(null,appendSql('deleted',2),'DOCUMENT_DELETED','service_role');
console.log('PASS: 11 legacy + v2 + rerun; guest and 8-user race; ACL/topic fences; NULL/outsider/direct-write denials; seq commit ordering; durable receipts; quotas; creator/account deletion');
