import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_MODELS,
  GEMINI_IMPLEMENT_SETTINGS,
  GEMINI_SETTINGS,
  IMPLEMENT_PREAMBLE,
  collectPatch,
  createWorkingCopy,
  removeWorkingCopy,
  PREAMBLE,
  buildCopilotArgs,
  buildGeminiArgs,
  buildPrompt,
  compareFingerprints,
  isAllowedGeminiModel,
  linkNodeModules,
  resolveCommand,
  unlinkNodeModules,
  toRepoRelative,
  usesSubagents,
} from './helper-cli.mjs';

const project = 'C:\\Users\\someone\\OneDrive\\ドキュメント\\ChatGPT\\隊列メーカー\\ipad-ui\\';

test('the prompt puts the preamble before the task', () => {
  const prompt = buildPrompt('  場所を探して  \n');
  assert.ok(prompt.startsWith(PREAMBLE));
  assert.ok(prompt.endsWith('\n場所を探して\n'));
  assert.match(prompt, /補助のエージェントは使わず/);
});

test('only Orchestrator models are allowed subagents', () => {
  assert.ok(usesSubagents('gemini-pro-orchestrator'));
  assert.ok(usesSubagents('gemini-pro-orchestrator-argon'));
  assert.ok(!usesSubagents('gemini-4-carbon-high'));
  const prompt = buildPrompt('x', { allowSubagents: true });
  assert.doesNotMatch(prompt, /補助のエージェントは使わず/);
  assert.match(prompt, /読むだけにしてください/);
});

test('Gemini runs with writes, MCP and gh denied, in the sandbox', () => {
  const args = buildGeminiArgs({ prompt: '-p looks like a flag', model: 'gemini-3.8-flash-high', timeoutSeconds: 900 });
  assert.equal(args[0], '--print=-p looks like a flag');
  assert.deepEqual(args.slice(args.indexOf('--print-timeout'), args.indexOf('--print-timeout') + 2), ['--print-timeout', '900s']);
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.deepEqual(settings, GEMINI_SETTINGS);
  assert.equal(settings.enableTerminalSandbox, true);
  assert.equal(settings.agentMode, '');
  for (const rule of ['write_file(*)', 'mcp(*)', 'execute_url(*)']) {
    assert.ok(settings.permissions.deny.includes(rule), rule);
  }
  // agy refuses --effort together with a model name that carries the thinking level.
  assert.ok(!args.includes('--effort'));
});

test('the gh and git push rules match commands behind the PowerShell preamble', () => {
  const patterns = GEMINI_SETTINGS.permissions.deny
    .map((rule) => rule.match(/^command\(regex:(.*)\)$/)?.[1])
    .filter(Boolean)
    .map((source) => new RegExp(`^${source}$`));
  const denied = (command) => patterns.some((pattern) => pattern.test(command));
  const preamble = 'try { [Console]::OutputEncoding = $OutputEncoding } catch {}; ';
  assert.ok(denied('gh --version'));
  assert.ok(denied(`${preamble}gh run rerun 1`));
  assert.ok(denied('C:\\tools\\gh.exe pr create'));
  assert.ok(denied(`${preamble}git push origin main`));
  assert.ok(!denied('git --version'));
  assert.ok(!denied(`${preamble}git log --oneline -5`));
  assert.ok(!denied('Select-String -Path app\\*.swift -Pattern ghost'));
});

test('Gemini passes extra directories when given', () => {
  const args = buildGeminiArgs({ prompt: 'x', model: 'm', timeoutSeconds: 60, addDirs: ['C:\\logs'] });
  assert.deepEqual(args.slice(-2), ['--add-dir', 'C:\\logs']);
});

test('only Gemini models that think enough are allowed', () => {
  for (const model of ['gemini-4-hydrogen-xhigh', 'gemini-4-hydrogen-high', 'gemini-4-carbon-high', 'gemini-4-argon-high', 'gemini-pro-orchestrator']) {
    assert.ok(isAllowedGeminiModel(model), model);
  }
  for (const model of ['gemini-4-hydrogen-medium', 'gemini-4-carbon-low', 'gemini-3.8-flash-high']) {
    assert.ok(!isAllowedGeminiModel(model), model);
  }
  assert.ok(isAllowedGeminiModel(DEFAULT_MODELS.gemini));
});

