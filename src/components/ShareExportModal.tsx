import type { StageConfig, ViewerPerspective } from "../types";
import { ExportPerspectiveOptions } from "./ExportPerspectiveOptions";
import { Download, FileText, Users, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import { formatExportTimestamp } from "../utils/exportFileName";
import type { ExportSource } from "../utils/mobileExportTypes";

const DocumentExportSheet = lazy(() => import("./DocumentExportSheet").then((module) => ({ default: module.DocumentExportSheet })));

export type ShareExportScope = "current" | "all";

export type ShareExportFormat = "pdf" | "image";

export type ShareExportOptions = {
  viewerPerspective?: ViewerPerspective;
  includeBackground: boolean;
  includeGrid: boolean;
  includeMeterRulers: boolean;
  includeNotes: boolean;
  includeAssignments: boolean;
  includeHiddenMembers: boolean;
  includeSceneTime: boolean;
  includeSceneName: boolean;
  layout: "auto" | "two" | "three" | "four";
  sceneGapRows: number;
  /** PDF only. Off (default): kana/kanji use the viewer's own Japanese font (much lighter). On: embed fonts. */
  embedPdfFonts?: boolean;
};

export type ShareExportRequest = {
  scope: ShareExportScope;
  format: ShareExportFormat;
  fileName: string;
  options: ShareExportOptions;
};

type ShareExportModalProps = {
  stage: StageConfig;
  isOpen: boolean;
  projectTitle: string;
  currentSceneLabel: string;
  hasAudio?: boolean;
  isParade?: boolean;
  viewerPerspective?: ViewerPerspective;
  onClose: () => void;
  onOpenCollaboration?: () => void;
  onExport: (request: ShareExportRequest) => void | Promise<void>;
  onExportZip?: (includeAudio: boolean) => void | Promise<void>;
  getMobileExportSource?: () => ExportSource;
};

const fixedExportOptions: ShareExportOptions = {
  includeBackground: true,
  includeGrid: true,
  includeMeterRulers: true,
  includeNotes: false,
  includeAssignments: false,
  includeHiddenMembers: false,
  includeSceneTime: false,
  includeSceneName: true,
  layout: "auto",
  sceneGapRows: 5,
};

const makeDefaultFileName = (projectTitle: string): string =>
  `${projectTitle.trim() || "隊列メーカー"}_隊列表_${formatExportTimestamp()}`;

export const ShareExportModal = ({
  stage,
  isOpen,
  projectTitle,
  currentSceneLabel,
  hasAudio = false,
  isParade = false,
  viewerPerspective = "audience",
  onClose,
  onOpenCollaboration,
  onExport,
  onExportZip,
  getMobileExportSource,
}: ShareExportModalProps) => {
  const [exportPerspective, setExportPerspective] = useState(viewerPerspective);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) setExportPerspective(viewerPerspective);
    wasOpen.current = isOpen;
  }, [isOpen, viewerPerspective]);
  const [scope, setScope] = useState<ShareExportScope | null>(null);
  const [format, setFormat] = useState<ShareExportFormat>("pdf");
  const [fileName, setFileName] = useState("");
  const [includeAssignments, setIncludeAssignments] = useState(false);
  const [includeAudioInZip, setIncludeAudioInZip] = useState(false);
  // Deliberately not remembered: the lighter viewer-font PDF is the normal choice.
  const [embedPdfFonts, setEmbedPdfFonts] = useState(false);
  const [rosterTarget, setRosterTarget] = useState<"members" | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const handleModalTab = useModalFocus(dialogRef, isOpen && !rosterTarget);

  useEffect(() => {
    if (!isOpen || rosterTarget) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, rosterTarget]);

  useEffect(() => {
    if (scope) {
      setFileName(makeDefaultFileName(projectTitle));
    }
  }, [currentSceneLabel, projectTitle, scope]);

  useEffect(() => {
    if (!isOpen) {
      setFormat("pdf");
      setScope(null);
      setFileName("");
      setIncludeAssignments(false);
      setIncludeAudioInZip(false);
      setEmbedPdfFonts(false);
      setRosterTarget(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!hasAudio) {
      setIncludeAudioInZip(false);
    }
  }, [hasAudio]);

  if (!isOpen) {
    return null;
  }
  if (rosterTarget && getMobileExportSource) return <Suspense fallback={<div role="dialog" aria-modal="true" aria-label="書き出しを準備中"><p role="status">書き出しを準備中…</p></div>}>
    <DocumentExportSheet initialTarget={rosterTarget} initialFormat="png" viewport
      getSource={getMobileExportSource} onClose={() => setRosterTarget(null)} />
  </Suspense>;

  const startExport = (nextScope: ShareExportScope) => {
    setScope(nextScope);
  };

  const submitExport = async () => {
    if (!scope) {
      return;
    }
    await onExport({
      scope,
      format,
      fileName: fileName.trim() || makeDefaultFileName(projectTitle),
      options: { ...fixedExportOptions, includeAssignments, viewerPerspective: isParade ? "audience" : exportPerspective,
        ...(format === "pdf" && embedPdfFonts ? { embedPdfFonts: true } : {}) },
    });
    onClose();
  };

  const runZipExport = async () => {
    if (!onExportZip) {
      return;
    }
    await onExportZip(hasAudio ? includeAudioInZip : false);
    onClose();
  };

  return (
    <div
      className="share-export-backdrop"
      onPointerDown={onClose}
      role="presentation"
    >
      <section
        ref={dialogRef}
        onKeyDown={handleModalTab}
        tabIndex={-1}
        className="share-export-modal"
        role="dialog"
        aria-modal="true"
        aria-label="共有と書き出し"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="share-export-modal__header">
          {scope ? (
            <button
              className="share-export-text-button"
              onClick={() => setScope(null)}
              type="button"
            >
              戻る
            </button>
          ) : (
            <span />
          )}
          <h2>
            {scope === "current"
              ? "このシーンを書き出す"
              : scope === "all"
                ? "すべてのシーンを書き出す"
                : "共有と書き出し"}
          </h2>
          <button
            className="share-export-close"
            onClick={onClose}
            type="button"
            aria-label="共有と書き出しを閉じる"
          >
            <X size={20} />
          </button>
        </header>

        {!scope ? (
          <div className="share-export-home">
            {onOpenCollaboration && <section className="share-export-section"><button className="share-export-row" type="button" onClick={onOpenCollaboration}>
              <Users size={26} /><span><strong>みんなで編集</strong><small>クラウド保存・招待・参加メンバー</small></span>
            </button></section>}
            <section className="share-export-section">
              <h3>隊列表（A4）</h3>
              <button
                className="share-export-row"
                onClick={() => startExport("current")}
                type="button"
              >
                <FileText size={26} />
                <span>
                  <strong>このシーンを書き出す</strong>
                  <small>PDF・画像を作成してから共有・保存できます</small>
                </span>
              </button>
              <button
                className="share-export-row"
                onClick={() => startExport("all")}
                type="button"
              >
                <Download size={26} />
                <span>
                  <strong>すべてのシーンを書き出す</strong>
                  <small>全シーンのPDF・画像を作成してから共有・保存できます</small>
                </span>
              </button>
              <label className="share-export-check">
                <input
                  checked={includeAssignments}
                  onChange={(event) => setIncludeAssignments(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  道具割当も右側に表示する
                  <small>
                    ステージ隊列の右側に、配置中の道具と担当メンバーを入れます。
                  </small>
                </span>
              </label>
            </section>

            {getMobileExportSource && (
              <section className="share-export-section">
                <h3>メンバー名簿</h3>
                <button className="share-export-row" type="button" onClick={() => setRosterTarget("members")}>
                  <Users size={26} aria-hidden="true" />
                  <span>
                    <strong>メンバー名簿</strong>
                    <small>グループごとのメンバー一覧を書き出します</small>
                  </span>
                </button>
              </section>
            )}

            {onExportZip && (
              <section className="share-export-section">
                <h3>隊列表共有</h3>
                <button
                  className="share-export-row"
                  onClick={() => void runZipExport()}
                  type="button"
                >
                  <Download size={26} />
                  <span>
                    <strong>隊列表ZIPを書き出す</strong>
                    <small>他の人の隊列メーカーへ読み込める .zip ファイルを作成します</small>
                  </span>
                </button>
                <label
                  className={
                    hasAudio
                      ? "share-export-check"
                      : "share-export-check is-disabled"
                  }
                >
                  <input
                    checked={includeAudioInZip}
                    disabled={!hasAudio}
                    onChange={(event) => setIncludeAudioInZip(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    音源ファイルも含める
                    <small>
                      {hasAudio
                        ? "共有先でも音源を再選択せずに再生できます。ファイルサイズは大きくなります。"
                        : "この隊列表には音源が設定されていません。"}
                    </small>
                  </span>
                </label>
              </section>
            )}
          </div>
        ) : (
          <div className="share-export-detail">
            {!isParade && <ExportPerspectiveOptions stage={stage} value={exportPerspective} onChange={setExportPerspective} />}
            <fieldset><legend>形式</legend><div className="document-export-options">
              <button type="button" aria-pressed={format === "pdf"} onClick={() => setFormat("pdf")}>PDF</button>
              <button type="button" aria-pressed={format === "image"} onClick={() => setFormat("image")}>画像</button>
            </div></fieldset>
            {format === "image" && <p className="muted-text">A4の1ページにつき1枚の画像を作成します。複数枚には連番とページ番号が付きます。</p>}
            <label className="share-export-field">
              ファイル名
              <input
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder={makeDefaultFileName(projectTitle)}
              />
            </label>

            <label className="share-export-check">
              <input
                checked={includeAssignments}
                onChange={(event) => setIncludeAssignments(event.target.checked)}
                type="checkbox"
              />
              <span>
                道具割当も右側に表示する
                <small>
                  ステージ隊列の右側に、配置中の道具と担当メンバーをまとめて入れます。
                </small>
              </span>
            </label>

            <p className="notice muted">
              シーン名とステージ画像を並べた、印刷しやすい固定レイアウトで書き出します。
            </p>

            {format === "pdf" && <label className="export-font-option">
              <input type="checkbox" checked={embedPdfFonts} onChange={(event) => setEmbedPdfFonts(event.target.checked)} />
              フォントを入れて作る（相手の画面で文字が正しく出ないときだけ・重くなります）
            </label>}

            <button
              className="share-export-submit"
              onClick={() => void submitExport()}
              type="button"
            >
              {format === "pdf" ? "PDFを作成" : "画像を作成"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
