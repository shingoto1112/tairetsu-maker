#!/usr/bin/env node
// Offline preflight. No environment files, secrets, connections or dependencies.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const migration = 'supabase/migrations/20261004000000_collab_v2_foundation.sql';
export const shutdownMigration = 'supabase/migrations/20261005000000_legacy_cloud_shutdown.sql';
export const rescueListingMigration = 'supabase/migrations/20261005001000_legacy_rescue_listing.sql';
export const multiUseMigration = 'supabase/migrations/20261006000000_collab_v2_multi_use_invites.sql';
export function preflight() {
  process.chdir(fileURLToPath(new URL('../', import.meta.url)));
  const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
  assert.equal(files.filter(f => f < '20261004').length, 11, 'Exactly 11 legacy migrations');
  assert.deepEqual(files.filter(f => f >= '20261004'), [migration, shutdownMigration, rescueListingMigration, multiUseMigration].map(p => p.split('/').at(-1)));
  const multi = readFileSync(multiUseMigration, 'utf8');
  assert.match(multi, /^begin;$/m); assert.match(multi, /commit;\s*$/);
  assert.match(multi, /default false/); assert.match(multi, /interval '7 days'/);
  assert.match(multi, /primary key\(invite_id,user_id,membership_generation\)/);
  assert.match(multi, /order by d.id for update/);
  assert.match(multi, /count\(\*\).*invite_uses[^\n]*>= 64/);
  for (const [body] of multi.matchAll(/create or replace function [\s\S]*?end \$\$;/g)) assert.match(body, /security definer set search_path = ''/);
  const multiCode = multi.replace(/'(?:''|[^'])*'/g, "''");
  for (const [, condition] of multiCode.matchAll(/\b(?:if|elsif|while)\s+([^;]*?)\bthen/gi)) assert(!/(?<!\()\bcase\b/i.test(condition));
  const listing = readFileSync(rescueListingMigration, 'utf8');
  assert.match(listing, /require_export_account\(\)/); assert.match(listing, /m\.role='owner'/);
  assert.match(listing, /m\.hidden_at is not null as hidden/); assert.match(listing, /'exportUntil'/);
  assert.match(listing, /p\.deleted_at is null/); assert.match(listing, /set search_path = ''/);
  assert(!/\b(?:update|delete from|insert into|drop|alter table)\b/i.test(listing), '11b does not mutate legacy data');
  const sql = readFileSync(migration, 'utf8');
  assert.match(sql, /\bbegin;/i); assert.match(sql, /commit;\s*$/i);
  assert(!/\b(?:alter|drop|insert into|update|delete from)\s+(?:table\s+)?public\.(?!collab_v2_)/i.test(sql), 'No legacy table mutations');
  const functions = [...sql.matchAll(/create or replace function ([\w.]+)\([\s\S]*?\n(?:\$\$;|end \$\$;)/g)];
  assert.equal(functions.length, 43, '10-transport: owner topic predicate, atomic roster and transactional ACL notification');
  const limits = readFileSync('src/config/collaborationLimits.ts','utf8');
  for (const [field, setting, value] of [['snapshotBytes','max_snapshot_bytes',2097152],['logBytes','max_log_bytes',1048576],
    ['entries','max_log_entries',512],['compactEntries','compact_updates',64],['compactBytes','compact_bytes',262144]]) {
    assert.match(limits.slice(limits.indexOf('export const SHARED_DOCUMENT_LIMITS')),new RegExp(`${field}: ${value}\\b`));
    assert.match(sql,new RegExp(`add column if not exists ${setting} [^;]*default ${value}\\b`));
  }
  for (const name of ['serverValidation','legacyServerValidation']) assert.match(readFileSync(`src/collaboration/${name}.ts`,'utf8'),/SERVER_LIMITS = SHARED_DOCUMENT_LIMITS/);
  for (const [body,name] of functions.filter(([,name])=>/collab_v2_(accept_restore|restore_state|publish_restore|release_restore)$/.test(name))) {
    assert.match(body,/require_service\(\)/,`${name} must be service-only`);
  }
  for (const [, name] of functions) assert(name.startsWith('public.collab_v2_') || name.startsWith('collab_v2_private.'));
  for (const [body] of functions) {
    assert.match(body, /security (invoker|definer) set search_path = ''/i);
    assert(!/\bnextval\(/i.test(body), 'No sequence-backed cursor');
  }
  // Catch dollar-quote damage and the PL/pgSQL CASE/THEN pitfall fixed in 9a.
  assert(!/\bas \$(?!\$)|^end \$;$/m.test(sql), 'No truncated dollar quotes');
  for (const [,condition] of sql.matchAll(/\b(?:if|elsif|while)\s+([^;]*?)\bthen/gi)) {
    assert(!/(?<!\()\bcase\b/i.test(condition), 'CASE in a procedural condition must be parenthesized');
  }
  assert.match(sql, /from public, anon, authenticated, service_role/);
  assert.match(sql, /for update;/);
  assert.match(sql, /v_seq := v_doc.head_seq \+ 1/);
  assert.match(sql, /deferrable initially deferred/);
  assert.match(sql, /as restrictive for insert to anon, authenticated/);
  assert.match(sql, /Returning errors \(rather than raising\)/);
  assert.match(sql, /used_membership = v_member/);
  assert.match(sql, /before delete on auth.users/);
  assert.match(sql, /before delete on public.collab_v2_documents/);
  assert(!/alter table realtime.messages/i.test(sql), 'Supabase owns realtime.messages; only add policies');
  const shutdown = readFileSync(shutdownMigration, 'utf8');
  assert.match(shutdown, /^begin;$/m); assert.match(shutdown, /commit;\s*$/);
  assert(!/^\s*(?:drop table|drop schema|truncate|drop [^;]* cascade)\b/im.test(shutdown), 'Shutdown retains data');
  assert(!/\b(?:alter|drop|insert into|update|delete from)\s+(?:table\s+)?(?:public\.collab_v2_|collab_v2_private\.)/i.test(shutdown), 'No v2 mutations');
  assert(!/alter table realtime.messages/i.test(shutdown));
  assert.match(shutdown, /as restrictive for all to anon, authenticated/);
  assert.match(shutdown, /p_confirmation is distinct from 'DELETE_MY_ACCOUNT'/);
  assert.match(shutdown, /on conflict do nothing/);
  // Every legacy table/function signature must be explicitly inventoried. This
  // check is independent of the migration's catalog loops and catches omissions.
  for (const f of files.filter(f => f < '20261004')) {
    const old = readFileSync(`supabase/migrations/${f}`, 'utf8');
    for (const [,name] of old.matchAll(/create table if not exists public\.(\w+)/gi)) assert(shutdown.includes(`'${name}'`),name);
    for (const [,name,args] of old.matchAll(/create (?:or replace )?function public\.(\w+)\(([^)]*)\)/gi)) {
      if (name === 'delete_current_account') continue;
      const types = args.split(',').map(a=>a.trim()).filter(Boolean).map(a=>a.split(/\s+/)[1]);
      assert(shutdown.includes(`'public.${name}(${types.join(',')})'`),`Missing legacy signature ${name}`);
    }
  }
  for (const [,condition] of shutdown.matchAll(/\b(?:if|elsif|while)\s+([^;]*?)\bthen/gi)) {
    assert(!/(?<!\()\bcase\b/i.test(condition), 'Parenthesized CASE required');
  }
  for (const [,body] of shutdown.matchAll(/create or replace function ([\s\S]*?)end \$\$;/g)) assert.match(body,/security (invoker|definer) set search_path = ''/i);
  const config = JSON.parse(readFileSync('supabase/functions/collab-ingest/deno.json', 'utf8'));
  assert.equal(config.imports.yjs, 'npm:yjs@13.6.33');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')); assert.equal(pkg.dependencies.yjs, '13.6.33');
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')); assert.equal(lock.packages['node_modules/yjs'].version, '13.6.33');
  const workflow = readFileSync('.github/workflows/supabase-sql-test.yml', 'utf8');
  assert.match(workflow, /runs-on: ubuntu-24.04/); assert.match(workflow, /workflow_dispatch:/);
  assert(!/secrets\.|supabase (?:db|functions) (?:push|deploy)/i.test(workflow), 'CI must not reach production');
  for (const file of ['index.ts', 'handler.ts']) {
    const edge = readFileSync(`supabase/functions/collab-ingest/${file}`, 'utf8');
    assert(!/console\.(?:log|error)\(/.test(edge), 'Never log tokens, document data or credentials');
  }
  for (const path of [migration, shutdownMigration, multiUseMigration, 'scripts/testing/multi-use-invites-sql-suite.mjs',
    'supabase/verify/20261006_multi_use_invites_verify.sql', 'scripts/testing/legacy-shutdown-sql-suite.mjs',
    'scripts/test-legacy-cloud-sql.mjs', 'scripts/legacy-export-contract.test.ts',
    'supabase/tests/fixtures/legacy-export-v1.json', 'docs/LEGACY_CLOUD_SHUTDOWN.md',
    '.github/workflows/supabase-sql-test.yml', 'supabase/tests/bootstrap.sql',
    'scripts/check-collab-v2.mjs', 'scripts/test-cloud-sql.mjs', 'scripts/bench-collab-v2.mjs',
    'src/collaboration/serverValidation.ts', 'src/collaboration/serverValidation.test.ts',
    'supabase/functions/collab-ingest/index.ts', 'supabase/functions/collab-ingest/handler.ts',
    'supabase/functions/collab-ingest/handler.test.ts', 'supabase/functions/collab-ingest/deno.json', 'docs/COLLAB_V2_SERVER.md']) {
    const text = readFileSync(path,'utf8');
    assert(!/[^\r\n][\t ]+\r?$/m.test(text), `Trailing whitespace: ${path}`);
    assert(!/^(?:<<<<<<<|=======|>>>>>>>) /m.test(text), `Conflict marker: ${path}`);
  }
  return files;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  preflight(); console.log('PASS: offline v2 inventory, security boundaries, quotas, pinned Yjs, Linux-only CI');
}
