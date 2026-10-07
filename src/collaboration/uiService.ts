import type { CollaborationUiOptions, SharingOperation } from "./uiTypes";
import type { CommitRequest, ProjectRecord } from "../repositories/types";
import type { ParticipantAuthState } from "./guestAuth";
import type { DocumentCursor, SharedDocumentSummary, SharedInvite, SharedMember } from "./managementTransport";
import { createParticipantAuth } from "./guestAuth";
import { createManagementTransport } from "./managementTransport";
import { createSupabaseTransport } from "./supabaseTransport";
import { CollaborationLifecycle } from "./lifecycle";
import { createCollaborationAccountApi } from "./account";
import { invitationToken } from "./invitations";
import { invitationBaseUrl, invitationOrigins } from "../config/collaborationLinks";
import { readInvitation, rememberInvitation, forgetInvitation } from "../storage/invitationMemory";
import { createCloudAuthClient, CloudAuthError } from "../cloud/auth";
import { cloudAuthEpoch, saveCloudAuthSession, waitCloudAuthPersistence, waitCloudAuthRestoration } from "../cloud/session";
import { prepareIndependentProjectCopy, sharingContentKey } from "../project/independentCopy";

type Screen = "manage" | "invite" | "account" | null;
type UiState = { screen: Screen; busy: boolean; error: string | null; notice: string | null; auth: ParticipantAuthState;
  documents: SharedDocumentSummary[]; cursor: DocumentCursor | null; members: SharedMember[]; invites: SharedInvite[]; link: string;
  issued: { inviteId: string; link: string } | null; localId: string | null };
const messages: Record<string, string> = {
  INVALID_INVITE: "この招待は期限切れ、使用済み、または取り消されています。新しい招待リンクをもらってください。",
  INVALID_INVITE_LINK: "招待リンクを確認してください。正式な隊列メーカーのリンクを貼り付けてください。",
  INVALID_DISPLAY_NAME: "表示名は1〜80文字で入力してください。",
  IPAD_ACCOUNT_REQUIRED: "iPadアプリではアカウントでログインしてから参加してください。",
  PERMANENT_ACCOUNT_REQUIRED: "共有を始めるにはアカウントでログインしてください。",
  AUTH_REQUIRED: "ログインしてから再試行してください。", ACCOUNT_CHANGED: "ログイン状態が変わりました。もう一度操作してください。",
  MEMBER_LIMIT: "参加できるのは8人までです。", NOT_MEMBER: "この隊列表の参加資格を確認できません。",
  MEMBERSHIP_CHANGED: "参加資格が変わりました。新しい参加資格で開き直してください。",
  INVITE_ATTEMPT_LIMIT: "試行回数が多いため、10分後に再試行してください。",
  PERSONAL_SYNC_CONFLICT: "旧クラウドと同期中の隊列表です。ホームで複製し、そのコピーをクラウドに保存してください。元の隊列表は端末に残っています。",
  ALREADY_SHARED: "この隊列表はすでにクラウドに保存されています。",
};
export const collaborationUiError = (error: unknown) => {
  if (error instanceof CloudAuthError) {
    const detail = `${error.details?.error_code ?? ""} ${error.details?.error ?? ""} ${error.message}`.toLowerCase();
    if (/invalid_credentials|invalid login credentials/.test(detail)) return "メールアドレスまたはパスワードが正しくありません。";
    if (/email_not_confirmed|email not confirmed/.test(detail)) return "アカウントの確認が完了していません。管理者にお問い合わせください。";
    if (/user_already_exists|email_exists|already registered/.test(detail)) return "このメールアドレスはすでに登録されています。";
    if (/weak_password|password should be/.test(detail)) return "パスワードは6文字以上で設定してください。";
    if (error.status === 429 || /rate_limit/.test(detail)) return "試行回数が多いため、しばらく待ってから再試行してください。";
    return "アカウント操作を完了できませんでした。入力と通信を確認してください。";
  }
  const code = (error as { code?: string })?.code;
  return code && messages[code] || (error instanceof Error && /[ぁ-んァ-ヶ一-龯]/u.test(error.message) ? error.message : "共同編集を確認できませんでした。通信を確認して再試行してください。");
};
/** One UI owner: explicit operations only, no whole-library providers. Fixed
 * commit requests and capability links are retained only in this memory. */
