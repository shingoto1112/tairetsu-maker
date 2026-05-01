import {
  Download,
  FileJson,
  FileText,
  Image,
  Link2,
  Printer,
  Share2,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useRef, useState } from "react";

export type ShareExportScope = "current" | "all";

export type ShareExportFormat = "pdf" | "image" | "stageflow" | "link";

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
  onClose: () => void;
  onExport: (request: ShareExportRequest) => void | Promise<void>;
  onImportJson: (file: File) => void;
};

const defaultOptions: ShareExportOptions = {
  includeBackground: true,
  includeGrid: true,
  includeMeterRulers: true,
  includeNotes: true,
  includeAssignments: true,
  includeHiddenMembers: false,
  includeSceneTime: true,
  includeSceneName: true,
  layout: "auto",
  sceneGapRows: 5,
};

const formatLabels: Record<ShareExportFormat, string> = {
  pdf: "PDF",
  image: "画像",
  stageflow: "隊列メーカーデータ",
  link: "リンク",
};

const formatDescriptions: Record<ShareExportFormat, string> = {
  pdf: "印刷画面からPDF保存",
  image: "PNGとして保存・共有",
  stageflow: "JSONでバックアップ",
  link: "共有URLをコピー",
};

const formatIcons: Record<ShareExportFormat, typeof FileText> = {
  pdf: FileText,
  image: Image,
  stageflow: FileJson,
  link: Link2,
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
    return `${title}_${currentSceneLabel || "現在シーン"}_印刷用_${date}`;
  }
  return `${title}_印刷用_${date}`;
};

