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
import { describeAudio, mergeAudioBindings, sameSong, songKey, validateAudioBindings } from "../repositories/audioBindings";
import { chooseDeviceAudio, deviceAudioCandidates } from "./deviceAudio";
import { CollaborationHistory, createHistoryTransport } from './historyApi';
import { HistoryController } from './historyController';

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
  historyUi: HistoryController | null = null;
  private detached = false;
  private disposed = false;
  private authEpoch = cloudAuthIdentity().epoch;
  private history: HistoryResult | null = null;
  private historyEvent = 0;
  private releases: (() => void)[] = [];
  private drainTimer?: ReturnType<typeof setTimeout>;
  private finishDrain?: () => void;
  private transport: CollaborationTransport | null = null;
  audioCandidates: AudioMeta[] = [];
  private reviewedSong?: string;
  private audioReview = 0;
  private constructor(private repository: ProjectRepository, readonly localId: string, private options: SharedSessionOptions) {
    this.coordinator = new SaveCoordinator(repository, state => {
      this.editor?.receiveDurable(); this.update();
      if (this.current()) options.saved(state);
    }, summary => options.committed(summary));
    this.releases.push(this.coordinator.subscribeCommits(event => {
      if (event.id !== localId || this.disposed) return;
      this.provider?.committedPending(event.pendingCount);
      this.historyUi?.wake();
      // A successful retry may have no new outbox entry (remote-only save).
      // Resume the receive lane that was fenced after its storage failure.
      if (this.provider?.snapshot.error?.kind === 'storage') this.provider.wake();
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
        void owner.reviewAudio();
      }, options.failed);
      owner.update();
      if (record.collaboration?.sharedDocumentId && options.enabled && options.config) {
        await waitCloudAuthRestoration().catch(() => {});
        const auth = createParticipantAuth(options.config, options.platform);
        // Guest recovery belongs to the common session owner before capturing identity.
        auth.state(); owner.authEpoch = cloudAuthIdentity().epoch;
        if (record.collaboration.transportBinding) owner.historyUi = new HistoryController({
          localId: owner.localId, repository, identity: record.collaboration,
          history: new CollaborationHistory(repository, createHistoryTransport(options.config, auth.credential)),
          valid: () => owner.authValid() && auth.state().status === 'signed-in' && cloudAuthIdentity().accountId === record.collaboration!.transportBinding!.accountId &&
            (!owner.provider || owner.provider.snapshot.sharing === 'active'),
          wake: () => owner.provider?.wake(),
        });
        owner.transport = options.mock && import.meta.env.DEV ? createHttpTransport(options.config, auth.credential, async (topic, credential, notice, status) => {
          const url = new URL(options.config!.url);
          if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("試験接続はローカルのみです。");
          const events = new EventSource(`${url.origin}/events?topic=${encodeURIComponent(topic)}&actor=${encodeURIComponent(credential.accountId)}`);
          events.onmessage = event => notice(JSON.parse(event.data)); events.onopen = () => status(true); events.onerror = () => status(false);
          return () => events.close();
        }) : createSupabaseTransport(options.config, auth.credential);
        owner.provider = new CollaborationProvider(owner.coordinator, owner.transport, { valid: () => owner.authValid() });
        owner.releases.push(owner.provider.subscribe(() => { owner.update(); owner.historyUi?.wake(); }));
        owner.releases.push(subscribeCloudAuth(() => {
          if (!owner.authValid()) {
            owner.provider?.stop(); owner.update(); owner.finishDrain?.();
          } else owner.provider?.wake();
        }));
      }
      await owner.reviewAudio();
      return owner;
    } catch (error) { owner.dispose(); throw error; }
  }
  start() { if (!this.disposed) this.provider?.start(); }
  private current() { return !this.disposed && !this.detached && this.options.current(); }
  private authValid() { return !this.disposed && cloudAuthIdentity().epoch === this.authEpoch; }
  private update() {
    let state = this.provider?.snapshot ?? null;
    if (state && !this.authValid()) state = { ...state, held: true, credentialConfirmed: false, sharing: "auth-required" };
    this.store.set({ ...sessionSnapshot(this.localId, state, this.coordinator.state, this.history), historyEvent: this.historyEvent });
  }
  historyResult(result: HistoryResult) { this.history = result; this.historyEvent++; this.update(); }
  get song(): Omit<AudioMeta, "id"> | null | undefined { return getModel(this.editor.doc).settings.get("song") as Omit<AudioMeta, "id"> | null | undefined; }
  audioMatches(meta: AudioMeta | null | undefined): boolean {
    const song = this.song;
    return !song ? !meta : !!meta && this.coordinator.audioBindingsProjection.some(b =>
      sameSong(b.song, song) && b.audio.id === meta.id && sameSong(b.audio, meta));
  }
  /** Explicit local choice also supports a different encoding of the same song.
   * Capture descriptor at picker start; never attach a late reply to a new song. */
  bindAudio(audio: AudioMeta, expectedSong = songKey(this.song)): void {
    if (this.disposed || expectedSong !== songKey(this.song) || !this.song) throw new Error("共通曲が変わりました。曲を確認して、もう一度この端末のファイルを選んでください。");
    const bindings = mergeAudioBindings(this.coordinator.audioBindingsProjection, [{ song: this.song, audio }]);
    validateAudioBindings(bindings);
    ++this.audioReview; this.reviewedSong = songKey(this.song);
    this.coordinator.setAudioBindings(bindings);
    this.editor.setLocal({ ...this.editor.project, audio });
  }
  changeSong(audio: AudioMeta): void {
    this.editor.edit(previous => ({ ...previous, audio }));
    this.bindAudio(audio);
  }
  private async reviewAudio(): Promise<void> {
    if (!this.editor || this.disposed) return;
    const song = this.song, key = songKey(song);
    if (this.reviewedSong === key) return;
    this.reviewedSong = key;
    const review = ++this.audioReview;
    if (!song) { this.audioCandidates = []; if (this.editor.project.audio) this.editor.setLocal({ ...this.editor.project, audio: null }); return; }
    try {
      const bindings = this.coordinator.audioBindingsProjection;
      const candidates = await deviceAudioCandidates(this.repository, bindings, this.editor.project.audio);
      const audio = await chooseDeviceAudio(song, bindings, candidates);
      if (this.disposed || review !== this.audioReview || key !== songKey(this.song)) return;
      this.audioCandidates = candidates;
      if (audio) this.bindAudio(audio, key);
      else this.editor.setLocal({ ...this.editor.project, audio: null });
    } catch (error) {
      if (this.disposed || review !== this.audioReview) return;
      this.editor.setLocal({ ...this.editor.project, audio: null }); this.options.failed(error);
      this.reviewedSong = undefined; // A later explicit retry can inspect storage again.
    }
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
    const live = this.editor.project;
    const safeProject = { ...live, audio: this.audioMatches(live.audio) ? live.audio : null };
    // Rescue uses live projection even when the original cannot be saved.
    if (!this.options.config || !this.transport) {
      const project = { ...structuredClone(safeProject), id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
      return { project, collaboration: null, expectedRepositoryRevision: null, localRevision: "1", operationId: crypto.randomUUID() } as const;
    }
    const lifecycle = new CollaborationLifecycle(this.repository, createManagementTransport(this.options.config), this.transport,
      { platform: this.options.platform, invitationBaseUrl: window.location.origin, allowedOrigins: [window.location.origin] });
    return lifecycle.prepareIndependentCopy(this.localId, safeProject);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.provider?.stop(); this.historyUi?.stop(); clearTimeout(this.drainTimer);
    this.releases.splice(0).forEach(release => release()); this.editor?.destroy();
    const finish = this.finishDrain; this.finishDrain = undefined; finish?.();
  }
}