test('Copilot ignores CLAUDE.md and denies writes, commands and memory', () => {
  const args = buildCopilotArgs({ prompt: 'x', model: 'auto' });
  assert.equal(args[0], '--prompt=x');
  assert.ok(args.includes('--no-custom-instructions'));
  assert.ok(args.includes('--no-ask-user'));
  for (const tool of ['write', 'shell', 'memory']) {
    const index = args.findIndex((arg, i) => arg === '--deny-tool' && args[i + 1] === tool);
    assert.notEqual(index, -1, tool);
  }
  assert.ok(!args.includes('--allow-all') && !args.includes('--yolo') && !args.includes('--allow-all-tools'));
});

test('Copilot passes effort and extra directories when given', () => {
  const args = buildCopilotArgs({ prompt: 'x', model: 'auto', effort: 'low', addDirs: ['C:\\logs'] });
  assert.deepEqual(args.slice(-4), ['--reasoning-effort', 'low', '--add-dir', 'C:\\logs']);
});

test('Copilot on Windows runs the npm loader with node, not through cmd.exe', () => {
  const resolved = resolveCommand('copilot', {
    env: { APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' },
    platform: 'win32',
    nodePath: 'C:\\node\\node.exe',
  });
  assert.equal(resolved.command, 'C:\\node\\node.exe');
  assert.match(resolved.prefixArgs[0], /npm[\\/]node_modules[\\/]@github[\\/]copilot[\\/]npm-loader\.js$/);
  assert.equal(resolved.requiredFile, resolved.prefixArgs[0]);
  assert.equal(resolveCommand('gemini', { platform: 'win32' }).command, 'agy');
});

test('project paths become repository-relative', () => {
  const forward = project.replaceAll('\\', '/').replace(/\/$/, '');
  const text = [
    `${project}src\\utils\\printLayout.ts:42`,
    `[a.tsx](file:///${forward}/src/a.tsx)`,
    `[b.tsx](file:///${encodeURI(forward)}/src/b.tsx)`,
    `${forward.replace('C:', 'c:')}/ios/App/x.swift:7`,
    `root: ${project.slice(0, -1)}`,
  ].join('\n');
  assert.equal(toRepoRelative(text, project), [
    'src\\utils\\printLayout.ts:42',
    '[a.tsx](src/a.tsx)',
    '[b.tsx](src/b.tsx)',
    'ios/App/x.swift:7',
    'root: .',
  ].join('\n'));
});

test('a sibling folder that shares the prefix is left alone', () => {
  const sibling = `${project.slice(0, -1)}-old\\memo.md`;
  assert.equal(toRepoRelative(sibling, project), sibling);
});

test('the preambles describe this app and keep npm installs out of the copy', () => {
  for (const preamble of [PREAMBLE, IMPLEMENT_PREAMBLE]) {
    assert.match(preamble, /隊列メーカー/);
    assert.doesNotMatch(preamble, /clipboard/i);
  }
  assert.match(IMPLEMENT_PREAMBLE, /npm install、npm ci/);
  assert.match(IMPLEMENT_PREAMBLE, /npm run typecheck/);
});

test('implement mode uses its own preamble and settings without allowing every command', () => {
  const prompt = buildPrompt('直して', { mode: 'implement' });
  assert.ok(prompt.startsWith(IMPLEMENT_PREAMBLE));
  assert.match(prompt, /補助のエージェントは使わず、自分で作業/);
  assert.doesNotMatch(buildPrompt('x', { mode: 'implement', allowSubagents: true }), /補助のエージェントは使わず/);
  const args = buildGeminiArgs({ prompt: 'x', model: 'm', timeoutSeconds: 60, mode: 'implement' });
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.deepEqual(settings, GEMINI_IMPLEMENT_SETTINGS);
  // An allow rule for every command made agy ignore the deny rules (tested 2026-11-18).
  assert.ok(!settings.permissions.allow.some((rule) => rule.startsWith('command(')));
  assert.ok(settings.permissions.deny.some((rule) => rule.includes('gh')));
  assert.ok(settings.permissions.deny.some((rule) => rule.includes('push')));
});

test('a working copy returns its changes, new files included, as a patch', () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'helper-cli-test-'));
  try {
    const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: project, encoding: 'utf8' });
    git('init', '-q');
    writeFileSync(path.join(project, '.gitignore'), 'ignored.txt\n');
    writeFileSync(path.join(project, 'tracked.txt'), 'one\n');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@invalid', 'commit', '-q', '-m', 'init');
    writeFileSync(path.join(project, 'tracked.txt'), 'one\ntwo\n'); // Uncommitted work is copied.
    writeFileSync(path.join(project, 'untracked.txt'), 'new\n');
    writeFileSync(path.join(project, 'ignored.txt'), 'secret\n');

    const copy = createWorkingCopy(project);
    try {
      assert.ok(existsSync(path.join(copy.directory, 'untracked.txt')));
      assert.ok(!existsSync(path.join(copy.directory, 'ignored.txt')));
      writeFileSync(path.join(copy.directory, 'tracked.txt'), 'one\ntwo\nthree\n');
      mkdirSync(path.join(copy.directory, 'sub'));
      writeFileSync(path.join(copy.directory, 'sub', 'added.txt'), 'added\n');
      const { patch } = collectPatch(copy.directory, copy.baseline);
      assert.match(patch, /\+three/);
      assert.doesNotMatch(patch, /\+two/); // Already in the working tree before the copy.
      assert.match(patch, /new file mode[\s\S]*\+added/);
      writeFileSync(path.join(project, 'change.patch'), patch);
      git('apply', '--check', 'change.patch');
    } finally {
      removeWorkingCopy(copy.directory);
    }
    assert.ok(!existsSync(copy.directory));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a working copy links installed packages, keeps caches apart and never deletes the real packages', () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'helper-cli-test-'));
  try {
    const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: project, encoding: 'utf8' });
    git('init', '-q');
    writeFileSync(path.join(project, '.gitignore'), 'node_modules\n');
    writeFileSync(path.join(project, 'index.ts'), 'export {};\n');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@invalid', 'commit', '-q', '-m', 'init');
    const installed = path.join(project, 'node_modules');
    for (const name of ['pkg', '@scope', '.bin', '.vite']) {
      mkdirSync(path.join(installed, name), { recursive: true });
    }
    writeFileSync(path.join(installed, 'pkg', 'index.js'), 'module.exports = 1;\n');
    writeFileSync(path.join(installed, '.vite', 'cache.json'), '{}\n');
    writeFileSync(path.join(installed, '.package-lock.json'), '{}\n');

    const copy = createWorkingCopy(project);
    const linked = path.join(copy.directory, 'node_modules');
    try {
      for (const name of ['pkg', '@scope', '.bin']) {
        assert.ok(lstatSync(path.join(linked, name)).isSymbolicLink(), name);
      }
      assert.equal(readFileSync(path.join(linked, 'pkg', 'index.js'), 'utf8'), 'module.exports = 1;\n');
      // Caches and loose files are not shared, so the copy's builds write only into the copy.
      assert.ok(!existsSync(path.join(linked, '.vite')));
      assert.ok(!existsSync(path.join(linked, '.package-lock.json')));
      mkdirSync(path.join(linked, '.vite'));
      writeFileSync(path.join(linked, '.vite', 'copy-cache.json'), '{}\n');
      writeFileSync(path.join(copy.directory, 'index.ts'), 'export const x = 1;\n');
      const { patch } = collectPatch(copy.directory, copy.baseline);
      assert.match(patch, /\+export const x = 1;/);
      assert.doesNotMatch(patch, /node_modules/);
    } finally {
      removeWorkingCopy(copy.directory);
    }
    assert.ok(!existsSync(copy.directory));
    assert.equal(readFileSync(path.join(installed, 'pkg', 'index.js'), 'utf8'), 'module.exports = 1;\n');
    assert.ok(existsSync(path.join(installed, '.vite', 'cache.json')));
    assert.ok(!existsSync(path.join(installed, '.vite', 'copy-cache.json')));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('removing the links refuses to leave one behind and skips real folders', () => {
  const copy = mkdtempSync(path.join(os.tmpdir(), 'helper-cli-test-'));
  const outside = mkdtempSync(path.join(os.tmpdir(), 'helper-cli-test-'));
  try {
    writeFileSync(path.join(outside, 'keep.txt'), 'keep\n');
    mkdirSync(path.join(copy, 'node_modules', '.vite'), { recursive: true });
    symlinkSync(outside, path.join(copy, 'node_modules', 'pkg'), 'junction');
    unlinkNodeModules(copy);
    assert.ok(!existsSync(path.join(copy, 'node_modules', 'pkg')));
    assert.ok(existsSync(path.join(copy, 'node_modules', '.vite')));
    assert.ok(existsSync(path.join(outside, 'keep.txt')));
    assert.equal(linkNodeModules(path.join(copy, 'missing'), copy), 0);
  } finally {
    rmSync(copy, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('fingerprints report added, removed and changed files', () => {
  const before = new Map([['a', '1:1'], ['b', '2:2'], ['c', '3:3']]);
  const after = new Map([['a', '1:1'], ['b', '2:9'], ['d', '4:4']]);
  assert.deepEqual(compareFingerprints(before, after), ['b', 'c', 'd']);
  assert.deepEqual(compareFingerprints(before, new Map(before)), []);
});
