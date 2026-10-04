import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export async function loadCollabEdge() {
  const root = process.cwd(), directory = await mkdtemp(path.join(root, '.tmp-provider-edge-'));
  try {
    const validation = await readFile('src/collaboration/serverValidation.ts', 'utf8');
    const handler = (await readFile('supabase/functions/collab-ingest/handler.ts', 'utf8'))
      .replace('../../../src/collaboration/serverValidation.ts', './validation.mjs');
    const dependencies = await Promise.all(['legacyServerValidation', 'serverSchema2', 'projectSchema', 'maintenance', 'checkpoint'].map(async name =>
      [name, await readFile(`src/collaboration/${name}.ts`, 'utf8')]));
    for (const [name, source] of [['validation', validation], ['handler', handler], ...dependencies]) {
      const resolved = source.replaceAll('./legacyServerValidation.ts', './legacyServerValidation.mjs')
        .replaceAll('./serverSchema2.ts', './serverSchema2.mjs').replaceAll('./projectSchema.ts', './projectSchema.mjs')
        .replaceAll('../../../src/collaboration/maintenance.ts', './maintenance.mjs').replaceAll('./checkpoint.ts', './checkpoint.mjs')
        .replaceAll('./serverValidation.ts', './validation.mjs');
      await writeFile(path.join(directory, `${name}.mjs`), ts.transpileModule(resolved, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText);
    }
    return await import(pathToFileURL(path.join(directory, 'handler.mjs')).href);
  } finally {
    const relative = path.relative(root, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(directory).startsWith('.tmp-provider-edge-')) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
}
