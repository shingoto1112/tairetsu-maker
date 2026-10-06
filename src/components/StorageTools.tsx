import { useEffect, useRef, useState } from "react";
import type { MaintenanceRepository } from "../storage/maintenanceTypes";
import { listRecoveryCandidates, recoveryItem, recoveryRequest, restoreCandidate, inspectCandidateZip, restorePreviousAsCopy, type RecoveryCandidate } from "../storage/recovery";
import { estimateBackup, generateBulkBackup, type BackupManifest } from "../storage/bulkBackup";
import { cleanupOldData, oldDataCleanupReasons } from "../storage/maintenance";
import { isNativeExportRuntime, shareGeneratedFilesWithNativeSheet, shareBlobWithNativeSheet } from "../platform/files";
import type { CommitRequest } from "../repositories/types";

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
};
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export const StorageTools = ({ repository, onChanged, damagedId, onDismissDamaged, menuRequest = 0, hideMenuButton = false }: {
  repository: MaintenanceRepository; onChanged: () => Promise<void>; damagedId: string | null; onDismissDamaged: () => void;
  /** Incremented by the home "…" menu to open 保存データの管理; the body stays mounted while it is closed. */
  menuRequest?: number;
  /** The home header owns the entry; restore candidates and messages stay visible here. */
  hideMenuButton?: boolean;
}) => {
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([]);
  const [view, setView] = useState<"recovery" | "menu" | "backup" | "cleanup" | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [includeAudio, setIncludeAudio] = useState(false), [estimate, setEstimate] = useState<{ count: number; audioBytes: number; jsonBytes: number; unknownCount: number } | null>(null);
  const [cleanupReasons, setCleanupReasons] = useState<string[]>([]);
  const requests = useRef(new Map<string, CommitRequest>());
  const refresh = async () => setCandidates(await listRecoveryCandidates(repository));
  useEffect(() => { let active = true; void listRecoveryCandidates(repository).then(items => { if (active) setCandidates(items); }).catch(() => {
    if (active) setMessage("復元候補を確認できません。保存データはそのまま残っています。");
  }); return () => { active = false; }; }, [repository]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return; setBusy(true); setMessage(null);
    try { await work(); } catch (e) { setMessage(e instanceof Error ? e.message : "処理を完了できませんでした。"); }
    finally { setBusy(false); }
  };
  const backup = async () => {
    let result: BackupManifest | null = null;
    async function* files() {
      for await (const file of generateBulkBackup(repository, includeAudio, (done, total) => setMessage(`バックアップを作成しています（${done}／${total}件）`))) {
        if (file.fileName.endsWith(".manifest.json")) result = JSON.parse(await file.blob.text()) as BackupManifest;
        yield file;
      }
    }
    const status = isNativeExportRuntime() ? await shareGeneratedFilesWithNativeSheet(files()) : await (async () => {
      for await (const file of files()) { download(file.blob, file.fileName); await new Promise(resolve => setTimeout(resolve, 150)); }
      return "downloaded";
    })();
    const final = result as BackupManifest | null;
    setMessage(status === "cancelled" ? "共有を取り消しました。保存先へのバックアップは完了していません。"
      : `${final?.exportedCount ?? 0}件を書き出しました。失敗 ${final?.failedCount ?? 0}件。${status === "downloaded" ? "ダウンロード先にZIPと一覧ファイルがすべてあることを確認してください。" : ""}`);
  };
  const close = () => { if (!busy) { setView(null); onDismissDamaged(); } };
  const dialog = view !== null || damagedId !== null;
  const handledRequest = useRef(menuRequest);
  useEffect(() => {
    if (menuRequest === handledRequest.current) return;
    handledRequest.current = menuRequest;
    if (!busy) { setMessage(null); setView("menu"); }
  }, [menuRequest, busy]);
  const empty = hideMenuButton && candidates.length === 0 && !(!dialog && message) && !dialog;
  return <section className={`storage-tools${empty ? " is-empty" : ""}`} aria-label="端末の保存データ">
    {candidates.length > 0 && <button className="mini-button" onClick={() => { setMessage(null); setView("recovery"); }}>復元できる隊列表（{candidates.length}件）</button>}
    {!hideMenuButton && <button className="mini-button" onClick={() => { setMessage(null); setView("menu"); }}>保存データの管理</button>}
    {!dialog && message && <p className="notice" role="status">{message}</p>}
    {dialog && <div className="new-formation-backdrop" onPointerDown={close}>
      <div className="new-formation-dialog storage-tools-dialog" role="dialog" aria-modal="true" aria-label={damagedId ? "読み込めない隊列表の復旧" : view === "recovery" ? "復元できる隊列表" : "保存データの管理"} onPointerDown={e => e.stopPropagation()}>
        <header><h2>{damagedId ? "隊列表を読み込めません" : view === "recovery" ? "復元できる隊列表" : "保存データの管理"}</h2><button className="mini-button" disabled={busy} onClick={close} aria-label="閉じる">閉じる</button></header>
        {damagedId ? <><p>前の正常な保存を、別の隊列表として一覧に戻せます。元の保存データは残ります。</p>
          <button className="mini-button" disabled={busy} onClick={() => void run(async () => { await restorePreviousAsCopy(repository, damagedId); await onChanged(); onDismissDamaged(); setMessage("前の保存を別の隊列表として復元しました。"); })}>前の保存を一覧に復元</button></>
        : view === "recovery" ? <><p>一覧に自動追加しなかった以前のデータです。復元すると独立した隊列表が増えます。</p>
          {candidates.map(candidate => <article className="storage-recovery-item" key={candidate.id}>
            <strong>{candidate.title}</strong><p>{candidate.updatedAt ? new Date(candidate.updatedAt).toLocaleString("ja-JP") : "更新日時不明"} ・ {candidate.memberCount ?? "不明"}人 ・ {candidate.sceneCount ?? "不明"}シーン</p><p className="notice muted">{candidate.source}</p>
            {candidate.restorable ? <button className="mini-button" disabled={busy} onClick={() => void run(async () => {
              let request = requests.current.get(candidate.id);
              if (!request) { request = recoveryRequest((await recoveryItem(repository, candidate.id)).json); requests.current.set(candidate.id, request); }
              await restoreCandidate(repository, candidate.id, request); requests.current.delete(candidate.id); await refresh(); await onChanged(); setMessage("一覧に復元しました。");
            })}>一覧に復元</button> : <><p>構造を読み取れないため、調査用のZIPだけを書き出せます。</p><button className="mini-button" disabled={busy} onClick={() => void run(async () => {
              const blob = await inspectCandidateZip(repository, candidate.id);
              if (isNativeExportRuntime()) await shareBlobWithNativeSheet({ blob, fileName: "recovery-inspection.zip" }); else download(blob, "recovery-inspection.zip");
            })}>ZIP で書き出す</button></>}
            <label className="checkbox-row"><input type="checkbox" checked={candidate.reviewed} disabled={busy || candidate.reviewed} onChange={() => void run(async () => {
              await repository.updateMaintenance({ action: "reviewed", ids: [candidate.id] }); await refresh();
            })} />この候補を確認しました（元の候補は残ります）</label>
          </article>)}
        </> : view === "backup" ? <><p>対象はこの端末に保存されている{estimate?.count ?? "…"}件の隊列表です。まだ取得していないクラウドの隊列表は含まれません。</p><p>1件ずつZIPで書き出します。共有への参加資格は含まれず、復元すると独立した隊列表になります。復元するときはZIPと一覧ファイルをまとめて選択してください。</p>
          <label className="checkbox-row"><input type="checkbox" checked={includeAudio} disabled={busy} onChange={e => setIncludeAudio(e.target.checked)} />音源も含める</label>
          <p>合計サイズの目安（圧縮前）：{estimate ? megabytes(estimate.jsonBytes + (includeAudio ? estimate.audioBytes : 0)) : "計算中…"}</p>
          {!!estimate?.unknownCount && <p className="notice">読み取れない{estimate.unknownCount}件のサイズは含まれていません。読み取れる隊列表の書き出しを続けます。</p>}
          {!isNativeExportRuntime() && <p className="notice">複数のファイルをダウンロードします。ブラウザに確認された場合は、複数ダウンロードを許可してください。</p>}
          <button className="mini-button primary" disabled={busy || !estimate?.count} onClick={() => void run(backup)}>バックアップを書き出す</button>
        </> : view === "cleanup" ? <><p>以前のlocalStorage、iPadの旧ミラーと旧音源だけを整理します。現在の隊列表・前世代・復元候補は残ります。</p>
          {cleanupReasons.map(reason => <p className="notice" key={reason}>{reason}</p>)}
          <button className="mini-button danger" disabled={busy || !!cleanupReasons.length} onClick={() => {
            if (window.confirm("古い保存データと旧音源を削除します。現在のデータと復元候補は残ります。先に手動バックアップを保存してください。整理しますか？")) void run(async () => { await cleanupOldData(repository); setMessage("古い保存データを整理しました。"); });
          }}>古いデータを削除する</button>
        </> : <><button className="mini-button" disabled={busy} onClick={() => void run(async () => { setView("backup"); setEstimate(await estimateBackup(repository)); })}>すべての隊列表をバックアップ</button>
          <button className="mini-button" disabled={busy} onClick={() => void run(async () => { setCleanupReasons(await oldDataCleanupReasons(repository)); setView("cleanup"); })}>古い保存データを整理</button></>}
        {message && <p className="notice" role="status">{message}</p>}
      </div>
    </div>}
  </section>;
};

