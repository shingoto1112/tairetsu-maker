#!/usr/bin/env node
// Fixed disposable Linux PostgreSQL. No CLI URL, .env, Supabase or GH access.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { migration, preflight } from './check-collab-v2.mjs';
import { runMaintenanceSqlSuite } from './testing/maintenance-sql-suite.mjs';
import { runRestoreSqlSuite } from './testing/restore-sql-suite.mjs';
import { runEphemeralSqlSuite } from './testing/ephemeral-sql-suite.mjs';

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
const json = text => JSON.parse(text.trim().split('\n').at(-1));
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
const denyJoin = (n, sql, message) => assert.equal(json(asUser(n, sql)).error, message);
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
assert(race.every(r => r.code === 0));
assert.equal(race.filter(r => !json(r.stdout).error).length, 1);
assert.equal(race.filter(r => json(r.stdout).error === 'MEMBER_LIMIT').length, 1);
assert.equal(scalar(`count(*) from public.collab_v2_members where document_id=${q(id)}`), '8');
const used = !json(race[0].stdout).error ? a : b;
denyJoin(9, `select public.collab_v2_join(${q(used.token)},'再利用')`, 'INVALID_INVITE');
// Expired/revoked invites tested with otherwise-valid membership capacity.
asUser(2, `select public.collab_v2_remove_member(${q(id)},${q(uid(3))})`);
const expired = invite(1, id); run(`update public.collab_v2_invites set expires_at=now()-interval '1 second' where id=${q(expired.inviteId)};`);
denyJoin(9, `select public.collab_v2_join(${q(expired.token)},'期限切れ')`, 'INVALID_INVITE');
const revoked = invite(2, id); asUser(10, `select public.collab_v2_revoke_invite(${q(id)},${q(revoked.inviteId)})`);
denyJoin(9, `select public.collab_v2_join(${q(revoked.token)},'失効')`, 'INVALID_INVITE');
denyJoin(9, "select public.collab_v2_join(null,'NULL')", 'INVALID_ARGUMENT');
denyJoin(9, `select public.collab_v2_join(${q('f'.repeat(64))},null)`, 'INVALID_ARGUMENT');
denyJoin(9, `select public.collab_v2_join(${q('f'.repeat(64))},'推測')`, 'INVALID_INVITE');
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
denyJoin(9, `select public.collab_v2_join(${q(abandoned.token)},'旧発行者')`, 'INVALID_INVITE');
const rejoined = join(2, invite(1, id).token); assert.notEqual(rejoined.membershipGeneration, m2);
assert.equal(json(asUser(3, `select public.collab_v2_access_status(${q(id)})`)).status, 'removed');
assert.equal(json(asUser(9, `select public.collab_v2_access_status(${q(id)})`)).status, 'unavailable');
const listed = json(asUser(10, `select public.collab_v2_list_members(${q(id)})`));
// Actual SQL roles: anon, guest, member, creator, removed, outsider.
const listMine = (n, args = '') => json(asUser(n, `select public.collab_v2_list_my_documents(${args})`));
const titleDoc = json(service(`select public.collab_v2_create_document(${q(uid(1))},'paging','\\x0001'::bytea,'SQL一覧題名')`));
run(`update public.collab_v2_documents set created_at='2026-10-04T00:00:00Z' where id in (${q(id)},${q(titleDoc.documentId)});`);
const firstList = listMine(1,'1'); assert.equal(firstList.items.length,1); assert(firstList.nextCursor);
const nextList = listMine(1,`1,${q(firstList.nextCursor.createdAt)},${q(firstList.nextCursor.documentId)}`);
assert.equal(nextList.items.length,1); assert.equal(nextList.nextCursor,null);
assert.notEqual(firstList.items[0].documentId,nextList.items[0].documentId);
assert([firstList.items[0],nextList.items[0]].some(row=>row.title==='SQL一覧題名'));
asUser(1,`select public.collab_v2_delete_document(${q(titleDoc.documentId)})`);
assert.equal(listMine(1).items.length,1,'deleted documents excluded');
for (const n of [1, 2, 10]) {
  const page = listMine(n); assert.equal(page.items.length, 1); assert.equal(page.nextCursor, null);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ['createdAt','documentId','documentSchema','isCreator','memberCount','title']);
  assert.equal(page.items[0].isCreator, n === 1); assert.equal(page.items[0].memberCount, 7);
  assert.equal(json(asUser(n, `select public.collab_v2_open_existing(${q(id)})`)).membershipGeneration, membership(id, n));
  const inviteStates = json(asUser(n, `select public.collab_v2_list_invites(${q(id)})`));
  assert(inviteStates.some(i => i.status === 'expired')); assert(inviteStates.some(i => i.status === 'revoked')); assert(inviteStates.some(i => i.status === 'used'));
  assert(inviteStates.every(i => Object.keys(i).sort().join() === 'expiresAt,inviteId,status'));
}
for (const n of [3, 9]) {
  assert.deepEqual(listMine(n).items, []);
  deny(n, `select public.collab_v2_open_existing(${q(id)})`, 'NOT_MEMBER');
  deny(n, `select public.collab_v2_list_invites(${q(id)})`, 'NOT_MEMBER');
}
deny(null, 'select public.collab_v2_list_my_documents()', 'permission denied', 'anon');
for (const fn of ['open_existing','list_invites']) deny(null, `select public.collab_v2_${fn}(${q(id)})`, 'permission denied', 'anon');
for (const args of ['null', '0', '101', `1,null,${q(id)}`]) deny(1, `select public.collab_v2_list_my_documents(${args})`, 'INVALID_ARGUMENT');
assert.equal(listed.length, 7); assert.equal(listed.filter(m => m.isCreator).length, 1);
assert.equal(listed.find(m => m.userId === uid(10)).isGuest, true);
assert.equal(listed.find(m => m.userId === uid(1)).isGuest, false);
deny(3, `select public.collab_v2_list_members(${q(id)})`, 'NOT_MEMBER');
for (const fn of ['access_status', 'list_members']) deny(null, `select public.collab_v2_${fn}(${q(id)})`, 'permission denied', 'anon');
for (const table of ['join_attempts', 'departures']) deny(1, `select * from collab_v2_private.${table}`, 'permission denied');
// Invalid attempts commit and are serialized per user, even under concurrency.
const guesses = await Promise.all(Array.from({ length: 22 }, () => concurrent(`begin; ${identity(29)} select public.collab_v2_join('${'f'.repeat(64)}','guess'); commit;`)));
assert(guesses.every(r => r.code === 0));
assert.equal(guesses.filter(r => json(r.stdout).error === 'INVITE_ATTEMPT_LIMIT').length, 2);
assert.equal(scalar(`attempts from collab_v2_private.join_attempts where user_id=${q(uid(29))}`), '21');
run(`update collab_v2_private.join_attempts set window_started=now()-interval '11 minutes' where user_id=${q(uid(29))};`);
assert.equal(join(29, 'f'.repeat(64)).error, 'INVALID_INVITE');
assert.equal(scalar(`attempts from collab_v2_private.join_attempts where user_id=${q(uid(29))}`), '1');
// One-use invite race and response loss: only the same ACTIVE membership can replay.
const retryDoc = create(25), single = invite(25, retryDoc.documentId);
const consume = await Promise.all([26,27].map(n => concurrent(`begin; ${identity(n)} select public.collab_v2_join(${q(single.token)},'race'); commit;`)));
assert(consume.every(r => r.code === 0));
assert.equal(consume.filter(r => json(r.stdout).error === 'INVALID_INVITE').length, 1);
const winner = !json(consume[0].stdout).error ? 26 : 27, joinedOnce = join(winner, single.token);
assert.deepEqual(join(winner, single.token), joinedOnce);
asUser(25, `select public.collab_v2_remove_member(${q(retryDoc.documentId)},${q(uid(winner))})`);
assert.equal(join(winner, single.token).error, 'INVALID_INVITE');
const joinedAgain = join(winner, invite(25, retryDoc.documentId).token);
assert.notEqual(joinedAgain.membershipGeneration, joinedOnce.membershipGeneration);
assert.equal(join(winner, single.token).error, 'INVALID_INVITE');
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

