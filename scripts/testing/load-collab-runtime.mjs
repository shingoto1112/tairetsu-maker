import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
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
    for (const match of [...source.matchAll(/(?:from\s*|import\s*\(\s*)(["'])(\.[^"']+)\1/g)]) {
      const specifier = match[2], dependency = path.resolve(path.dirname(input), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`);
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
    const [runtime, normalization, validation] = await Promise.all([
      compile(path.join(root, "src/collaboration/runtime.ts")), compile(path.join(root, "src/project/normalizeProject.ts")),
      compile(path.join(root, "src/collaboration/serverValidation.ts")),
    ]);
    return { runtime: await import(pathToFileURL(runtime).href), normalization: await import(pathToFileURL(normalization).href),
      validation: await import(pathToFileURL(validation).href), dispose };
  } catch (error) { await dispose(); throw error; }
}
