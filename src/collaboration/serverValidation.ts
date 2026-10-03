import * as Y from "yjs";

/** Pure schema-1 server validator. No repository, browser UI, or Deno dependencies.
 * Deno maps the bare import to npm:yjs@13.6.33; Vitest uses the same installed version.
 * Extend this whitelist explicitly when schema 2 ships, never silently accept it.
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
  return Uint8Array.from(text, c => c.charCodeAt(0));
}

/** Bounded V1 wire scanner, BEFORE Yjs allocates arrays or reads recursive any.
 * Schema 1 needs only maps + scalar metadata + {x,y}. Reject subdocs, strings,
 * arrays, XML, unknown roots, trailing bytes and oversized declared counts even
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
  const text = () => {
    const length = bounded(255);
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
  const any = () => {
    const tag = byte();
    if (tag === 119) { if (!validId(text())) fail(); return; }
    if (tag === 125 || tag === 124 || tag === 123) { number(tag); return; }
    if (tag !== 118 || uint() !== 2) return fail();
    const keys = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const key = text(); if (!['x', 'y'].includes(key) || keys.has(key)) fail();
      keys.add(key); number(byte());
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
        if (![1, 7, 8].includes(ref)) fail();
        if (info & 128) id();
        if (info & 64) id();
        if (!(info & 192)) {
          const parentInfo = uint();
          if (parentInfo === 1) { if (!['metadata', 'members', 'scenes'].includes(text())) fail(); }
          else if (parentInfo === 0) id(); else fail();
          if (info & 32) { if (!validId(text())) fail(); }
        }
        if (ref === 1) { length = bounded(1000000); if (!length) fail(); }
        if (ref === 7 && uint() !== 1) fail(); // Y.Map only
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

type Topology = { projectId: string; members: string[]; scenes: string[] };
function position(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'x,y' ||
    !Number.isFinite((value as { x: number }).x) || !Number.isFinite((value as { y: number }).y)) fail();
}
function assertState(doc: Y.Doc): Topology {
  if (doc.store.pendingStructs || doc.store.pendingDs) fail("MISSING_DEPENDENCIES");
  if ([...doc.share.keys()].some(key => !['members', 'metadata', 'scenes'].includes(key))) fail();
  const metadata = doc.getMap('metadata'), members = doc.getMap('members'), scenes = doc.getMap('scenes');
  if (metadata.size !== 2 || metadata.get('schemaVersion') !== 1 || !validId(metadata.get('projectId'))) fail("UNSUPPORTED_SCHEMA");
  if (members.size > SERVER_LIMITS.members || scenes.size > SERVER_LIMITS.scenes) fail("QUOTA_EXCEEDED");
  let positions = 0;
  for (const [id, value] of members) if (!validId(id) || !(value instanceof Y.Map) || value.size) fail();
  for (const [id, scene] of scenes) {
    if (!validId(id) || !(scene instanceof Y.Map) || scene.size !== 1 || !(scene.get('positions') instanceof Y.Map)) fail();
    const map = scene.get('positions') as Y.Map<unknown>; positions += map.size;
    if (positions > SERVER_LIMITS.positions) fail("QUOTA_EXCEEDED");
    for (const [member, value] of map) { if (!members.has(member)) fail(); position(value); }
  }
  // Retain and inspect hidden/deleted Item content (gc:false). A malicious write
  // cannot smuggle arbitrary structure by adding and deleting it in one update.
  let structs = 0;
  if (doc.store.clients.size > SERVER_LIMITS.clients) fail("QUOTA_EXCEEDED");
  for (const list of doc.store.clients.values()) for (const struct of list) {
    if (++structs > SERVER_LIMITS.structs) fail("QUOTA_EXCEEDED");
    if (!(struct instanceof Y.Item)) continue;
    const parent = struct.parent;
    if (!(parent instanceof Y.Map) || !struct.parentSub) fail();
    const values = struct.content.getContent();
    if (struct.content instanceof Y.ContentDeleted) continue; // Valid GC'd history.
    if (!values.length || values.length > SERVER_LIMITS.structs) fail();
    for (const value of values as unknown[]) {
      const key = struct.parentSub;
      if (parent === metadata) {
        if ((key === 'schemaVersion' && value === 1) || (key === 'projectId' && value === metadata.get('projectId'))) continue;
        fail();
      }
      if (parent === members || parent === scenes) {
        if (!validId(key) || !(value instanceof Y.Map)) fail();
        continue;
      }
      const rootItem = parent._item;
      if (rootItem?.parent === members) fail(); // Members have no shared fields yet.
      if (rootItem?.parent === scenes) {
        if (key !== 'positions' || !(value instanceof Y.Map)) fail();
      } else if (rootItem?.parent instanceof Y.Map && rootItem.parent._item?.parent === scenes) {
        if (!members.has(key)) fail(); position(value);
      } else fail();
    }
  }
  return { projectId: metadata.get('projectId') as string, members: [...members.keys()].sort(), scenes: [...scenes.keys()].sort() };
}
export function validateState(snapshot: Uint8Array, updates: readonly Uint8Array[] = [], incoming?: Uint8Array): { stateBytes: number; elapsedMs: number } {
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
    const before = assertState(doc);
    if (incoming) {
      apply(incoming, SERVER_LIMITS.updateBytes);
      if (JSON.stringify(assertState(doc)) !== JSON.stringify(before)) fail("TOPOLOGY_CHANGE");
    }
    const stateBytes = Y.encodeStateAsUpdate(doc).length;
    if (stateBytes > SERVER_LIMITS.snapshotBytes) fail("QUOTA_EXCEEDED");
    if (performance.now() - start > SERVER_LIMITS.validationMs) fail("VALIDATION_BUDGET");
    return { stateBytes, elapsedMs: performance.now() - start };
  } catch (error) { if (error instanceof ValidationError) throw error; return fail(); }
  finally { doc.destroy(); }
}