const appendSql = (updateId, head = 0, actor = 1, member = membership(id, actor), bytes = '\\x0000', digest = null, title = '隊列表') =>
  `select public.collab_v2_append(${q(id)},${q(uid(actor))},1,${q(member)},${head},${q(updateId)},${bytes === null ? 'null' : q(bytes)}::bytea,${digest ?? `extensions.digest(${bytes === null ? 'null' : q(bytes)}::bytea,'sha256')`},${q(title)})`;
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
assert.equal(json(service(appendSql('parallel-b',1,1,d.membershipGeneration,'\\x0000',null,'更新済み題名'))).seq, '2');
assert.equal(scalar(`title_seq=head_seq and list_title='更新済み題名' from public.collab_v2_documents where id=${q(id)}`),'t');
assert.equal(json(service(appendSql('parallel-a',0))).duplicate, true);
assert.equal(scalar(`title_seq=2 and list_title='更新済み題名' from public.collab_v2_documents where id=${q(id)}`),'t','duplicate never regresses the display title');
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
assert.equal(json(asUser(1, `select public.collab_v2_get_updates(${q(id)},1,1,32,${q(compacted.snapshot.id)})`)).snapshot,null,'known snapshot suppresses repeat download');
assert.notEqual(json(asUser(1, `select public.collab_v2_get_updates(${q(id)},1,0,32,${q(compacted.snapshot.id)})`)).snapshot,null,'known ID cannot bypass a required newer cut');
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
const ownedAccountTopic = scalar(`private_topic from public.collab_v2_documents where id=${q(owner.documentId)}`);
const accountInvite = invite(20,id);
run(`insert into public.projects(title,created_by) values('legacy account fixture',${q(uid(20))});`);
const deletion = json(asUser(20, "select row_to_json(t) from public.delete_current_account('DELETE_MY_ACCOUNT') t")); assert.equal(deletion.success,true);
for (const oldTopic of [accountTopic, ownedAccountTopic]) assert(Number(scalar(`count(*) from realtime.messages where topic=${q(oldTopic)} and event='acl_changed' and payload='{}'::jsonb and private`)) >= 1, 'Auth cascade sends content-free committed invalidation');
assert.equal(scalar(`count(*) from public.collab_v2_documents where id=${q(owner.documentId)}`),'0');
assert.equal(json(asUser(21, `select public.collab_v2_access_status(${q(owner.documentId)})`)).status, 'ended');
assert.equal(json(asUser(9, `select public.collab_v2_access_status(${q(owner.documentId)})`)).status, 'unavailable');
assert.equal(scalar(`count(*) from public.collab_v2_members where user_id=${q(uid(20))}`),'0');
assert.equal(scalar(`actor_id is null from public.collab_v2_updates where document_id=${q(id)} and seq=3`),'t');
assert.equal(scalar(`actor_id is null from public.collab_v2_update_receipts where document_id=${q(id)} and seq=3`),'t');
assert.equal(scalar(`count(*) from public.projects where created_by=${q(uid(20))}`),'0');
assert.notEqual(scalar(`private_topic from public.collab_v2_documents where id=${q(id)}`),accountTopic);
denyJoin(9, `select public.collab_v2_join(${q(accountInvite.token)},'deleted issuer')`, 'INVALID_INVITE');
deny(20, `select public.collab_v2_create_invite(${q(id)})`, 'NOT_AUTHENTICATED');
const cascade = create(22); run(`delete from auth.users where id=${q(uid(22))};`);
assert.equal(scalar(`count(*) from public.collab_v2_documents where id=${q(cascade.documentId)}`),'0');

