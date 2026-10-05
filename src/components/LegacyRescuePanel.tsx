import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CloudConfig } from "../cloud/config";
import { cloudAuthIdentity, subscribeCloudAuth, readCloudAuthSession } from "../cloud/session";
import type { LegacySource } from "../storage/legacyReaders";
import { createLegacyExportApi, legacyFailureMessage, legacyFailureDetail, type LegacyCursor, type LegacyListItem } from "../legacyImport/api";
import { LegacyCloudImporter, type ImportRepository, type ImportResult } from "../legacyImport/importer";
import { enumerateDrafts, draftVariant, rescueDraft } from "../legacyImport/drafts";
import "./legacyRescue.css";

function FailureDetail({ detail }: { detail?: string }) {
  return detail ? <details className="legacy-rescue-detail"><summary>詳しい理由</summary><p>{detail}</p></details> : null;
}

export default function LegacyRescuePanel({ repository, config, onChanged }: {
  repository: ImportRepository; config: CloudConfig | null; onChanged: () => Promise<void>;
}) {
  const [view, setView] = useState<"cloud" | "draft" | null>(null);
  const [auth, setAuth] = useState(cloudAuthIdentity);
  const [rows, setRows] = useState<LegacyListItem[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [cursor, setCursor] = useState<LegacyCursor | null>(null), [loaded, setLoaded] = useState(false);
  const [until, setUntil] = useState<string | null>(null), [drafts, setDrafts] = useState<LegacySource[]>([]);
  const [results, setResults] = useState<Record<string, ImportResult>>({});
  const [draftResults, setDraftResults] = useState<Record<string, { message: string; detail?: string }>>({});
  const [failureDetail, setFailureDetail] = useState<string | undefined>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const controller = useRef<AbortController | null>(null), alive = useRef(true);
  const [expired, setExpired] = useState(false);
  useEffect(() => subscribeCloudAuth(() => setAuth(cloudAuthIdentity())), []);
  useEffect(() => { controller.current?.abort(); setRows([]); setSelected([]); setLoaded(false); setCursor(null); setUntil(null); setResults({}); setExpired(false); }, [auth.epoch]);
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
  const guest = (readCloudAuthSession() as { collaborationGuest?: boolean } | null)?.collaborationGuest;
  const canCloud = !!config && auth.status === "signed-in" && !!auth.accountId && !guest;
  const execute = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return;
    const next = new AbortController(); controller.current = next; setBusy(true); setMessage(null); setFailureDetail(undefined);
    try { await work(next.signal); }
    catch (e) { if (alive.current) { if (typeof e === "object" && e !== null && "code" in e && e.code === "LEGACY_EXPORT_EXPIRED") setExpired(true);
      setMessage(legacyFailureMessage(e)); setFailureDetail(legacyFailureDetail(e)); } }
    finally { if (controller.current === next) controller.current = null; if (alive.current) { setBusy(false); await onChanged().catch(() => setMessage("保存一覧を更新できませんでした。画面を開き直してください。")); } }
  };
  const list = (nextPage = false) => execute(async signal => {
    if (!config || !auth.accountId) return;
    const page = await createLegacyExportApi(config, auth.accountId).list(nextPage ? cursor ?? undefined : undefined, signal);
    signal.throwIfAborted();
    setRows(previous => [...new Map([...(nextPage ? previous : []), ...page.items].map(r => [r.projectId, r])).values()]);
    setSelected(previous => [...new Set([...(nextPage ? previous : []), ...page.items.filter(r => !r.hidden).map(r => r.projectId)])]);
    setCursor(page.nextCursor); setUntil(page.exportUntil); setLoaded(true);
  });
  const importRows = (chosen: LegacyListItem[], changed = false) => execute(async signal => {
    if (!config || !auth.accountId) return;
    const importer = new LegacyCloudImporter(repository, createLegacyExportApi(config, auth.accountId), new URL(config.url).origin + new URL(config.url).pathname.replace(/\/$/, ""), auth.accountId);
    setProgress({ completed: 0, total: chosen.length });
    for (const [i, row] of chosen.entries()) {
      signal.throwIfAborted(); const result = await importer.importOne(row, signal, changed);
      if (!alive.current) return;
      setResults(previous => ({ ...previous, [row.projectId]: result })); setProgress({ completed: i + 1, total: chosen.length });
    }
    setMessage("処理が終わりました。取り込み済みの隊列表はホームで編集できます。");
  });
  const readDrafts = () => execute(async signal => { const sources = await enumerateDrafts(); signal.throwIfAborted(); setDrafts(sources); setLoaded(true); });
  const resultLabels = { imported: "保存しました", already: "取り込み済み", recovery: "取り込めなかった隊列表", failed: "取り込めませんでした" };
  const renderRows = (hidden: boolean) => <ul className="legacy-rescue-list">{rows.filter(r => r.hidden === hidden).map(row => {
    const result = results[row.projectId];
    return <li key={row.projectId}><label><input type="checkbox" disabled={busy || expired} checked={selected.includes(row.projectId)}
      onChange={e => setSelected(previous => e.target.checked ? [...previous, row.projectId] : previous.filter(id => id !== row.projectId))} />
      <strong>{row.title || "名称未設定"}</strong></label><small>{row.mode === "parade" ? "パレード" : "ステージ"}</small>
      {result && <div className="legacy-rescue-result"><strong>{resultLabels[result.status]}</strong><p>{result.message}</p>
        <FailureDetail detail={result.detail} />
        {result.recoveryId && result.canRescueChanged && <button className="mini-button primary" type="button" disabled={busy || expired} onClick={() => void importRows([row], true)}>変更された内容を別の独立コピーとして救出</button>}</div>}</li>;
  })}</ul>;
  return <section className="legacy-rescue-entry" aria-label="旧データの取り込みと救出">
    <button className="mini-button" type="button" onClick={() => { setView("cloud"); setLoaded(rows.length > 0); setMessage(null); setFailureDetail(undefined); }}>旧クラウドの隊列表を取り込む</button>
    <button className="mini-button" type="button" onClick={() => { setView("draft"); setLoaded(false); setMessage(null); setFailureDetail(undefined); }}>この端末に残っている旧クラウドの下書き</button>
    {view && createPortal(<div className="legacy-rescue-backdrop"><div className="legacy-rescue-dialog" role="dialog" aria-modal="true" aria-labelledby="legacy-rescue-heading" tabIndex={-1}>
      <header><h2 id="legacy-rescue-heading">{view === "cloud" ? "旧クラウドの隊列表を取り込む" : "旧クラウドの下書き"}</h2>
        <button className="mini-button" type="button" aria-label="救出画面を閉じる" onClick={() => { controller.current?.abort(); setView(null); }}>閉じる</button></header>
      <p>この端末に独立した隊列表として保存します。共同編集は始まりません。元のデータは削除しません。</p>
      {view === "cloud" ? <>
        <p>取り込み期限：本番切替から30日{until ? `（${new Date(until).toLocaleString("ja-JP")}まで）` : "。終了日時は一覧取得後に表示します。"}</p>
        {!canCloud && <p>旧クラウドで使ったアカウントにホームからログインしてください。下書きの救出はログイン不要です。</p>}
        <div className="legacy-rescue-actions"><button className="mini-button" type="button" disabled={!canCloud || busy || expired} onClick={() => void list()}>一覧を取得</button>
          {cursor && <button className="mini-button" type="button" disabled={busy || expired} onClick={() => void list(true)}>次の20件を取得</button>}
          <button className="mini-button primary" type="button" disabled={!canCloud || busy || expired || !selected.length} onClick={() => void importRows(rows.filter(r => selected.includes(r.projectId)))}>選んだ隊列表を取り込む / 再開</button>
          {busy && <button className="mini-button" type="button" onClick={() => controller.current?.abort()}>中断</button>}</div>
        {loaded && <p>{rows.length}件取得・{selected.length}件選択{cursor ? "（続きがあります）" : ""}。所有者の文書だけ表示します。</p>}
        {progress.total > 0 && <p role="status">{progress.completed} / {progress.total}件処理</p>}
        {renderRows(false)}
        {rows.some(r => r.hidden) && <details><summary>旧一覧で非表示にした隊列表（別候補）</summary><p>自動では選びません。必要な文書を選んでください。</p>{renderRows(true)}</details>}
        {loaded && rows.length === 0 && <p>取り込める旧文書はありません。</p>}
      </> : <>
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
      </>}
      {message && <p role="status" className="legacy-rescue-message">{message}</p>}
      {message && <FailureDetail detail={failureDetail} />}
      {busy && <p role="status">{view === "cloud" ? "取得・保存中…" : "端末ファイルを確認・保存中…"}</p>}
    </div></div>, document.body)}
  </section>;
}