export const StorageRecoveryScreen = ({ repository, onRestored }: { repository: MaintenanceRepository | null; onRestored: () => void }) => {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return <main className="library-shell"><h1>保存データを読み込めません</h1>
    <p>保存データを空で作り直すことはしません。</p>
    {repository?.restoreRecoveryBackup ? <><p>最後に検証した端末バックアップから戻せます。その後の編集は含まれない可能性があります。現在のデータは調査用に残します。</p>
      <button className="mini-button" disabled={busy} onClick={() => {
        if (!window.confirm("最後に検証したバックアップへ戻しますか？バックアップ作成後の編集は含まれない可能性があります。")) return;
        setBusy(true); setError(null);
        void repository.restoreRecoveryBackup!().then(onRestored).catch((e: unknown) => setError(e && typeof e === "object" && "code" in e && e.code === "NOT_FOUND"
          ? "検証済みバックアップが見つかりませんでした。現在のデータは残っています。" : e instanceof Error ? e.message : "バックアップから戻せませんでした。")).finally(() => setBusy(false));
      }}>検証済みバックアップから戻す</button></> : <p>この端末の保存領域を読み込めません。別途保存したZIPを保管し、保存領域へのアクセスを確認してください。</p>}
    {error && <p role="alert">{error}</p>}
  </main>;
};