// 9a: real-role writer/receipt collection and checkpoint foundation.
const history = create(24), hid = history.documentId, writer = uid(924);
join(25,invite(24,hid).token); join(10,invite(24,hid).token);
const hmember = membership(hid,24);
const happend = (updateId, seq, head=0) => `select public.collab_v2_append(${q(hid)},${q(uid(24))},1,${q(hmember)},${head},${q(updateId)},'\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256'),'履歴',${q(writer)},${seq})`;
const hconfirm = seq => `select public.collab_v2_confirm_writer(${q(hid)},1,${q(hmember)},${q(writer)},${seq})`;
assert.equal(json(asUser(24,hconfirm(0))).reclaimedThrough,'0');
deny(25,hconfirm(0),'NOT_MEMBER'); deny(null,hconfirm(0),'permission denied','anon');
const wraces = await Promise.all(['writer-race-a','writer-race-b'].map(u=>concurrent(`begin; ${identity(null,'service_role')} ${happend(u,1)}; commit;`)));
assert.equal(wraces.filter(r=>r.code===0).length,1,'one winner for writer seq 1');
assert.match(wraces.find(r=>r.code!==0).stderr,/WRITER_SEQUENCE_CONFLICT/);
const historyWinner = wraces[0].code===0 ? 'writer-race-a' : 'writer-race-b';
assert.equal(json(service(happend(historyWinner,1))).duplicate,true,'ACK-loss retry before collection');
deny(24,hconfirm(2),'ACK_AHEAD');
assert.equal(json(asUser(24,hconfirm(1))).reclaimedThrough,'1');
assert.equal(scalar(`receipt_count from public.collab_v2_documents where id=${q(hid)}`),'0');
assert.equal(json(service(happend(historyWinner,1))).result,'RECEIPT_RECLAIMED','old request cannot append after collection');
assert.equal(json(service(happend('new-id-old-seq',1))).result,'RECEIPT_RECLAIMED','changed ID below boundary cannot append either');
assert.equal(scalar(`head_seq from public.collab_v2_documents where id=${q(hid)}`),'1');
assert.equal(json(service(happend('writer-next',2,1))).seq,'2');
assert.equal(json(asUser(24,hconfirm(2))).reclaimedThrough,'2');
// Due contract freezes the pre-append cut, and preserves it on later appends.
// The dedicated 9b suite covers completion of the new initial cut.
run(`delete from collab_v2_private.history_due where document_id=${q(hid)}`);
run(`update public.collab_v2_documents set last_checkpoint_at=now()-interval '11 minutes' where id=${q(hid)}`);
assert.equal(json(service(happend('due-first',3,2))).seq,'3');
assert.equal(scalar(`cut_seq from collab_v2_private.history_due where document_id=${q(hid)}`),'2');
assert.equal(json(service(happend('due-later',4,3))).seq,'4');
assert.equal(scalar(`cut_seq from collab_v2_private.history_due where document_id=${q(hid)}`),'2');
asUser(24,hconfirm(4));
const payload = JSON.stringify({formatVersion:1,sharedSchemaVersion:2,content:{roots:{},hasSong:false},song:null});
// SQL tests exercise storage/RLS; validating the logical DTO is Edge's boundary.
const pbytes = `convert_to(${q(payload)},'UTF8')`;
const storeHistory = (actor=24, reason='manual') => `select public.collab_v2_store_checkpoint(${q(hid)},${q(uid(actor))},1,2,${pbytes},extensions.digest(${pbytes},'sha256'),${q(reason)})`;
const point = json(service(storeHistory()));
assert.equal(json(service(storeHistory(10))).contentId,point.contentId,'same-document content dedupe');
assert.equal(scalar(`count(*) from public.collab_v2_checkpoint_contents where document_id=${q(hid)}`),'1');
join(26,invite(24,hid).token); // This participant joins AFTER both checkpoints.
for (const actor of [24,25,10,26]) {
  assert.equal(json(asUser(actor,`select public.collab_v2_get_checkpoint(${q(hid)},${q(point.id)})`)).confirmedSeq,'2');
  assert.equal(json(asUser(actor,`select public.collab_v2_list_checkpoints(${q(hid)})`)).length,2);
  assert.equal(asUser(actor,`select count(*) from public.collab_v2_checkpoint_contents where document_id=${q(hid)}`),'1');
  deny(actor,storeHistory(actor),'permission denied');
}
for (const actor of [25,10]) deny(actor,`select public.collab_v2_delete_checkpoint(${q(hid)},${q(point.id)})`,'CREATOR_ONLY');
deny(null,`select public.collab_v2_get_checkpoint(${q(hid)},${q(point.id)})`,'permission denied','anon');
deny(9,`select public.collab_v2_get_checkpoint(${q(hid)},${q(point.id)})`,'NOT_MEMBER');
assert.equal(asUser(9,`select count(*) from public.collab_v2_checkpoints where document_id=${q(hid)}`),'0');
asUser(25,`select public.collab_v2_remove_member(${q(hid)},${q(uid(26))})`);
deny(26,`select public.collab_v2_get_checkpoint(${q(hid)},${q(point.id)})`,'NOT_MEMBER');
deny(null,storeHistory(26),'NOT_MEMBER','service_role');
assert.equal(asUser(26,`select count(*) from public.collab_v2_checkpoint_contents where document_id=${q(hid)}`),'0');
for (const table of ['writers','checkpoints','checkpoint_contents']) {
  deny(24,`delete from public.collab_v2_${table}`,'permission denied');
  deny(null,`select * from public.collab_v2_${table}`,'permission denied','anon');
}
// Quotas are changed only inside rollback-only fixture transactions.
for (const pool of ['state','checkpoint','work']) {
  try { run(`begin; select collab_v2_private.require_budget(134217728,${q(pool)}); rollback;`); assert.fail('pool capacity'); }
  catch(error) { assert.match(error.stderr??error.message,/PROJECT_QUOTA_EXCEEDED/); }
}
run(`begin; update collab_v2_private.budget_settings set state_bytes=1;
  select collab_v2_private.require_budget(1000,'state',1001); rollback;`); // shrinking/replace delta accepted even after lowering limits
