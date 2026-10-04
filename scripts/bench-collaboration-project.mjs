import { readFile } from "node:fs/promises";
import * as Y from "yjs";
import { loadCollabRuntime } from "./testing/load-collab-runtime.mjs";

// Anonymous fixtures only; no environment/auth/network, no production data.
const loaded = await loadCollabRuntime();
try {
  const raw = JSON.parse(await readFile("src/repositories/contract/fixtures/projects.json", "utf8")).large;
  const project = loaded.normalization.normalizeProject(raw), samples = [];
  for (let n = 0; n < 12; n++) {
    const start = performance.now(), doc = loaded.runtime.createSharedDocument(project), initialized = performance.now();
    const initial = Y.encodeStateAsUpdate(doc), other = loaded.runtime.joinSharedDocument(initial), commands = new loaded.runtime.CollaborationCommands(doc);
    let update; doc.on("update", bytes => { update = bytes; });
    const before = loaded.runtime.projectSharedDocument(doc, project), operationStart = performance.now();
    commands.applyRecipe(before, { ...before, frames: before.frames.map((frame, i) => i ? frame :
      { ...frame, positions: { ...frame.positions, [project.members[0].id]: { x: 25, y: 30 } } }) });
    const operated = performance.now();
    loaded.runtime.projectSharedDocument(doc, project); const projected = performance.now();
    Y.applyUpdate(other, update, loaded.runtime.REMOTE_ORIGIN); loaded.runtime.projectSharedDocument(other, project);
    const reflected = performance.now(), validation = loaded.validation.validateState(initial, [], update);
    samples.push({ initializeMs: initialized - start, operationMs: operated - operationStart, projectionMs: projected - operated,
      remoteReflectionMs: reflected - projected, initialBytes: initial.length, updateBytes: update.length,
      documentBytes: Y.encodeStateAsUpdate(doc).length, validationMs: validation.elapsedMs });
    commands.destroy(); doc.destroy(); other.destroy();
  }
  const timings = Object.fromEntries(["initializeMs", "operationMs", "projectionMs", "remoteReflectionMs", "validationMs"].map(key => {
    const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
    return [key, { median: +values[6].toFixed(3), p95: +values[11].toFixed(3) }];
  }));
  console.log("COLLAB_PROJECT_BENCH", JSON.stringify({ environment: "Node, Windows/local; not hosted Edge or iPad", members: project.members.length,
    scenes: project.frames.length, trials: samples.length, ...timings, initialBytes: samples[0].initialBytes, operationUpdateBytes: samples[0].updateBytes,
    afterOperationBytes: samples[0].documentBytes }));
} finally { await loaded.dispose(); }
