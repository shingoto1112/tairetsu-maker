import { Download, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";

export type ShareExportScope = "current" | "all";

export type ShareExportFormat = "pdf" | "image";

export type ShareExportOptions = {
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
};

export type ShareExportRequest = {
  scope: ShareExportScope;
  format: ShareExportFormat;
  fileName: string;
  options: ShareExportOptions;
};

type ShareExportModalProps = {
  isOpen: boolean;
  projectTitle: string;
  currentSceneLabel: string;
  hasAudio?: boolean;
  onClose: () => void;
  onExport: (request: ShareExportRequest) => void | Promise<void>;
  onExportZip?: (includeAudio: boolean) => void | Promise<void>;
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

const makeDefaultFileName = (
  scope: ShareExportScope,
  projectTitle: string,
  currentSceneLabel: string,
): string => {
  const title = projectTitle.trim() || "隊列メーカー";
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  if (scope === "current") {
    return `${title}_${currentSceneLabel || "現在シーン"}_${date}`;
  }
  return `${title}_${date}`;
};

export const ShareExportModal = ({
  isOpen,
  projectTitle,
  currentSceneLabel,
  hasAudio = false,
  onClose,
  onExport,
  onExportZip,
}: ShareExportModalProps) => {
  const [scope, setScope] = useState<ShareExportScope | null>(null);
  const [fileName, setFileName] = useState("");
  const [includeAssignments, setIncludeAssignments] = useState(false);
  const [includeAudioInZip, setIncludeAudioInZip] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (scope) {
      setFileName(makeDefaultFileName(scope, projectTitle, currentSceneLabel));
    }
  }, [currentSceneLabel, projectTitle, scope]);

  useEffect(() => {
    if (!isOpen) {
      setScope(null);
      setFileName("");
      setIncludeAssignments(false);
      setIncludeAudioInZip(false);
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

  const startExport = (nextScope: ShareExportScope) => {
    setScope(nextScope);
  };

  const submitExport = async () => {
    if (!scope) {
      return;
    }
    await onExport({
      scope,
      format: "pdf",
      fileName: fileName.trim() || makeDefaultFileName(scope, projectTitle, currentSceneLabel),
      options: { ...fixedExportOptions, includeAssignments },
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
            <section className="share-export-section">
              <h3>印刷・PDF</h3>
              <button
                className="share-export-row"
                onClick={() => startExport("current")}
                type="button"
              >
                <FileText size={26} />
                <span>
                  <strong>このシーンを書き出す</strong>
                  <small>現在のシーンをPDFで保存します</small>
                </span>
              </button>
              <button
                className="share-export-row"
                onClick={() => startExport("all")}
                type="button"
              >
                <Download size={26} />
                <span>
                  <strong>すべてのシーンを書き出す / PDF保存</strong>
                  <small>ファイル名を指定してPDFで保存します</small>
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
                    <small>他の人の隊列メーカーへ読み込める .zip ファイルを保存します</small>
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
            <label className="share-export-field">
              ファイル名
              <input
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder={makeDefaultFileName(scope, projectTitle, currentSceneLabel)}
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

            <button
              className="share-export-submit"
              onClick={() => void submitExport()}
              type="button"
            >
              PDFとして保存
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
