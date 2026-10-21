import wasmUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";
import { createHbSubsetter, instantiateHbResponse } from "./hbSubset";
import { checkAbort } from "./fonts";

// Loaded only by the export-time dynamic import. Cache the initialized engine,
// never document-specific results or transferred/detached source font buffers.
let engine: Promise<ReturnType<typeof createHbSubsetter>> | undefined;
export async function subsetTrueType(source: Uint8Array, codes: readonly number[], signal?: AbortSignal) {
  checkAbort(signal);
  // Shared initialization is independent of any caller's cancellation. Failed loads retry.
  engine ??= fetch(wasmUrl).then(instantiateHbResponse).then(createHbSubsetter).catch(error => { engine = undefined; throw error; });
  const subset = await engine;
  checkAbort(signal);
  // Give the browser a cancellation opportunity immediately before synchronous WASM.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  checkAbort(signal);
  const bytes = subset(source, codes);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  checkAbort(signal);
  return bytes;
}
