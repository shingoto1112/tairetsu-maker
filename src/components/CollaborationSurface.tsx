import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CollaborationUiBridge } from "../collaboration/uiTypes";
import type { CollaborationUiService } from "../collaboration/uiService";
import { subscribeCloudAuth, readCloudAuthSession } from "../cloud/session";
import { useModalFocus } from "../hooks/useModalFocus";
import { sessionTone } from "../storage/sharedSessionState";
import "./collaboration.css";
import CollaborationHistoryPanel from './CollaborationHistoryPanel';

type Props = { bridge: CollaborationUiBridge; view: "library" | "editor"; localId?: string; attached?: boolean };
export default function CollaborationSurface(props: Props) {
  const [service, setService] = useState<CollaborationUiService | null>(null);
  useEffect(() => { let current = true; void props.bridge.get().then(service => { if (current) setService(service); }); return () => { current = false; }; }, [props.bridge]);
  return service ? <Surface {...props} service={service} /> : <p role="status">共同編集を準備中…</p>;
}
function Surface({ service, view, localId, attached }: Props & { service: CollaborationUiService }) {
  const ui = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const initialized = useRef(false);
  useEffect(() => {
    const release = subscribeCloudAuth(() => service.authChanged());
    void service.initialize().then(() => {
      if (view === "library" && !initialized.current) { initialized.current = true; void service.run(() => service.refresh()); }
    });
    return release;
  }, [service, view]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const focus = useModalFocus(dialogRef, !!ui.screen);
  const signed = ui.auth.status === "signed-in" ? ui.auth : null;
  const run = (fn: () => Promise<void>) => void service.run(fn);
  const copy = (link: string) => run(async () => {
    try { await navigator.clipboard.writeText(link); setCopyNotice("リンクをコピーしました。"); }
    catch { throw new Error("コピーできませんでした。リンクの入力欄を長押ししてコピーしてください。"); }
  });
  const share = (link: string) => run(async () => {
    const { Share } = await import("@capacitor/share");
    try { await Share.share({ title: "隊列メーカーの招待", text: "隊列表に参加してください", url: link }); }
    catch { throw new Error("共有シートを開けませんでした。リンクをコピーして共有してください。"); }
  });
  useEffect(() => {
    if (!ui.screen) { setPassword(""); setDeleting(false); setConfirmDelete(false); setCopyNotice(null); }
    if (!ui.screen) return;
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") service.close(); };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [ui.screen, service]);
  const session = service.optionsNow.store;
  const active = service.optionsNow.active();
  const isShared = !!active?.attached && active.localId === localId;
  const creator = ui.members.find(member => member.isCreator)?.userId === signed?.userId;
  const canManage = signed && ui.members.some(member => member.userId === signed.userId);
  const localDocuments = new Set(service.optionsNow.summaries().filter(summary => signed && summary.sharing?.accountId === signed.userId).map(summary => summary.sharing!.documentId));
  const missingDocuments = ui.documents.filter(document => !localDocuments.has(document.documentId));
  const localCount = ui.documents.length - missingDocuments.length;
  const linkTools = (link: string) => <div className="collab-actions">
    <button type="button" disabled={ui.busy} onClick={() => copy(link)}>リンクをコピー</button>
    {service.optionsNow.platform === "ipad" && <button type="button" disabled={ui.busy} onClick={() => share(link)}>共有シートを開く</button>}
  </div>;
  return <>
    {view === "library" && <section className="collab-home" aria-label="アカウントとクラウドの隊列表" aria-busy={ui.busy || ui.auth.status === "restoring"}>
      <div className="collab-heading"><h2>クラウドの隊列表</h2>
        <div className="collab-actions">{signed ? <><span>{signed.isGuest ? "ゲスト" : "アカウント"}：{signed.displayName || (signed.isGuest ? "ゲスト" : readCloudAuthSession()?.user.email)}</span>
          {!signed.isGuest && <button type="button" disabled={ui.busy} onClick={() => service.account()}>アカウント</button>}
          <button type="button" disabled={ui.busy} onClick={() => run(() => service.signOut())}>ログアウト</button></> :
          <button type="button" disabled={ui.busy || ui.auth.status === "restoring"} onClick={() => service.account()}>{ui.auth.status === "restoring" ? "ログイン情報を確認中…" : "ログイン / 新規登録"}</button>}</div></div>
      {signed?.isGuest && <p>ブラウザのデータを消すと入り直しになります。新しい招待リンクが必要です。</p>}
      {ui.error && !ui.screen && <p role="alert">{ui.error}</p>}{ui.notice && !ui.screen && <p role="status">{ui.notice}</p>}
      {signed && <><div className="collab-home-summary"><p>{localCount > 0 ? `この端末にある共有隊列表 ${localCount}件` : "この端末にない隊列表を取得して開けます。"}</p><button type="button" disabled={ui.busy} onClick={() => run(() => service.refresh())}>一覧を更新</button></div>
        {missingDocuments.length > 0 && <div className="collab-document-list">{missingDocuments.map(document => <button key={document.documentId} type="button" disabled={ui.busy || document.documentSchema !== 2}
          onClick={() => run(() => service.openExisting(document.documentId))} aria-label={`${document.title}をクラウドから開く`}>
          <strong>{document.title}</strong><span className="collab-badge">{document.memberCount === 1 ? "クラウド保存" : `共有中・${document.memberCount}人`}</span>
          <small>{document.isCreator ? "自分が作成" : "参加中"} · {new Date(document.createdAt).toLocaleDateString("ja-JP")}
            {" · この端末で取得して開く"}</small>
        </button>)}</div>}{!ui.documents.length && <p>クラウドの隊列表はまだありません。</p>}
        {ui.cursor && <button type="button" disabled={ui.busy} onClick={() => run(() => service.refresh(true))}>続きを表示</button>}</>}
      <div className="collab-join-entry"><span>新規 / 読込</span><button type="button" disabled={ui.busy} onClick={() => service.invitation("")}>招待リンクで参加</button></div>
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
          {copyNotice && <p role="status">{copyNotice}</p>}
          {ui.screen === "manage" && <>
            {!isShared ? <><p>クラウドに保存して別の端末でも開けます。一人だけでも使えます。</p>
              <p>共有を始めるには恒久アカウントでログインしてください。</p>
              <label>共有で使う表示名<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={signed?.displayName || "表示名"} /></label>
              <button className="collab-primary" type="button" disabled={ui.busy} onClick={() => run(() => service.start(name || signed?.displayName || "作成者"))}>共有を始める</button></> : <>
              <StatusLabel session={session} localId={localId!} />
              <p>編集内容のクラウドへの送信は自動です。「この端末に保存」は端末への保存操作です。</p>
              <button type="button" disabled={ui.busy} onClick={() => run(() => service.refreshManagement())}>最新の状態を確認</button>
              {canManage && <>
                {active?.historyUi && <CollaborationHistoryPanel key={localId} controller={active.historyUi} members={ui.members} creator={creator} session={session}
                  open={(record, message) => service.openHistoryCopy(record, message)} />}
                <section><h3>招待リンク</h3><p>1人につき1リンク。24時間以内に1回だけ参加できます。</p>
                  <button type="button" disabled={ui.busy} onClick={() => run(() => service.invite())}>招待リンクを作成</button>
                  {ui.issued && <div className="collab-issued"><label>作成した招待リンク<input aria-label="作成した招待リンク" readOnly value={ui.issued.link} /></label>{linkTools(ui.issued.link)}</div>}
                  <ul>{ui.invites.map(invite => <li key={invite.inviteId}><span>期限：{new Date(invite.expiresAt).toLocaleString("ja-JP")} · {{ active: "未使用", used: "使用済み", expired: "期限切れ", revoked: "取り消し済み" }[invite.status]}</span>
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
            <button type="button" disabled={ui.busy || service.saveRetry} onClick={() => run(async () => service.setLink(await navigator.clipboard.readText()))}>クリップボードから貼り付け</button>
            <p className="collab-muted">貼り付けボタンが使えない場合は、入力欄を長押しして貼り付けてください。</p>
            <label>参加する表示名<input value={name} maxLength={80} disabled={ui.busy || service.saveRetry} onChange={event => setName(event.target.value)} /></label>
            {!signed && <p>{service.optionsNow.platform === "ipad" ? "ログイン後、この招待の参加画面に戻ります。アプリを再起動した場合はリンクを貼り付け直してください。" : "ゲストとして参加します。ブラウザのデータを消すと入り直しになります。"}</p>}
            <button className="collab-primary" type="button" disabled={ui.busy || !ui.link || !name.trim()} onClick={() => run(() => service.join(name))}>
              {service.saveRetry ? "保存を再試行して開く" : service.optionsNow.platform === "ipad" && !signed ? "ログインして参加する" : "参加する"}</button>
            {service.optionsNow.platform === "web" && ui.link && <section><h3>iPadアプリで参加する場合</h3><p>アプリで参加するにはリンクをコピーしてアプリに貼り付けてください。アプリではアカウントでログインします。</p>{linkTools(ui.link)}</section>}
          </>}
          {ui.screen === "account" && <>
            {signed && !signed.isGuest ? <><p>{signed.displayName || "アカウント"} · {readCloudAuthSession()?.user.email}</p>
              <button type="button" disabled={ui.busy} onClick={() => run(() => service.signOut())}>ログアウト</button>
              {!deleting ? <button type="button" disabled={ui.busy} onClick={() => setDeleting(true)}>アカウント削除</button> :
                <form onSubmit={event => { event.preventDefault(); if (confirmDelete) run(() => service.deleteAccount(password)); }}>
                  <p>自分が作った共有隊列表はクラウドから削除されます。他の人の端末のコピーは残ります。</p>
                  <label>現在のパスワード<input type="password" value={password} required autoComplete="current-password" onChange={event => setPassword(event.target.value)} /></label>
                  <label className="collab-check"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />削除内容を確認しました</label>
                  <button className="collab-danger" disabled={ui.busy || !confirmDelete || !password} type="submit">アカウントを削除する</button>
                </form>}</> : <form className="library-cloud-login" onSubmit={event => { event.preventDefault(); run(() => service.signIn(email, password, register ? name : undefined)); }}>
                  <p>{register ? "新規登録" : "ログイン"}</p>
                  {register && <label>表示名<input value={name} maxLength={80} required onChange={event => setName(event.target.value)} autoComplete="nickname" /></label>}
                  <label>メールアドレス<input type="email" value={email} required onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>
                  <label>パスワード<input type="password" value={password} required minLength={register ? 6 : undefined} onChange={event => setPassword(event.target.value)} autoComplete={register ? "new-password" : "current-password"} /></label>
                  <button className="collab-primary" disabled={ui.busy} type="submit">{register ? "新規登録" : "ログイン"}</button>
                  <button disabled={ui.busy} type="button" onClick={() => { setRegister(!register); setPassword(""); }}>{register ? "ログインへ" : "新しいアカウントを登録"}</button>
                </form>}
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
  return service ? <Badge service={service} summary={summary} /> : <span>共有中</span>;
}
function Badge({ service, summary }: { service: CollaborationUiService; summary: import("../repositories/types").ProjectSummary }) {
  const ui = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const document = ui.auth.status === "signed-in" && ui.auth.userId === summary.sharing?.accountId ? ui.documents.find(item => item.documentId === summary.sharing?.documentId) : null;
  return <span>{document ? document.memberCount === 1 ? "クラウド保存" : `共有中・${document.memberCount}人` : "共有中"}</span>;
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
