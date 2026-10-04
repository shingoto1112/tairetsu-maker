import assert from 'node:assert/strict';

/** Real DB roles/transactions and legacy broad policies, not Realtime's cached
 * WebSocket authorization. Hosted residual connections need separate smoke. */
export async function runEphemeralSqlSuite(h) {
  const { run, asUser, deny, create, join, invite, uid, q, json, scalar } = h;
  const id = create(35).documentId;
  for (const who of [2, 10]) join(who, invite(35, id).token);
  const topic = () => scalar(`private_topic from public.collab_v2_documents where id=${q(id)}`);
  const derived = (base, who) => `${base}:ephemeral:${uid(who)}`;
  const insert = (t, requested = t, extension = 'broadcast') => `set local realtime.topic=${q(requested)};
    insert into realtime.messages(topic,extension,payload) values(${q(t)},${q(extension)},'{}')`;
  const read = (who, t, role = 'authenticated') => run(`begin; set local role ${role};
    set local request.jwt.claim.sub=${q(who === null ? '' : uid(who))}; set local realtime.topic=${q(t)};
    select count(*) from realtime.messages where topic=${q(t)}; rollback;`);
  const notifyCount = t => Number(scalar(`count(*) from realtime.messages where topic=${q(t)} and event='acl_changed' and payload='{}'::jsonb and private`));
  const old = topic(), mine = derived(old, 35);
  for (const who of [35, 2, 10]) {
    const own = derived(old, who); asUser(who, insert(own));
    for (const reader of [35, 2, 10]) assert.equal(read(reader, own), '1');
    assert.equal(read(9, own), '0');
    for (const other of [35, 2, 10, 9].filter(n => n !== who)) deny(other, insert(own), 'row-level security');
    deny(who, insert(old), 'row-level security');
    deny(who, insert(own, own, 'presence'), 'row-level security');
    const receipt = json(asUser(who, `select public.collab_v2_ephemeral_state(${q(id)})`));
    assert.equal(receipt.topic, old); assert.equal(receipt.members.length, 3);
    assert(receipt.members.every(m => m.membershipGeneration && /^#[0-9a-f]{6}$/.test(m.color)));
  }
  deny(null, insert(mine), 'permission denied|row-level security', 'anon');
  deny(null, `select public.collab_v2_ephemeral_state(${q(id)})`, 'permission denied', 'anon');
  deny(9, `select public.collab_v2_ephemeral_state(${q(id)})`, 'NOT_MEMBER');
  // Even if future legacy grants give anon access, restrictive fences deny it.
  const anonSetup = `grant select,insert on realtime.messages to anon; grant usage on sequence realtime.messages_id_seq to anon;
    create policy test_anon_read on realtime.messages for select to anon using(true);
    create policy test_anon_write on realtime.messages for insert to anon with check(true);
    set local role anon; set local realtime.topic=${q(mine)};`;
  // Missing private/public helper privileges may reject anon at planning time;
  // either permission denial or zero rows is a valid receive rejection.
  try { assert.equal(run(`begin; ${anonSetup} select count(*) from realtime.messages; rollback;`), '0'); }
  catch (error) { assert.match(error.stderr ?? error.message, /permission denied/); }
  try { run(`begin; ${anonSetup} insert into realtime.messages(topic,extension,payload) values(${q(mine)},'broadcast','{}'); rollback;`); assert.fail('anon INSERT fence'); }
  catch (error) { assert.match(error.stderr ?? error.message, /row-level security|permission denied/); }
  assert.equal(read(null, mine), '0'); deny(null, insert(mine), 'row-level security');
  // Probe topic and row topic must agree; prefix and guessed suffix never suffice.
  for (const [row, requested] of [[mine, old], [old, mine], ['legacy-room', mine], [mine, 'legacy-room'], [`${mine}:extra`, mine]]) deny(35, insert(row, requested), 'row-level security');
  deny(35, insert(`${old}:ephemeral:${uid(9)}`), 'row-level security');
  assert.equal(read(35, `${old}:ephemeral:${uid(9)}`), '0');
  asUser(35, `select public.collab_v2_remove_member(${q(id)},${q(uid(2))})`);
  assert.equal(notifyCount(old), 1, 'removal commit invalidates old server-only channel');
  assert.notEqual(topic(), old);
  for (const who of [35, 10, 2, 9]) {
    assert.equal(read(who, mine), '0'); deny(who, insert(mine), 'row-level security');
  }
  const next = topic(); assert.equal(read(2, derived(next, 35)), '0');
  deny(2, insert(derived(next, 2)), 'row-level security');
  join(2, invite(35, id).token); const beforeGeneration = topic();
  run(`update public.collab_v2_members set membership_generation=gen_random_uuid() where document_id=${q(id)} and user_id=${q(uid(2))};`);
  assert.equal(notifyCount(beforeGeneration), 1); assert.notEqual(topic(), beforeGeneration);
  const beforeRollback = topic();
  run(`begin; delete from public.collab_v2_members where document_id=${q(id)} and user_id=${q(uid(2))}; rollback;`);
  assert.equal(topic(), beforeRollback); assert.equal(notifyCount(beforeRollback), 0, 'rollback leaks no notice');
  asUser(10, `select public.collab_v2_leave(${q(id)})`); assert.equal(notifyCount(beforeRollback), 1);
  const beforeDelete = topic(); asUser(35, `select public.collab_v2_delete_document(${q(id)})`);
  assert.equal(notifyCount(beforeDelete), 1); deny(35, insert(derived(beforeDelete, 35)), 'row-level security');
  deny(35, `select public.collab_v2_ephemeral_state(${q(id)})`, 'NOT_MEMBER');
  // Physical Auth/document cascade also produces a committed content-free event.
  const physical = id;
  const physicalTopic = scalar(`private_topic from public.collab_v2_documents where id=${q(physical)}`);
  run(`delete from public.collab_v2_documents where id=${q(physical)};`); assert.equal(notifyCount(physicalTopic), 1);
  console.log('PASS: direct ephemeral owner-only INSERT/current member SELECT, legacy fences, rotations, removal/leave/delete/rollback notices');
}
