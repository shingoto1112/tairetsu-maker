import { base64Bytes, COLLABORATION_LIMITS } from "../repositories/collaborationData";
import { isRevision } from "../repositories/types";
import { isValidStorageId } from "../repositories/ids";
import { SHARED_DOCUMENT_LIMITS } from "../config/collaborationLimits";

export type Credential = { accountId: string; accessToken: string };
export type AppendRequest = { action: "append"; documentId: string; generation: string; membershipGeneration: string; updateId: string; bytes: string;
  writerId?: string; writerSeq?: string };
export type ConfirmRequest = { documentId: string; generation: string; membershipGeneration: string; writerId: string; ackThrough: string };
export type MaintenanceHint = { checkpointDue: boolean; compactionRequired: boolean };
export type MaintenanceRequest = { action: "maintain" | "manual"; documentId: string; generation: string; membershipGeneration: string };
export type Ack = { documentId: string; generation: string; updateId: string; seq: string; duplicate: boolean; maintenance?: MaintenanceHint };
export type Notice = { documentId: string; generation: string; headSeq: string; aclGeneration: string };
export type PullPage = Notice & { documentSchema: 1 | 2; topic: string; deleted: boolean; maintenance?: MaintenanceHint;
  snapshot: null | { id: string; uptoSeq: string; bytes: string }; updates: { seq: string; updateId: string; actor: string | null; bytes: string }[] };
export class TransportError extends Error {
  constructor(readonly kind: "network" | "auth" | "permission" | "capacity" | "generation" | "protocol" | "rate-limit" | "temporary" | "validation", readonly code: string, readonly retryAfterMs = 0) { super(code); }
}
export interface CollaborationTransport {
  credential(signal: AbortSignal): Promise<Credential | null>;
  membership(documentId: string, credential: Credential, signal: AbortSignal): Promise<string>;
  pull(documentId: string, generation: string, cursor: string, limit: number, credential: Credential, signal: AbortSignal, knownSnapshotId?: string): Promise<unknown>;
  append(request: AppendRequest, credential: Credential, signal: AbortSignal): Promise<unknown>;
  confirm(request: ConfirmRequest, credential: Credential, signal: AbortSignal): Promise<unknown>;
  maintenance?(request: MaintenanceRequest, credential: Credential, signal: AbortSignal): Promise<unknown>;
  subscribe(topic: string, credential: Credential, notice: (value: unknown) => void, status: (connected: boolean) => void): Promise<() => void>;
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const revision = (v: unknown): v is string => isRevision(v) && BigInt(v) <= 9223372036854775807n;
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
function invalid(): never { throw new TransportError("protocol", "INVALID_RESPONSE"); }
export function needsMaintenance(value: unknown): boolean {
  if (value === undefined) return false; // compatible with the pre-9b mock/API
  if (!obj(value) || typeof value.checkpointDue !== "boolean" || typeof value.compactionRequired !== "boolean") invalid();
  return value.checkpointDue || value.compactionRequired;
}
export function parseNotice(v: unknown): Notice | null {
  return obj(v) && uuid(v.documentId) && revision(v.generation) && v.generation !== "0" && revision(v.headSeq) && revision(v.aclGeneration) ? v as Notice : null;
}
export function parseAck(v: unknown, request: AppendRequest): Ack {
  if (obj(v) && v.result === "RECEIPT_RECLAIMED" && v.documentId === request.documentId && v.generation === request.generation && v.updateId === request.updateId &&
    v.writerId === request.writerId && revision(v.reclaimedThrough) && request.writerSeq && BigInt(request.writerSeq) <= BigInt(v.reclaimedThrough))
    throw new TransportError("validation", "RECEIPT_RECLAIMED");
  if (!obj(v) || v.documentId !== request.documentId || v.generation !== request.generation || v.updateId !== request.updateId || !revision(v.seq) || v.seq === "0" || typeof v.duplicate !== "boolean") invalid();
  needsMaintenance(v.maintenance);
  return v as Ack;
}
export function parsePage(v: unknown, documentId: string, generation: string): PullPage {
  if (!obj(v) || !parseNotice(v) || v.documentId !== documentId || v.generation !== generation || ![1, 2].includes(v.documentSchema as number) ||
    typeof v.topic !== "string" || !/^collab-v2:[0-9a-f-]{36}$/i.test(v.topic) || typeof v.deleted !== "boolean" || !Array.isArray(v.updates) || v.updates.length > 32) invalid();
  try {
    if (v.snapshot !== null) {
      if (!obj(v.snapshot) || !uuid(v.snapshot.id) || !revision(v.snapshot.uptoSeq)) invalid();
      base64Bytes(v.snapshot.bytes, SHARED_DOCUMENT_LIMITS.snapshotBytes);
    }
    for (const u of v.updates as unknown[]) {
      if (!obj(u) || !revision(u.seq) || !isValidStorageId(u.updateId) || (u.actor !== null && !uuid(u.actor))) invalid();
      base64Bytes(u.bytes, COLLABORATION_LIMITS.updateBytes);
    }
  } catch { invalid(); }
  needsMaintenance(v.maintenance);
  return v as PullPage;
}