export class CollaborationUiService {
  private listeners = new Set<() => void>();
  private state: UiState;
  private fixed: { request: CommitRequest; epoch: number; link?: string } | null = null;
  private rescue: { request: CommitRequest; projection: import("../types").Project; localId: string } | null = null;
  private api: CollaborationLifecycle | null = null;
  private auth: ReturnType<typeof createParticipantAuth> | null = null;
  private ready: Promise<void> | null = null;
  private afterLogin: "manage" | null = null;
  private linkRevision = 0;
  private sharingCopies = new Map<string, { accountId: string; content: string; request: CommitRequest }>();
  private listRevision = 0;
  private receivedInvitation = readInvitation();
  constructor(private options: () => CollaborationUiOptions) {
    const invitation = readInvitation();
    this.state = { screen: invitation ? "invite" : null, busy: false, error: invitation?.invalid ? messages.INVALID_INVITE_LINK : null,
      notice: null, auth: { status: "restoring" }, documents: [], cursor: null, members: [], invites: [], link: invitation?.link ?? "", issued: null, localId: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<UiState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  initialize() { return this.ready ??= (async () => {
    await waitCloudAuthRestoration();
    const { config, platform } = this.options();
    if (config) {
      this.auth = createParticipantAuth(config, platform);
      this.api = new CollaborationLifecycle(this.repository(), createManagementTransport(config), createSupabaseTransport(config, this.auth.credential),
        { platform, auth: this.auth, invitationBaseUrl, allowedOrigins: invitationOrigins });
    }
    this.authChanged();
  })().catch(error => { this.patch({ error: collaborationUiError(error) }); this.ready = null; }); }
  private repository() { const repository = this.options().repository(); if (!repository) throw new Error("端末の保存領域を準備中です。"); return repository; }
  private lifecycle() { if (!this.api) throw new Error("共同編集は現在利用できません。"); return this.api; }
  authChanged() {
    const auth = this.auth?.state() ?? { status: "signed-out", guestRecovery: "new-invite-required" } as const;
    const previous = this.state.auth;
    const changed = previous.status !== auth.status || previous.status === "signed-in" && auth.status === "signed-in" && previous.userId !== auth.userId;
    this.patch({ auth, ...(changed ? { documents: [], cursor: null, members: [], invites: [], issued: null } : {}) });
    if (changed) { this.fixed = null; this.rescue = null; this.sharingCopies.clear(); this.listRevision++; }
  }
  async run(action: () => Promise<void>) {
    if (this.state.busy) return;
    this.linkRevision++;
    this.patch({ busy: true, error: null, notice: null });
    try { await this.initialize(); await action(); }
    catch (error) { this.patch({ error: collaborationUiError(error) }); }
    finally { this.patch({ busy: false }); }
  }
  close() { if (!this.state.busy) { this.linkRevision++; this.patch({ screen: null, error: null, ...(this.state.screen === "account" ? { notice: null } : {}) }); } }
  account() { this.linkRevision++; this.patch({ screen: "account", error: null }); }
  invitation(link?: string) {
    if (this.state.busy) return;
    this.linkRevision++;
    if (link !== undefined) { this.fixed = null; rememberInvitation(link); this.receivedInvitation = readInvitation(); }
    this.patch({ screen: "invite", ...(link !== undefined ? { link } : {}), error: null });
  }
  receiveInvitation(value: { link: string; invalid?: boolean }) {
    if (value === this.receivedInvitation) return true;
    if (this.state.busy || this.fixed) return false;
    this.receivedInvitation = value;
    this.linkRevision++;
    this.patch({ screen: "invite", link: value.link, error: value.invalid ? messages.INVALID_INVITE_LINK : null });
    return true;
  }
  setLink(link: string) { if (!this.state.busy && !this.fixed) { this.linkRevision++; this.patch({ link }); } }
  async paste(readText: () => Promise<string>): Promise<void> {
    if (this.state.busy || this.fixed) return;
    const revision = ++this.linkRevision;
    let link: string;
    try { link = await readText(); } // Start in the click's user activation, outside run().
    catch (error) { if (revision === this.linkRevision && this.state.screen === "invite") throw error; return; }
    if (revision === this.linkRevision && this.state.screen === "invite") this.setLink(link);
  }
  async refresh(more = false) {
    const epoch = cloudAuthEpoch();
    const revision = ++this.listRevision, auth = this.auth?.state();
    if (auth?.status !== "signed-in" || typeof navigator !== "undefined" && navigator.onLine === false) { this.patch({ documents: [], cursor: null }); return; }
    if (!more) this.patch({ documents: [], cursor: null });
    // Foundation caps the whole service at 100 documents. This lightweight
    // page covers every local badge without reading any CRDT; cursor remains
    // supported if that server limit grows in a later version.
    const page = await this.lifecycle().listMyDocuments(100, more ? this.state.cursor : null);
    const latest = this.auth?.state();
    if (epoch !== cloudAuthEpoch() || revision !== this.listRevision || latest?.status !== "signed-in" || latest.userId !== auth.userId) return;
    this.patch({ documents: more ? [...this.state.documents, ...page.items] : page.items, cursor: page.nextCursor });
  }
  connectivityChanged() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { this.listRevision++; this.patch({ documents: [], cursor: null }); }
  }
  // Independent editor has no shared session: App supplies its current ID.
  manageLocal(localId: string) { this.patch({ screen: "manage", localId, error: null, members: [], invites: [] }); void this.run(() => this.refreshManagement()); }
  private async sharedRecord() {
    const localId = this.state.localId; if (!localId) throw new Error("隊列表を開いてから操作してください。");
    const record = await this.repository().get(localId); if (!record) throw new Error("隊列表が見つかりません。"); return record;
  }
  async refreshManagement() {
    const record = await this.sharedRecord(), documentId = record.collaboration?.sharedDocumentId;
    if (!documentId || this.auth?.state().status !== "signed-in") return;
    const epoch = cloudAuthEpoch();
    const [members, invites] = await Promise.all([this.lifecycle().members(documentId), this.lifecycle().invites(documentId)]);
    if (epoch === cloudAuthEpoch() && record.project.id === this.state.localId) this.patch({ members, invites });
    await this.refresh().catch(() => {});
  }
  async signIn(email: string, password: string, name?: string) {
    const config = this.options().config; if (!config) throw new Error("共同編集は現在利用できません。");
    const epoch = cloudAuthEpoch(), client = createCloudAuthClient(config);
    const session = name === undefined ? await client.signInWithPassword(email.trim(), password) : await client.signUpWithPassword(email.trim(), password, name.trim());
    if (epoch !== cloudAuthEpoch()) throw new Error(messages.ACCOUNT_CHANGED);
    if (!session) throw new Error("登録を完了できませんでした。管理者にお問い合わせください。");
    saveCloudAuthSession(session); await waitCloudAuthPersistence(); this.authChanged();
    this.patch({ screen: readInvitation() ? "invite" : this.afterLogin, notice: null }); this.afterLogin = null; await this.refresh();
  }
  async signOut() { await this.auth?.signOut(new AbortController().signal); this.authChanged(); this.patch({ screen: null }); }
  async deleteAccount(password: string) {
    const config = this.options().config; if (!config) throw new Error("共同編集は現在利用できません。");
    await createCollaborationAccountApi(config).deleteAccountWithPassword(password, "DELETE_MY_ACCOUNT");
    await waitCloudAuthPersistence(); this.authChanged(); this.patch({ screen: null, notice: "アカウントを削除しました。この端末のコピーは残っています。" });
  }
  async changePassword(current: string, next: string, confirmation: string) {
    const config = this.options().config; if (!config) throw new Error("共同編集は現在利用できません。");
    const result = await createCollaborationAccountApi(config).changePassword(current, next, confirmation);
    this.patch({ notice: result.persistenceFailed
      ? "パスワードを変更しました。この端末のログイン情報を保存できませんでした。次回は新しいパスワードでログインしてください。"
      : "パスワードを変更しました。" });
  }
  async start(name: string) {
    return this.saveLocalToCloud(this.state.localId ?? undefined, undefined, name);
  }
  /** Both entry points fix the operation synchronously, before initialization.
   * No login continuation, editor open, rescue copy or invitation is involved. */
  async saveLocalToCloud(localId?: string, operation?: SharingOperation, name?: string) {
    if (this.state.busy) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.patch({ error: "オフラインです。通信できる状態で、もう一度操作してください。", notice: null }); return;
    }
    const epoch = cloudAuthEpoch();
    const fixedOperation = operation ?? this.options().sharingOperation(localId);
    await this.run(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("オフラインです。通信できる状態で、もう一度操作してください。");
      const auth = this.auth?.state();
      if (auth?.status !== "signed-in" || auth.isGuest) {
        this.afterLogin = null;
        this.account();
        this.patch({ notice: "クラウドに保存するにはログインしてください。ログイン後、もう一度「クラウドに保存」を押してください。" });
        return;
      }
      const current = () => {
        const latest = this.auth?.state();
        return fixedOperation.current() && epoch === cloudAuthEpoch() && latest?.status === "signed-in" && !latest.isGuest && latest.userId === auth.userId;
      };
      const assertCurrent = () => { if (!current()) throw new Error("対象またはログイン状態が変わりました。もう一度操作してください。"); };
      assertCurrent();
      let copied = false, success = false, attempted = false;
      try {
        const source = await fixedOperation.prepare();
        assertCurrent();
        if (source.project.id !== fixedOperation.localId) throw new Error("開く対象が変わりました。");
        if (source.sync) throw Object.assign(new Error(messages.PERSONAL_SYNC_CONFLICT), { code: "PERSONAL_SYNC_CONFLICT" });
        if (source.collaboration?.sharedDocumentId) throw Object.assign(new Error(messages.ALREADY_SHARED), { code: "ALREADY_SHARED" });
        const content = sharingContentKey(source.project);
        let copy = this.sharingCopies.get(fixedOperation.localId);
        if (!copy || copy.accountId !== auth.userId || copy.content !== content) {
          copy = { accountId: auth.userId, content, request: prepareIndependentProjectCopy(source.project) };
          this.sharingCopies.set(fixedOperation.localId, copy);
        }
        await this.repository().commit(copy.request); copied = true;
        assertCurrent();
        const latest = await this.repository().get(fixedOperation.localId);
        if (latest?.repositoryRevision !== source.repositoryRevision) throw new Error("端末の隊列表が更新されました。内容を確認して、もう一度操作してください。");
        assertCurrent();
        attempted = true;
        let initialChecked = false;
        await this.lifecycle().startSharing(fixedOperation.localId, name || auth.displayName || "作成者", new AbortController().signal,
          async record => {
            assertCurrent();
            if (!initialChecked && record.repositoryRevision !== source.repositoryRevision) throw new Error("端末の隊列表が更新されました。内容を確認してください。");
            initialChecked = true;
            const saved = await this.repository().get(fixedOperation.localId);
            assertCurrent();
            if (saved?.repositoryRevision !== record.repositoryRevision) throw new Error("端末の隊列表が更新されました。内容を確認してください。");
          });
        assertCurrent(); success = true;
      } catch (error) {
        if (copied) throw new Error("共有を始めた時点のコピーは保存しました。クラウドへの保存は確認できませんでした。" + collaborationUiError(error));
        throw error;
      } finally {
        // Release preparation for every outcome; only an attempted lifecycle
        // may change sessions. Keep durable results explicit if UI setup fails.
        try { await fixedOperation.settle(success, attempted); }
        catch (error) { throw new Error((success ? "クラウドへの保存と開始時のコピー保存は完了しました。編集画面を準備できませんでした。ホームから隊列表を開いてください。"
          : copied ? "共有を始めた時点のコピーは保存しました。クラウドへの保存は確認できませんでした。" : "") + collaborationUiError(error)); }
      }
      this.patch({ screen: null, notice: "クラウドに保存しました。共有を始めた時点の独立したコピーも端末に残っています。コピーは以後の共同編集を受け取りません。" });
      await this.refresh().catch(() => {}); // A metadata failure cannot undo sharing.
    });
  }
  private async saveAndOpen(request: CommitRequest) {
    const record = await this.lifecycle().saveJoinedProject(request);
    if (!await this.options().open(record)) throw new Error("隊列表を保存しました。編集中の内容を保存してから開き直してください。");
    this.fixed = null; forgetInvitation(); this.patch({ screen: null, link: "" });
    await this.refresh().catch(() => {});
  }
  async join(name: string) {
    if (this.options().platform === "ipad" && this.auth?.state().status !== "signed-in") { this.account(); return; }
    invitationToken(this.state.link, invitationOrigins);
    if (!this.fixed) {
      const request = await this.lifecycle().prepareJoin(this.state.link, name);
      this.fixed = { request, epoch: cloudAuthEpoch(), link: this.state.link };
    }
    if (this.fixed.epoch !== cloudAuthEpoch()) throw new Error(messages.ACCOUNT_CHANGED);
    await this.saveAndOpen(this.fixed.request);
  }
  async openExisting(documentId: string) {
    if (this.fixed && this.fixed.request.collaboration?.sharedDocumentId === documentId && this.fixed.epoch === cloudAuthEpoch()) return this.saveAndOpen(this.fixed.request);
    const prepared = await this.lifecycle().openExisting(documentId);
    if ("record" in prepared) { if (!await this.options().open(prepared.record)) throw new Error("編集中の内容を保存してから開いてください。"); return; }
    this.fixed = { request: prepared.request, epoch: cloudAuthEpoch() }; await this.saveAndOpen(prepared.request);
  }
  async invite() {
    const documentId = (await this.sharedRecord()).collaboration?.sharedDocumentId; if (!documentId) return;
    const epoch = cloudAuthEpoch();
    const issued = await this.lifecycle().createInvite(documentId);
    if (epoch !== cloudAuthEpoch()) throw new Error(messages.ACCOUNT_CHANGED);
    this.patch({ issued }); await this.refreshManagement();
  }
  async revoke(inviteId: string) { const id = (await this.sharedRecord()).collaboration?.sharedDocumentId; if (id) { await this.lifecycle().revokeInvite(id, inviteId); await this.refreshManagement(); } }
  async remove(userId: string) { const id = (await this.sharedRecord()).collaboration?.sharedDocumentId; if (id) { await this.lifecycle().removeMember(id, userId); await this.refreshManagement(); } }
  async leaveOrEnd(end: boolean) {
    const id = (await this.sharedRecord()).collaboration?.sharedDocumentId; if (!id) return;
    if (end) await this.lifecycle().deleteSharedDocument(id); else await this.lifecycle().leave(id);
    this.options().active()?.provider?.wake(); this.patch({ members: [], invites: [], issued: null, notice: end ? "共有が終了しました。この端末のコピーは残っています" : "共有から退出しました。この端末のコピーは残っています" });
    await this.refresh().catch(() => {});
  }
  async independentCopy() {
    const active = this.options().active(); if (!active) return;
    if (!this.rescue || JSON.stringify(this.rescue.projection) !== JSON.stringify(active.editor.project)) {
      // prepare stages the current batch synchronously. Capture that projection
      // before its repository read yields, so newer edits cannot be discarded
      // by comparing them with a request that contains the older projection.
      const pending = active.prepareIndependentCopy(), projection = active.editor.project;
      const request = await pending; this.rescue = { request, projection, localId: active.localId };
    }
    const fixed = this.rescue; await this.repository().commit(fixed.request);
    const record = await this.repository().get(fixed.request.project.id!); if (!record) throw new Error("保存結果を確認できませんでした。");
    if (!await this.options().open(record, fixed)) throw new Error("コピーを保存しました。追加の編集があるため元の隊列表を表示しています。");
    this.rescue = null; this.patch({ screen: null });
  }
  async openHistoryCopy(record: ProjectRecord, message: string) {
    if (!await this.options().open(record)) return false;
    this.patch({ screen: null, notice: message.includes('未設定') ? message : '控えを新しい隊列表として開きました。' });
    return true;
  }
  async removeLocal() {
    const record = await this.sharedRecord();
    await this.options().transform(async id => {
      if (id !== record.project.id) throw new Error("開いている隊列表が変わりました。");
      const current = await this.repository().get(id); if (!current) throw new Error("隊列表が見つかりません。");
      await this.lifecycle().removeLocalCopy(id, current.repositoryRevision, crypto.randomUUID());
      return current;
    });
    await this.options().localRemoved(); this.patch({ screen: null });
  }
  get optionsNow() { return this.options(); }
  get saveRetry() { return !!this.fixed; }
}
