import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";

export const CameraExportDialog = ({ onClose, onExport }: { onClose: () => void; onExport: (format: "image" | "pdf") => void }) => {
  const [format, setFormat] = useState<"image" | "pdf">("image");
  const dialog = useRef<HTMLElement>(null), handleTab = useModalFocus(dialog);
  return <div className="document-export-backdrop document-export-backdrop--viewport">
    <section ref={dialog} tabIndex={-1} className="document-export-sheet" role="dialog" aria-modal="true" aria-label="ステージを書き出す"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } handleTab(event); }}>
      <header><h2>ステージを書き出す</h2><button type="button" onClick={onClose} aria-label="閉じる"><X size={20} /></button></header>
      <p>ステージ周辺を、現在の余白と縦横比で1ページにします。</p>
      <fieldset><legend>形式</legend><div className="document-export-options">
        <button type="button" aria-pressed={format === "image"} onClick={() => setFormat("image")}>画像</button>
        <button type="button" aria-pressed={format === "pdf"} onClick={() => setFormat("pdf")}>PDF</button>
      </div></fieldset>
      <button type="button" className="primary document-export-create" onClick={() => onExport(format)}>{format === "image" ? "画像を作成" : "PDFを作成"}</button>
    </section>
  </div>;
};
