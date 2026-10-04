#!/usr/bin/env node
// Separate 11a expectation oracle. Fixed disposable Linux loopback DBs only.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { migration, preflight } from './check-collab-v2.mjs';
import { runLegacyShutdownSqlSuite } from './testing/legacy-shutdown-sql-suite.mjs';

assert.equal(process.platform,'linux','Linux CI only');
assert.equal(process.argv.length,2,'No overrides accepted');
const files=preflight();
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^PG/i.test(name)));
Object.assign(env,{PGPASSWORD:'local-test-only',PGSSLMODE:'disable',PGOPTIONS:'-c statement_timeout=20000 -c lock_timeout=10000'});
const args=['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','5432','-U','postgres'];
const execute=(db,sql)=>execFileSync('psql',[...args,'-d',db],{input:`set timezone='UTC';\n${sql}`,encoding:'utf8',env,timeout:60000,stdio:['pipe','pipe','pipe']}).trim();
// Never use or reset the main CI database. Separate databases make order tests
// independent, including defaults, publications, auth triggers and ACLs.
for (const foundationAfterShutdown of [false,true]) {
  const db=foundationAfterShutdown ? 'legacy_shutdown_before_v2_test' : 'legacy_shutdown_after_v2_test';
  assert.equal(execute('postgres',`select count(*) from pg_database where datname='${db}'`),'0','Fresh disposable database required');
  execute('postgres',`create database ${db}`);
  try {
    const run=sql=>execute(db,sql);
    const concurrent=sql=>new Promise(resolve=>{
      const child=spawn('psql',[...args,'-d',db],{env,stdio:['pipe','pipe','pipe']});
      let stdout='',stderr='';
      child.stdout.on('data',c=>{stdout+=c;}); child.stderr.on('data',c=>{stderr+=c;});
      child.on('error',e=>resolve({code:-1,stderr:e.message,stdout}));
      child.on('close',code=>resolve({code,stderr,stdout})); child.stdin.end(sql);
    });
    // Roles are cluster-wide and already created by the main SQL suite. Keep
    // every other bootstrap statement identical to its permissive defaults.
    run(readFileSync('supabase/tests/bootstrap.sql','utf8').replace(/^create role (anon|authenticated|service_role) [^;]+;\r?\n/gm,''));
    for (const file of files.filter(f=>f<'20261004')) run(readFileSync(`supabase/migrations/${file}`,'utf8'));
    run('create schema test_support');
    if (!foundationAfterShutdown) run(readFileSync(migration,'utf8'));
    await runLegacyShutdownSqlSuite({run,concurrent,foundationAfterShutdown});
  } finally {
    execute('postgres',`drop database ${db} with (force)`);
  }
}