try { run(`begin; update collab_v2_private.budget_settings set document_checkpoint_bytes=1; ${identity(null,'service_role')} ${storeHistory()}; commit;`); assert.fail('manual capacity'); }
catch(error) { assert.match(error.stderr??error.message,/CHECKPOINT_QUOTA_EXCEEDED/); }
try { run(`begin; update collab_v2_private.budget_settings set checkpoint_bytes=1; ${identity(null,'service_role')} ${storeHistory(24,'before-restore')}; commit;`); assert.fail('mandatory capacity'); }
catch(error) { assert.match(error.stderr??error.message,/PROJECT_QUOTA_EXCEEDED/); }
assert.equal(scalar(`head_seq from public.collab_v2_documents where id=${q(hid)}`),'4','mandatory failure changes neither head nor current state');
assert.equal(json(run(`begin; update collab_v2_private.budget_settings set document_checkpoint_bytes=1; ${identity(null,'service_role')} ${storeHistory(24,'automatic')}; rollback;`)).result,'DEFERRED_CAPACITY');
try { run(`begin; update collab_v2_private.budget_settings set mandatory_checkpoint_bytes=2097152;
  insert into collab_v2_private.work_reservations(document_id,lease_id,bytes,expires_at) values(${q(hid)},${q(uid(930))},16777216,now()-interval '1 minute');
  select collab_v2_private.require_budget(1,'work'); rollback;`); assert.fail('expired reservations count until deleted'); }
