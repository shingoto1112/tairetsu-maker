import * as Y from "yjs";
import type { Project } from "../types";
import { incrementRevision, RepositoryError, type CommitRequest, type ProjectRecord, type ProjectRepository } from "../repositories/types";
import { SaveCoordinator } from "../storage/saveCoordinator";
import { createSharedDocument, getModel } from "./model";
import { createCollaborationData, hydrateCollaboration, decodeUpdate, encodeUpdate } from "./persistence";
import { projectSharedDocument } from "./projection";
import { newSharedLocalId } from "./identity";
import { displayName, invitationLink, invitationToken } from "./invitations";
import { TransportError, parsePage, type CollaborationTransport, type Credential } from "./transport";
import type { ManagementTransport, AccessStatus, MembershipReceipt, DocumentCursor } from "./managementTransport";
import type { createParticipantAuth } from "./guestAuth";

export type SharingState = { status: "active" | "removed" | "ended" | "unavailable" | "membership-changed" | "auth-required";
  message: string; localCopyRetained: true; unsentChangesRetained: true };
export function sharingState(status: SharingState["status"]): SharingState {
  return { status, message: status === "ended" ? "共有が終了しました。この端末のコピーは残っています" :
    status === "removed" ? "共有メンバーから外されました。この端末のコピーは残っています" :
    status === "membership-changed" ? "参加資格が変わりました。未送信の変更はこの端末に残っています" :
    status === "auth-required" ? "ログインが必要です。ゲストは新しい招待から入り直してください" :
    status === "unavailable" ? "共有先を確認できません。この端末のコピーは残っています" : "共有中",
    localCopyRetained: true, unsentChangesRetained: true };
}
/** Management calls run with a fresh credential. The caller closes/flushes its
 * editor before start/removeLocal; this service never owns the App's editor. */
