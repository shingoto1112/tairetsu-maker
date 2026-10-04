import * as Y from "yjs";
// @ts-ignore Deno requires explicit TS extensions; Vite/Vitest resolve them.
import { validateState as validateLegacy, assertState as assertLegacyDocument } from "./legacyServerValidation.ts";
// @ts-ignore Deno source import.
import { assertFullState } from "./serverSchema2.ts";

/** Pure schema-2 server validator. No repository, browser UI, or Deno dependencies.
 * Deno maps the bare import to npm:yjs@13.6.33; Vitest uses the same installed version.
 * Schema 1 remains readable for the historical storage/provider contract fixture.
 */
export const SERVER_LIMITS = Object.freeze({ updateBytes: 262144, snapshotBytes: 8388608,
  logBytes: 4194304, entries: 4096, members: 500, scenes: 200, positions: 100000,
  structs: 100000, clients: 1024, validationMs: 1000 });
export class ValidationError extends Error {
  constructor(public readonly code: string) { super(code); }
}
function fail(code = "INVALID_UPDATE"): never { throw new ValidationError(code); }
const encoder = new TextEncoder();
export function validId(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 255 || encoder.encode(value).length > 255 ||
    /[\\/:\u0000-\u001f\u007f-\u009f]/.test(value) || value.includes("..")) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = value.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function encodeBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function decodeBase64(value: unknown, max: number): Uint8Array {
  if (typeof value !== "string" || !value || value.length > Math.ceil(max / 3) * 4) fail("QUOTA_EXCEEDED");
  if (value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail();
  let text: string;
  try { text = atob(value); } catch { return fail(); }
  if (text.length > max) fail("QUOTA_EXCEEDED");
  if (btoa(text) !== value) fail();
  // Uint8Array.from(string, mapper) first builds an iterable value list in V8.
  // At 8MiB that transient list alone can exceed an Edge worker's memory limit.
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Bounded V1 wire scanner, BEFORE Yjs allocates arrays or reads recursive any.
 * Allow bounded plain JSON and Array/Map/Text wire content. Reject subdocs,
 * XML, unknown roots, trailing bytes and oversized declared counts even
 * when they would be deleted/hidden by the final projection. Pinned Yjs wire format.
 */
export function inspectWire(bytes: Uint8Array): void {
  let offset = 0, structCount = 0, deleteCount = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const byte = () => { if (offset >= bytes.length) return fail(); return bytes[offset++]; };
  const uint = () => {
    let n = 0, factor = 1;
    for (let i = 0; i < 8; i++) {
      const b = byte(); n += (b & 127) * factor;
      if (!Number.isSafeInteger(n)) fail();
      if (!(b & 128)) return n;
      factor *= 128;
    }
    return fail();
  };
  const bounded = (max: number) => { const n = uint(); if (n > max) fail("QUOTA_EXCEEDED"); return n; };
  const text = (max = 255) => {
    const length = bounded(max);
    if (offset + length > bytes.length) return fail();
    let s: string;
    try { s = decoder.decode(bytes.subarray(offset, offset + length)); }
    catch { return fail(); }
    offset += length; return s;
  };
  const number = (tag: number) => {
    if (tag === 125) {
      let b = byte(), n = b & 63, factor = 64; const sign = b & 64 ? -1 : 1;
      for (let i = 0; b & 128; i++) {
        if (i >= 8) return fail();
        b = byte(); n += (b & 127) * factor; factor *= 128;
      }
      if (!Number.isSafeInteger(n)) fail(); return sign * n;
    }
    if (tag !== 123 && tag !== 124) return fail();
    const size = tag === 123 ? 8 : 4;
    if (offset + size > bytes.length) return fail();
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size);
    const n = size === 8 ? view.getFloat64(0) : view.getFloat32(0); offset += size;
    if (!Number.isFinite(n)) fail(); return n;
  };
  let values = 0;
  const any = (depth = 0): void => {
    if (depth > 12 || ++values > SERVER_LIMITS.structs) fail("QUOTA_EXCEEDED");
    const tag = byte();
    if ([126, 120, 121].includes(tag)) return;
    if (tag === 119) { text(262144); return; }
    if (tag === 125 || tag === 124 || tag === 123) { number(tag); return; }
    if (tag === 117) { const count = bounded(4096); for (let i = 0; i < count; i++) any(depth + 1); return; }
    if (tag !== 118) return fail();
    const count = bounded(128), keys = new Set<string>();
    for (let i = 0; i < count; i++) {
      const key = text();
      if (keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) fail();
      keys.add(key); any(depth + 1);
    }
  };
  const id = () => { uint(); uint(); };
  const clients = bounded(SERVER_LIMITS.clients);
  const seen = new Set<number>();
  for (let i = 0; i < clients; i++) {
    const count = bounded(SERVER_LIMITS.structs); structCount += count;
    if (structCount > SERVER_LIMITS.structs) fail("QUOTA_EXCEEDED");
    const client = uint(); if (seen.has(client)) fail(); seen.add(client);
    let clock = uint();
    for (let j = 0; j < count; j++) {
      const info = byte(), ref = info & 31;
      let length = 1;
      if (ref === 0 || info === 10) { length = bounded(1000000); if (!length) fail(); }
      else {
        if (![1, 4, 7, 8].includes(ref)) fail();
        if (info & 128) id();
        if (info & 64) id();
        if (!(info & 192)) {
          const parentInfo = uint();
          if (parentInfo === 1) { if (!['metadata', 'settings', 'members', 'stageObjects', 'scenes', 'memberGroups', 'objectGroups', 'movementPlans', 'movementPaths', 'orders', 'tombstones'].includes(text())) fail(); }
          else if (parentInfo === 0) id(); else fail();
          // Composite map keys contain multiple independently bounded IDs.
          // The closed schema validator checks their canonical tuple shape.
          if (info & 32) { const key = text(2048); if (!key || /[\u0000-\u001f]/.test(key)) fail(); }
        }
        if (ref === 1) { length = bounded(1000000); if (!length) fail(); }
        if (ref === 7 && ![0, 1, 2].includes(uint())) fail(); // Array, Map, Text only
        if (ref === 4) { length = text(262144).length; if (!length) fail(); }
        if (ref === 8) {
          length = bounded(SERVER_LIMITS.structs); if (!length) fail();
          for (let k = 0; k < length; k++) any();
        }
      }
      clock += length; if (!Number.isSafeInteger(clock)) fail();
    }
  }
  const dsClients = bounded(SERVER_LIMITS.clients);
  for (let i = 0; i < dsClients; i++) {
    uint(); const ranges = bounded(SERVER_LIMITS.structs); deleteCount += ranges;
    if (deleteCount > SERVER_LIMITS.structs) fail("QUOTA_EXCEEDED");
    for (let j = 0; j < ranges; j++) { const clock = uint(), length = uint(); if (!length || !Number.isSafeInteger(clock + length)) fail(); }
  }
  if (offset !== bytes.length) fail();
}

/** Internal validation boundary shared with maintenance. Checks hidden Items as
 * well as the visible closed schema; callers must retain gc:false until checked. */
export function assertValidatedDocument(doc: Y.Doc, expectedSchema: 1 | 2): void {
  if (doc.store.pendingStructs || doc.store.pendingDs) fail('MISSING_DEPENDENCIES');
  if (doc.store.clients.size > SERVER_LIMITS.clients) fail('QUOTA_EXCEEDED');
  let items = 0;
  for (const structs of doc.store.clients.values()) for (const struct of structs) {
    items += struct.length;
    if (items > SERVER_LIMITS.structs) fail('QUOTA_EXCEEDED');
  }
  if (doc.getMap('metadata').get('schemaVersion') !== expectedSchema) fail('UNSUPPORTED_SCHEMA');
  try {
    if (expectedSchema === 2) assertFullState(doc);
    else assertLegacyDocument(doc);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    fail(error instanceof Error && ['QUOTA_EXCEEDED','UNSUPPORTED_SCHEMA','MISSING_DEPENDENCIES'].includes(error.message) ? error.message : 'INVALID_UPDATE');
  }
}

export function assertResolvedDocument(doc: Y.Doc): void {
  if (doc.store.pendingStructs || doc.store.pendingDs) fail('MISSING_DEPENDENCIES');
}

/** A stable description of clocks/deletions, confined to the pinned Yjs boundary. */
export function documentCausality(doc: Y.Doc): string {
  return JSON.stringify({ clocks: Array.from(Y.decodeStateVector(Y.encodeStateVector(doc))).sort(([a], [b]) => a - b),
    deleted: Array.from(Y.createDeleteSetFromStructStore(doc.store).clients)
      .sort(([a], [b]) => a - b).map(([client, ranges]) => [client, ranges.map(r => [r.clock, r.len])]) });
}

export function validateState(snapshot: Uint8Array, updates: readonly Uint8Array[] = [], incoming?: Uint8Array, expectedSchema?: 1 | 2): { stateBytes: number; elapsedMs: number; title: string } {
  const start = performance.now();
  if (!snapshot.length || snapshot.length > SERVER_LIMITS.snapshotBytes || updates.length > SERVER_LIMITS.entries ||
    updates.reduce((n, b) => n + b.length, 0) > SERVER_LIMITS.logBytes || incoming && (!incoming.length || incoming.length > SERVER_LIMITS.updateBytes)) fail("QUOTA_EXCEEDED");
  const doc = new Y.Doc({ gc: false });
  const apply = (bytes: Uint8Array, max: number) => {
    if (!bytes.length || bytes.length > max) fail("QUOTA_EXCEEDED");
    inspectWire(bytes); Y.applyUpdate(doc, bytes);
    if (doc.store.pendingStructs || doc.store.pendingDs) fail('MISSING_DEPENDENCIES');
    if (doc.store.clients.size > SERVER_LIMITS.clients) fail('QUOTA_EXCEEDED');
    let logicalItems = 0;
    for (const list of doc.store.clients.values()) for (const struct of list) {
      logicalItems += struct.length;
      if (logicalItems > SERVER_LIMITS.structs) fail('QUOTA_EXCEEDED');
    }
    if (performance.now() - start > SERVER_LIMITS.validationMs) fail("VALIDATION_BUDGET");
  };
  try {
    apply(snapshot, SERVER_LIMITS.snapshotBytes);
    for (const update of updates) apply(update, SERVER_LIMITS.updateBytes);
    if (expectedSchema !== undefined && doc.getMap("metadata").get("schemaVersion") !== expectedSchema) fail("UNSUPPORTED_SCHEMA");
    if (doc.getMap("metadata").get("schemaVersion") === 1) {
      try { return { ...validateLegacy(snapshot, updates, incoming), title: "隊列表" }; }
      catch (e) { throw new ValidationError(e instanceof Error ? e.message : "INVALID_UPDATE"); }
    }
    assertFullState(doc);
    const before = JSON.stringify(doc.getMap("metadata").toJSON());
    if (incoming) {
      apply(incoming, SERVER_LIMITS.updateBytes);
      assertFullState(doc);
      if (JSON.stringify(doc.getMap("metadata").toJSON()) !== before) fail("TOPOLOGY_CHANGE");
    }
    const stateBytes = Y.encodeStateAsUpdate(doc).length;
    if (stateBytes > SERVER_LIMITS.snapshotBytes) fail("QUOTA_EXCEEDED");
    if (performance.now() - start > SERVER_LIMITS.validationMs) fail("VALIDATION_BUDGET");
    // Read the validated visible atom from this same Doc. Never accept a hint
    // from the caller or alter the full title stored in the CRDT.
    const atom = doc.getMap("settings").get("title") as { title: string };
    const title = Array.from(atom.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim()).slice(0, 120).join("") || "名称未設定";
    return { stateBytes, elapsedMs: performance.now() - start, title };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    if (error instanceof Error && ["QUOTA_EXCEEDED", "UNSUPPORTED_SCHEMA", "MISSING_DEPENDENCIES"].includes(error.message)) fail(error.message);
    return fail();
  }
  finally { doc.destroy(); }
}
