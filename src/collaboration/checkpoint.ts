import * as Y from "yjs";
// @ts-ignore Deno source import; both runtimes pin Yjs 13.6.33.
import { validateState, ValidationError, SERVER_LIMITS } from "./serverValidation.ts";
// @ts-ignore Deno source import.
import { sceneMaps } from "./projectSchema.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type MapDTO = { [key: string]: Json };
export type CheckpointReason = "manual" | "automatic" | "before-restore" | "before-generation";
export type SongDTO = { name: string; type: string; size: number; duration?: number };
/** Logical shared schema, not Project, Yjs binary structs or device storage.
 * Closed root/field vocabulary is checked by the same server schema validator.
 * Order/tombstone records preserve the shared model's reference semantics. */
export type SharedContentDTO = { roots: Record<string, MapDTO>; hasSong: boolean };
export type CheckpointDTO = { documentId: string; generation: string; confirmedSeq: string; formatVersion: 1;
  sharedSchemaVersion: 1 | 2; content: SharedContentDTO; song: SongDTO | null; digest: string;
  reason: CheckpointReason; serverAt: string; requestedBy: string | null; automatic: boolean };
const roots2 = ["metadata", "settings", "members", "stageObjects", "scenes", "memberGroups", "objectGroups", "movementPlans", "movementPaths", "orders", "tombstones"];
const roots1 = ["metadata", "members", "scenes"];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: unknown, names: string[]) => object(v) && Object.keys(v).length === names.length && names.every(n => Object.prototype.hasOwnProperty.call(v, n));
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const revision = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) <= 9223372036854775807n;
function invalid(): never { throw new ValidationError("INVALID_CHECKPOINT"); }
function plain(v: unknown, depth = 0): void {
  if (depth > 12) invalid();
  if (v === null || typeof v === "boolean" || typeof v === "string" || typeof v === "number" && Number.isFinite(v)) return;
  if (Array.isArray(v)) { if (v.length > 100000) invalid(); for (const item of v) plain(item, depth + 1); return; }
  if (!object(v)) invalid();
  for (const [k, item] of Object.entries(v)) { if (["__proto__", "constructor", "prototype"].includes(k)) invalid(); plain(item, depth + 1); }
}
/** Canonical JSON digest includes DTO/schema versions, shared content and song;
 * excludes seq/reason/actor/time so identical content deduplicates in one document. */
export function canonicalCheckpointContent(value: Pick<CheckpointDTO, "formatVersion" | "sharedSchemaVersion" | "content" | "song">): Uint8Array {
  plain(value);
  const canonical = (v: Json): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : object(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k] as Json)}`).join(",")}}` : JSON.stringify(v);
  const bytes = new TextEncoder().encode(canonical({ formatVersion: value.formatVersion, sharedSchemaVersion: value.sharedSchemaVersion, content: value.content as unknown as Json, song: value.song as unknown as Json }));
  if (bytes.length > SERVER_LIMITS.snapshotBytes) throw new ValidationError("CHECKPOINT_QUOTA_EXCEEDED");
  return bytes;
}
async function digest(bytes: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(b => b.toString(16).padStart(2, "0")).join(""); }
function projectContent(doc: Y.Doc, schema: 1 | 2): { content: SharedContentDTO; song: SongDTO | null } {
  const roots = Object.fromEntries((schema === 2 ? roots2 : roots1).map(name => [name, doc.getMap(name).toJSON() as MapDTO]));
  const settings = roots.settings;
  const hasSong = !!settings && Object.prototype.hasOwnProperty.call(settings, "song"), song = hasSong ? settings.song as unknown as SongDTO | null : null;
  if (settings) delete settings.song;
  return { content: { roots, hasSong }, song };
}
/** Reconstruct the logical DTO through public Yjs APIs. All binary/internal
 * checks remain in serverValidation; no new doc.store or Item dependencies. */
