import type { Project, AudioMeta } from "../types";
import type { ProjectRecord, ProjectRepository, ProjectSummary } from "../repositories/types";
import { SaveCoordinator, type SaveState } from "../storage/saveCoordinator";
import { SharedSessionStore, sessionSnapshot } from "../storage/sharedSessionState";
import { cloudAuthIdentity, subscribeCloudAuth, waitCloudAuthRestoration } from "../cloud/session";
import type { CloudConfig } from "../cloud/config";
import { SharedProjectEditor } from "./editorSession";
import { CollaborationProvider } from "./provider";
import { createParticipantAuth } from "./guestAuth";
import { createHttpTransport, createSupabaseTransport } from "./supabaseTransport";
import { CollaborationLifecycle } from "./lifecycle";
import { createManagementTransport } from "./managementTransport";
import { getModel } from "./model";
import type { HistoryResult } from "./commands";
import type { CollaborationTransport } from "./transport";

export type SharedSessionOptions = {
  enabled: boolean; config: CloudConfig | null; platform: "web" | "ipad"; mock?: boolean;
  current: () => boolean; publish: (project: Project) => void; failed: (error: unknown) => void;
  saved: (state: SaveState | null) => void; committed: (summary: ProjectSummary) => void;
};
/** One document, one coordinator, one persistent editor and one provider. */
export class SharedSessionController {
  readonly store = new SharedSessionStore();
  readonly coordinator: SaveCoordinator;
  editor!: SharedProjectEditor;
  attached = false;
  provider: CollaborationProvider | null = null;
  private detached = false;
  private disposed = false;
  private authEpoch = cloudAuthIdentity().epoch;
  private history: HistoryResult | null = null;
  private releases: (() => void)[] = [];
  private drainTimer?: ReturnType<typeof setTimeout>;
  private finishDrain?: () => void;
  private transport: CollaborationTransport | null = null;
  private constructor(private repository: ProjectRepository, readonly localId: string, private options: SharedSessionOptions) {
    this.coordinator = new SaveCoordinator(repository, state => {
      this.editor?.receiveDurable(); this.update();
      if (this.current()) options.saved(state);
    }, summary => options.committed(summary));
    this.releases.push(this.coordinator.subscribeCommits(event => {
      if (event.id !== localId || this.disposed) return;
      this.provider?.committedPending(event.pendingCount);
      if (!event.pendingUpdateIds.length) return;
      // A microtask merges several commits; ACK/cursor/view-only commits do not wake.
      if (this.sendQueued) return;
      this.sendQueued = true; queueMicrotask(() => { this.sendQueued = false; if (!this.disposed) this.provider?.wakeSend(); });
    }));
  }
  private sendQueued = false;
  static async create(repository: ProjectRepository, record: ProjectRecord, options: SharedSessionOptions) {
    const owner = new SharedSessionController(repository, record.project.id!, options);
    try {
      owner.coordinator.activate(record);
      owner.attached = !!record.collaboration?.sharedDocumentId;
      owner.editor = await SharedProjectEditor.create(owner.coordinator, record.project, project => {
        if (owner.current()) options.publish(project);
      }, options.failed);
      owner.update();
      if (record.collaboration?.sharedDocumentId && options.enabled && options.config) {
        await waitCloudAuthRestoration().catch(() => {});
        const auth = createParticipantAuth(options.config, options.platform);
        // Guest recovery belongs to the common session owner before capturing identity.
        auth.state(); owner.authEpoch = cloudAuthIdentity().epoch;
        owner.transport = options.mock && import.meta.env.DEV ? createHttpTransport(options.config, auth.credential, async (topic, credential, notice, status) => {
          const url = new URL(options.config!.url);
          if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("試験接続はローカルのみです。");
          const events = new EventSource(`${url.origin}/events?topic=${encodeURIComponent(topic)}&actor=${encodeURIComponent(credential.accountId)}`);
          events.onmessage = event => notice(JSON.parse(event.data)); events.onopen = () => status(true); events.onerror = () => status(false);
          return () => events.close();
        }) : createSupabaseTransport(options.config, auth.credential);
        owner.provider = new CollaborationProvider(owner.coordinator, owner.transport, { valid: () => owner.authValid() });
        owner.releases.push(owner.provider.subscribe(() => owner.update()));
        owner.releases.push(subscribeCloudAuth(() => {
          if (!owner.authValid()) {
            owner.provider?.stop(); owner.update(); owner.finishDrain?.();
          } else owner.provider?.wake();
        }));
      }
      return owner;
    } catch (error) { owner.dispose(); throw error; }
  }
  start() { if (!this.disposed) this.provider?.start(); }
  private current() { return !this.disposed && !this.detached && this.options.current(); }
  private authValid() { return !this.disposed && cloudAuthIdentity().epoch === this.authEpoch; }
  private update() {
    let state = this.provider?.snapshot ?? null;
    if (state && !this.authValid()) state = { ...state, held: true, credentialConfirmed: false, sharing: "auth-required" };
    this.store.set(sessionSnapshot(this.localId, state, this.coordinator.state, this.history));
  }
  historyResult(result: HistoryResult) { this.history = result; this.update(); }
  get song(): Omit<AudioMeta, "id"> | null | undefined { return getModel(this.editor.doc).settings.get("song") as Omit<AudioMeta, "id"> | null | undefined; }
  audioMatches(meta: AudioMeta | null | undefined): boolean {
    const song = this.song;
    return !song ? !meta : !!meta && ["name", "type", "size", "duration"].every(key => song[key as keyof typeof song] === meta[key as keyof AudioMeta]);
  }
  async flush(): Promise<boolean> { this.editor.end(); return this.editor.stagePending() && await this.coordinator.flush(); }
  /** UI awaits device durability, never network drain. Caller retains this owner
   * independently until background completion, then switches its coordinator. */
  async close(background = true): Promise<boolean> {
    if (!await this.flush()) return false;
    const pending = (await this.coordinator.getSendableOutbox()).length;
    this.detached = true;
    if (!background || !pending || !this.provider?.snapshot.online || !this.authValid() || this.provider.snapshot.error || this.provider.snapshot.held) {
      this.dispose(); return true;
    }
    this.provider.backgroundSendOnly(); return true;
  }
  beginBackground(timeoutMs = 30_000): Promise<void> {
    if (this.disposed || !this.provider) { this.dispose(); return Promise.resolve(); }
    return new Promise(resolve => {
      let unsubscribe = () => {};
      const finish = () => { unsubscribe(); this.dispose(); resolve(); };
      this.finishDrain = finish;
      this.drainTimer = setTimeout(finish, timeoutMs);
      unsubscribe = this.provider!.subscribe(state => {
        if (state.error || state.held || !state.online || !this.authValid()) finish();
        else if (!state.syncing) void this.coordinator.getSendableOutbox().then(outbox => { if (!outbox.length) finish(); }).catch(finish);
      });
      if (this.disposed) unsubscribe();
      this.provider!.wakeSend();
    });
  }
  async prepareIndependentCopy() {
    this.editor.end(); this.editor.stagePending();
    // Rescue uses live projection even when the original cannot be saved.
    if (!this.options.config || !this.transport) {
      const project = { ...structuredClone(this.editor.project), id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
      return { project, collaboration: null, expectedRepositoryRevision: null, localRevision: "1", operationId: crypto.randomUUID() } as const;
    }
    const lifecycle = new CollaborationLifecycle(this.repository, createManagementTransport(this.options.config), this.transport,
      { platform: this.options.platform, invitationBaseUrl: window.location.origin, allowedOrigins: [window.location.origin] });
    return lifecycle.prepareIndependentCopy(this.localId, this.editor.project);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.provider?.stop(); clearTimeout(this.drainTimer);
    this.releases.splice(0).forEach(release => release()); this.editor?.destroy();
    const finish = this.finishDrain; this.finishDrain = undefined; finish?.();
  }
}
