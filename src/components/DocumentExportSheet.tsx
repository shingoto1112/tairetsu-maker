import { useEffect, useRef, useState } from "react";
import type { ExportRequest, ExportSource, ExportTarget, GeneratedExport } from "../utils/mobileExportTypes";
import { canShareExportFiles, saveExportFile, shareExportFiles } from "../utils/exportDelivery";

export const EXPORT_TARGET_LABELS: Record<ExportTarget, string> = {
  formation: "隊列表", members: "メンバー名簿", objects: "道具名簿", assignments: "道具割当表",
};
type Props = { initialTarget: ExportTarget; initialFormat?: "png" | "pdf"; supportsFormation?: boolean; viewport?: boolean; getSource: () => ExportSource; onClose: () => void };
const sizeLabel = (size: number) => size >= 1_000_000 ? `${(size / 1_000_000).toFixed(2)}MB` : `${Math.ceil(size / 1000)}KB`;

export const DocumentExportSheet = ({ initialTarget, initialFormat = "png", supportsFormation = false, viewport = false, getSource, onClose }: Props) => {
  const [request, setRequest] = useState<ExportRequest>({ target: initialTarget, scope: initialTarget === "formation" ? "all" : "current", purpose: "mobile", format: initialFormat, includeDetails: false });
  const [estimate, setEstimate] = useState("");
  const [result, setResult] = useState<GeneratedExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [saveList, setSaveList] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const deliveryPending = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      mounted.current = false; controller.current?.abort();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!result) return;
    const url = URL.createObjectURL(result.preview); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  useEffect(() => {
    setRequest((previous) => ({ ...previous, target: initialTarget, scope: initialTarget === "formation" ? "all" : "current", purpose: "mobile", format: initialFormat }));
  }, [initialTarget, initialFormat]);
  useEffect(() => {
    if (request.target !== "formation") { setEstimate(""); return; }
    const abort = new AbortController();
    setEstimate("予想ページ数を確認中…");
    void (async () => {
      try {
        const source = getSource();
        const { createFormationSnapshot } = await import("../utils/formationExportLayout");
        const { prepareFormationPages } = await import("../utils/formationExport");
        if (abort.signal.aborted) return;
        const snapshot = createFormationSnapshot(source, request.scope);
        const pages = await prepareFormationPages(snapshot, Boolean(request.includeDetails), { signal: abort.signal, onProgress: () => {} });
        if (!abort.signal.aborted) setEstimate(`予想 ${pages.length}ページ${request.includeDetails ? "（全体図 → 拡大図・左から右）" : ""}`);
      } catch (error) {
        if (!abort.signal.aborted) setEstimate(error instanceof Error ? error.message : "予想ページ数を確認できませんでした。");
      }
    })();
    return () => abort.abort();
  }, [request.target, request.scope, request.includeDetails, getSource]);
  const create = async () => {
    if (controller.current || deliveryPending.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setNotice(""); setProgress("書き出しを準備中…");
    try {
      // Freeze source before importing encoders or waiting for fonts.
      const source = getSource();
      const { exportTargets, generateDocumentExport } = await import("../utils/mobileExport");
      if (abort.signal.aborted) throw new DOMException("取り消しました。", "AbortError");
      const snapshot = exportTargets[request.target].snapshot(source, request);
      const completed = await generateDocumentExport(snapshot, request, {
        signal: abort.signal, onProgress: (message) => { if (mounted.current) setProgress(message); },
      });
      if (!abort.signal.aborted && mounted.current) { setResult(completed); setSaveList(false); }
    } catch (error) {
      if (mounted.current) setNotice(abort.signal.aborted ? "作成を取り消しました。" : error instanceof Error ? error.message : "書き出しに失敗しました。もう一度お試しください。");
    } finally {
      controller.current = null;
      if (mounted.current) { setBusy(false); setProgress(""); }
    }
  };
  const deliver = async (action: () => Promise<string>, sharing: boolean) => {
    if (deliveryPending.current) return;
    deliveryPending.current = true; setDelivering(true); setNotice("");
    try {
      // action invokes Web Share synchronously in the click stack with prepared Files.
      const status = await action();
      if (mounted.current) setNotice(status === "cancelled" ? "取り消しました。作成済みファイルからもう一度試せます。"
        : status === "unsupported" ? "この環境ではファイル共有に対応していません。保存するをご利用ください。"
          : sharing ? "共有先への受け渡しが完了しました。" : status === "shared" ? "保存・共有先への受け渡しが完了しました。" : "保存しました。");
    } catch (error) {
      if (mounted.current) setNotice(`受け渡しに失敗しました。作成済みファイルから再試行できます。${error instanceof Error ? ` ${error.message}` : ""}`);
    } finally { deliveryPending.current = false; if (mounted.current) setDelivering(false); }
  };
  const update = (patch: Partial<ExportRequest>) => setRequest((previous) => ({ ...previous, ...patch }));
  const locked = busy || delivering;
  return <div className={`document-export-backdrop${viewport ? " document-export-backdrop--viewport" : ""}`}>
    <section ref={dialog} className="document-export-sheet" role="dialog" aria-modal="true" aria-labelledby="document-export-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); if (busy) controller.current?.abort(); else if (!delivering) onClose(); }
        if (event.key === "Tab") {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><h2 id="document-export-title">書き出し</h2><button type="button" disabled={locked} onClick={onClose}>閉じる</button></header>
      <fieldset disabled={locked}><legend>対象</legend><div className="document-export-options">
        {Object.entries(EXPORT_TARGET_LABELS).filter(([target]) => target !== "formation" || supportsFormation || initialTarget === "formation").map(([target, label]) => <button type="button" key={target} aria-pressed={request.target === target}
          onClick={() => update({ target: target as ExportTarget, ...(target === "assignments" || target === "formation" ? { purpose: "mobile" } : {}), ...(target === "formation" ? { scope: "all" } : {}) })}>{label}</button>)}
      </div></fieldset>
      {(request.target === "assignments" || request.target === "formation") && <fieldset disabled={locked}><legend>範囲</legend><div className="document-export-options">
        <button type="button" aria-pressed={request.scope === "current"} onClick={() => update({ scope: "current" })}>このシーン</button>
        <button type="button" aria-pressed={request.scope === "all"} onClick={() => update({ scope: "all" })}>全シーン</button>
      </div></fieldset>}
      {request.target === "formation" && <fieldset disabled={locked}><legend>読みやすさ</legend>
        <label><input type="checkbox" checked={Boolean(request.includeDetails)} onChange={(event) => update({ includeDetails: event.target.checked })} /> 拡大図も付ける</label>
        <p className="muted-text">名前が読める大きさで分割します。狭い隊列表では全体図だけになります。</p>
        <p role="status">{estimate}</p>
      </fieldset>}
      <fieldset disabled={locked}><legend>用途</legend><div className="document-export-options">
        <button type="button" aria-pressed={request.purpose === "mobile"} onClick={() => update({ purpose: "mobile" })}>スマホで見る（LINE向け）</button>
        {request.target !== "assignments" && request.target !== "formation" && <button type="button" aria-pressed={request.purpose === "a4"} onClick={() => update({ purpose: "a4" })}>印刷向け（A4）</button>}
      </div></fieldset>
      <fieldset disabled={locked}><legend>形式</legend><div className="document-export-options">
        <button type="button" aria-pressed={request.format === "png"} onClick={() => update({ format: "png" })}>画像</button>
        <button type="button" aria-pressed={request.format === "pdf"} onClick={() => update({ format: "pdf" })}>PDF</button>
      </div></fieldset>
      <button type="button" className="primary" disabled={locked} onClick={() => void create()}>{EXPORT_TARGET_LABELS[request.target]}の{request.format === "png" ? "画像" : "PDF"}を作成</button>
      {busy && <div className="document-export-progress"><p role="status">{progress}</p><button type="button" onClick={() => { controller.current?.abort(); setProgress("作成を取り消しています…"); }}>作成を取り消す</button></div>}
      {result && <section className="document-export-result" aria-label="作成済みファイル">
        <h3>{result.targetLabel}・{result.scopeLabel}</h3>
        <p>{result.files[0].type === "application/pdf" ? `PDF・${result.pageCount}ページ` : `${result.files.length}枚の画像`}・合計 {sizeLabel(result.files.reduce((sum, file) => sum + file.size, 0))}</p>
        {previewUrl && <img src={previewUrl} alt={`${result.targetLabel}の先頭ページ`} />}
        <p className="muted-text">共有先でLINEを選んでください。</p>
        {!canShareExportFiles(result.files) && <p>この環境では共有できません。保存するをご利用ください。</p>}
        {result.files.length > 4 && <p>画像が多い場合は、PDFにまとめると共有・保存しやすくなります。</p>}
        <div className="document-export-options">
          <button type="button" disabled={locked || !canShareExportFiles(result.files)} onClick={() => void deliver(() => shareExportFiles(result.files, result.targetLabel), true)}>共有する</button>
          <button type="button" disabled={locked} onClick={() => {
            if (result.files.length === 1) void deliver(() => saveExportFile(result.files[0]), false);
            else setSaveList(true);
          }}>保存する</button>
        </div>
        {saveList && <div><p>画像は1枚ずつ保存してください。</p>{result.files.map((file, index) =>
          <button type="button" key={file.name} disabled={locked} onClick={() => void deliver(() => saveExportFile(file), false)}>{index + 1}枚目を保存</button>)}</div>}
      </section>}
      {notice && <p role="status">{notice}</p>}
    </section>
  </div>;
};
