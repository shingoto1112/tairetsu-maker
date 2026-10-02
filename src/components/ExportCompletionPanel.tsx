import { Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CompletedExport } from "../utils/mobileExportTypes";
import { canShareExportFiles, isAppleTouchDevice, saveExportFile, shareExportFiles } from "../utils/exportDelivery";
import { isNativeExportRuntime, isNativeExportShareAvailable } from "../platform/files";

const sizeLabel = (size: number) => size >= 1_000_000 ? `${(size / 1_000_000).toFixed(2)}MB` : `${Math.ceil(size / 1000)}KB`;
type Props = { result: CompletedExport; disabled?: boolean; onBusyChange?: (busy: boolean) => void; onCopyImage?: (blob: Blob) => Promise<boolean> };

export const ExportCompletionPanel = ({ result, disabled = false, onBusyChange, onCopyImage }: Props) => {
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveList, setSaveList] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setNotice(""); setSaveList(false);
    if (!result.preview) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(result.preview); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  const native = isNativeExportRuntime();
  const shareAvailable = canShareExportFiles(result.files);
  const sharePrimary = native || (isAppleTouchDevice() && shareAvailable);
  const locked = disabled || busy;
  const pdf = result.files[0]?.type === "application/pdf";
  const images = result.files.every((file) => file.type.startsWith("image/"));
  const deliver = async (action: () => Promise<string>, sharing: boolean) => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); onBusyChange?.(true); setNotice("");
    try {
      // Invoke the prepared Web Share action in the tap stack, before any await.
      const status = await action();
      if (mounted.current) setNotice(status === "cancelled" ? "取り消しました。作成済みファイルからもう一度試せます。"
        : status === "unsupported" ? "この環境ではファイル共有に対応していません。保存するをご利用ください。"
          : sharing || status === "shared" ? "共有先への受け渡しが完了しました。"
            : status === "copied" ? "画像をクリップボードにコピーしました。" : status === "downloaded" ? "ダウンロードを開始しました。" : "保存しました。");
    } catch (error) {
      if (mounted.current) setNotice(`受け渡しに失敗しました。作成済みファイルから再試行できます。${error instanceof Error ? ` ${error.message}` : ""}`);
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); onBusyChange?.(false); }
    }
  };
  const share = () => void deliver(() => shareExportFiles(result.files, result.targetLabel), true);
  const save = () => {
    if (result.files.length === 1) void deliver(() => saveExportFile(result.files[0]), false);
    else setSaveList(true);
  };
  return <section className="document-export-result" aria-label="作成済みファイル" aria-busy={busy}>
    <h3>{result.targetLabel}・{result.scopeLabel}</h3>
    <p>{pdf ? `PDF・${result.pageCount}ページ` : images ? `${result.files.length}枚の画像` : `${result.files.length}個のファイル`}・合計 {sizeLabel(result.files.reduce((sum, file) => sum + file.size, 0))}</p>
    {previewUrl && <img src={previewUrl} alt={`${result.targetLabel}の先頭ページ`} />}
    {sharePrimary && <p className="muted-text">{images ? "LINE・AirDrop・写真への保存など" : "LINE・AirDrop・ファイルへの保存など"}</p>}
    {native && !isNativeExportShareAvailable() && <p role="alert">共有機能が見つかりません。アプリを更新してから再試行してください。</p>}
    {images && result.files.length > 4 && <p>画像が多い場合は、PDFにまとめると共有・保存しやすくなります。</p>}
    <div className="document-export-options">
      <button type="button" className="primary export-completion-primary" disabled={locked || (native && !shareAvailable)} onClick={sharePrimary ? share : save}>
        {sharePrimary && <Share2 size={20} aria-hidden="true" />}{sharePrimary ? "共有・保存" : "保存する"}
      </button>
      {!native && sharePrimary && <button type="button" disabled={locked} onClick={save}>ファイルに保存</button>}
      {!sharePrimary && shareAvailable && <button type="button" disabled={locked} onClick={share}>共有する</button>}
      {!native && !isAppleTouchDevice() && onCopyImage && images && result.files.length === 1 &&
        <button type="button" disabled={locked} onClick={() => void deliver(async () => {
          if (!await onCopyImage(result.files[0])) throw new Error("この環境ではクリップボードにコピーできません。");
          return "copied";
        }, false)}>画像をコピー</button>}
    </div>
    {saveList && <div className="export-completion-save-list"><p>画像は1枚ずつ保存してください。</p>{result.files.map((file, index) =>
      <button type="button" key={file.name} disabled={locked} onClick={() => void deliver(() => saveExportFile(file), false)}>{index + 1}枚目を保存</button>)}</div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
};

export const ExportCompletionDialog = ({ result, onClose, onCopyImage }: { result: CompletedExport; onClose: () => void; onCopyImage?: Props["onCopyImage"] }) => {
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="document-export-backdrop document-export-backdrop--viewport">
    <section ref={dialog} className="document-export-sheet" role="dialog" aria-modal="true" aria-label="書き出し完了"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); if (!busy) onClose(); }
        if (event.key === "Tab") {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><h2>書き出し完了</h2><button type="button" disabled={busy} onClick={onClose}>閉じる</button></header>
      <ExportCompletionPanel result={result} onBusyChange={setBusy} onCopyImage={onCopyImage} />
    </section>
  </div>;
};
