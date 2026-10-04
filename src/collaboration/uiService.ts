import type { CollaborationUiOptions } from "./uiTypes";
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
  PERSONAL_SYNC_CONFLICT: "旧クラウドの隊列表は、独立したコピーを作成してから共有してください。",
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
    if (changed) { this.fixed = null; this.rescue = null; }
  }
  async run(action: () => Promise<void>) {
    if (this.state.busy) return;
    this.patch({ busy: true, error: null, notice: null });
    try { await this.initialize(); await action(); }
    catch (error) { this.patch({ error: collaborationUiError(error) }); }
    finally { this.patch({ busy: false }); }
  }
  close() { if (!this.state.busy) this.patch({ screen: null, error: null }); }
  account() { this.patch({ screen: "account", error: null }); }
  invitation(link?: string) {
    if (this.state.busy) return;
    if (link !== undefined) { this.fixed = null; rememberInvitation(link); }
    this.patch({ screen: "invite", ...(link !== undefined ? { link } : {}), error: null });
  }
  setLink(link: string) { if (!this.state.busy && !this.fixed) this.patch({ link }); }
  async refresh(more = false) {
    const epoch = cloudAuthEpoch();
    if (this.auth?.state().status !== "signed-in") { this.patch({ documents: [], cursor: null }); return; }
    // Foundation caps the whole service at 100 documents. This lightweight
    // page covers every local badge without reading any CRDT; cursor remains
    // supported if that server limit grows in a later version.
    const page = await this.lifecycle().listMyDocuments(100, more ? this.state.cursor : null);
    if (epoch !== cloudAuthEpoch()) return;
    this.patch({ documents: more ? [...this.state.documents, ...page.items] : page.items, cursor: page.nextCursor });
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
  }
  async signIn(email: string, password: string, name?: string) {
    const config = this.options().config; if (!config) throw new Error("共同編集は現在利用できません。");
    const epoch = cloudAuthEpoch(), client = createCloudAuthClient(config);
    const session = name === undefined ? await client.signInWithPassword(email.trim(), password) : await client.signUpWithPassword(email.trim(), password, name.trim());
    if (epoch !== cloudAuthEpoch()) throw new Error(messages.ACCOUNT_CHANGED);
    if (!session) throw new Error("登録を完了できませんでした。管理者にお問い合わせください。");
    saveCloudAuthSession(session); await waitCloudAuthPersistence(); this.authChanged();
    this.patch({ screen: readInvitation() ? "invite" : this.afterLogin }); this.afterLogin = null; await this.refresh();
  }
  async signOut() { await this.auth?.signOut(new AbortController().signal); this.authChanged(); this.patch({ screen: null }); }
  async deleteAccount(password: string) {
    const config = this.options().config; if (!config) throw new Error("共同編集は現在利用できません。");
    await createCollaborationAccountApi(config).deleteAccountWithPassword(password, "DELETE_MY_ACCOUNT");
    await waitCloudAuthPersistence(); this.authChanged(); this.patch({ screen: null, notice: "アカウントを削除しました。この端末のコピーは残っています。" });
  }
  async start(name: string) {
    const auth = this.auth?.state();
    if (auth?.status !== "signed-in" || auth.isGuest) { this.afterLogin = "manage"; this.account(); return; }
    await this.options().transform(localId => this.lifecycle().startSharing(localId, name));
    this.patch({ screen: null });
  }
  private async saveAndOpen(request: CommitRequest) {
    const record = await this.lifecycle().saveJoinedProject(request);
    if (!await this.options().open(record)) throw new Error("隊列表を保存しました。編集中の内容を保存してから開き直してください。");
    this.fixed = null; forgetInvitation(); this.patch({ screen: null, link: "" });
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
