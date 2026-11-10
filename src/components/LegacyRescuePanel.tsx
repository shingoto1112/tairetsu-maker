import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LegacySource } from "../storage/legacyReaders";
import { legacyFailureMessage, legacyFailureDetail } from "../legacyImport/api";
import type { ImportRepository } from "../legacyImport/importer";
import { enumerateDrafts, draftVariant, rescueDraft } from "../legacyImport/drafts";
import "./legacyRescue.css";

function FailureDetail({ detail }: { detail?: string }) {
  return detail ? <details className="legacy-rescue-detail"><summary>詳しい理由</summary><p>{detail}</p></details> : null;
}

export default function LegacyRescuePanel({ repository, onChanged, openRequest = 0, hideEntry = false }: {
  repository: ImportRepository; onChanged: () => Promise<void>;
  /** Incremented by the home "…" menu; opens on-device draft rescue directly. */
  openRequest?: number;
  /** The home header owns the entry, so the home page shows no legacy buttons. */
  hideEntry?: boolean;
}) {
  const [view, setView] = useState<"draft" | null>(null);
  const [loaded, setLoaded] = useState(false), [drafts, setDrafts] = useState<LegacySource[]>([]);
  const [draftResults, setDraftResults] = useState<Record<string, { message: string; detail?: string }>>({});
  const [failureDetail, setFailureDetail] = useState<string | undefined>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (!view) return;
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { controller.current?.abort(); setView(null); } };
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('.legacy-rescue-dialog'); modal?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !modal) return;
      const items = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')].filter(item => item.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', escape); document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('keydown', trap); previous?.focus(); };
  }, [view]);
  const execute = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return;
    const next = new AbortController(); controller.current = next; setBusy(true); setMessage(null); setFailureDetail(undefined);
    try { await work(next.signal); }
    catch (e) { if (alive.current) { setMessage(legacyFailureMessage(e)); setFailureDetail(legacyFailureDetail(e)); } }
    finally { if (controller.current === next) controller.current = null; if (alive.current) { setBusy(false); await onChanged().catch(() => setMessage("保存一覧を更新できませんでした。画面を開き直してください。")); } }
  };
  const readDrafts = () => execute(async signal => { const sources = await enumerateDrafts(); signal.throwIfAborted(); setDrafts(sources); setLoaded(true); });
  const openDraft = () => { setView("draft"); setLoaded(false); setMessage(null); setFailureDetail(undefined); };
  const handledRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === handledRequest.current) return;
    handledRequest.current = openRequest;
    if (!controller.current) { setMessage(null); setFailureDetail(undefined); setLoaded(false); setView("draft"); }
  }, [openRequest]);
  const dialog = view && createPortal(<div className="legacy-rescue-backdrop"><div className="legacy-rescue-dialog" role="dialog" aria-modal="true" aria-labelledby="legacy-rescue-heading" tabIndex={-1}>
      <header><h2 id="legacy-rescue-heading">旧クラウドの下書きを救出</h2>
        <div className="legacy-rescue-header-actions">
          <button className="mini-button" type="button" aria-label="救出画面を閉じる" onClick={() => { controller.current?.abort(); setView(null); }}>閉じる</button>
        </div></header>
      <p>旧クラウドからの取り込みは2026年11月4日に終了しました。このiPadアプリ内に残る下書きは、ログインせずに救出できます。</p>
      <p>この端末に独立した隊列表として保存します。共同編集は始まりません。元のデータは削除しません。</p>
      <p>どのアカウントの下書きか、クラウドより新しいかは判定できません。通常の下書き・保存途中の下書き・予備の下書きを個別に選んで救出してください。</p>
      <button className="mini-button" type="button" disabled={busy} onClick={() => void readDrafts()}>端末の下書きを調べる</button>
      <ul className="legacy-rescue-list">{drafts.filter(s => s.role === "draft" && s.status !== "absent" || s.status === "unreadable").map(source => <li key={source.source}>
        <strong>{source.projects?.[0] && typeof source.projects[0] === "object" && "title" in source.projects[0] ? String(source.projects[0].title) : draftVariant(source)}</strong>
        <details className="legacy-rescue-detail"><summary>元ファイルの情報</summary><small>{source.source.split("/").pop()}</small></details>
        <p>{draftVariant(source)}{source.savedAt ? `・${new Date(source.savedAt).toLocaleString("ja-JP")}` : ""}</p>
        {source.status === "unreadable" ? <p>{source.issue === "CORRUPT" ? "破損しているため読めません。" : source.issue === "ACCESS_DENIED" ? "読取りが拒否されました。" : "読取りエラーです。再試行してください。"}</p>
          : source.role === "draft" && <button className="mini-button primary" type="button" disabled={busy} onClick={() => void execute(async signal => {
            signal.throwIfAborted(); try { const saved = await rescueDraft(repository, source, undefined, signal); setDraftResults(previous => ({ ...previous, [source.source]: { message: saved.already ? "救出済みです。編集・削除した文書は戻しません。" : "独立コピーを保存しました。元ファイルは残っています。" } })); }
            catch (e) { setDraftResults(previous => ({ ...previous, [source.source]: { message: legacyFailureMessage(e), detail: legacyFailureDetail(e) } })); }
          })}>この下書きを独立コピーとして救出</button>}
        {draftResults[source.source] && <><p role="status">{draftResults[source.source].message}</p><FailureDetail detail={draftResults[source.source].detail} /></>}</li>)}</ul>
      {loaded && !drafts.some(s => s.role === "draft" || s.status === "unreadable") && <p>この端末で旧下書きは見つかりませんでした。iPadアプリの端末ファイルが対象です。</p>}
      {message && <p role="status" className="legacy-rescue-message">{message}</p>}
      {message && <FailureDetail detail={failureDetail} />}
      {busy && <p role="status">端末ファイルを確認・保存中…</p>}
    </div></div>, document.body);
  if (hideEntry) return <>{dialog}</>;
  return <section className="legacy-rescue-entry" aria-label="旧クラウドの下書きを救出">
    <button className="mini-button" type="button" onClick={openDraft}>旧クラウドの下書きを救出</button>
    {dialog}
  </section>;
}
