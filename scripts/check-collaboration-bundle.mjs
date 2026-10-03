import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

// Both builds use the real Vite configuration. No app/UI entry is changed.
const root = process.cwd();
const temporary = await mkdtemp(path.join(root, ".tmp-collaboration-build-"));
const isCollaboration = id => /\/src\/collaboration\//.test(id.replaceAll("\\", "/"));
const isYjs = id => /\/node_modules\/(yjs|lib0)\//.test(id.replaceAll("\\", "/"));
const outputs = result => {
  assert(!("on" in result), "Unexpected watch build");
  return (Array.isArray(result) ? result : [result]).flatMap(output => output.output);
};
const measure = async (outDir, chunk) => {
  const bytes = await readFile(path.join(outDir, chunk.fileName));
  return { file: chunk.fileName, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
};
const staticGraph = (entry, chunks) => {
  const result = new Set();
  const visit = file => {
    if (result.has(file)) return;
    result.add(file);
    const chunk = chunks.find(item => item.fileName === file);
    assert(chunk, `Missing static chunk ${file}`);
    chunk.imports.forEach(visit);
  };
  visit(entry.fileName);
  return [...result].map(file => chunks.find(chunk => chunk.fileName === file));
};

try {
  const normalDir = path.join(temporary, "normal");
  const normal = outputs(await build({ root, logLevel: "warn", build: { outDir: normalDir, emptyOutDir: true } }));
  const normalChunks = normal.filter(item => item.type === "chunk");
  const main = normalChunks.find(chunk => chunk.isEntry && chunk.facadeModuleId?.endsWith("index.html"));
  assert(main, "Missing production app entry");
  assert(!normalChunks.some(chunk => Object.keys(chunk.modules).some(id => isYjs(id) || isCollaboration(id))),
    "Unused collaboration must be absent from the normal production build");
  const mainSize = await measure(normalDir, main);

  const probe = path.join(temporary, "probe.js");
  const loaderPath = path.join(root, "src/collaboration/index.ts").replaceAll("\\", "/");
  await writeFile(probe, `import { loadCollaboration } from ${JSON.stringify(loaderPath)};\nexport const ready = loadCollaboration();\n`);
  const probeDir = path.join(temporary, "probe");
  const probeChunks = outputs(await build({ root, logLevel: "warn", build: {
    outDir: probeDir, emptyOutDir: true,
    rollupOptions: { input: { app: path.join(root, "index.html"), "collaboration-probe": probe } },
  } })).filter(item => item.type === "chunk");
  const probeEntry = probeChunks.find(chunk => chunk.isEntry &&
    chunk.facadeModuleId?.replaceAll("\\", "/") === probe.replaceAll("\\", "/"));
  assert(probeEntry, "Missing probe entry");
  const startup = staticGraph(probeEntry, probeChunks);
  assert(!startup.some(chunk => Object.keys(chunk.modules).some(isYjs)), "Yjs must load dynamically");
  assert(startup.some(chunk => chunk.dynamicImports.length > 0), "Missing dynamic import boundary");
  const additional = probeChunks.filter(chunk => Object.keys(chunk.modules).some(id =>
    isYjs(id) || (isCollaboration(id) && !id.replaceAll("\\", "/").endsWith("/index.ts"))));
  assert(additional.some(chunk => Object.keys(chunk.modules).some(isYjs)), "Probe must actually bundle Yjs");
  assert(!additional.some(chunk => startup.includes(chunk)), "Runtime leaked into startup graph");
  const additionalSizes = await Promise.all(additional.map(chunk => measure(probeDir, chunk)));
  console.log("COLLAB_BUNDLE", JSON.stringify({ normalMain: mainSize, additionalChunks: additionalSizes,
    normalHasCollaboration: false, probeLoadsYjsDynamically: true }));
} finally {
  const relative = path.relative(root, temporary);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative) &&
    path.basename(temporary).startsWith(".tmp-collaboration-build-"), "Unsafe cleanup target");
  await rm(temporary, { recursive: true, force: true });
}
