import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CollaborationUiBridge } from "../collaboration/uiTypes";
import type { CollaborationUiService } from "../collaboration/uiService";
import { subscribeCloudAuth, readCloudAuthSession, cloudAuthEpoch } from "../cloud/session";
import { PASSWORD_MIN_LENGTH } from "../cloud/password";
import CollaborationPasswordForm from "./CollaborationPasswordForm";
import { useModalFocus } from "../hooks/useModalFocus";
import { sessionTone } from "../storage/sharedSessionState";
import "./collaboration.css";
import CollaborationHistoryPanel from './CollaborationHistoryPanel';
import InvitationLinkTools from './InvitationLinkTools';
import { readInvitation, subscribeInvitation } from '../storage/invitationMemory';
import { localSharingBadge } from "../collaboration/libraryCards";

type Props = { bridge: CollaborationUiBridge; view: "library" | "editor"; localId?: string; attached?: boolean };
export default function CollaborationSurface(props: Props) {
  const [service, setService] = useState<CollaborationUiService | null>(null);
  useEffect(() => { let current = true; void props.bridge.get().then(service => { if (current) setService(service); }); return () => { current = false; }; }, [props.bridge]);
  return service ? <Surface {...props} service={service} /> : <p role="status">共同編集を準備中…</p>;
}
function Surface({ service, view, localId, attached }: Props & { service: CollaborationUiService }) {
  const ui = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const invitation = useSyncExternalStore(subscribeInvitation, readInvitation);
  const received = useRef<ReturnType<typeof readInvitation>>(null);
  useEffect(() => {
    if (invitation && invitation !== received.current && service.receiveInvitation(invitation)) received.current = invitation;
  }, [invitation, service, ui.busy, ui.screen, ui.link]);
  useEffect(() => {
    const release = subscribeCloudAuth(() => service.authChanged());
    void service.initialize().then(() => {
      if (view === "library") void service.run(() => service.refresh());
    });
    const connectivity = () => {
      service.connectivityChanged();
      if (view === "library" && navigator.onLine !== false) void service.run(() => service.refresh());
    };
    window.addEventListener("offline", connectivity); window.addEventListener("online", connectivity);
    return () => { release(); window.removeEventListener("offline", connectivity); window.removeEventListener("online", connectivity); };
  }, [service, view]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const focus = useModalFocus(dialogRef, !!ui.screen);
  const signed = ui.auth.status === "signed-in" ? ui.auth : null;
  const authEpoch = cloudAuthEpoch();
  useEffect(() => { setPassword(""); setChangingPassword(false); setDeleting(false); setConfirmDelete(false); }, [ui.screen, authEpoch]);
  const run = (fn: () => Promise<void>) => void service.run(fn);
  const paste = () => {
    setPasteNotice(null);
    void service.paste(() => navigator.clipboard.readText()).catch(() => {
      setPasteNotice("入力欄を長押し（PC は Ctrl+V）して貼り付けてください");
    });
  };
  const share = (link: string) => run(async () => {
    const { Share } = await import("@capacitor/share");
    try { await Share.share({ title: "隊列メーカーの招待", text: "隊列表に参加してください", url: link }); }
    catch { throw new Error("共有シートを開けませんでした。リンクをコピーして共有してください。"); }
  });
  useEffect(() => {
    if (!ui.screen) { setPassword(""); setDeleting(false); setConfirmDelete(false); setPasteNotice(null); }
    if (!ui.screen) return;
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") service.close(); };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [ui.screen, service]);
  const session = service.optionsNow.store;
  const active = service.optionsNow.active();
  const isShared = !!active?.attached && active.localId === localId;
  const creator = ui.members.find(member => member.isCreator)?.userId === signed?.userId;
  const canManage = signed && ui.members.some(member => member.userId === signed.userId);
  const linkTools = (link: string, label: string) => <InvitationLinkTools link={link} label={label} disabled={ui.busy}
    share={service.optionsNow.platform === "ipad" ? () => share(link) : undefined} />;
  return <>
    {/* Home: the header and grid (FormationLibrary) show the account button and cloud cards; this keeps messages and dialogs. */}
    {view === "library" && !ui.screen && (ui.error || ui.notice) && <section className="collab-home-status" aria-label="共同編集のお知らせ">
      {ui.error && <p role="alert">{ui.error}</p>}{ui.notice && <p role="status">{ui.notice}</p>}
    </section>}
    {view === "editor" && attached && <SharedIndicators service={service} session={session} localId={localId!} />}
    {view === "editor" && ui.error && !ui.screen && <p className="collab-error" role="alert">{ui.error}</p>}
    {view === "editor" && ui.notice && !ui.screen && <p className="collab-notice" role="status">{ui.notice}</p>}
    {ui.screen && createPortal(<div className="collab-backdrop" onPointerDown={() => service.close()}>
      <section className="collab-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={ui.screen === "manage" ? "みんなで編集" : ui.screen === "invite" ? "招待されています" : "アカウント"}
        onPointerDown={event => event.stopPropagation()} onKeyDown={focus}>
        <header><h2>{ui.screen === "manage" ? "みんなで編集" : ui.screen === "invite" ? "招待されています" : "アカウント"}</h2>
          <button type="button" disabled={ui.busy} aria-label="共同編集画面を閉じる" onClick={() => service.close()}>閉じる</button></header>
        <div className="collab-dialog-body">
          {ui.error && <p className="collab-error" role="alert">{ui.error}</p>}{ui.notice && <p role="status">{ui.notice}</p>}
          {ui.screen === "manage" && <>
            {!isShared ? <><p>クラウドに保存して別の端末でも開けます。一人だけでも使えます。</p>
              <p>共有を始めた時点の独立したコピーが、同じ名前でこの端末に残ります。そのコピーは以後の共同編集を受け取りません。</p>
              <p>共有を始めるには恒久アカウントでログインしてください。</p>
              <label>共有で使う表示名<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={signed?.displayName || "表示名"} /></label>
              <button className="collab-primary" type="button" disabled={ui.busy} onClick={() => void service.start(name || signed?.displayName || "作成者")}>共有を始める</button></> : <>
              <StatusLabel session={session} localId={localId!} />
              <p>編集内容のクラウドへの送信は自動です。「この端末に保存」は端末への保存操作です。</p>
              <button type="button" disabled={ui.busy} onClick={() => run(() => service.refreshManagement())}>最新の状態を確認</button>
              {canManage && <>
                {active?.historyUi && <CollaborationHistoryPanel key={localId} controller={active.historyUi} members={ui.members} creator={creator} session={session}
                  open={(record, message) => service.openHistoryCopy(record, message)} />}
                <section><h3>招待リンク</h3><p>このリンクは7日間、何人でも参加に使えます（作成者を含めて合計8人まで）。参加した人に期限はありません。</p>
                  <button type="button" disabled={ui.busy} onClick={() => run(() => service.invite())}>招待リンクを作成</button>
                  {ui.issued && linkTools(ui.issued.link, "作成した招待リンク")}
                  <p>取り消すと、まだ参加していない人はこのリンクで参加できなくなります。参加済みの人はそのままです。</p>
                  <ul>{ui.invites.map(invite => <li key={invite.inviteId}><span>期限：{new Date(invite.expiresAt).toLocaleString("ja-JP")} · {(invite.multiUse ? { active: "有効", used: "上限に達しました", expired: "期限切れ", revoked: "取り消し済み" } : { active: "未使用", used: "使用済み", expired: "期限切れ", revoked: "取り消し済み" })[invite.status]}{invite.multiUse && invite.joinedCount !== undefined && ` · このリンクで参加：${invite.joinedCount}人`}</span>
                    {invite.status === "active" && <button type="button" disabled={ui.busy} onClick={() => run(() => service.revoke(invite.inviteId))}>招待を取り消す</button>}</li>)}</ul>
                </section>
                <section><h3>参加メンバー（{ui.members.length}人）</h3><ul>{ui.members.map(member => <li key={member.userId}>
                  <span>{member.displayName} {member.isGuest && <small>ゲスト</small>} {member.isCreator && <small>作成者</small>}</span>
                  {!member.isCreator && member.userId !== signed?.userId && <button type="button" disabled={ui.busy} aria-label={`${member.displayName}を外す`}
                    onClick={() => { if (window.confirm(`${member.displayName}を共有メンバーから外しますか？この人の端末のコピーは残ります。`)) run(() => service.remove(member.userId)); }}>外す</button>}</li>)}</ul></section>
                <section className="collab-danger-zone">
                  {creator ? <><p>共有を終了すると、クラウドの文書を削除します。他の人の端末のコピーは残ります。</p><button type="button" disabled={ui.busy}
                    onClick={() => { if (window.confirm("共有を終了して、クラウドからこの隊列表を削除しますか？端末のコピーは残ります。")) run(() => service.leaveOrEnd(true)); }}>共有を終了（クラウドから削除）</button></> :
                    <button type="button" disabled={ui.busy} onClick={() => { if (window.confirm("共有から退出しますか？この端末のコピーは残ります。")) run(() => service.leaveOrEnd(false)); }}>共有から退出</button>}
                </section>
              </>}
              <button type="button" disabled={ui.busy} onClick={() => run(() => service.independentCopy())}>独立した隊列表として保存</button>
            </>}
            <section className="collab-danger-zone"><h3>この端末のコピー</h3><p>クラウドの文書や参加資格は削除しません。未送信の編集もこの端末から消えます。必要なら先に独立した隊列表として保存してください。</p>
              <button type="button" disabled={ui.busy} onClick={() => { if (window.confirm("この端末のコピーと未送信の編集を削除しますか？必要な編集は先に独立した隊列表として保存してください。")) run(() => service.removeLocal()); }}>この端末のコピーを削除</button></section>
          </>}
          {ui.screen === "invite" && <>
            <p>表示名を入力し、「参加する」を押すまで招待は使用しません。</p>
            <label>招待リンク<input type="text" value={ui.link} disabled={ui.busy || service.saveRetry} onChange={event => service.setLink(event.target.value)} placeholder="招待リンクをここに貼り付け" autoComplete="off" /></label>
            <button type="button" disabled={ui.busy || service.saveRetry} onClick={paste}>クリップボードから貼り付け</button>
            {pasteNotice && <p role="status">{pasteNotice}</p>}
            <p className="collab-muted">貼り付けボタンが使えない場合は、入力欄を長押しして貼り付けてください。</p>
            <label>参加する表示名<input value={name} maxLength={80} disabled={ui.busy || service.saveRetry} onChange={event => setName(event.target.value)} /></label>
            {!signed && <p>{service.optionsNow.platform === "ipad" ? "ログイン後、この招待の参加画面に戻ります。アプリを再起動した場合はリンクを貼り付け直してください。" : "ゲストとして参加します。ブラウザのデータを消すと入り直しになります。"}</p>}
            <button className="collab-primary" type="button" disabled={ui.busy || !ui.link || !name.trim()} onClick={() => run(() => service.join(name))}>
              {service.saveRetry ? "保存を再試行して開く" : service.optionsNow.platform === "ipad" && !signed ? "ログインして参加する" : "参加する"}</button>
            {service.optionsNow.platform === "web" && ui.link && <section><h3>iPadアプリで参加する場合</h3><p>アプリで参加するにはリンクをコピーしてアプリに貼り付けてください。アプリではアカウントでログインします。</p>{linkTools(ui.link, "iPadアプリに貼り付ける招待リンク")}</section>}
          </>}
          {ui.screen === "account" && <>
            {signed && !signed.isGuest ? <><p>{signed.displayName || "アカウント"} · {readCloudAuthSession()?.user.email}</p>
              <button type="button" disabled={ui.busy} onClick={() => run(() => service.signOut())}>ログアウト</button>
              {!deleting && (!changingPassword ? <button type="button" disabled={ui.busy} onClick={() => setChangingPassword(true)}>パスワードを変更</button> :
                <CollaborationPasswordForm key={authEpoch} service={service} busy={ui.busy} cancel={() => setChangingPassword(false)} />)}
              {!deleting ? <button type="button" disabled={ui.busy || changingPassword} onClick={() => setDeleting(true)}>アカウント削除</button> :
                <form onSubmit={event => { event.preventDefault(); if (confirmDelete) run(() => service.deleteAccount(password)); }}>
                  <p>自分が作った共有隊列表はクラウドから削除されます。他の人の端末のコピーは残ります。</p>
                  <label>現在のパスワード<input type="password" value={password} required autoComplete="current-password" onChange={event => setPassword(event.target.value)} /></label>
                  <label className="collab-check"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />削除内容を確認しました</label>
                  <button className="collab-danger" disabled={ui.busy || !confirmDelete || !password} type="submit">アカウントを削除する</button>
                </form>}</> : <>
              {signed?.isGuest && <section className="collab-guest-status" aria-label="ゲストとして参加中">
                <p>ゲストとして参加中：{signed.displayName || "ゲスト"}</p>
                <p>ブラウザのデータを消すと入り直しになります。新しい招待リンクが必要です。</p>
                <button type="button" disabled={ui.busy} onClick={() => run(() => service.signOut())}>ログアウト</button>
              </section>}
              <form className="library-cloud-login" onSubmit={event => { event.preventDefault(); run(() => service.signIn(email, password, register ? name : undefined)); }}>
                  <p>{register ? "新規登録" : "ログイン"}</p>
                  {register && <label>表示名<input value={name} maxLength={80} required onChange={event => setName(event.target.value)} autoComplete="nickname" /></label>}
                  <label>メールアドレス<input type="email" value={email} required onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>
                  <label>パスワード<input type="password" value={password} required minLength={register ? PASSWORD_MIN_LENGTH : undefined} onChange={event => setPassword(event.target.value)} autoComplete={register ? "new-password" : "current-password"} /></label>
                  <button className="collab-primary" disabled={ui.busy} type="submit">{register ? "新規登録" : "ログイン"}</button>
                  <button disabled={ui.busy} type="button" onClick={() => { setRegister(!register); setPassword(""); }}>{register ? "ログインへ" : "新しいアカウントを登録"}</button>
                </form></>}
          </>}
          {ui.busy && <p role="status">処理中…</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
export function CollaborationBadge({ bridge, summary }: { bridge: CollaborationUiBridge; summary: import("../repositories/types").ProjectSummary }) {
  const [service, setService] = useState<CollaborationUiService | null>(null);
  useEffect(() => { let current = true; void bridge.get().then(value => { if (current) setService(value); }); return () => { current = false; }; }, [bridge]);
  return service ? <Badge service={service} summary={summary} /> : <span>クラウド</span>;
}
function Badge({ service, summary }: { service: CollaborationUiService; summary: import("../repositories/types").ProjectSummary }) {
  const ui = useSyncExternalStore(service.subscribe, service.getSnapshot);
  return <span>{localSharingBadge(summary, ui.documents, ui.auth)}</span>;
}
export function CollaborationStatus({ bridge, localId }: { bridge: CollaborationUiBridge; localId: string }) {
  const session = bridge.options!.store;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  if (snapshot.localId !== localId) return null;
  return <button className="collab-status-pill" data-tone={sessionTone(snapshot)} type="button"
    onClick={() => void bridge.get().then(service => service.manageLocal(localId))} title="共同編集の状態と管理">{snapshot.label}</button>;
}
function StatusLabel({ session, localId }: { session: import("../storage/sharedSessionState").SharedSessionStore; localId: string }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <p className="collab-status-text" data-tone={sessionTone(snapshot)} role="status">{snapshot.localId === localId ? snapshot.label : "接続を確認中"}</p>;
}
function SharedIndicators({ service, session, localId }: { service: CollaborationUiService; session: import("../storage/sharedSessionState").SharedSessionStore; localId: string }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const seen = useRef(false);
  useEffect(() => {
    if (!snapshot.history) return;
    const message = snapshot.history.status === "partial" ? "他の人の変更があるため、一部だけ元に戻しました" : snapshot.history.status === "blocked" ? "他の人が変更したため元に戻せません" : "";
    setHistoryMessage((!seen.current ? "共有中の元に戻すは自分の操作だけが対象です。" : "") + message || null); seen.current = true;
    const timer = setTimeout(() => setHistoryMessage(null), 6500); return () => clearTimeout(timer);
  }, [snapshot.history, snapshot.historyEvent]);
  if (snapshot.localId !== localId) return null;
  const banners: Record<string, string> = { removed: "共有メンバーから外されました。この端末のコピーは残っています", ended: "共有が終了しました。この端末のコピーは残っています",
    "auth-required": "ログインが必要です。この端末のコピーは残っています", "membership-changed": "参加資格が変わりました。未送信の編集はこの端末に残っています" };
  return <>
    {historyMessage && <span className="collab-history" role="status">{historyMessage}</span>}
    {banners[snapshot.sharing] && <div className={`collab-banner collab-banner--${snapshot.sharing}`} role="status" aria-label={`共有状態 ${snapshot.sharing}`}>
      <span>{banners[snapshot.sharing]}</span><button type="button" disabled={service.getSnapshot().busy} onClick={() => void service.run(() => service.independentCopy())}>独立した隊列表として保存</button>
    </div>}
  </>;
}
