import { createServer } from 'vite';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Own disposable Vite, V2 OFF, no .env. Original scripts remain compatible
// with an already-running 5179 server; temporary copies change only that URL.
const origin = 'http://127.0.0.1:5185';
process.env.VITE_COLLABORATION_V2 = '0';
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5185, strictPort: true }, logLevel: 'warn' });
const env = { ...process.env, REPOSITORY_TEST_ORIGIN: origin, COLLABORATION_TEST_ORIGIN: origin };
const run = (file, args, shell = false) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { env, stdio: 'inherit', shell });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${file} ${args.join(' ')}: exit ${code}`)));
});
const scripts = process.argv.includes('--repository-only') ? [] : ['test-collaboration-provider-browser', 'test-collaboration-app-browser', 'test-collaboration-lifecycle-browser', 'test-app-storage-browser', 'test-build22-browser'];
try {
  await vite.listen();
  for (const name of scripts) {
    const temporary = path.resolve('scripts', `.tmp-8a2-${name}.mjs`);
    try {
      const source = await readFile(`scripts/${name}.mjs`, 'utf8');
      await writeFile(temporary, source.replaceAll('http://127.0.0.1:5179', origin));
      console.log(`RUN ${name} (isolated V2 OFF server)`);
      await run(process.execPath, [temporary]);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:repository:browser'], process.platform === 'win32');
  console.log(`LOCAL_REGRESSION_BROWSER: PASS (${scripts.length + 1} scripts, disposable V2 OFF server)`);
} finally { await vite.close(); }