export class CollaborationLifecycle {
  constructor(private repository: ProjectRepository, private management: ManagementTransport, private transport: CollaborationTransport,
    private options: { invitationBaseUrl: string; allowedOrigins: readonly string[]; platform: "web" | "ipad"; auth?: ReturnType<typeof createParticipantAuth> }) {}
  private async credential(signal: AbortSignal): Promise<Credential> {
    const value = await this.transport.credential(signal);
    if (!value) throw new TransportError("auth", "AUTH_REQUIRED");
    return value;
  }
  private async record(id: string): Promise<ProjectRecord> {
    const record = await this.repository.get(id); if (!record) throw new RepositoryError("NOT_FOUND"); return record;
  }
  async startSharing(localId: string, name: string, signal = new AbortController().signal): Promise<ProjectRecord> {
    const normalizedName = displayName(name), auth = await this.credential(signal);
    let record = await this.record(localId);
    if (record.sync) throw new TransportError("validation", "PERSONAL_SYNC_CONFLICT");
    if (record.collaboration?.sharedDocumentId) throw new TransportError("validation", "ALREADY_SHARED");
    if (!record.collaboration) {
      const doc = createSharedDocument(record.project);
      try {
        const collaboration = createCollaborationData(doc);
        const project = projectSharedDocument(doc, record.project);
        await this.repository.commit({ project, collaboration, expectedRepositoryRevision: record.repositoryRevision,
          localRevision: incrementRevision(record.localRevision), operationId: crypto.randomUUID() });
      } finally { doc.destroy(); }
      record = await this.record(localId);
    }
    // Durable initial bytes survive a lost create reply; never regenerate Y.Doc.
    if (record.collaboration?.documentSchema !== 2) throw new TransportError("validation", "UNSUPPORTED_SCHEMA");
    const receipt = await this.management.create(record.collaboration.base, normalizedName, auth, signal);
    if (receipt.generation !== record.collaboration.generation) throw new TransportError("generation", "STALE_GENERATION");
    await this.confirmAccess(receipt, auth, signal);
    const coordinator = new SaveCoordinator(this.repository, () => {}); coordinator.activate(record);
    if (!await coordinator.bindSharedDocument(receipt.documentId, { accountId: auth.accountId, membershipGeneration: receipt.membershipGeneration }))
      throw coordinator.state?.error ?? new RepositoryError("IO_ERROR");
    return this.record(localId);
  }
  async createInvite(documentId: string, signal = new AbortController().signal) {
    // Validate the configured target BEFORE issuing a one-use server token.
    const base = new URL(this.options.invitationBaseUrl);
    if (!this.options.allowedOrigins.includes(base.origin)) throw new TransportError("validation", "INVALID_INVITE_ORIGIN");
    invitationLink(base.href, "0".repeat(64));
    const invite = await this.management.invite(documentId, await this.credential(signal), signal);
    return { inviteId: invite.inviteId, expiresAt: invite.expiresAt, link: invitationLink(base.href, invite.token) };
  }
  /** Same path handles Web open and iPad clipboard paste. No universal links. */
  async prepareJoin(link: string, name: string, signal = new AbortController().signal, captchaToken?: string): Promise<CommitRequest> {
    const token = invitationToken(link, this.options.allowedOrigins), normalizedName = displayName(name);
    let auth = await this.transport.credential(signal);
    if (!auth && this.options.platform === "web" && this.options.auth) {
      await this.options.auth.beginGuest(normalizedName, signal, captchaToken); auth = await this.credential(signal);
    }
    if (!auth) throw new TransportError("auth", this.options.platform === "ipad" ? "IPAD_ACCOUNT_REQUIRED" : "AUTH_REQUIRED");
    const receipt = await this.management.join(token, normalizedName, auth, signal);
    return this.prepareDownload(receipt, auth, signal);
  }
  async listMyDocuments(limit = 32, cursor: DocumentCursor | null = null, signal = new AbortController().signal) {
    return this.management.listMyDocuments(limit, cursor, await this.credential(signal), signal);
  }
  /** No invitation is consumed. Resume only the exact immutable attachment;
   * never replace its pending edits with a server projection. */
  async openExisting(documentId: string, signal = new AbortController().signal): Promise<{ record: ProjectRecord } | { request: CommitRequest }> {
    const auth = await this.credential(signal), receipt = await this.management.openExisting(documentId, auth, signal);
    if (receipt.documentId !== documentId) throw new TransportError("protocol", "DOCUMENT_MISMATCH");
    let cursor: string | undefined;
    do {
      const page = await this.repository.list({ limit: 100, cursor });
      for (const item of page.items) {
        const shared = item.sharing;
        if (shared?.documentId !== documentId || shared.accountId !== auth.accountId || shared.membershipGeneration !== receipt.membershipGeneration) continue;
        const record = await this.record(item.id), data = record.collaboration;
        if (data?.sharedDocumentId === documentId && data.generation === receipt.generation && data.transportBinding?.accountId === auth.accountId &&
          data.transportBinding.membershipGeneration === receipt.membershipGeneration) {
          await this.confirmAccess(receipt, auth, signal); return { record };
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { request: await this.prepareDownload(receipt, auth, signal) };
  }
  private async confirmAccess(receipt: MembershipReceipt, auth: Credential, signal: AbortSignal) {
    if (signal.aborted || (await this.credential(signal)).accountId !== auth.accountId) throw new TransportError("auth", "ACCOUNT_CHANGED");
    const current = await this.management.openExisting(receipt.documentId, auth, signal);
    if (current.membershipGeneration !== receipt.membershipGeneration) throw new TransportError("permission", "MEMBERSHIP_CHANGED");
    if (current.generation !== receipt.generation) throw new TransportError("generation", "STALE_GENERATION");
  }
  private async prepareDownload(receipt: MembershipReceipt, auth: Credential, signal: AbortSignal): Promise<CommitRequest> {
    const localId = newSharedLocalId(receipt.documentId);
    let data: ReturnType<typeof createCollaborationData> | null = null, cursor = "0";
    // Server log is bounded to 4096. A busy document cannot create an unbounded
    // join loop; failure leaves its membership and all existing copies intact.
    for (let i = 0; i < 129; i++) {
      const access = await this.management.access(receipt.documentId, auth, signal);
      if (access.status !== "active" || access.membershipGeneration !== receipt.membershipGeneration)
        throw new TransportError("permission", access.status === "ended" ? "DOCUMENT_DELETED" : "MEMBERSHIP_CHANGED");
      const page = parsePage(await this.transport.pull(receipt.documentId, receipt.generation, cursor, 32, auth, signal, data?.knownSnapshotId), receipt.documentId, receipt.generation);
      if (page.deleted) throw new TransportError("permission", "DOCUMENT_DELETED");
      if (page.documentSchema !== 2 || (!data && !page.snapshot)) throw new TransportError("protocol", "INITIAL_STATE_REQUIRED");
      if (!data) data = { schemaVersion: 1, sharedDocumentId: receipt.documentId, generation: receipt.generation, documentSchema: 2,
        base: page.snapshot!.bytes, journal: [], outbox: [], serverCursor: page.snapshot!.uptoSeq, knownSnapshotId: page.snapshot!.id,
        transportBinding: { accountId: auth.accountId, membershipGeneration: receipt.membershipGeneration } };
      const doc = hydrateCollaboration(data);
      try {
        if (page.snapshot) {
          if (BigInt(page.snapshot.uptoSeq) > BigInt(page.headSeq)) throw new TransportError("protocol", "INVALID_CURSOR");
          Y.applyUpdate(doc, decodeUpdate(page.snapshot.bytes));
          if (BigInt(page.snapshot.uptoSeq) > BigInt(cursor)) cursor = page.snapshot.uptoSeq;
        }
        for (const update of page.updates) {
          if (update.seq !== incrementRevision(cursor) || BigInt(update.seq) > BigInt(page.headSeq)) throw new TransportError("protocol", "NONCONTIGUOUS_PAGE");
          Y.applyUpdate(doc, decodeUpdate(update.bytes)); cursor = update.seq;
        }
        if (BigInt(cursor) > BigInt(page.headSeq) || (cursor !== page.headSeq && !page.updates.length)) throw new TransportError("protocol", "INVALID_CURSOR");
        data = { ...data, ...(page.snapshot ? { knownSnapshotId: page.snapshot.id } : {}), base: encodeUpdate(Y.encodeStateAsUpdate(doc)), serverCursor: cursor };
        // Full state validation, including missing binary dependencies.
        const checked = hydrateCollaboration(data); checked.destroy();
        if (cursor === page.headSeq) {
          await this.confirmAccess(receipt, auth, signal);
          const now = new Date().toISOString();
          const base = { id: localId, updatedAt: now, stage: {}, frames: [] } as unknown as Project;
          const project = projectSharedDocument(doc, base, receipt.documentId);
          if (getModel(doc).metadata.get("schemaVersion") !== 2) throw new TransportError("validation", "UNSUPPORTED_SCHEMA");
          return { project, collaboration: data, expectedRepositoryRevision: null, localRevision: "1", operationId: crypto.randomUUID() };
        }
      } finally { doc.destroy(); }
    }
    throw new TransportError("temporary", "JOIN_CATCHUP_LIMIT");
  }
  /** Retain this fixed request if storage fails; retry identical ID/bytes. */
  async saveJoinedProject(request: CommitRequest): Promise<ProjectRecord> {
    if (request.expectedRepositoryRevision !== null || !request.collaboration?.transportBinding) throw new RepositoryError("INVALID_ARGUMENT");
    await this.repository.commit(request); return this.record(request.project.id!);
  }
  async state(localId: string, signal = new AbortController().signal): Promise<SharingState> {
    const data = (await this.record(localId)).collaboration;
    if (!data?.sharedDocumentId) return sharingState("unavailable");
    const auth = await this.transport.credential(signal);
    if (!auth || data.transportBinding?.accountId !== auth.accountId) return sharingState("auth-required");
    const access: AccessStatus = await this.management.access(data.sharedDocumentId, auth, signal);
    return sharingState(access.status === "active" && access.membershipGeneration !== data.transportBinding.membershipGeneration ? "membership-changed" : access.status);
  }
  async members(documentId: string, signal = new AbortController().signal) { return this.management.members(documentId, await this.credential(signal), signal); }
  async invites(documentId: string, signal = new AbortController().signal) { return this.management.invites(documentId, await this.credential(signal), signal); }
  async revokeInvite(documentId: string, inviteId: string, signal = new AbortController().signal) { await this.management.revoke(documentId, inviteId, await this.credential(signal), signal); }
  async removeMember(documentId: string, userId: string, signal = new AbortController().signal) { await this.management.remove(documentId, userId, await this.credential(signal), signal); }
  async leave(documentId: string, signal = new AbortController().signal) { await this.management.leave(documentId, await this.credential(signal), signal); }
  async deleteSharedDocument(documentId: string, signal = new AbortController().signal) { await this.management.delete(documentId, await this.credential(signal), signal); }
  /** Independent copy includes unsent edits. Keep original attachment/outbox. */
  async prepareIndependentCopy(localId: string, liveProjection?: Project): Promise<CommitRequest> {
    const record = await this.record(localId);
    if (liveProjection && liveProjection.id !== localId) throw new RepositoryError("INVALID_ARGUMENT");
    const project = { ...JSON.parse(JSON.stringify(liveProjection ?? record.project)) as Project, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    return { project, collaboration: null, expectedRepositoryRevision: null, localRevision: "1", operationId: crypto.randomUUID() };
  }
  async removeLocalCopy(localId: string, expectedRepositoryRevision: string, operationId: string): Promise<void> {
    await this.repository.remove({ id: localId, expectedRepositoryRevision, operationId });
  }
}
