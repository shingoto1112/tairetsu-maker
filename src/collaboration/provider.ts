import type { SaveCoordinator } from "../storage/saveCoordinator";
import { compareRevisions, incrementRevision, RepositoryError, type CollaborationData, type CollaborationUpdate } from "../repositories/types";
import { needsMaintenance, parseAck, parseNotice, parsePage, TransportError, uuid, type CollaborationTransport, type Credential, type PullPage } from "./transport";

export type ProviderError = { kind: TransportError["kind"] | "storage" | "membership"; code: string };
export type ProviderState = { online: boolean; realtimeConnected: boolean; syncing: boolean; pending: number; held: boolean; cursor: string; error: ProviderError | null; credentialConfirmed: boolean; pullConfirmed: boolean;
  sharing: "active" | "removed" | "ended" | "membership-changed" | "auth-required"; historyDeferred?: boolean };
/** Notification only, durable queue only. One instance owns one active coordinator session. */
export class CollaborationProvider {
  private state: ProviderState = { online: true, realtimeConnected: false, syncing: false, pending: 0, held: false, cursor: "0", error: null, sharing: "active", credentialConfirmed: false, pullConfirmed: false };
  private listeners = new Set<(state: ProviderState) => void>();
  private stopped = true;
  private controller = new AbortController();
  private timers = new Map<"send" | "pull", ReturnType<typeof setTimeout>>();
  private running = new Set<"send" | "pull">();
  private requested = new Set<"send" | "pull">();
  private attempts = { send: 0, pull: 0 };
  private resyncRequired = false;
  private errors: Partial<Record<"send" | "pull", ProviderError>> = {};
  private blocked = new Set<"send" | "pull">();
  private topicKey = "";
  private unsubscribe: (() => void) | null = null;
  private epoch = 0;
  private activeId: string | null = null;
  private poll?: ReturnType<typeof setInterval>;
  private sendOnly = false;
  private queueVersion = 0;
  private maintenanceRunning = false;
  private maintenancePending = false;
  private maintenanceTimer?: ReturnType<typeof setTimeout>;
  private maintenanceAttempts = 0;
  constructor(private coordinator: SaveCoordinator, private transport: CollaborationTransport,
    private options: { pollMs?: number; backoffMs?: number; random?: () => number; lifecycle?: boolean; valid?: () => boolean; aclChanged?: () => void } = {}) {
      this.state.pending = coordinator.collaborationProjection?.outbox.filter(e => e.status === "pending").length ?? 0;
    }
  get snapshot(): ProviderState { return { ...this.state, error: this.state.error ? { ...this.state.error } : null }; }
  subscribe(listener: (state: ProviderState) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot); return () => { this.listeners.delete(listener); };
  }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false; this.activeId = this.coordinator.state?.id ?? null; this.controller = new AbortController();
    if (this.options.lifecycle !== false && typeof window !== "undefined") {
      this.state.online = navigator.onLine;
      window.addEventListener("online", this.onOnline); window.addEventListener("offline", this.onOffline);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.poll = setInterval(() => { this.kick("pull"); this.kick("send"); }, this.options.pollMs ?? 30_000);
    this.wake();
  }
  stop(): void {
    this.stopped = true; this.epoch++; this.controller.abort(); this.closeChannel();
    this.timers.forEach(clearTimeout); this.timers.clear(); clearInterval(this.poll);
    clearTimeout(this.maintenanceTimer); this.maintenanceTimer = undefined;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline); window.removeEventListener("offline", this.onOffline); document.removeEventListener("visibilitychange", this.onVisible);
    }
    this.emit();
  }
  /** After local flush, reconnect, foreground, or renewed authentication. Never flushes local edits to send. */
  wake(): void { this.blocked.clear(); this.kick("pull"); this.kick("send"); this.requestMaintenance(); }
  /** Coalesced durable local updates wake only the send lane. */
  wakeSend(): void { this.blocked.delete("send"); this.kick("send"); }
  committedPending(pending: number): void { this.queueVersion++; this.state.pending = pending; this.emit(); }
  backgroundSendOnly(): void {
    this.sendOnly = true; this.epoch++; this.controller.abort(); this.controller = new AbortController();
    this.closeChannel(); clearInterval(this.poll); this.timers.forEach(clearTimeout); this.timers.clear();
    clearTimeout(this.maintenanceTimer); this.maintenanceTimer = undefined;
    this.requested.clear(); this.wakeSend();
  }
  setOnline(online: boolean): void {
    this.state.online = online; this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.closeChannel();
    this.state.credentialConfirmed = false; this.state.pullConfirmed = false;
    this.timers.forEach(clearTimeout); this.timers.clear();
    clearTimeout(this.maintenanceTimer); this.maintenanceTimer = undefined;
    this.emit(); if (online) this.wake();
  }
  private onOnline = () => this.setOnline(true);
  private onOffline = () => this.setOnline(false);
  private onVisible = () => { if (document.visibilityState === "visible") this.wake(); };
  private emit() {
    this.state.syncing = !this.stopped && this.state.online && this.running.size > 0;
    this.state.error = this.errors.send ?? this.errors.pull ?? null;
    for (const listener of this.listeners) { try { listener(this.snapshot); } catch { /* Observer cannot break sync. */ } }
  }
  private valid(epoch: number): boolean { return !this.stopped && this.state.online && this.epoch === epoch && this.coordinator.state?.id === this.activeId && (this.options.valid?.() ?? true); }
  private closeChannel() { this.topicKey = ""; const unsubscribe = this.unsubscribe; this.unsubscribe = null; this.state.realtimeConnected = false; unsubscribe?.(); }
  private kick(lane: "send" | "pull") {
    if (lane === "pull" && this.sendOnly) return;
    if (["removed", "ended"].includes(this.state.sharing)) return;
    if (!this.valid(this.epoch) || this.blocked.has(lane)) return;
    if (this.running.has(lane)) { this.requested.add(lane); return; }
    if (this.timers.has(lane)) return;
    void this.run(lane);
  }
  private async run(lane: "send" | "pull") {
    const epoch = this.epoch, signal = this.controller.signal;
    this.running.add(lane); this.requested.delete(lane); this.emit();
    let retry = 0;
    try {
      if (lane === "pull" && this.coordinator.state?.error && !await this.coordinator.flush()) throw new RepositoryError("IO_ERROR");
      const queueVersion = this.queueVersion;
      const data = await this.coordinator.getCommittedCollaboration();
      if (!data?.sharedDocumentId || !this.valid(epoch)) return;
      if (compareRevisions(data.serverCursor, this.state.cursor) > 0) this.state.cursor = data.serverCursor;
      if (queueVersion === this.queueVersion) this.state.pending = data.outbox.filter(e => e.status === "pending").length;
      const credential = await this.transport.credential(signal);
      if (!this.valid(epoch)) return;
      if (!credential) throw new TransportError("auth", "AUTH_REQUIRED");
      // Check identity before reading document contents with a different account.
      if (!data.transportBinding || data.transportBinding.accountId !== credential.accountId) {
        this.state.held = true; throw new TransportError("permission", "SENDER_BINDING_REQUIRED");
      }
      const membership = await this.transport.membership(data.sharedDocumentId, credential, signal);
      if (!this.valid(epoch)) return;
      if (!uuid(membership)) throw new TransportError("protocol", "INVALID_MEMBERSHIP");
      const membershipChanged = membership !== data.transportBinding.membershipGeneration;
      this.state.held = this.resyncRequired || !!data.recoveryRequired || membershipChanged;
      this.state.credentialConfirmed = true;
      this.state.sharing = membershipChanged ? "membership-changed" : "active";
      if (lane === "send" && this.state.held) {
        this.errors.send = { kind: "membership", code: data.recoveryRequired ? "RECOVERY_CONFIRMATION_REQUIRED" : this.resyncRequired ? "RECEIPT_RECLAIMED" : "MEMBERSHIP_CHANGED" }; this.blocked.add("send"); return;
      }
      if (lane === "send") await this.send(data, credential, epoch, signal);
      else { const caughtUp = await this.pull(data, credential, epoch, signal); if (this.valid(epoch)) this.state.pullConfirmed = caughtUp; }
      if (!this.valid(epoch)) return;
      delete this.errors[lane]; this.attempts[lane] = 0;
    } catch (error) {
      if (!this.valid(epoch)) return;
      const e = error instanceof TransportError ? error : new TransportError("validation", error instanceof RepositoryError ? error.code : "LOCAL_STATE_INVALID");
      this.errors[lane] = { kind: error instanceof RepositoryError || e.code.startsWith("LOCAL_") ? "storage" : e.kind, code: e.code };
      if (lane === "pull") this.state.pullConfirmed = false;
      if (["auth", "permission", "generation"].includes(e.kind)) this.state.credentialConfirmed = false;
      if (e.kind === "auth") this.state.sharing = "auth-required";
      if (e.code === "MEMBERSHIP_CHANGED") this.state.sharing = "membership-changed";
      if (e.code === "RECEIPT_RECLAIMED") { this.resyncRequired = true; this.state.held = true; this.kick("pull"); }
      if (["DOCUMENT_DELETED", "NOT_MEMBER"].includes(e.code)) {
        this.state.sharing = e.code === "DOCUMENT_DELETED" ? "ended" : "removed";
        this.state.held = true; this.blocked.add("send"); this.blocked.add("pull");
        this.epoch++; this.controller.abort(); this.timers.forEach(clearTimeout); this.timers.clear();
        this.closeChannel(); clearInterval(this.poll);
      }
      if (["network", "temporary", "rate-limit"].includes(e.kind) || e.code === "MISSING_DEPENDENCIES" || e.code === "HEAD_CONFLICT") {
        const attempt = this.attempts[lane]++;
        if (e.code === "MISSING_DEPENDENCIES") this.kick("pull");
        retry = Math.max(e.retryAfterMs, Math.min(30_000, (this.options.backoffMs ?? 500) * 2 ** Math.min(attempt, 10)) * (0.5 + (this.options.random ?? Math.random)()));
      }
      if (!retry) this.blocked.add(lane);
      if (["auth", "permission", "generation"].includes(e.kind)) this.closeChannel();
    } finally {
      this.running.delete(lane); this.emit();
      if (retry && this.valid(epoch)) {
        this.timers.set(lane, setTimeout(() => { this.timers.delete(lane); this.kick(lane); }, retry));
      } else if (this.requested.delete(lane)) this.kick(lane);
    }
  }
  private async send(data: CollaborationData, credential: Credential, epoch: number, signal: AbortSignal) {
    // Do not expose new, uncommitted shared updates. Local audio/view review may
    // be dirty on reopen while the shared outbox was already durably committed.
    if (this.coordinator.state?.saving) return;
    if (this.coordinator.state?.dirty && this.coordinator.collaborationProjection?.outbox.some(e => e.status === "pending" &&
      !data.outbox.some(saved => saved.updateId === e.updateId && saved.bytes === e.bytes))) return;
    if (!await this.coordinator.prepareCollaborationWriter()) throw new TransportError("validation", "LOCAL_WRITER_COMMIT_FAILED");
    if (!this.valid(epoch)) return;
    data = (await this.coordinator.getCommittedCollaboration())!;
    await this.confirmWriter(data, credential, signal);
    const outbox = await this.coordinator.getSendableOutbox();
    for (const update of outbox) {
      if (!this.valid(epoch)) return;
      // Recheck each request; no arbitrary topic or actor is sent to Edge.
      const membership = await this.transport.membership(data.sharedDocumentId!, credential, signal);
      if (!this.valid(epoch)) return;
      if (membership !== data.transportBinding!.membershipGeneration) { this.state.held = true; throw new TransportError("permission", "MEMBERSHIP_CHANGED"); }
      const request = { action: "append" as const, documentId: data.sharedDocumentId!, generation: data.generation,
        membershipGeneration: data.transportBinding!.membershipGeneration, updateId: update.updateId, bytes: update.bytes,
        writerId: data.writer!.id, writerSeq: update.writerSeq! };
      const ack = parseAck(await this.transport.append(request, credential, signal), request);
      if (this.valid(epoch) && needsMaintenance(ack.maintenance)) this.requestMaintenance();
      if (!this.valid(epoch)) return;
      this.state.pullConfirmed = false; this.kick("pull");
      if (!await this.coordinator.markOutboxSent([update.updateId])) throw new TransportError("validation", "LOCAL_ACK_COMMIT_FAILED");
      if (!this.valid(epoch)) return;
      const committed = await this.coordinator.getCommittedCollaboration();
      if (!this.valid(epoch)) return;
      await this.confirmWriter(committed!, credential, signal);
      const queueVersion = this.queueVersion;
      const remaining = await this.coordinator.getSendableOutbox();
      if (!this.valid(epoch)) return;
      if (queueVersion === this.queueVersion) this.state.pending = remaining.length;
      this.emit();
    }
  }
  private async confirmWriter(data: CollaborationData, credential: Credential, signal: AbortSignal) {
    const writer = data.writer!;
    const result = await this.transport.confirm({ documentId: data.sharedDocumentId!, generation: data.generation,
      membershipGeneration: data.transportBinding!.membershipGeneration, writerId: writer.id, ackThrough: writer.ackThrough }, credential, signal) as { writerId?: string; reclaimedThrough?: string };
    if (result?.writerId !== writer.id || typeof result.reclaimedThrough !== "string" || !/^(0|[1-9][0-9]*)$/.test(result.reclaimedThrough) || compareRevisions(result.reclaimedThrough, writer.ackThrough) < 0)
      throw new TransportError("protocol", "INVALID_CONFIRMATION");
  }
  private async pull(data: CollaborationData, credential: Credential, epoch: number, signal: AbortSignal) {
    let cursor = data.serverCursor;
    let knownSnapshotId = data.knownSnapshotId;
    // Bound each turn; a busy document yields before catching up further.
    for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
      const page = parsePage(await this.transport.pull(data.sharedDocumentId!, data.generation, cursor, 32, credential, signal, knownSnapshotId), data.sharedDocumentId!, data.generation);
      if (page.documentSchema !== data.documentSchema) throw new TransportError("validation", "UNSUPPORTED_SCHEMA");
      if (!this.valid(epoch)) return false;
      if (needsMaintenance(page.maintenance)) this.requestMaintenance();
      if (page.deleted) throw new TransportError("permission", "DOCUMENT_DELETED");
      const updates: CollaborationUpdate[] = [];
      let next = cursor;
      if (page.snapshot) {
        if (compareRevisions(page.snapshot.uptoSeq, page.headSeq) > 0) throw new TransportError("protocol", "SNAPSHOT_AHEAD");
        if (compareRevisions(page.snapshot.uptoSeq, cursor) >= 0) {
          next = page.snapshot.uptoSeq;
        }
      }
      for (const update of page.updates) {
        if (update.seq !== incrementRevision(next) || compareRevisions(update.seq, page.headSeq) > 0) throw new TransportError("protocol", "NONCONTIGUOUS_PAGE");
        updates.push({ updateId: update.updateId, bytes: update.bytes, source: "remote" }); next = update.seq;
      }
      if (compareRevisions(page.headSeq, next) < 0 || (next === cursor && compareRevisions(page.headSeq, cursor) > 0)) throw new TransportError("protocol", "INVALID_HEAD");
      if (updates.length || page.snapshot) {
        // Flush a previously failed receive first; never roll back an in-memory cursor.
        if (this.coordinator.state?.error && !await this.coordinator.flush()) throw new TransportError("validation", "LOCAL_COMMIT_FAILED");
        if (page.snapshot) {
          if (!await this.coordinator.receiveCollaborationSnapshot(page.snapshot.bytes, updates, next, page.snapshot.id)) throw new TransportError("validation", "LOCAL_COMMIT_FAILED");
        } else await this.coordinator.editCollaboration(updates, next);
        if (!this.valid(epoch)) return false;
        if (!await this.coordinator.flush()) throw new TransportError("validation", "LOCAL_COMMIT_FAILED");
        const committed = await this.coordinator.getCommittedCollaboration();
        if (!this.valid(epoch)) return false;
        if (!committed || compareRevisions(committed.serverCursor, next) < 0) throw new TransportError("protocol", "CURSOR_NOT_COMMITTED");
        cursor = committed.serverCursor; knownSnapshotId = committed.knownSnapshotId; this.state.cursor = cursor;
      }
      await this.channel(page, credential, epoch);
      if (!this.valid(epoch)) return false;
      if (compareRevisions(cursor, page.headSeq) >= 0) return true;
    }
    this.requested.add("pull"); return false;
  }
  private async channel(page: PullPage, credential: Credential, epoch: number) {
    const key = `${page.topic}/${page.aclGeneration}/${credential.accessToken}`;
    if (key === this.topicKey) return;
    this.closeChannel(); this.topicKey = key;
    let unsubscribe: () => void;
    try { unsubscribe = await this.transport.subscribe(page.topic, credential, value => {
      if (!this.valid(epoch) || this.topicKey !== key) return;
      if (value && typeof value === 'object' && 'type' in value && value.type === 'acl-changed') {
        this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.closeChannel();
        this.state.credentialConfirmed = false; this.state.pullConfirmed = false;
        this.options.aclChanged?.(); this.emit(); this.wake(); return;
      }
      const notice = parseNotice(value);
      if (notice?.documentId === page.documentId && notice.generation === page.generation && notice.aclGeneration === page.aclGeneration && compareRevisions(notice.headSeq, this.state.cursor) > 0) this.kick("pull");
    }, connected => {
      if (!this.valid(epoch) || this.topicKey !== key) return;
      this.state.realtimeConnected = connected; this.emit();
      if (connected) this.kick("pull");
      else this.closeChannel();
    }); } catch (error) { this.closeChannel(); throw error instanceof TransportError ? error : new TransportError("network", "REALTIME_UNAVAILABLE"); }
    if (!this.valid(epoch) || this.topicKey !== key) unsubscribe(); else this.unsubscribe = unsubscribe;
  }
  /** Independent from send/pull and SaveCoordinator writes. A failed automatic
   * checkpoint never holds editing, ACKs, or outbox collection. DB lease coalesces peers. */
  private requestMaintenance(delay = 100): void {
    if (!this.transport.maintenance || this.sendOnly) return;
    this.maintenancePending = true;
    if (!this.valid(this.epoch) || this.maintenanceRunning || this.maintenanceTimer || this.state.sharing !== "active") return;
    this.maintenanceTimer = setTimeout(() => { this.maintenanceTimer = undefined; void this.maintain(); }, delay);
  }
  private async maintain(): Promise<void> {
    if (!this.transport.maintenance || !this.valid(this.epoch) || this.sendOnly) return;
    const epoch = this.epoch, signal = this.controller.signal;
    this.maintenanceRunning = true; this.maintenancePending = false;
    let retry = 0;
    try {
      const data = await this.coordinator.getCommittedCollaboration();
      if (!this.valid(epoch) || !data?.sharedDocumentId || !data.transportBinding) return;
      const auth = await this.transport.credential(signal);
      if (!this.valid(epoch) || !auth || auth.accountId !== data.transportBinding.accountId) return;
      const membership = await this.transport.membership(data.sharedDocumentId, auth, signal);
      if (!this.valid(epoch) || membership !== data.transportBinding.membershipGeneration) return;
      const result = await this.transport.maintenance({ action: "maintain", documentId: data.sharedDocumentId, generation: data.generation,
        membershipGeneration: membership }, auth, signal) as { result?: string; retryAfterMs?: number; maintenance?: unknown };
      if (!this.valid(epoch)) return;
      if (!result || !["NOOP","BUSY","RATE_LIMIT","DEFERRED_CAPACITY","STORED","COMPACTED"].includes(result.result ?? "")) throw new TransportError("protocol", "INVALID_MAINTENANCE_RESPONSE");
      this.maintenanceAttempts = 0;
      this.state.historyDeferred = result.result === 'DEFERRED_CAPACITY'; this.emit();
      if (result.result === "COMPACTED") this.kick("pull"); // snapshot ID is committed by the existing receive transaction
      if (["BUSY","RATE_LIMIT","DEFERRED_CAPACITY"].includes(result.result!) || needsMaintenance(result.maintenance))
        retry = Math.max(10_000, Math.min(300_000, Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 10_000));
    } catch (error) {
      if (!this.valid(epoch)) return;
      if (error instanceof TransportError && error.kind === 'capacity') { this.state.historyDeferred = true; this.emit(); }
      if (!(error instanceof TransportError) || ["network","temporary","rate-limit","capacity"].includes(error.kind) ||
        ["LEASE_EXPIRED","STALE_LEASE","SNAPSHOT_CONFLICT"].includes(error.code)) {
        retry = Math.max(error instanceof TransportError ? error.retryAfterMs : 0,
          Math.min(300_000, (this.options.backoffMs ?? 1000) * 2 ** Math.min(this.maintenanceAttempts++, 9)) * (0.5 + (this.options.random ?? Math.random)()));
      }
    } finally {
      this.maintenanceRunning = false;
      if (this.valid(epoch)) {
        if (retry) this.requestMaintenance(retry);
        else if (this.maintenancePending) this.requestMaintenance();
      } else if (this.maintenancePending && this.valid(this.epoch)) this.requestMaintenance();
    }
  }
}
