import { base64Bytes, COLLABORATION_LIMITS } from "../repositories/collaborationData";
import { isRevision } from "../repositories/types";
import { isValidStorageId } from "../repositories/ids";

export type Credential = { accountId: string; accessToken: string };
export type AppendRequest = { action: "append"; documentId: string; generation: string; membershipGeneration: string; updateId: string; bytes: string };
export type Ack = { documentId: string; generation: string; updateId: string; seq: string; duplicate: boolean };
export type Notice = { documentId: string; generation: string; headSeq: string; aclGeneration: string };
export type PullPage = Notice & { documentSchema: 1; topic: string; deleted: boolean;
  snapshot: null | { uptoSeq: string; bytes: string }; updates: { seq: string; updateId: string; actor: string | null; bytes: string }[] };
export class TransportError extends Error {
  constructor(readonly kind: "network" | "auth" | "permission" | "capacity" | "generation" | "protocol" | "rate-limit" | "temporary" | "validation", readonly code: string, readonly retryAfterMs = 0) { super(code); }
}
export interface CollaborationTransport {
  credential(signal: AbortSignal): Promise<Credential | null>;
  membership(documentId: string, credential: Credential, signal: AbortSignal): Promise<string>;
  pull(documentId: string, generation: string, cursor: string, limit: number, credential: Credential, signal: AbortSignal): Promise<unknown>;
  append(request: AppendRequest, credential: Credential, signal: AbortSignal): Promise<unknown>;
  subscribe(topic: string, credential: Credential, notice: (value: unknown) => void, status: (connected: boolean) => void): Promise<() => void>;
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const revision = (v: unknown): v is string => isRevision(v) && BigInt(v) <= 9223372036854775807n;
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
function invalid(): never { throw new TransportError("protocol", "INVALID_RESPONSE"); }
export function parseNotice(v: unknown): Notice | null {
  return obj(v) && uuid(v.documentId) && revision(v.generation) && v.generation !== "0" && revision(v.headSeq) && revision(v.aclGeneration) ? v as Notice : null;
}
export function parseAck(v: unknown, request: AppendRequest): Ack {
  if (!obj(v) || v.documentId !== request.documentId || v.generation !== request.generation || v.updateId !== request.updateId || !revision(v.seq) || v.seq === "0" || typeof v.duplicate !== "boolean") invalid();
  return v as Ack;
}
export function parsePage(v: unknown, documentId: string, generation: string): PullPage {
  if (!obj(v) || !parseNotice(v) || v.documentId !== documentId || v.generation !== generation || v.documentSchema !== 1 ||
    typeof v.topic !== "string" || !/^collab-v2:[0-9a-f-]{36}$/i.test(v.topic) || typeof v.deleted !== "boolean" || !Array.isArray(v.updates) || v.updates.length > 32) invalid();
  try {
    if (v.snapshot !== null) {
      if (!obj(v.snapshot) || !revision(v.snapshot.uptoSeq)) invalid();
      base64Bytes(v.snapshot.bytes, COLLABORATION_LIMITS.baseBytes);
    }
    for (const u of v.updates as unknown[]) {
      if (!obj(u) || !revision(u.seq) || !isValidStorageId(u.updateId) || (u.actor !== null && !uuid(u.actor))) invalid();
      base64Bytes(u.bytes, COLLABORATION_LIMITS.updateBytes);
    }
  } catch { invalid(); }
  return v as PullPage;
}
