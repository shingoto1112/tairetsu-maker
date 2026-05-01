import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Folder,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { HorizontalGuideMode, Project } from "../types";

export type NewFormationInput = {
  title: string;
  widthMeters: number;
  heightMeters: number;
  useGlobalStageSize: boolean;
  gridSizeMeters: number;
  horizontalGuideMode: HorizontalGuideMode;
  memberDiameterMeters: number;
  audioFile: File | null;
};

type FormationLibraryProps = {
  projects: Project[];
  notice?: string | null;
  onCreate: (input: NewFormationInput) => void | Promise<void>;
  onOpenProject: (project: Project) => void | Promise<void>;
  onRenameProject: (projectId: string, title: string) => void | Promise<void>;
  onDuplicateProject: (project: Project) => void | Promise<void>;
  onExportProject: (project: Project, includeAudio: boolean) => void | Promise<void>;
  onImportProjectFile: (file: File) => void | Promise<void>;
  onDeleteProject: (project: Project) => void | Promise<void>;
};

type LibraryMenu = {
  projectId: string;
  left: number;
  top: number;
};

const MENU_WIDTH = 196;
const MENU_HEIGHT = 226;
const MENU_MARGIN = 12;

const clampMenuPosition = (left: number, top: number): { left: number; top: number } => {
  const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
  const maxTop = Math.max(MENU_MARGIN, window.innerHeight - MENU_HEIGHT - MENU_MARGIN);
  return {
    left: Math.min(Math.max(MENU_MARGIN, left), maxLeft),
    top: Math.min(Math.max(MENU_MARGIN, top), maxTop),
  };
};

