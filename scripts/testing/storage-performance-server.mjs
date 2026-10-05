import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { transformSync, types as t } from '@babel/core';
import { parseExpression } from '@babel/parser';
import assert from 'node:assert/strict';

// No env files, credentials or remote backend. Instrumentation is transformed
// only by this local harness, never included in the normal build.
export async function storagePerformanceServer({ port = 5179, v2 = false, profile = false } = {}) {
  assert(process.env.NODE_ENV !== 'production', 'Local browser measurements require NODE_ENV=development (DEV runtime/mock guards)');
  const baseline = process.env.PERF_BASELINE_RAIL ? readFileSync(process.env.PERF_BASELINE_RAIL, 'utf8') : undefined;
  const plugin = {
    name: 'storage-performance-profile', enforce: 'pre',
    transform(code, id) {
      if (baseline && id.endsWith('/src/components/SceneThumbnailRail.tsx')) return baseline;
      if (!profile) return;
      if (id.endsWith('/src/project/normalizeProject.ts')) {
        return code.replace('export const normalizeProject =', 'const unmeasuredNormalizeProject =') +
          '\nexport const normalizeProject = (project: Project): Project => { const t = performance.now(); try { return unmeasuredNormalizeProject(project); } finally { window.__storageProfile?.push({id:"normalize", duration:performance.now()-t}); } };';
      }
      if (id.endsWith('/src/main.tsx')) return code.replace('<App />', '<React.Profiler id="app" onRender={(id, phase, duration) => window.__storageProfile?.push({id, phase, duration})}><App /></React.Profiler>');
      if (id.endsWith('/src/App.tsx')) {
        code = 'import { Profiler as StorageProfiler } from "react";\n' + code;
        return transformSync(code, { configFile:false, babelrc:false, parserOpts:{plugins:['jsx','typescript']}, plugins:[{
          visitor: { JSXElement(path) {
            const name=path.node.openingElement.name.name;
            if (!['SceneThumbnailRail','StageCanvas','ParadeCanvas'].includes(name)) return;
            const tag=t.jsxIdentifier('StorageProfiler');
            const attrs=[t.jsxAttribute(t.jsxIdentifier('id'),t.stringLiteral(name)),
              t.jsxAttribute(t.jsxIdentifier('onRender'),t.jsxExpressionContainer(parseExpression('(id, phase, duration) => window.__storageProfile?.push({id, phase, duration})')))];
            path.replaceWith(t.jsxElement(t.jsxOpeningElement(tag,attrs),t.jsxClosingElement(tag),[path.node]));path.skip();
          } },
        }] }).code;
      }
    },
  };
  const server = await createServer({ mode: 'development', envFile: false, plugins: [plugin],
    define: { 'import.meta.env.VITE_COLLABORATION_V2': JSON.stringify(v2 ? '1' : '0'),
      'import.meta.env.VITE_SUPABASE_URL': 'undefined', 'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined' },
    server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' });
  await server.listen();
  return server;
}

if (process.argv[1]?.endsWith('storage-performance-server.mjs')) {
  const port=Number(process.env.STORAGE_TEST_PORT ?? 5179);
  const server = await storagePerformanceServer({port});
  console.log(`Local isolated test server http://127.0.0.1:${port} (V2 OFF, envFile=false)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
}