catch(error) { assert.match(error.stderr??error.message,/PROJECT_QUOTA_EXCEEDED/); }
asUser(24,`select public.collab_v2_delete_checkpoint(${q(hid)},${q(point.id)})`);
assert.equal(scalar(`count(*) from public.collab_v2_checkpoint_contents where document_id=${q(hid)}`),'1','content survives while another checkpoint references it');
const stateUsed = scalar(`(select coalesce(sum(log_bytes+receipt_count*512::bigint+512),0) from public.collab_v2_documents)+
  (select count(*)*512 from public.collab_v2_updates)+(select coalesce(sum(octet_length(bytes)+512),0) from public.collab_v2_sync_snapshots)+
  (select count(*)*512 from public.collab_v2_writers)+(select count(*)*512 from collab_v2_private.history_due)`);
try { run(`begin; insert into public.collab_v2_sync_snapshots(id,document_id,generation,upto_seq,bytes,digest)
  values(${q(uid(940))},${q(hid)},1,2,${q(initial)}::bytea,extensions.digest(${q(initial)}::bytea,'sha256'));
  update public.collab_v2_documents set previous_snapshot_id=${q(uid(940))} where id=${q(hid)};
  update collab_v2_private.budget_settings set state_bytes=${stateUsed}; select collab_v2_private.require_budget(1); rollback;`); assert.fail('previous snapshot budget'); }
