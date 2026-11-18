import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const origin = 'http://127.0.0.1:5196';
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5196, strictPort: true }, logLevel: 'warn' });
await vite.listen(); console.log('Owned regression runner PID', process.pid);
const run = script => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, REPOSITORY_TEST_ORIGIN: origin,
    ROUND12_SHOT_DIR: process.env.ROUND12_SHOT_DIR ?? path.join(os.tmpdir(), 'tairetsu-shots-annotation-regressions') } });
  console.log('Owned test PID', child.pid, script); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
});
try {
  const scripts = process.argv.slice(2);
  for (const script of scripts.length ? scripts : ['scripts/test-collaboration-ui-browser.mjs', 'scripts/test-shared-session-app-browser.mjs',
    'scripts/test-collaboration-lifecycle-browser.mjs', 'scripts/test-build22-browser.mjs']) await run(script);
} finally { await vite.close(); }
