import { mkdtemp, readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/** Offline CLI only. Transpile the actual relative module graph with installed
 * TypeScript; works on Linux/Windows without changing package/typecheck settings. */
export async function loadCollabRuntime() {
  const root = process.cwd(), directory = await mkdtemp(path.join(root, ".tmp-collab-runtime-")), seen = new Map();
  const compile = async input => {
    const relative = path.relative(root, input);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Runtime source outside workspace");
    const output = path.join(directory, relative.replace(/\.ts$/, ".mjs"));
    if (seen.has(input)) return output;
    seen.set(input, output);
    let source = ts.transpileModule(await readFile(input, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    // Vite replaces import.meta.env at build time; plain Node has none. Use a
    // production-like, flag-OFF environment for this offline CLI.
    source = source.replaceAll("import.meta.env", '({ DEV: false, PROD: true, MODE: "test" })');
    for (const match of [...source.matchAll(/(?:from\s*|import\s*\(\s*)(["'])(\.[^"']+)\1/g)]) {
      const specifier = match[2]; let dependency = path.resolve(path.dirname(input), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
      try { await access(dependency); } catch { dependency = path.resolve(path.dirname(input), specifier, 'index.ts'); }
      const target = await compile(dependency);
      let newSpecifier = path.relative(path.dirname(output), target).replaceAll("\\", "/");
      if (!newSpecifier.startsWith(".")) newSpecifier = `./${newSpecifier}`;
      source = source.replaceAll(`${match[1]}${specifier}${match[1]}`, `${match[1]}${newSpecifier}${match[1]}`);
    }
    await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, source);
    return output;
  };
  const dispose = async () => {
    const relative = path.relative(root, directory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(directory).startsWith(".tmp-collab-runtime-")) throw new Error("Unsafe cleanup");
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const [runtime, normalization, validation, maintenance, restoration] = await Promise.all([
      compile(path.join(root, "src/collaboration/runtime.ts")), compile(path.join(root, "src/project/normalizeProject.ts")),
      compile(path.join(root, "src/collaboration/serverValidation.ts")),
      compile(path.join(root, "src/collaboration/maintenance.ts")),
      compile(path.join(root, "src/collaboration/restore.ts")),
    ]);
    return { runtime: await import(pathToFileURL(runtime).href), normalization: await import(pathToFileURL(normalization).href),
      validation: await import(pathToFileURL(validation).href), maintenance: await import(pathToFileURL(maintenance).href),
      restoration: await import(pathToFileURL(restoration).href),
      moduleUrls: [runtime, normalization, validation, maintenance, restoration].map(p => pathToFileURL(p).href),
      loadSource: async relative => import(pathToFileURL(await compile(path.resolve(root, relative))).href), dispose };
  } catch (error) { await dispose(); throw error; }
}
