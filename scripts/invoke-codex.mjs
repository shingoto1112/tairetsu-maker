import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findUsageLimit } from './codex-limit.mjs';

// The 5-hour window plus slack. A reset further away is the weekly limit, which
// is reported to the caller instead of being waited out.
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
// Codex prints the reset time without seconds.
const RESET_MARGIN_MS = 60 * 1000;
const UNKNOWN_RESET_RETRY_MS = 15 * 60 * 1000;
const LIMIT_EXIT_CODE = 75;
const OUTPUT_TAIL_LENGTH = 32 * 1024;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const SESSION_ID_PATTERN = /^session id: ([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\s*$/m;
const RESUME_PROMPT = [
  '前回の実行はCodexの利用制限で中断された。このセッションで依頼されたタスクを続ける。',
  '最初に git status と差分で現在の状態を確認し、済んでいる操作を繰り返さずに残りを完了すること。',
].join('\n');

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    task: { type: 'string' },
    'task-file': { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    'no-wait': { type: 'boolean' },
  },
});

if (!['review', 'implement'].includes(values.mode)) {
  throw new Error('Specify --mode review or --mode implement.');
}
if (Boolean(values.task) === Boolean(values['task-file'])) {
  throw new Error('Specify exactly one of --task or --task-file.');
}
// These two values are placed on the cmd.exe command line, so they are restricted
// to characters the shell does not interpret.
if (values.model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.model)) {
  throw new Error('--model must be a model slug such as gpt-6.1-sol.');
}
if (values.effort !== undefined && !EFFORTS.includes(values.effort)) {
  throw new Error(`--effort must be one of: ${EFFORTS.join(', ')}.`);
}

const task = values['task-file']
  ? await readFile(values['task-file'], 'utf8')
  : values.task;
if (!task.trim()) {
  throw new Error('The task must not be empty.');
}

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const isReview = values.mode === 'review';
const commonArgs = ['exec', '--sandbox', isReview ? 'read-only' : 'workspace-write', '--color', 'never'];
if (values.model) {
  commonArgs.push('--model', values.model);
}
if (values.effort) {
  commonArgs.push('--config', `model_reasoning_effort=${values.effort}`);
}
// A review changes nothing, so it leaves no session behind and is simply run
// again after a limit. An implementation keeps its session so that it can be
// resumed with the record of what it already did.
const freshArgs = [...commonArgs, ...(isReview ? ['--ephemeral'] : []), '-'];

const isWindows = process.platform === 'win32';
const environment = { ...process.env };

// A standalone CLI must discover its own runtime instead of reusing the desktop
// host's private IPC transport and packaged shell paths inherited by Claude.
for (const name of [
  'CODEX_APP_RUNTIME_CLI_PATH',
  'CODEX_APP_TOOLS_PIPE_PATH',
  'CODEX_WINDOWS_REGISTERED_CORE',
  'CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY',
  'CODEX_SHELL',
]) {
  delete environment[name];
}

/**
 * Runs Codex once, echoing its output. Resolves with the exit code, the output
 * tail, when the last output arrived, and the session id from the header.
 */
function runCodex(args, prompt) {
  return new Promise((resolve) => {
    let failed = false;
    let head = '';
    let tail = '';
    let lastOutputAt = new Date();

    // Only validated arguments enter cmd.exe. Task content travels through UTF-8 stdin.
    const worker = spawn(
      isWindows ? (process.env.ComSpec || 'cmd.exe') : 'codex',
      isWindows ? ['/d', '/s', '/c', `codex.cmd ${args.join(' ')}`] : args,
      {
        cwd: projectDirectory,
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    for (const [source, destination] of [[worker.stdout, process.stdout], [worker.stderr, process.stderr]]) {
      source.setEncoding('utf8');
      // pipe() pauses the child's stream while the destination is slow.
      source.pipe(destination, { end: false });
      source.on('data', (chunk) => {
        lastOutputAt = new Date();
        // The session id is in the header, ahead of the echoed task.
        if (head.length < 4096) {
          head += chunk;
        }
        tail = (tail + chunk).slice(-OUTPUT_TAIL_LENGTH);
      });
    }

    worker.on('error', (error) => {
      console.error(`Could not start Codex: ${error.message}`);
      failed = true;
    });
    worker.stdin.on('error', (error) => {
      console.error(`Could not send the task to Codex: ${error.message}`);
      failed = true;
    });
    worker.on('close', (code) => {
      resolve({
        code: failed ? 1 : (code ?? 1),
        tail,
        lastOutputAt,
        sessionId: head.match(SESSION_ID_PATTERN)?.[1] ?? null,
      });
    });
    worker.stdin.end(prompt, 'utf8');
  });
}

/** Waits against the wall clock, so a sleeping PC resumes promptly after it wakes. */
async function sleepUntil(time) {
  while (Date.now() < time) {
    await sleep(Math.min(30 * 1000, time - Date.now()));
  }
}

let firstLimitAt = null;
let sessionId = null;

for (;;) {
  const resuming = sessionId !== null;
  const result = resuming
    ? await runCodex([...commonArgs, 'resume', sessionId, '-'], RESUME_PROMPT)
    : await runCodex(freshArgs, task);
  if (result.code === 0) {
    break;
  }

  const limit = findUsageLimit(result.tail, result.lastOutputAt);
  if (!limit) {
    process.exitCode = result.code;
    break;
  }
  if (!isReview) {
    sessionId = result.sessionId ?? sessionId;
    if (!sessionId) {
      // Without the session, a second run could repeat work the first already did.
      console.error('[invoke-codex] Codex usage limit reached, but no session id was found to resume.');
      process.exitCode = LIMIT_EXIT_CODE;
      break;
    }
  }

  firstLimitAt ??= Date.now();
  // A reset time well in the past means the time was misread, so it is treated as unknown.
  const resetIsUsable = limit.resetAt && limit.resetAt.getTime() > Date.now() - RESET_MARGIN_MS;
  const resumeAt = resetIsUsable
    ? Math.max(Date.now(), limit.resetAt.getTime()) + RESET_MARGIN_MS
    : Date.now() + UNKNOWN_RESET_RETRY_MS;
  const resetText = limit.resetAt ? limit.resetAt.toLocaleString('ja-JP') : 'unknown';
  const sessionText = sessionId ? ` Session: ${sessionId}.` : '';

  if (values['no-wait'] || resumeAt - firstLimitAt > MAX_WAIT_MS) {
    console.error(
      `[invoke-codex] Codex usage limit reached. Reset: ${resetText}.${sessionText} Not waiting.`,
    );
    process.exitCode = LIMIT_EXIT_CODE;
    break;
  }

  console.error(
    `[invoke-codex] Codex usage limit reached. Reset: ${resetText}.${sessionText} ` +
    `Continuing at ${new Date(resumeAt).toLocaleString('ja-JP')}.`,
  );
  await sleepUntil(resumeAt);
  console.error(sessionId ? '[invoke-codex] Resuming the session.' : '[invoke-codex] Running the task again.');
}
