import type { SaveCoordinator } from "../storage/saveCoordinator";
import { compareRevisions, incrementRevision, RepositoryError, type CollaborationData, type CollaborationUpdate } from "../repositories/types";
import { parseAck, parseNotice, parsePage, TransportError, uuid, type CollaborationTransport, type Credential, type PullPage } from "./transport";

export type ProviderError = { kind: TransportError["kind"] | "storage" | "membership"; code: string };
export type ProviderState = { online: boolean; realtimeConnected: boolean; syncing: boolean; pending: number; held: boolean; cursor: string; error: ProviderError | null };
/** Notification only, durable queue only. One instance owns one active coordinator session. */
export class CollaborationProvider {
  private state: ProviderState = { online: true, realtimeConnected: false, syncing: false, pending: 0, held: false, cursor: "0", error: null };
  private listeners = new Set<(state: ProviderState) => void>();
  private stopped = true;
  private controller = new AbortController();
  private timers = new Map<"send" | "pull", ReturnType<typeof setTimeout>>();
  private running = new Set<"send" | "pull">();
  private requested = new Set<"send" | "pull">();
  private attempts = { send: 0, pull: 0 };
  private errors: Partial<Record<"send" | "pull", ProviderError>> = {};
  private blocked = new Set<"send" | "pull">();
  private topicKey = "";
  private unsubscribe: (() => void) | null = null;
  private epoch = 0;
  private activeId: string | null = null;
  private poll?: ReturnType<typeof setInterval>;
  constructor(private coordinator: SaveCoordinator, private transport: CollaborationTransport,
    private options: { pollMs?: number; backoffMs?: number; random?: () => number; lifecycle?: boolean } = {}) {}
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
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline); window.removeEventListener("offline", this.onOffline); document.removeEventListener("visibilitychange", this.onVisible);
    }
    this.emit();
  }
  /** After local flush, reconnect, foreground, or renewed authentication. Never flushes local edits to send. */
  wake(): void { this.blocked.clear(); this.kick("pull"); this.kick("send"); }
  setOnline(online: boolean): void {
    this.state.online = online; this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.closeChannel();
    this.timers.forEach(clearTimeout); this.timers.clear();
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
  private valid(epoch: number): boolean { return !this.stopped && this.state.online && this.epoch === epoch && this.coordinator.state?.id === this.activeId; }
  private closeChannel() { this.topicKey = ""; const unsubscribe = this.unsubscribe; this.unsubscribe = null; this.state.realtimeConnected = false; unsubscribe?.(); }
  private kick(lane: "send" | "pull") {
    if (this.stopped || !this.state.online || this.blocked.has(lane) || this.coordinator.state?.id !== this.activeId) return;
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
      const data = await this.coordinator.getCommittedCollaboration();
      if (!data?.sharedDocumentId || !this.valid(epoch)) return;
      this.state.cursor = data.serverCursor; this.state.pending = data.outbox.filter(e => e.status === "pending").length;
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
      this.state.held = membership !== data.transportBinding.membershipGeneration;
      if (lane === "send" && this.state.held) {
        this.errors.send = { kind: "membership", code: "MEMBERSHIP_CHANGED" }; this.blocked.add("send"); return;
      }
      if (lane === "send") await this.send(data, credential, epoch, signal);
      else await this.pull(data, credential, epoch, signal);
      if (!this.valid(epoch)) return;
      delete this.errors[lane]; this.attempts[lane] = 0;
    } catch (error) {
      if (!this.valid(epoch)) return;
      const e = error instanceof TransportError ? error : new TransportError("validation", error instanceof RepositoryError ? error.code : "LOCAL_STATE_INVALID");
      this.errors[lane] = { kind: error instanceof RepositoryError || e.code.startsWith("LOCAL_") ? "storage" : e.kind, code: e.code };
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
    const outbox = await this.coordinator.getSendableOutbox();
    for (const update of outbox) {
      if (!this.valid(epoch)) return;
      // Recheck each request; no arbitrary topic or actor is sent to Edge.
      const membership = await this.transport.membership(data.sharedDocumentId!, credential, signal);
      if (!this.valid(epoch)) return;
      if (membership !== data.transportBinding!.membershipGeneration) { this.state.held = true; throw new TransportError("permission", "MEMBERSHIP_CHANGED"); }
      const request = { action: "append" as const, documentId: data.sharedDocumentId!, generation: data.generation,
        membershipGeneration: data.transportBinding!.membershipGeneration, updateId: update.updateId, bytes: update.bytes };
      parseAck(await this.transport.append(request, credential, signal), request);
      if (!this.valid(epoch)) return;
      if (!await this.coordinator.markOutboxSent([update.updateId])) throw new TransportError("validation", "LOCAL_ACK_COMMIT_FAILED");
      this.state.pending = (await this.coordinator.getSendableOutbox()).length; this.emit();
    }
  }
  private async pull(data: CollaborationData, credential: Credential, epoch: number, signal: AbortSignal) {
    let cursor = data.serverCursor;
    // Bound each turn; a busy document yields before catching up further.
    for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
      const page = parsePage(await this.transport.pull(data.sharedDocumentId!, data.generation, cursor, 32, credential, signal), data.sharedDocumentId!, data.generation);
      if (!this.valid(epoch)) return;
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
          if (!await this.coordinator.receiveCollaborationSnapshot(page.snapshot.bytes, updates, next)) throw new TransportError("validation", "LOCAL_COMMIT_FAILED");
        } else await this.coordinator.editCollaboration(updates, next);
        if (!this.valid(epoch)) return;
        if (!await this.coordinator.flush()) throw new TransportError("validation", "LOCAL_COMMIT_FAILED");
        const committed = await this.coordinator.getCommittedCollaboration();
        if (!this.valid(epoch)) return;
        if (!committed || compareRevisions(committed.serverCursor, next) < 0) throw new TransportError("protocol", "CURSOR_NOT_COMMITTED");
        cursor = committed.serverCursor; this.state.cursor = cursor;
      }
      await this.channel(page, credential, epoch);
      if (!this.valid(epoch) || compareRevisions(cursor, page.headSeq) >= 0) return;
    }
    this.requested.add("pull");
  }
  private async channel(page: PullPage, credential: Credential, epoch: number) {
    const key = `${page.topic}/${page.aclGeneration}/${credential.accessToken}`;
    if (key === this.topicKey) return;
    this.closeChannel(); this.topicKey = key;
    let unsubscribe: () => void;
    try { unsubscribe = await this.transport.subscribe(page.topic, credential, value => {
      if (!this.valid(epoch) || this.topicKey !== key) return;
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
}