const formatProjectDate = (project: Project): string => {
  const raw = project.lastOpenedAt ?? project.updatedAt ?? project.createdAt;
  if (!raw) {
    return "日時なし";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "日時なし";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const isActivationKey = (event: KeyboardEvent<HTMLElement>): boolean =>
  event.key === "Enter" || event.key === " ";

export const FormationLibrary = ({
  projects,
  notice,
  onCreate,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onExportProject,
  onImportProjectFile,
  onDeleteProject,
}: FormationLibraryProps) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [widthMeters, setWidthMeters] = useState(12);
  const [heightMeters, setHeightMeters] = useState(8);
  const [useGlobalStageSize, setUseGlobalStageSize] = useState(true);
  const [gridSizeMeters, setGridSizeMeters] = useState(0.25);
  const [horizontalGuideMode, setHorizontalGuideMode] =
    useState<HorizontalGuideMode>("meters");
  const [memberDiameterMeters, setMemberDiameterMeters] = useState(0.5);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryMenu, setLibraryMenu] = useState<LibraryMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [exportTarget, setExportTarget] = useState<Project | null>(null);
  const [includeAudioInExport, setIncludeAudioInExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const aTime = Date.parse(a.lastOpenedAt ?? a.updatedAt ?? a.createdAt ?? "");
        const bTime = Date.parse(b.lastOpenedAt ?? b.updatedAt ?? b.createdAt ?? "");
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }),
    [projects],
  );

  const menuProject =
    libraryMenu === null
      ? null
      : sortedProjects.find((project) => project.id === libraryMenu.projectId) ?? null;

  useEffect(() => {
    if (!libraryMenu) {
      return undefined;
    }
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setLibraryMenu(null);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setLibraryMenu(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [libraryMenu]);

  const resetDialog = () => {
    setTitle("");
    setWidthMeters(12);
    setHeightMeters(8);
    setUseGlobalStageSize(true);
    setGridSizeMeters(0.25);
    setHorizontalGuideMode("meters");
    setMemberDiameterMeters(0.5);
    setAudioFile(null);
    setError(null);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    resetDialog();
  };

  const openCreateDialog = () => {
    setIsAddDialogOpen(false);
    setIsDialogOpen(true);
  };

  const handleAudioFile = (event: ChangeEvent<HTMLInputElement>) => {
    setAudioFile(event.target.files?.[0] ?? null);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setIsImporting(true);
    try {
      await onImportProjectFile(file);
      setIsAddDialogOpen(false);
    } finally {
      setIsImporting(false);
    }
  };

  const validatePositive = (value: number, label: string): string | null => {
    if (!Number.isFinite(value) || value <= 0) {
      return `${label}は0より大きい数値にしてください。`;
    }
    return null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("隊列表名を入力してください。");
      return;
    }
    const validationError =
      validatePositive(widthMeters, "ステージ横幅") ??
      validatePositive(heightMeters, "ステージ縦幅") ??
      validatePositive(gridSizeMeters, "グリッド間隔") ??
      validatePositive(memberDiameterMeters, "メンバー円の直径");
    if (validationError) {
      setError(validationError);
      return;
    }
    await onCreate({
      title: trimmedTitle,
      widthMeters,
      heightMeters,
      useGlobalStageSize,
      gridSizeMeters,
      horizontalGuideMode,
      memberDiameterMeters,
      audioFile,
    });
    closeDialog();
  };

  const openMenu = (
    project: Project,
    event: MouseEvent<HTMLElement>,
    anchor?: "button",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const point =
      anchor === "button"
        ? {
            left: event.currentTarget.getBoundingClientRect().right - MENU_WIDTH,
            top: event.currentTarget.getBoundingClientRect().bottom + 6,
          }
        : { left: event.clientX, top: event.clientY };
    setLibraryMenu({
      projectId: project.id ?? "",
      ...clampMenuPosition(point.left, point.top),
    });
  };

  const runMenuAction = async (action: () => void | Promise<void>) => {
    await action();
    setLibraryMenu(null);
  };

  const openRenameDialog = (project: Project) => {
    setRenameTarget(project);
    setRenameTitle(project.title || "");
    setLibraryMenu(null);
  };

  const openExportDialog = (project: Project) => {
    setExportTarget(project);
    setIncludeAudioInExport(false);
    setLibraryMenu(null);
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameTarget?.id) return;
    const nextTitle = renameTitle.trim();
    if (!nextTitle) return;
    await onRenameProject(renameTarget.id, nextTitle);
    setRenameTarget(null);
    setRenameTitle("");
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    await onDeleteProject(deleteTarget);
    setDeleteTarget(null);
  };

  const submitExport = async () => {
    if (!exportTarget) return;
    setIsExporting(true);
    try {
      await onExportProject(exportTarget, includeAudioInExport && Boolean(exportTarget.audio?.id));
      setExportTarget(null);
      setIncludeAudioInExport(false);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main className="library-shell">
      <header className="library-header">
        <div>
          <p className="library-kicker">隊列表作成アプリ</p>
          <h1>隊列メーカー</h1>
        </div>
        <p>作成済みの隊列表を開くか、新しい隊列表を作成します。</p>
      </header>

      {notice && <p className="library-notice">{notice}</p>}

      <section className="library-grid" aria-label="隊列表一覧">
        <button
          className="formation-card formation-card--new"
          onClick={() => setIsAddDialogOpen(true)}
          type="button"
        >
          <span className="formation-card__plus">
            <Plus size={30} />
          </span>
          <strong>追加</strong>
          <small>新規 / 読込</small>
        </button>

        {sortedProjects.map((project, index) => (
          <article
            className="formation-card formation-card--saved"
            key={project.id ?? `${project.title}-${index}`}
            onClick={() => void onOpenProject(project)}
            onContextMenu={(event) => openMenu(project, event)}
            onKeyDown={(event) => {
              if (isActivationKey(event)) {
                event.preventDefault();
                void onOpenProject(project);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`${project.title || "名称未設定"}を開く`}
          >
            <button
              className="formation-card__menu"
              type="button"
              aria-label={`${project.title || "名称未設定"}のメニュー`}
              onClick={(event) => openMenu(project, event, "button")}
            >
              <MoreHorizontal size={18} />
            </button>
            <span
              className={`formation-folder formation-folder--${(index % 6) + 1}`}
              aria-hidden="true"
            >
              <Folder size={56} />
            </span>
            <strong>{project.title || "名称未設定"}</strong>
            <small>最終使用: {formatProjectDate(project)}</small>
          </article>
        ))}
      </section>

      {sortedProjects.length === 0 && (
        <p className="library-empty">
          まだ保存済みの隊列表はありません。左上の新規作成から始めてください。
        </p>
      )}

      {libraryMenu && menuProject && (
        <div
          className="library-context-menu"
          ref={menuRef}
          style={{ left: libraryMenu.left, top: libraryMenu.top }}
          role="menu"
        >
          <button
            type="button"
            onClick={() => runMenuAction(() => onOpenProject(menuProject))}
          >
            <ExternalLink size={15} />
            開く
          </button>
          <button type="button" onClick={() => openRenameDialog(menuProject)}>
            <Edit3 size={15} />
            名前を変更
          </button>
          <button
            type="button"
            onClick={() => runMenuAction(() => onDuplicateProject(menuProject))}
          >
            <Copy size={15} />
            複製
          </button>
          <button type="button" onClick={() => openExportDialog(menuProject)}>
            <Download size={15} />
            書き出し
          </button>
          <button
            className="danger"
            type="button"
            onClick={() => {
              setDeleteTarget(menuProject);
              setLibraryMenu(null);
            }}
          >
            <Trash2 size={15} />
            削除
          </button>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".tairetsu,application/zip,application/x-zip-compressed"
        onChange={(event) => void handleImportFile(event)}
        hidden
      />

      {isAddDialogOpen && (
        <div
          className="new-formation-backdrop"
          onPointerDown={() => setIsAddDialogOpen(false)}
        >
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表を追加"
          >
            <header>
              <h2>隊列表を追加</h2>
              <button
                className="share-export-close"
                onClick={() => setIsAddDialogOpen(false)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <div className="library-add-options">
              <button type="button" onClick={openCreateDialog}>
                <Plus size={22} />
                <span>
                  <strong>新しく作る</strong>
                  <small>最初から新しい隊列表を作成します。</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={isImporting}
              >
                <Upload size={22} />
                <span>
                  <strong>読み込む</strong>
                  <small>共有された .tairetsu ファイルを読み込みます。</small>
                </span>
              </button>
            </div>
            <footer>
              <button
                className="mini-button"
                onClick={() => setIsAddDialogOpen(false)}
                type="button"
              >
                キャンセル
              </button>
            </footer>
          </div>
        </div>
      )}

      {isDialogOpen && (
        <div className="new-formation-backdrop" onPointerDown={closeDialog}>
          <form
            className="new-formation-dialog"
            onSubmit={(event) => void submit(event)}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="新しい隊列表を作成"
          >
            <header>
              <h2>新しい隊列表を作成</h2>
              <button
                className="share-export-close"
                onClick={closeDialog}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>

            <label>
              隊列表名
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例：2026春 オープニング"
                autoFocus
              />
            </label>

            <label>
              音源
              <input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={handleAudioFile} />
              <small>{audioFile ? audioFile.name : "任意です。音源なしでも作成できます。"}</small>
            </label>

            <section className="new-formation-size">
              <h3>ステージ設定</h3>
              <p className="notice muted">
                現在: 横{widthMeters || 0}m / 縦{heightMeters || 0}m /{" "}
                {useGlobalStageSize ? "全シーン固定ON" : "シーン別サイズ"}
              </p>
              <label>
                全シーン固定
                <select
                  value={String(useGlobalStageSize)}
                  onChange={(event) => setUseGlobalStageSize(event.target.value === "true")}
                >
                  <option value="true">ON</option>
                  <option value="false">OFF</option>
                </select>
              </label>
              <label>
                横幅
                <span className="meter-input">
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={widthMeters}
                    onChange={(event) => setWidthMeters(Number(event.target.value))}
                  />
                  m
                </span>
              </label>
              <label>
                縦幅
                <span className="meter-input">
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={heightMeters}
                    onChange={(event) => setHeightMeters(Number(event.target.value))}
                  />
                  m
                </span>
              </label>
              <label>
                グリッド間隔
                <span className="meter-input">
                  <input
                    type="number"
                    min="0.05"
                    step="0.05"
                    value={gridSizeMeters}
                    onChange={(event) => setGridSizeMeters(Number(event.target.value))}
                  />
                  m
                </span>
              </label>
              <label>
                横方向の表示
                <select
                  value={horizontalGuideMode}
                  onChange={(event) =>
                    setHorizontalGuideMode(event.target.value as HorizontalGuideMode)
                  }
                >
                  <option value="meters">通常メートル表示</option>
                  <option value="centerSplit">センター割り表示</option>
                </select>
              </label>
              <label>
                メンバー円の直径
                <span className="meter-input">
                  <input
                    type="number"
                    min="0.1"
                    step="0.05"
                    value={memberDiameterMeters}
                    onChange={(event) => setMemberDiameterMeters(Number(event.target.value))}
                  />
                  m
                </span>
              </label>
            </section>

            {error && <p className="dialog-error">{error}</p>}

            <footer>
              <button className="mini-button" onClick={closeDialog} type="button">
                キャンセル
              </button>
              <button className="mini-button primary" type="submit">
                作成する
              </button>
            </footer>
          </form>
        </div>
      )}

      {renameTarget && (
        <div className="new-formation-backdrop" onPointerDown={() => setRenameTarget(null)}>
          <form
            className="new-formation-dialog library-small-dialog"
            onSubmit={(event) => void submitRename(event)}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表名を変更"
          >
            <header>
              <h2>名前を変更</h2>
              <button
                className="share-export-close"
                onClick={() => setRenameTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <label>
              隊列表名
              <input
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                autoFocus
              />
            </label>
            <footer>
              <button
                className="mini-button"
                onClick={() => setRenameTarget(null)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="mini-button primary"
                type="submit"
                disabled={!renameTitle.trim()}
              >
                保存
              </button>
            </footer>
          </form>
        </div>
      )}

      {exportTarget && (
        <div className="new-formation-backdrop" onPointerDown={() => setExportTarget(null)}>
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表を書き出し"
          >
            <header>
              <h2>隊列表を書き出し</h2>
              <button
                className="share-export-close"
                onClick={() => setExportTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <p className="notice">
              「{exportTarget.title || "名称未設定"}」を .tairetsu ファイルとして書き出します。
            </p>
            <label className="library-export-check">
              <input
                type="checkbox"
                checked={includeAudioInExport}
                onChange={(event) => setIncludeAudioInExport(event.target.checked)}
                disabled={!exportTarget.audio?.id}
              />
              音源ファイルも含める
            </label>
            {!exportTarget.audio?.id && (
              <p className="notice muted">音源は設定されていません。</p>
            )}
            <footer>
              <button
                className="mini-button"
                onClick={() => setExportTarget(null)}
                type="button"
                disabled={isExporting}
              >
                キャンセル
              </button>
              <button
                className="mini-button primary"
                onClick={() => void submitExport()}
                type="button"
                disabled={isExporting}
              >
                書き出す
              </button>
            </footer>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="new-formation-backdrop" onPointerDown={() => setDeleteTarget(null)}>
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表を削除"
          >
            <header>
              <h2>隊列表を削除しますか？</h2>
              <button
                className="share-export-close"
                onClick={() => setDeleteTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <p className="notice">
              「{deleteTarget.title || "名称未設定"}」を削除します。この操作は元に戻せません。
            </p>
            <footer>
              <button
                className="mini-button"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                キャンセル
              </button>
              <button className="mini-button danger" onClick={() => void submitDelete()} type="button">
                削除する
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
};