export const ShareExportModal = ({
  isOpen,
  projectTitle,
  currentSceneLabel,
  onClose,
  onExport,
  onImportJson,
}: ShareExportModalProps) => {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [scope, setScope] = useState<ShareExportScope | null>(null);
  const [format, setFormat] = useState<ShareExportFormat>("pdf");
  const [fileName, setFileName] = useState("");
  const [options, setOptions] = useState<ShareExportOptions>(defaultOptions);

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

  if (!isOpen) {
    return null;
  }

  const updateOption = <Key extends keyof ShareExportOptions>(
    key: Key,
    value: ShareExportOptions[Key],
  ) => {
    setOptions((previous) => ({ ...previous, [key]: value }));
  };

  const startExport = (nextScope: ShareExportScope) => {
    setScope(nextScope);
    setFormat("pdf");
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImportJson(file);
      event.target.value = "";
      onClose();
    }
  };

  const handleExport = async () => {
    if (!scope) {
      return;
    }
    await onExport({
      scope,
      format,
      fileName: fileName.trim() || makeDefaultFileName(scope, projectTitle, currentSceneLabel),
      options,
    });
    if (format === "link" || format === "stageflow") {
      onClose();
    }
  };

  const runHomeExport = async (request: ShareExportRequest) => {
    await onExport(request);
    onClose();
  };

  const renderFormatCards = () => (
    <div className="share-format-grid" role="radiogroup" aria-label="書き出し形式">
      {(["pdf", "image", "stageflow", "link"] as ShareExportFormat[]).map(
        (item) => {
          const Icon = formatIcons[item];
          return (
            <button
              className={
                format === item
                  ? "share-format-card is-selected"
                  : "share-format-card"
              }
              key={item}
              onClick={() => setFormat(item)}
              role="radio"
              aria-checked={format === item}
              type="button"
            >
              <strong>{formatLabels[item]}</strong>
              <span>{formatDescriptions[item]}</span>
              <Icon size={25} />
            </button>
          );
        },
      )}
    </div>
  );

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
              <h3>共同・共有</h3>
              <button
                className="share-export-row"
                onClick={() =>
                  void runHomeExport({
                    scope: "all",
                    format: "link",
                    fileName: makeDefaultFileName("all", projectTitle, currentSceneLabel),
                    options,
                  })
                }
                type="button"
              >
                <Share2 size={26} />
                <span>
                  <strong>共有リンク</strong>
                  <small>リンクをコピーして共有します</small>
                </span>
              </button>
            </section>

            <section className="share-export-section">
              <h3>書き出し</h3>
              <button
                className="share-export-row"
                onClick={() => startExport("current")}
                type="button"
              >
                <FileText size={26} />
                <span>
                  <strong>このシーンを書き出す</strong>
                  <small>現在の隊列表をPDF・画像・リンクで共有</small>
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
                  <small>全シーンを印刷・PDF保存しやすい形へ</small>
                </span>
              </button>
              <button
                className="share-export-row"
                onClick={() =>
                  void runHomeExport({
                    scope: "all",
                    format: "pdf",
                    fileName: makeDefaultFileName("all", projectTitle, currentSceneLabel),
                    options,
                  })
                }
                type="button"
              >
                <Printer size={26} />
                <span>
                  <strong>印刷</strong>
                  <small>ブラウザ印刷からPDF保存できます</small>
                </span>
              </button>
            </section>

            <section className="share-export-section">
              <h3>データ管理</h3>
              <button
                className="share-export-row"
                onClick={() =>
                  void runHomeExport({
                    scope: "all",
                    format: "stageflow",
                    fileName: makeDefaultFileName("all", projectTitle, currentSceneLabel),
                    options,
                  })
                }
                type="button"
              >
                <FileJson size={26} />
                <span>
                  <strong>JSONを書き出し</strong>
                  <small>隊列メーカーデータとしてバックアップ</small>
                </span>
              </button>
              <button
                className="share-export-row"
                onClick={() => importInputRef.current?.click()}
                type="button"
              >
                <Upload size={26} />
                <span>
                  <strong>JSONを読み込み</strong>
                  <small>保存済みの隊列メーカーデータを開きます</small>
                </span>
              </button>
            </section>
          </div>
        ) : (
          <div className="share-export-detail">
            {renderFormatCards()}

            <label className="share-export-field">
              ファイル名
              <input
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder={makeDefaultFileName(scope, projectTitle, currentSceneLabel)}
              />
            </label>

            <section className="share-export-options">
              <h3>オプション</h3>
              <label>
                <input
                  checked={options.includeBackground}
                  onChange={(event) =>
                    updateOption("includeBackground", event.target.checked)
                  }
                  type="checkbox"
                />
                背景を含める
              </label>
              <label>
                <input
                  checked={options.includeGrid}
                  onChange={(event) =>
                    updateOption("includeGrid", event.target.checked)
                  }
                  type="checkbox"
                />
                グリッドを含める
              </label>
              <label>
                <input
                  checked={options.includeMeterRulers}
                  onChange={(event) =>
                    updateOption("includeMeterRulers", event.target.checked)
                  }
                  type="checkbox"
                />
                メートル目盛りを含める
              </label>
              <label>
                <input
                  checked={options.includeNotes}
                  onChange={(event) =>
                    updateOption("includeNotes", event.target.checked)
                  }
                  type="checkbox"
                />
                メモを含める
              </label>
              <label>
                <input
                  checked={options.includeAssignments}
                  onChange={(event) =>
                    updateOption("includeAssignments", event.target.checked)
                  }
                  type="checkbox"
                />
                道具割当を含める
              </label>
              <label>
                <input
                  checked={options.includeHiddenMembers}
                  onChange={(event) =>
                    updateOption("includeHiddenMembers", event.target.checked)
                  }
                  type="checkbox"
                />
                非表示メンバーを含める
              </label>
              <label>
                <input
                  checked={options.includeSceneName}
                  onChange={(event) =>
                    updateOption("includeSceneName", event.target.checked)
                  }
                  type="checkbox"
                />
                シーン名を含める
              </label>
              <label>
                <input
                  checked={options.includeSceneTime}
                  onChange={(event) =>
                    updateOption("includeSceneTime", event.target.checked)
                  }
                  type="checkbox"
                />
                シーン時刻を含める
              </label>
            </section>

            {format === "pdf" && scope === "all" && (
              <section className="share-export-layout">
                <h3>レイアウト</h3>
                {[
                  ["auto", "自動"],
                  ["two", "2シーン/ページ"],
                  ["three", "3シーン/ページ"],
                  ["four", "4シーン/ページ"],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      checked={options.layout === value}
                      onChange={() =>
                        updateOption("layout", value as ShareExportOptions["layout"])
                      }
                      type="radio"
                    />
                    {label}
                  </label>
                ))}
                <label>
                  シーン間余白
                  <select
                    value={options.sceneGapRows}
                    onChange={(event) =>
                      updateOption("sceneGapRows", Number(event.target.value))
                    }
                  >
                    <option value={3}>3マス</option>
                    <option value={5}>5マス</option>
                    <option value={7}>7マス</option>
                  </select>
                </label>
              </section>
            )}

            <button
              className="share-export-submit"
              onClick={handleExport}
              type="button"
            >
              {format === "pdf"
                ? "PDFとして保存"
                : format === "image"
                  ? "画像として保存"
                  : "書き出す"}
            </button>
          </div>
        )}

        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
        />
      </section>
    </div>
  );
};
