import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migration, shutdownMigration, rescueListingMigration } from '../check-collab-v2.mjs';

const tables = ['projects','project_members','project_resources','scenes','edit_locks',
  'snapshots','audit_logs','project_invites','scene_cell_versions','user_contacts','profiles'];
const fixture = JSON.parse(readFileSync('supabase/tests/fixtures/legacy-export-v1.json','utf8'));
const shutdown = readFileSync(shutdownMigration,'utf8');
const foundation = readFileSync(migration,'utf8');
const rescueListing = readFileSync(rescueListingMigration,'utf8');
const q = value => `'${String(value).replaceAll("'","''")}'`;
const uid = n => `11000000-0000-0000-0001-${String(n).padStart(12,'0')}`;

// run is supplied by the Linux-only, fixed loopback disposable DB runner.
export async function runLegacyShutdownSqlSuite({ run, concurrent, foundationAfterShutdown = false }) {
  const scalar = sql => run(`select ${sql};`);
  const json = text => JSON.parse(text.trim().split('\n').at(-1));
  const legacyCounts = () => json(run(`select jsonb_object_agg(name,n) from
    (${tables.map(t=>`select ${q(t)} name,count(*) n from public.${t}`).join(' union all ')}) counts`));
  const v2Acl = () => json(scalar(`jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
      'definition',md5(pg_get_functiondef(p.oid)),'acl',p.proacl) order by p.oid)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='collab_v2_private' or (n.nspname='public' and p.proname like 'collab_v2_%')),
    'tables',(select jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'acl',c.relacl,
      'rls',c.relrowsecurity,'columns',(select jsonb_agg(a.attacl order by a.attnum)
        from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by c.oid)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and (n.nspname='collab_v2_private' or (n.nspname='public' and c.relname like 'collab_v2_%'))))`));
  let beforeV2=foundationAfterShutdown ? null : v2Acl();
  const identity = (n, role='authenticated') => `set local role ${role};
    set local request.jwt.claim.sub=${q(n===null ? '' : uid(n))};
    set local request.jwt.claims=${q(JSON.stringify({sub:n===null ? null : uid(n),role,is_anonymous:n===10}))};`;
  const asUser = (n,sql,role='authenticated') => run(`begin; ${identity(n,role)} ${sql}; commit;`);
  const deny = (n,sql,message='permission denied',role='authenticated') => {
    let error;
    try { asUser(n,sql,role); } catch(e) { error=e; }
    assert(error,`Expected denial: ${sql}`);
    assert.match(error.stderr??error.message,new RegExp(message),sql);
  };
  run(`set timezone='UTC';
    insert into auth.users(id,email,is_anonymous,raw_user_meta_data)
    select ('11000000-0000-0000-0001-'||lpad(n::text,12,'0'))::uuid,
      case when n=10 then null else 'fixture'||n||'@example.invalid' end,n=10,'{}'
    from generate_series(1,12) n;
    insert into public.projects(id,title,mode,schema_version,legacy_project_id,created_at,updated_at,created_by)
    values(${q(fixture.project.id)},${q(fixture.project.title)},'stage',1,'synthetic-local-source',
      '2026-10-05T00:00:00Z','2026-10-05T00:00:00Z',${q(uid(1))});
    insert into public.project_members(project_id,user_id,role)
    values(${q(fixture.project.id)},${q(uid(1))},'owner'),
      (${q(fixture.project.id)},${q(uid(2))},'editor'),
      (${q(fixture.project.id)},${q(uid(10))},'owner');`);
  for (const r of fixture.resources) run(`insert into public.project_resources(project_id,resource_key,data,updated_by)
    values(${q(fixture.project.id)},${q(r.resource_key)},${q(JSON.stringify(r.data))},${q(uid(1))});`);
  for (const s of fixture.scenes) run(`insert into public.scenes(project_id,scene_id,data,updated_by)
    values(${q(fixture.project.id)},${q(s.scene_id)},${q(JSON.stringify(s.data))},${q(uid(1))});`);
  // Independently granted columns, nested definer views, owned sequences and
  // PUBLIC grants simulate real DB drift; no such objects exist in the old SQL.
  run(`create view public.legacy_shutdown_fixture_view as select id,title from public.projects;
    create view public.legacy_shutdown_fixture_nested as select * from public.legacy_shutdown_fixture_view;
    create sequence public.legacy_shutdown_fixture_seq owned by public.projects.schema_version;
    grant all on public.legacy_shutdown_fixture_view,public.legacy_shutdown_fixture_nested to public;
    grant select(title),update(title) on public.projects to public,anon,authenticated;
    grant all on sequence public.legacy_shutdown_fixture_seq to public;
    create table test_support.shutdown_functions as select p.oid,pg_get_functiondef(p.oid) definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname<>'delete_current_account'
        and p.proname not like 'collab_v2_%';`);
  const beforeRows=legacyCounts();
  const assertStopped = () => {
    // Effective permissions include PUBLIC and inherited roles; enumerate all
    // original functions independently rather than trusting the allowlist.
    for (const role of ['anon','authenticated']) {
      assert.equal(scalar(`count(*) from test_support.shutdown_functions f
        where has_function_privilege(${q(role)},f.oid,'EXECUTE')`),'0');
      for (const name of [...tables,'legacy_shutdown_fixture_view','legacy_shutdown_fixture_nested']) {
        assert.equal(scalar(`has_table_privilege(${q(role)},${q('public.'+name)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          or has_any_column_privilege(${q(role)},${q('public.'+name)},'SELECT,INSERT,UPDATE,REFERENCES')`),'f',`${role}/${name}`);
      }
      assert.equal(scalar(`has_sequence_privilege(${q(role)},'public.legacy_shutdown_fixture_seq','USAGE,SELECT,UPDATE')`),'f');
    }
    assert.equal(scalar(`count(*) from test_support.shutdown_functions f join pg_proc p on p.oid=f.oid
      where f.definition is distinct from pg_get_functiondef(p.oid)`),'0','legacy definitions retained');
    assert.equal(scalar(`count(*) from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename=any(array[${tables.map(q).join(',')}])`),'0');
    for (const [n,role] of [[null,'anon'],[null,'authenticated'],[10,'authenticated'],[1,'authenticated'],[3,'authenticated']]) {
      for (const sql of ["select public.cloud_collab_current_role(null)",
        "select public.cloud_collab_log(null,'forged')",'select public.list_user_contacts()',
        'select public.delete_cloud_project(null)',"select public.acquire_edit_lock(null,'scene','s','token')",
        "select public.create_cloud_project('forged','stage',1,null,'{}','[]')",
        'select public.handle_auth_user_profile()',"select public.cloud_collab_token_hash('secret')",
        "select public.save_scene_with_lock(null,'s',1,'{}','token')"])
        deny(n,sql,'permission denied',role);
      for (const sql of ['select title from public.projects',"update public.projects set title='forged'",
        'delete from public.projects',"insert into public.profiles(user_id,display_name) values(null,'fixture')",
        'select * from public.legacy_shutdown_fixture_nested',"select nextval('public.legacy_shutdown_fixture_seq')"])
        deny(n,sql,'permission denied',role);
    }
  };
  run(shutdown); assertStopped();
  if (beforeV2) assert.deepEqual(v2Acl(),beforeV2,'shutdown leaves v2 definitions/ACLs unchanged');
  assert.deepEqual(legacyCounts(),beforeRows,'shutdown retains every legacy row');
  const settings = scalar('row_to_json(s)::text from legacy_cloud_private.shutdown_settings s');
  assert.equal(scalar("export_until-cutover_at between interval '30 days' and interval '30 days 1 second' from legacy_cloud_private.shutdown_settings"),'t');
  run(shutdown); assertStopped();
  assert.equal(scalar('row_to_json(s)::text from legacy_cloud_private.shutdown_settings s'),settings,'rerun must not extend deadline');
  if (foundationAfterShutdown) {
    run(foundation); run(foundation); assertStopped(); beforeV2=v2Acl();
  }
  run(rescueListing);
  run(rescueListing);
  assertStopped();
  assert.equal(scalar('row_to_json(s)::text from legacy_cloud_private.shutdown_settings s'),settings,'11b rerun retains cutover/deadline');
  run(`insert into auth.users(id,email,is_anonymous) values(${q(uid(13))},null,true)`);
  assert.equal(scalar(`count(*) from public.profiles where user_id=${q(uid(13))}`),'0','v2 signup no longer creates legacy profiles');
  const id = fixture.project.id;
  const exported = () => json(asUser(1,`select public.legacy_export_project(${q(id)})`));
  assert.deepEqual(exported(),fixture,'11b adapter uses this exact contract fixture');
  for (const sql of ['select public.legacy_list_owned_projects()',`select public.legacy_export_project(${q(id)})`]) {
    deny(null,sql,'permission denied','anon');
    for (const n of [null,10,13,99]) deny(n,sql,'PERMANENT_ACCOUNT_REQUIRED');
  }
  for (const n of [2,3]) deny(n,`select public.legacy_export_project(${q(id)})`,'LEGACY_PROJECT_UNAVAILABLE');
  run(`update public.project_members set role='owner' where project_id=${q(id)} and user_id=${q(uid(2))}`);
  assert.deepEqual(json(asUser(2,`select public.legacy_export_project(${q(id)})`)),fixture,'current permanent co-owner can export');
  run(`update public.project_members set role='editor' where project_id=${q(id)} and user_id=${q(uid(2))}`);
  deny(1,'select public.legacy_export_project(null)','LEGACY_PROJECT_UNAVAILABLE');
  deny(1,`select public.legacy_export_project('${'f'.repeat(8)}-ffff-ffff-ffff-ffffffffffff')`,'LEGACY_PROJECT_UNAVAILABLE');
  assert.deepEqual(json(asUser(3,'select public.legacy_list_owned_projects()')).items,[]);
  assert.deepEqual(json(asUser(1,'select public.legacy_list_owned_projects()')),{
    contractVersion:1,items:[{projectId:id,title:fixture.project.title,mode:'stage',schemaVersion:1,createdAt:fixture.project.created_at,hidden:false}],nextCursor:null,
    exportUntil:JSON.parse(settings).export_until
  });
  run(`update public.project_members set hidden_at=now() where project_id=${q(id)} and user_id=${q(uid(1))}`);
  assert.equal(json(asUser(1,'select public.legacy_list_owned_projects()')).items[0].hidden,true,'hidden owner remains a separate rescue candidate');
  assert.deepEqual(exported(),fixture,'hidden marker does not enter document body');
  run(`update public.project_members set hidden_at=null where project_id=${q(id)} and user_id=${q(uid(1))}`);
  for (const args of ['null','0','51',`1,null,${q(id)}`,"1,'infinity',null",`1,'infinity',${q(id)}`])
    deny(1,`select public.legacy_list_owned_projects(${args})`,'INVALID_ARGUMENT');
  const secondId='11000000-0000-0000-0000-000000000002';
  run(`insert into public.projects(id,title,created_by,created_at) values(${q(secondId)},'paging',${q(uid(1))},'2026-10-05T00:00:00Z');
    insert into public.project_members(project_id,user_id,role) values(${q(secondId)},${q(uid(1))},'owner');`);
  const page1=json(asUser(1,'select public.legacy_list_owned_projects(1)'));
  assert.equal(page1.items[0].projectId,secondId); assert(page1.nextCursor);
  const page2=json(asUser(1,`select public.legacy_list_owned_projects(1,${q(page1.nextCursor.createdAt)},${q(page1.nextCursor.projectId)})`));
  assert.equal(page2.items[0].projectId,id); assert.equal(page2.nextCursor,null);
  deny(1,`select public.legacy_export_project(${q(secondId)})`,'LEGACY_EXPORT_INCOMPLETE');
  run(`update public.projects set deleted_at=now() where id=${q(secondId)}`);
  deny(1,`select public.legacy_export_project(${q(secondId)})`,'LEGACY_PROJECT_UNAVAILABLE');
  assert.equal(json(asUser(1,'select public.legacy_list_owned_projects()')).items.length,1);
  run(`update public.project_members set role='viewer' where project_id=${q(id)} and user_id=${q(uid(1))}`);
  deny(1,`select public.legacy_export_project(${q(id)})`,'LEGACY_PROJECT_UNAVAILABLE');
  run(`update public.project_members set role='owner' where project_id=${q(id)} and user_id=${q(uid(1))}`);
  run(`update legacy_cloud_private.shutdown_settings set export_until=clock_timestamp()-interval '1 second',cutover_at=clock_timestamp()-interval '31 days'`);
  for (const sql of ['select public.legacy_list_owned_projects()',`select public.legacy_export_project(${q(id)})`]) deny(1,sql,'LEGACY_EXPORT_EXPIRED');
  run(shutdown);
  deny(1,`select public.legacy_export_project(${q(id)})`,'LEGACY_EXPORT_EXPIRED','authenticated');
  run(`update legacy_cloud_private.shutdown_settings set export_until=clock_timestamp()+interval '1 day'`);
  // Bounds include both source payload and the aggregate's metadata overhead.
  run(`update public.scenes set data=jsonb_build_object('notes',repeat('x',8388608)) where project_id=${q(id)}`);
  deny(1,`select public.legacy_export_project(${q(id)})`,'LEGACY_EXPORT_TOO_LARGE');
  run(`update public.scenes set data='{"notes":""}' where project_id=${q(id)}`);
  const baseBytes=Number(asUser(1,`select octet_length(public.legacy_export_project(${q(id)})::text)`));
  run(`update public.scenes set data=jsonb_build_object('notes',repeat('x',${8388608-baseBytes})) where project_id=${q(id)}`);
  assert.equal(asUser(1,`select octet_length(public.legacy_export_project(${q(id)})::text)`),'8388608','exact response byte ceiling accepted');
  run(`update public.scenes set data=jsonb_build_object('notes',repeat('x',${8388609-baseBytes})) where project_id=${q(id)}`);
  deny(1,`select public.legacy_export_project(${q(id)})`,'LEGACY_EXPORT_TOO_LARGE');
  run(`update public.scenes set data=${q(JSON.stringify(fixture.scenes[0].data))} where project_id=${q(id)}`);
  // A second transaction changes resource + scene atomically while a STABLE
  // export statement waits. It must return both old values, never a mixed pair.
  if (concurrent) {
    const pending=concurrent(`begin; set local application_name='legacy-export-snapshot'; ${identity(1)}
      with barrier as materialized(select pg_sleep(2))
      select public.legacy_export_project(${q(id)}) from barrier; commit;`);
    let ready=false;
    for (let i=0;i<100;i++) {
      if (scalar("exists(select 1 from pg_stat_activity where application_name='legacy-export-snapshot' and wait_event='PgSleep')")==='t') { ready=true; break; }
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert(ready,'snapshot barrier');
    run(`begin; update public.project_resources set version=2 where project_id=${q(id)};
      update public.scenes set version=2 where project_id=${q(id)}; commit;`);
    const observed=await pending; assert.equal(observed.code,0,observed.stderr);
    assert.deepEqual(json(observed.stdout),fixture,'single calling-statement snapshot');
    assert(exported().resources.every(r=>r.version===2)); assert.equal(exported().scenes[0].version,2);
  }
  // A broad permissive policy is deliberately present in bootstrap. Neither
  // row topic nor requested topic may bypass the restrictive legacy fence.
  const oldTopic=`cloud-project:${id}`;
  run(`insert into realtime.messages(topic,extension,payload) values(${q(oldTopic)},'broadcast','{}'),(${q(oldTopic)},'presence','{}');`);
  for (const [n,role] of [[null,'anon'],[10,'authenticated'],[1,'authenticated'],[3,'authenticated']]) {
    if (role==='anon') { deny(n,'select * from realtime.messages','permission denied',role); continue; }
    assert.equal(asUser(n,`set local realtime.topic=${q(oldTopic)}; select count(*) from realtime.messages`),'0');
    assert.equal(asUser(n,"set local realtime.topic='unrelated'; select count(*) from realtime.messages where topic like 'cloud-project:%'"),'0');
    for (const ext of ['broadcast','presence']) deny(n,`set local realtime.topic=${q(oldTopic)};
      insert into realtime.messages(topic,extension,payload) values(${q(oldTopic)},${q(ext)},'{}')`,'row-level security');
  }
  // Current v2 creator/private topics and direct ephemeral publication continue.
  const create=n=>json(asUser(null,`select public.collab_v2_create_document(${q(uid(n))},'fixture','\\x0001'::bytea)`,'service_role'));
  const v2=create(1), v2id=v2.documentId;
  const topic=scalar(`private_topic from public.collab_v2_documents where id=${q(v2id)}`);
  run(`insert into realtime.messages(topic,extension,payload) values(${q(topic)},'broadcast','{}');`);
  assert.equal(asUser(1,`set local realtime.topic=${q(topic)}; select count(*) from realtime.messages where topic=${q(topic)}`),'1');
  assert.equal(asUser(3,`set local realtime.topic=${q(topic)}; select count(*) from realtime.messages where topic=${q(topic)}`),'0');
  const ep=json(asUser(1,`select public.collab_v2_ephemeral_state(${q(v2id)})`));
  // The existing transport oracle covers exact ephemeral fields/roster; check
  // it via its derived topic from SQL to avoid duplicating client encoding.
  const ephemeralTopic=`${ep.topic}:ephemeral:${uid(1)}`;
  assert.equal(typeof ephemeralTopic,'string');
  asUser(1,`set local realtime.topic=${q(ephemeralTopic)};
    insert into realtime.messages(topic,extension,payload) values(${q(ephemeralTopic)},'broadcast','{}')`);
  deny(3,`set local realtime.topic=${q(ephemeralTopic)};
    insert into realtime.messages(topic,extension,payload) values(${q(ephemeralTopic)},'broadcast','{}')`,'row-level security');
  const deletion=(n,value,role='authenticated')=>json(asUser(n,`select row_to_json(t) from public.delete_current_account(${value}) t`,role));
  assert.equal(deletion(null,"'DELETE_MY_ACCOUNT'").reason,'not_authenticated');
  assert.equal(deletion(99,"'DELETE_MY_ACCOUNT'").reason,'user_not_found');
  assert.equal(deletion(10,"'DELETE_MY_ACCOUNT'").reason,'permanent_account_required');
  assert.equal(deletion(13,"'DELETE_MY_ACCOUNT'").reason,'permanent_account_required','DB anonymous flag wins over permanent-looking JWT');
  assert.equal(deletion(1,'null').reason,'confirmation_required');
  assert.equal(deletion(1,"'wrong'").reason,'confirmation_required');
  deny(null,"select public.delete_current_account('DELETE_MY_ACCOUNT')",'permission denied','anon');
  assert.deepEqual(exported().project,fixture.project,'denials have no document effects');
  // Sole owner deleted, co-owned legacy document transferred, unrelated legacy
  // history anonymized. v2 creator docs CASCADE; other participation removed.
  const owned=create(4), retained=create(5);
  const ownedInvite=json(asUser(4,`select public.collab_v2_create_invite(${q(owned.documentId)})`));
  asUser(6,`select public.collab_v2_join(${q(ownedInvite.token)},'fixture')`);
  const inv=json(asUser(5,`select public.collab_v2_create_invite(${q(retained.documentId)})`));
  asUser(4,`select public.collab_v2_join(${q(inv.token)},'fixture')`);
  const ownedTopic=scalar(`private_topic from public.collab_v2_documents where id=${q(owned.documentId)}`);
  const retainedTopic=scalar(`private_topic from public.collab_v2_documents where id=${q(retained.documentId)}`);
  run(`insert into public.projects(id,title,created_by) values
    ('11000000-0000-0000-0000-000000000004','sole',${q(uid(4))}),
    ('11000000-0000-0000-0000-000000000005','co-owned',${q(uid(4))});
    insert into public.project_members(project_id,user_id,role) values
      ('11000000-0000-0000-0000-000000000004',${q(uid(4))},'owner'),
      ('11000000-0000-0000-0000-000000000005',${q(uid(4))},'owner'),
      ('11000000-0000-0000-0000-000000000005',${q(uid(5))},'owner');
    update public.project_resources set updated_by=${q(uid(4))} where project_id=${q(id)};
    update public.scenes set updated_by=${q(uid(4))} where project_id=${q(id)};
    insert into public.audit_logs(project_id,actor_id,action) values(${q(id)},${q(uid(4))},'fixture');
    insert into public.snapshots(project_id,target_type,target_id,version,data,created_by)
      values(${q(id)},'scene','scene-fixture',1,'{}',${q(uid(4))});
    insert into public.scene_cell_versions(project_id,scene_id,cell_kind,cell_id,updated_by)
      values(${q(id)},'scene-fixture','notes','_',${q(uid(4))});
    insert into public.project_invites(project_id,invited_email,role,token_hash,invited_by,accepted_by)
      values(${q(id)},'recipient@example.invalid','editor','fixture-accepted',${q(uid(5))},${q(uid(4))}),
        (${q(id)},'fixture4@example.invalid','editor','fixture-email',${q(uid(5))},null),
        (${q(id)},'recipient@example.invalid','editor','fixture-sender',${q(uid(4))},null);`);
  assert.deepEqual(deletion(4,"'DELETE_MY_ACCOUNT'"),{success:true,reason:'ok',deleted_project_count:1,transferred_project_count:1});
  assert.equal(scalar(`count(*) from auth.users where id=${q(uid(4))}`),'0');
  assert.equal(scalar("created_by='11000000-0000-0000-0001-000000000005' from public.projects where id='11000000-0000-0000-0000-000000000005'"),'t');
  assert.equal(scalar(`count(*) from public.collab_v2_documents where id=${q(owned.documentId)}`),'0');
  assert.equal(scalar(`count(*) from public.collab_v2_members where user_id=${q(uid(4))}`),'0');
  assert.equal(json(asUser(6,`select public.collab_v2_access_status(${q(owned.documentId)})`)).status,'ended');
  for (const oldTopic of [ownedTopic,retainedTopic]) assert(Number(scalar(`count(*) from realtime.messages where topic=${q(oldTopic)}
    and event='acl_changed' and payload='{}'::jsonb and private`))>=1,'committed content-free v2 account notice');
  assert.equal(scalar("accepted_by is null from public.project_invites where token_hash='fixture-accepted'"),'t');
  assert.equal(scalar("count(*) from public.project_invites where token_hash in ('fixture-email','fixture-sender')"),'0');
  assert.equal(json(asUser(5,`select public.collab_v2_access_status(${q(retained.documentId)})`)).status,'active');
  for (const [t,c] of [['project_resources','updated_by'],['scenes','updated_by'],['audit_logs','actor_id'],['snapshots','created_by'],['scene_cell_versions','updated_by']])
    assert.equal(scalar(`count(*) from public.${t} where ${c}=${q(uid(4))}`),'0');
  deny(4,`select public.legacy_export_project(${q(id)})`,'PERMANENT_ACCOUNT_REQUIRED');
  assert.equal(deletion(4,"'DELETE_MY_ACCOUNT'").reason,'user_not_found');
  run(foundation); assertStopped(); run(shutdown); assertStopped(); run(rescueListing); assertStopped();
  assert.deepEqual(v2Acl(),beforeV2,'reruns preserve v2 definitions/table and column ACLs');
  assert.equal(json(asUser(1,`select public.collab_v2_access_status(${q(v2id)})`)).status,'active');
  console.log(`PASS: 11a ${foundationAfterShutdown ? 'old → shutdown → v2' : 'old → v2 → shutdown'}, reruns, effective ACLs, snapshot/export fixture, deadlines, account cascade, old/v2 topics`);
}
