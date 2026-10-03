import { scrollWithinContainer } from "../utils/scrollWithinContainer";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ExportRequest, ExportSource, ExportTarget, GeneratedExport } from "../utils/mobileExportTypes";
import { ExportCompletionPanel } from "./ExportCompletionPanel";
import { useModalFocus } from "../hooks/useModalFocus";

export const EXPORT_TARGET_LABELS: Record<ExportTarget, string> = {
  formation: "隊列表", members: "メンバー名簿", objects: "道具名簿", assignments: "道具割当表",
};
type Props = { initialTarget: ExportTarget; initialFormat?: "png" | "pdf"; supportsFormation?: boolean; viewport?: boolean; getSource: () => ExportSource; onClose: () => void };

export const DocumentExportSheet = ({ initialTarget, initialFormat = "png", supportsFormation = false, viewport = false, getSource, onClose }: Props) => {
  const [request, setRequest] = useState<ExportRequest>({ target: initialTarget, scope: initialTarget === "formation" ? "all" : "current", purpose: initialTarget === "objects" ? "a4" : "mobile", format: initialTarget === "members" ? "png" : initialFormat, includeDetails: false });
  const [estimate, setEstimate] = useState("");
  const [memberFit, setMemberFit] = useState<"checking" | "fits" | "small" | "error">("checking");
  const [memberEstimate, setMemberEstimate] = useState("");
  const [result, setResult] = useState<GeneratedExport | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The finished file appears below the options; scroll so its share/save buttons are in view.
    // The preview image is inserted a moment later, so scroll again once it has taken its space.
    if (!result) return undefined;
    const reveal = () => scrollWithinContainer(resultRef.current, { behavior: "smooth", block: "end" });
    reveal();
    const timer = window.setTimeout(reveal, 200);
    return () => window.clearTimeout(timer);
  }, [result]);
  const [busy, setBusy] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const deliveryPending = useRef(false);
  const handleDeliveryBusy = (pending: boolean) => { deliveryPending.current = pending; setDelivering(pending); };
  const mounted = useRef(true);
  const dialog = useRef<HTMLElement>(null);
  const handleModalTab = useModalFocus(dialog);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    setRequest((previous) => ({ ...previous, target: initialTarget, scope: initialTarget === "formation" ? "all" : "current", purpose: initialTarget === "objects" ? "a4" : "mobile", format: initialTarget === "members" ? "png" : initialFormat }));
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
  useEffect(() => {
    if (request.target !== "members" || request.purpose !== "mobile") return;
    const abort = new AbortController();
    setMemberFit("checking"); setMemberEstimate("全員が入る配置を確認中…");
    void (async () => {
      try {
        const { createRosterExportSnapshot } = await import("../utils/rosterExportSnapshot");
        const { prepareMemberMobilePlan } = await import("../utils/memberMobileExport");
        const source = getSource();
        const snapshot = createRosterExportSnapshot(source.projectTitle, "members", source.members, source.memberGroups);
        const plan = await prepareMemberMobilePlan(snapshot, { signal: abort.signal, onProgress: () => {} });
        if (abort.signal.aborted) return;
        setMemberFit(plan ? "fits" : "small");
        setMemberEstimate(plan ? `1枚・${plan.width}×${plan.height}px・${plan.columns}列・名前${plan.fontSize}px` : "24pxの文字では全員が1枚に収まりません。作成方法を選び、プレビューで確認してください。");
      } catch (error) {
        if (!abort.signal.aborted) {
          setMemberFit("error"); setMemberEstimate(error instanceof Error ? error.message : "配置を確認できませんでした。");
        }
      }
    })();
    return () => abort.abort();
  }, [request.target, request.purpose, getSource]);
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
      if (!abort.signal.aborted && mounted.current) { setResult(completed); }
    } catch (error) {
      if (mounted.current) setNotice(abort.signal.aborted ? "作成を取り消しました。" : error instanceof Error ? error.message : "書き出しに失敗しました。もう一度お試しください。");
    } finally {
      controller.current = null;
      if (mounted.current) { setBusy(false); setProgress(""); }
    }
  };
  const update = (patch: Partial<ExportRequest>) => setRequest((previous) => ({ ...previous, ...patch }));
  const locked = busy || delivering;
  return <div className={`document-export-backdrop${viewport ? " document-export-backdrop--viewport" : ""}`}>
    <section ref={dialog} tabIndex={-1} className="document-export-sheet" role="dialog" aria-modal="true" aria-labelledby="document-export-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); if (busy) controller.current?.abort(); else if (!delivering) onClose(); }
        handleModalTab(event);
      }}>
      <header><h2 id="document-export-title">書き出し</h2><button className="share-export-close" type="button" disabled={locked} onClick={onClose} aria-label="閉じる"><X size={20} aria-hidden="true" /></button></header>
      <fieldset disabled={locked}><legend>対象</legend><div className="document-export-options">
        {Object.entries(EXPORT_TARGET_LABELS).filter(([target]) => target !== "formation" || supportsFormation || initialTarget === "formation").map(([target, label]) => <button type="button" key={target} aria-pressed={request.target === target}
          onClick={() => update({ target: target as ExportTarget, purpose: target === "objects" ? "a4" : "mobile", ...(target === "members" ? { format: "png", memberOverflow: "single" } : {}), ...(target === "formation" ? { scope: "all" } : {}) })}>{label}</button>)}
      </div></fieldset>
      {(request.target === "assignments" || request.target === "formation") && <fieldset disabled={locked}><legend>範囲</legend><div className="document-export-options">
        <button type="button" aria-pressed={request.scope === "current"} onClick={() => update({ scope: "current" })}>このシーン</button>
        <button type="button" aria-pressed={request.scope === "all"} onClick={() => update({ scope: "all" })}>全シーン</button>
      </div></fieldset>}
      {request.target === "formation" && <fieldset disabled={locked}><legend>読みやすさ</legend>
        <label className="document-export-check"><input type="checkbox" checked={Boolean(request.includeDetails)} onChange={(event) => update({ includeDetails: event.target.checked })} /> 拡大図も付ける</label>
        <p className="muted-text">名前が読める大きさで分割します。狭い隊列表では全体図だけになります。</p>
        <p role="status">{estimate}</p>
      </fieldset>}
      <fieldset disabled={locked}><legend>用途</legend><div className="document-export-options">
        {(request.target === "members" ? ["mobile", "a4"] as const : ["a4", "mobile"] as const)
          .filter(purpose => purpose === "mobile" || (request.target !== "assignments" && request.target !== "formation"))
          .map(purpose => <button key={purpose} type="button" aria-pressed={request.purpose === purpose} onClick={() => update({ purpose })}>{purpose === "mobile" ? "スマホで見る（LINE向け）" : "印刷向け（A4）"}</button>)}
      </div></fieldset>
      {request.target === "members" && request.purpose === "mobile" && <fieldset disabled={locked}><legend>1枚の名簿</legend>
        <p className="muted-text">全員を1枚にまとめます。名前は拡大して確認できます</p>
        <p role="status">{memberEstimate}</p>
        {memberFit === "small" && <div className="document-export-options">
          <button type="button" aria-pressed={request.memberOverflow !== "readable"} onClick={() => update({ memberOverflow: "single" })}>全員を1枚にする（文字が小さくなります）</button>
          <button type="button" aria-pressed={request.memberOverflow === "readable"} onClick={() => update({ memberOverflow: "readable" })}>読みやすさを優先して分ける（複数枚）</button>
        </div>}
      </fieldset>}
      <fieldset disabled={locked}><legend>形式</legend><div className="document-export-options">
        <button type="button" aria-pressed={request.format === "png"} onClick={() => update({ format: "png" })}>画像</button>
        <button type="button" aria-pressed={request.format === "pdf"} onClick={() => update({ format: "pdf" })}>PDF</button>
      </div></fieldset>
      <button type="button" className="primary document-export-create" disabled={locked || (request.target === "members" && request.purpose === "mobile" && (memberFit === "checking" || memberFit === "error"))} onClick={() => void create()}>{EXPORT_TARGET_LABELS[request.target]}の{request.format === "png" ? "画像" : "PDF"}を作成</button>
      {busy && <div className="document-export-progress"><p role="status">{progress}</p><button type="button" onClick={() => { controller.current?.abort(); setProgress("作成を取り消しています…"); }}>作成を取り消す</button></div>}
      {result && <div ref={resultRef}><ExportCompletionPanel result={result} disabled={busy} onBusyChange={handleDeliveryBusy} /></div>}
      {notice && <p role="status">{notice}</p>}
    </section>
  </div>;
};