function materialize(dto: Pick<CheckpointDTO, "content" | "song" | "sharedSchemaVersion">): Y.Doc {
  if (!exact(dto.content, ["roots", "hasSong"]) || typeof dto.content.hasSong !== "boolean" || !exact(dto.content.roots, dto.sharedSchemaVersion === 2 ? roots2 : roots1) ||
    !dto.content.hasSong && dto.song !== null || dto.sharedSchemaVersion === 1 && dto.content.hasSong) invalid();
  const doc = new Y.Doc();
  try {
    for (const [name, entries] of Object.entries(dto.content.roots)) {
      if (!object(entries)) invalid();
      const root = doc.getMap(name);
      for (const [id, value] of Object.entries(entries)) {
        if (["metadata", "settings", "tombstones"].includes(name)) { root.set(id, value); continue; }
        if (!object(value)) invalid();
        const record = new Y.Map(); root.set(id, record);
        for (const [field, item] of Object.entries(value)) {
          if (name === "orders" && field === "slots") {
            if (!Array.isArray(item)) invalid(); const slots = new Y.Array(); record.set(field, slots); slots.push(item);
          } else if (name === "orders" && field === "active" || name === "scenes" && (sceneMaps as readonly string[]).includes(field) ||
            name === "memberGroups" && field === "memberIds" || name === "objectGroups" && field === "objectIds") {
            if (!object(item)) invalid(); record.set(field, new Y.Map(Object.entries(item)));
          } else if (name === "scenes" && field === "notes") {
            if (typeof item !== "string") invalid(); record.set(field, new Y.Text(item));
          } else record.set(field, item);
        }
      }
    }
    if (dto.content.hasSong) doc.getMap("settings").set("song", dto.song);
    validateState(Y.encodeStateAsUpdate(doc), [], undefined, dto.sharedSchemaVersion);
    const projected = projectContent(doc, dto.sharedSchemaVersion);
    if (new TextDecoder().decode(canonicalCheckpointContent({ formatVersion: 1, sharedSchemaVersion: dto.sharedSchemaVersion, ...projected })) !==
      new TextDecoder().decode(canonicalCheckpointContent({ formatVersion: 1, ...dto }))) invalid();
    return doc;
  } catch (error) { doc.destroy(); throw error; }
}
/** The caller supplies a server cut, never a dirty editor's seq label. */
export async function createCheckpointDTO(snapshot: { uptoSeq: string; bytes: Uint8Array }, updates: readonly { seq: string; bytes: Uint8Array }[],
  metadata: Omit<CheckpointDTO, "formatVersion" | "content" | "song" | "digest">): Promise<CheckpointDTO> {
  if (!revision(snapshot.uptoSeq)) invalid();
  let seq = BigInt(snapshot.uptoSeq);
  for (const update of updates) { if (!revision(update.seq) || BigInt(update.seq) !== ++seq) invalid(); }
  if (String(seq) !== metadata.confirmedSeq) invalid();
  validateState(snapshot.bytes, updates.map(u => u.bytes), undefined, metadata.sharedSchemaVersion);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, snapshot.bytes); for (const update of updates) Y.applyUpdate(doc, update.bytes);
    return await checkpointFromConfirmedDocument(doc, metadata);
  } finally { doc.destroy(); }
}
/** For a reconstructed, confirmed Doc only; binary state is revalidated here. */
export async function checkpointFromConfirmedDocument(doc: Y.Doc, metadata: Omit<CheckpointDTO, "formatVersion" | "content" | "song" | "digest">): Promise<CheckpointDTO> {
  validateState(Y.encodeStateAsUpdate(doc), [], undefined, metadata.sharedSchemaVersion);
  const payload = { formatVersion: 1 as const, sharedSchemaVersion: metadata.sharedSchemaVersion, ...projectContent(doc, metadata.sharedSchemaVersion) };
  const dto: CheckpointDTO = { ...metadata, ...payload, digest: await digest(canonicalCheckpointContent(payload)) };
  return validateCheckpointDTO(dto);
}
export async function validateCheckpointDTO(value: unknown): Promise<CheckpointDTO> {
  if (!exact(value, ["documentId", "generation", "confirmedSeq", "formatVersion", "sharedSchemaVersion", "content", "song", "digest", "reason", "serverAt", "requestedBy", "automatic"])) invalid();
  const dto = value as CheckpointDTO;
  if (!uuid(dto.documentId) || !revision(dto.generation) || dto.generation === "0" || !revision(dto.confirmedSeq) || dto.formatVersion !== 1 || ![1,2].includes(dto.sharedSchemaVersion) ||
    !["manual","automatic","before-restore","before-generation"].includes(dto.reason) || typeof dto.automatic !== "boolean" || dto.automatic !== (dto.reason === "automatic") ||
    dto.requestedBy !== null && !uuid(dto.requestedBy) || typeof dto.serverAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(dto.serverAt) || !Number.isFinite(Date.parse(dto.serverAt)) || !/^[0-9a-f]{64}$/.test(dto.digest)) invalid();
  const bytes = canonicalCheckpointContent(dto);
  if (await digest(bytes) !== dto.digest) throw new ValidationError("CHECKPOINT_DIGEST_MISMATCH");
  const doc = materialize(dto); doc.destroy();
  return JSON.parse(JSON.stringify(dto)) as CheckpointDTO;
}
