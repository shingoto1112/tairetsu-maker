import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MODELS,
  EFFORTS,
  GEMINI_KILL_MARGIN_MS,
  MAX_TASK_LENGTH,
  MODES,
  TOOLS,
  buildCopilotArgs,
  buildGeminiArgs,
  buildPrompt,
  collectPatch,
  createWorkingCopy,
  isAllowedGeminiModel,
  usesSubagents,
  removeWorkingCopy,
  resolveCommand,
  runHelper,
} from './helper-cli.mjs';

// Asks Gemini (agy) or Copilot to read the repository and answer, or asks Gemini to
// implement a change on a copy of the working tree and return it as a patch.
//   node scripts/invoke-helper.mjs --tool gemini --task-file C:/path/to/task.txt
//   node scripts/invoke-helper.mjs --tool gemini --mode implement --task-file C:/path/to/task.txt

const DEFAULT_TIMEOUT_MINUTES = { review: 15, implement: 60 };

const { values } = parseArgs({
  options: {
    tool: { type: 'string' },
    mode: { type: 'string' },
    'patch-out': { type: 'string' },
    task: { type: 'string' },
    'task-file': { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    'timeout-minutes': { type: 'string' },
    'add-dir': { type: 'string', multiple: true },
  },
});

if (!TOOLS.includes(values.tool)) {
  throw new Error(`Specify --tool ${TOOLS.join(' or --tool ')}.`);
}
const mode = values.mode ?? 'review';
if (!MODES.includes(mode)) {
  throw new Error(`--mode must be one of: ${MODES.join(', ')}.`);
}
if (mode === 'implement' && values.tool !== 'gemini') {
  throw new Error('Only Gemini implements. Copilot runs in review mode only.');
}
if (values['patch-out'] !== undefined && mode !== 'implement') {
  throw new Error('--patch-out is for --mode implement.');
}
if (Boolean(values.task) === Boolean(values['task-file'])) {
  throw new Error('Specify exactly one of --task or --task-file.');
}
if (values.model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.model)) {
  throw new Error('--model must be a model slug such as gemini-4-carbon-high.');
}
if (values.tool === 'gemini' && values.model !== undefined && !isAllowedGeminiModel(values.model)) {
  throw new Error(
    `${values.model} thinks too little to be accurate. ` +
    'Use gemini-4-hydrogen-xhigh, gemini-4-carbon-high or gemini-4-argon-high.',
  );
}
if (values.effort !== undefined && !EFFORTS[values.tool].includes(values.effort)) {
  throw new Error(
    values.tool === 'gemini'
      ? 'Gemini takes its thinking level from the model name (such as gemini-4-hydrogen-xhigh), not --effort.'
      : `--effort for ${values.tool} must be one of: ${EFFORTS[values.tool].join(', ')}.`,
  );
}
const timeoutMinutes = values['timeout-minutes'] === undefined
  ? DEFAULT_TIMEOUT_MINUTES[mode]
  : Number(values['timeout-minutes']);
if (!(timeoutMinutes > 0 && timeoutMinutes <= 120)) {
  throw new Error('--timeout-minutes must be a number above 0 and at most 120.');
}
const addDirs = (values['add-dir'] ?? []).map((directory) => path.resolve(directory));
for (const directory of addDirs) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`--add-dir is not a directory: ${directory}`);
  }
}

const task = values['task-file']
  ? await readFile(values['task-file'], 'utf8')
  : values.task;
if (!task.trim()) {
  throw new Error('The task must not be empty.');
}
if (task.length > MAX_TASK_LENGTH) {
  throw new Error(
    `The task is ${task.length} characters; the limit is ${MAX_TASK_LENGTH}. ` +
    'Put long material in a file and name the file in the task.',
  );
}

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const timeoutSeconds = Math.round(timeoutMinutes * 60);
const model = values.model ?? DEFAULT_MODELS[values.tool];
const options = {
  prompt: buildPrompt(task, { allowSubagents: usesSubagents(model), mode }),
  model,
  effort: values.effort,
  timeoutSeconds,
  addDirs,
  mode,
};

const { command, prefixArgs, requiredFile } = resolveCommand(values.tool);
if (requiredFile && !existsSync(requiredFile)) {
  throw new Error(`Copilot CLI was not found at ${requiredFile}. Install it with: npm install -g @github/copilot`);
}

const isGemini = values.tool === 'gemini';
const copy = mode === 'implement' ? createWorkingCopy(projectDirectory) : null;
try {
  process.exitCode = await runHelper({
    tool: values.tool,
    command,
    args: [...prefixArgs, ...(isGemini ? buildGeminiArgs(options) : buildCopilotArgs(options))],
    projectDirectory,
    cwd: copy?.directory ?? projectDirectory,
    killAfterMs: timeoutSeconds * 1000 + (isGemini ? GEMINI_KILL_MARGIN_MS : 0),
  });
  if (copy) {
    // The patch is kept even when the run failed or timed out, so partial work can be reviewed.
    const { patch, stat } = collectPatch(copy.directory, copy.baseline);
    const patchPath = path.resolve(values['patch-out']
      ?? path.join(os.tmpdir(), 'tairetsu-helper', `gemini-${new Date().toISOString().replace(/[:.]/g, '-')}.patch`));
    mkdirSync(path.dirname(patchPath), { recursive: true });
    writeFileSync(patchPath, patch);
    console.log(`\n[invoke-helper] Patch: ${patchPath}`);
    console.log(patch ? stat.trimEnd() : '[invoke-helper] No changes.');
    console.log('[invoke-helper] Review it, then apply with: git -c core.autocrlf=false apply --check <patch> && git -c core.autocrlf=false apply <patch>');
  }
} finally {
  if (copy) {
    removeWorkingCopy(copy.directory);
  }
}
