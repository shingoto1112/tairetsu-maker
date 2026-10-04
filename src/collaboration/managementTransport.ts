import type { CloudConfig } from "../cloud/config";
import { createCollaborationRequest, httpError } from "./supabaseTransport";
import { parseNotice, TransportError, uuid, type Credential } from "./transport";

export type MembershipReceipt = { documentId: string; generation: string; headSeq: string; aclGeneration: string; topic: string; membershipGeneration: string };
export type SharedMember = { userId: string; displayName: string; isGuest: boolean; isCreator: boolean };
export type AccessStatus = { status: "active"; membershipGeneration: string } | { status: "removed" | "ended" | "unavailable" };
export interface ManagementTransport {
  create(bytes: string, displayName: string, auth: Credential, signal: AbortSignal): Promise<MembershipReceipt>;
  invite(documentId: string, auth: Credential, signal: AbortSignal): Promise<{ inviteId: string; token: string; expiresAt: string }>;
  join(token: string, displayName: string, auth: Credential, signal: AbortSignal): Promise<MembershipReceipt>;
  members(documentId: string, auth: Credential, signal: AbortSignal): Promise<SharedMember[]>;
  access(documentId: string, auth: Credential, signal: AbortSignal): Promise<AccessStatus>;
  revoke(documentId: string, inviteId: string, auth: Credential, signal: AbortSignal): Promise<void>;
  remove(documentId: string, userId: string, auth: Credential, signal: AbortSignal): Promise<void>;
  leave(documentId: string, auth: Credential, signal: AbortSignal): Promise<void>;
  delete(documentId: string, auth: Credential, signal: AbortSignal): Promise<void>;
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const invalid = (): never => { throw new TransportError("protocol", "INVALID_MANAGEMENT_RESPONSE"); };
export function parseMembershipReceipt(v: unknown): MembershipReceipt {
  if (!obj(v) || !parseNotice(v) || !uuid(v.membershipGeneration) || typeof v.topic !== "string" || !/^collab-v2:[0-9a-f-]{36}$/i.test(v.topic)) invalid();
  return v as MembershipReceipt;
}
export function parseAccessStatus(v: unknown): AccessStatus {
  if (!obj(v) || !["active", "removed", "ended", "unavailable"].includes(v.status as string) || (v.status === "active" && !uuid(v.membershipGeneration))) invalid();
  return v as AccessStatus;
}
export function createManagementTransport(config: CloudConfig, fetcher: typeof fetch = fetch): ManagementTransport {
  const request = createCollaborationRequest(config, fetcher);
  const rpc = async (name: string, args: unknown, auth: Credential, signal: AbortSignal) => {
    const result = await request(`/rest/v1/rpc/collab_v2_${name}`, auth, signal, args);
    // Join failures are returned, so the attempt counter commits on failure.
    if (obj(result) && typeof result.error === "string") throw httpError(result.error === "INVITE_ATTEMPT_LIMIT" ? 429 : result.error === "MEMBER_LIMIT" ? 413 : result.error === "INVALID_ARGUMENT" ? 400 : 403, result.error,
      result.error === "INVITE_ATTEMPT_LIMIT" ? 600_000 : 0);
    return result;
  };
  return {
    create: async (bytes, displayName, auth, signal) => parseMembershipReceipt(await request("/functions/v1/collab-ingest", auth, signal, { action: "create", bytes, displayName })),
    invite: async (documentId, auth, signal) => {
      const result = await rpc("create_invite", { p_document: documentId }, auth, signal);
      if (!obj(result) || !uuid(result.inviteId) || typeof result.token !== "string" || !/^[0-9a-f]{64}$/.test(result.token) ||
        typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) invalid();
      return result as { inviteId: string; token: string; expiresAt: string };
    },
    join: async (token, displayName, auth, signal) => parseMembershipReceipt(await rpc("join", { p_token: token, p_display_name: displayName }, auth, signal)),
    members: async (documentId, auth, signal) => {
      const result = await rpc("list_members", { p_document: documentId }, auth, signal);
      if (!Array.isArray(result) || result.length > 8 || result.some(m => !obj(m) || !uuid(m.userId) || typeof m.displayName !== "string" ||
        !m.displayName.trim() || [...m.displayName].length > 80 || typeof m.isGuest !== "boolean" || typeof m.isCreator !== "boolean") ||
        new Set(result.map(m => m.userId)).size !== result.length || result.filter(m => m.isCreator).length !== 1) invalid();
      return result as SharedMember[];
    },
    access: async (documentId, auth, signal) => parseAccessStatus(await rpc("access_status", { p_document: documentId }, auth, signal)),
    revoke: async (documentId, inviteId, auth, signal) => { await rpc("revoke_invite", { p_document: documentId, p_invite: inviteId }, auth, signal); },
    remove: async (documentId, userId, auth, signal) => { await rpc("remove_member", { p_document: documentId, p_user: userId }, auth, signal); },
    leave: async (documentId, auth, signal) => { await rpc("leave", { p_document: documentId }, auth, signal); },
    delete: async (documentId, auth, signal) => { await rpc("delete_document", { p_document: documentId }, auth, signal); },
  };
}