catch(error) { assert.match(error.stderr??error.message,/PROJECT_QUOTA_EXCEEDED/); }
const legacyLost=create(27), lid=legacyLost.documentId, lm=membership(lid,27), lw=uid(927);
const legacyAppend=(sequenced=false)=>`select public.collab_v2_append(${q(lid)},${q(uid(27))},1,${q(lm)},0,'legacy-ack-lost','\\x0000'::bytea,extensions.digest('\\x0000'::bytea,'sha256'),'legacy'${sequenced ? `,${q(lw)},1` : ''})`;
assert.equal(json(service(legacyAppend())).seq,'1');
assert.equal(json(service(legacyAppend(true))).duplicate,true,'upgrade binds a same-digest, same-actor ACK-lost legacy receipt instead of appending');
asUser(27,`select public.collab_v2_confirm_writer(${q(lid)},1,${q(lm)},${q(lw)},1)`);
deny(null,legacyAppend(),'WRITER_REQUIRED','service_role');
assert.equal(scalar(`head_seq from public.collab_v2_documents where id=${q(lid)}`),'1');

// Foundation noninterference remains a distinct oracle. 11a's intentional
// shutdown ACL changes are checked separately by test-legacy-cloud-sql.mjs.
// Rerun with populated v2 tables. Confirm content, state, legacy function ACLs.
await runMaintenanceSqlSuite({run,service,asUser,deny,create,join,invite,membership,uid,q,json,scalar,identity,concurrent,initial,pbytes});
await runRestoreSqlSuite({run,service,asUser,deny,create,join,invite,membership,uid,q,json,scalar,identity,concurrent,initial,pbytes});
await runEphemeralSqlSuite({run,asUser,deny,create,join,invite,uid,q,json,scalar});
const before = scalar(`md5(row_to_json(d)::text) from public.collab_v2_documents d where id=${q(id)}`);
run(readFileSync(migration,'utf8'));
assert.equal(scalar(`md5(row_to_json(d)::text) from public.collab_v2_documents d where id=${q(id)}`),before);
assert.equal(scalar(`count(*) from test_support.legacy_functions b join pg_proc p on p.oid=b.oid where b.definition is distinct from pg_get_functiondef(p.oid) or b.proacl is distinct from p.proacl`),'0');
assert.equal(scalar(`count(*) from test_support.legacy_tables b join pg_class c on c.oid=b.oid where b.relacl is distinct from c.relacl or b.relrowsecurity is distinct from c.relrowsecurity`),'0');
// Repeat the new transport oracle after reapplication, with fresh disposable data.
await runEphemeralSqlSuite({run,asUser,deny,create,join,invite,uid,q,json,scalar});
asUser(1,`select public.collab_v2_delete_document(${q(id)})`);
assert.equal(scalar(`deleted_at is not null and latest_snapshot_id is null from public.collab_v2_documents where id=${q(id)}`),'t');
for (const table of ['updates','update_receipts','sync_snapshots','invites']) assert.equal(scalar(`count(*) from public.collab_v2_${table} where document_id=${q(id)}`),'0');
assert.equal(json(asUser(2, `select public.collab_v2_access_status(${q(id)})`)).status, 'ended');
assert.equal(json(asUser(3, `select public.collab_v2_access_status(${q(id)})`)).status, 'ended');
deny(2,`select public.collab_v2_get_updates(${q(id)},1,0)`,'DOCUMENT_DELETED');
deny(null,appendSql('deleted',2),'DOCUMENT_DELETED','service_role');
console.log('PASS: 11 legacy + v2 + rerun; guest and 8-user race; ACL/topic fences; NULL/outsider/direct-write denials; seq commit ordering; durable receipts; quotas; creator/account deletion');
