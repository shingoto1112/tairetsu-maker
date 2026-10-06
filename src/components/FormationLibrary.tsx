import type { AudioSelection } from "../platform/audioStorage";
import { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, Download, Edit3, ExternalLink, Folder, MoreHorizontal, Plus, Trash2, Upload, Users, X } from "lucide-react";
import type { ProjectSummary } from "../repositories/types";

import type {
  FormationMode,
  HorizontalGuideMode,
  ParadeHorizontalMeasureMode,
  ParadeRulerPosition,
  ParadeSettings,
} from "../types";

import { AudioFilePickerButton } from "./AudioFilePickerButton";

import { LegalLinks } from "./LegalLinks";
import { HorizontalCountingCards } from "./HorizontalCountingCards";
import { toHorizontalCountingMode, toParadeHorizontalMeasureMode } from "../utils/horizontalRuler";

export type NewFormationInput = {
  title: string;
  formationMode: FormationMode;
  widthMeters: number;
  heightMeters: number;
  useGlobalStageSize: boolean;
  gridSizeMeters: number;
  horizontalGuideMode: HorizontalGuideMode;
  memberDiameterMeters: number;
  paradeSettings?: ParadeSettings;
  audioFile: AudioSelection | null;
};

type FormationLibraryProps = {
  projects: ProjectSummary[];
  disabled?: boolean;
  notice?: string | null;
  storageTools?: ReactNode;
  onOpenHelp?: () => void;
  collaborationSlot?: ReactNode;
  renderProjectBadge?: (summary: ProjectSummary) => ReactNode;
  onJoinInvitation?: () => void;
  onImportProjectFiles?: (files: File[]) => void | Promise<void>;

  onCreate: (input: NewFormationInput) => void | Promise<void>;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onRenameProject: (projectId: string, title: string) => void | Promise<void>;
  onDuplicateProject: (projectId: string) => void | Promise<void>;
  onExportProject: (projectId: string, includeAudio: boolean) => void | Promise<void>;
  onImportProjectFile: (file: File) => void | Promise<void>;
  onDeleteProject: (projectId: string) => void | Promise<void>;
};

type LibraryMenu = {
  projectId: string;
  left: number;
  top: number;
};

const MENU_WIDTH = 196;
const MENU_HEIGHT = 230;
const MENU_MARGIN = 12;

const clampMenuPosition = (left: number, top: number): { left: number; top: number } => {
  const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
  const maxTop = Math.max(MENU_MARGIN, window.innerHeight - MENU_HEIGHT - MENU_MARGIN);
  return {
    left: Math.min(Math.max(MENU_MARGIN, left), maxLeft),
    top: Math.min(Math.max(MENU_MARGIN, top), maxTop),
  };
};

const formatProjectDate = (project: ProjectSummary): string => {
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

type CreationNumberFieldProps = {
  name: string; label: string; min: number; step: string; value: number;
  onChange: (value: number) => void; error?: string;
};
const CreationNumberField = ({ name, label, min, step, value, onChange, error }: CreationNumberFieldProps) => (
  <div className="creation-number-field">
    <label>
      {label}
      <span className="meter-input">
        <input type="number" name={name} aria-label={label} data-number-field data-field-label={label}
          min={min} step={step} value={Number.isFinite(value) ? value : ""}
          aria-invalid={Boolean(error)} aria-describedby={error ? "create-" + name + "-error" : undefined}
          onChange={(event) => onChange(event.target.valueAsNumber)} />
        m
      </span>
    </label>
    {error && <small id={"create-" + name + "-error"} className="formation-field-error">{error}</small>}
  </div>
);

export const FormationLibrary = ({
  projects,
  disabled = false,
  notice,
  storageTools,
  onOpenHelp,
  collaborationSlot,
  renderProjectBadge,
  onJoinInvitation,
  onImportProjectFiles,
  onCreate,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onExportProject,
  onImportProjectFile,
  onDeleteProject,
}: FormationLibraryProps) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isTypeDialogOpen, setIsTypeDialogOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formationMode, setFormationMode] = useState<FormationMode>("stage");
  const [title, setTitle] = useState("");
  const [widthMeters, setWidthMeters] = useState(12);
  const [heightMeters, setHeightMeters] = useState(8);
  const [useGlobalStageSize, setUseGlobalStageSize] = useState(true);
  const [gridSizeMeters, setGridSizeMeters] = useState(0.5);
  const [horizontalGuideMode, setHorizontalGuideMode] =
    useState<HorizontalGuideMode>("centerSplit");
  const [memberDiameterMeters, setMemberDiameterMeters] = useState(0.5);
  const [paradeTotalDistance, setParadeTotalDistance] = useState(100);
  const [paradeWidthMeters, setParadeWidthMeters] = useState(20);
  const [paradeCellSizeMeters, setParadeCellSizeMeters] = useState(1);
  const [paradeRulerPosition, setParadeRulerPosition] =
    useState<ParadeRulerPosition>("both");
  const [paradeHorizontalMeasureMode, setParadeHorizontalMeasureMode] =
    useState<ParadeHorizontalMeasureMode>("centerSplit");
  const [paradeEmphasizeEvery5m, setParadeEmphasizeEvery5m] = useState(true);
  const [paradeEmphasizeEvery10m, setParadeEmphasizeEvery10m] = useState(true);
  const [audioFile, setAudioFile] = useState<AudioSelection | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryMenu, setLibraryMenu] = useState<LibraryMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  const [exportTarget, setExportTarget] = useState<ProjectSummary | null>(null);
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
    setFieldErrors({});
    setAdvancedOpen(false);
    setFormationMode("stage");
    setTitle("");
    setWidthMeters(12);
    setHeightMeters(8);
    setUseGlobalStageSize(true);
    setGridSizeMeters(0.5);
    setHorizontalGuideMode("centerSplit");
    setMemberDiameterMeters(0.5);
    setParadeTotalDistance(100);
    setParadeWidthMeters(20);
    setParadeCellSizeMeters(1);
    setParadeRulerPosition("both");
    setParadeHorizontalMeasureMode("centerSplit");
    setParadeEmphasizeEvery5m(true);
    setParadeEmphasizeEvery10m(true);
    setAudioFile(null);
    setError(null);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    resetDialog();
  };

  const openCreateTypeDialog = () => {
    setIsAddDialogOpen(false);
    setIsTypeDialogOpen(true);
  };

  const openCreateDialog = (nextMode: FormationMode) => {
    resetDialog();
    setFormationMode(nextMode);
    setIsTypeDialogOpen(false);
    setIsDialogOpen(true);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) {
      return;
    }
    setIsImporting(true);
    try {
      if (onImportProjectFiles && (files.length > 1 || files[0].name.endsWith(".manifest.json"))) await onImportProjectFiles(files);
      else await onImportProjectFile(files[0]);
      setIsAddDialogOpen(false);
    } finally {
      setIsImporting(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const trimmedTitle = title.trim();
    const errors: Record<string, string> = {};
    if (!trimmedTitle) errors.title = "隊列表名を入力してください。";
    form.querySelectorAll<HTMLInputElement>('input[data-number-field]').forEach(input => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || value < Number(input.min)) {
        errors[input.name] = input.dataset.fieldLabel + "は" + input.min + "以上の数値にしてください。";
      }
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const input = form.elements.namedItem(Object.keys(errors)[0]) as HTMLInputElement | null;
      // Reveal every invalid advanced field, even when the first error is elsewhere.
      if (Object.keys(errors).some(key => form.elements.namedItem(key) instanceof HTMLInputElement &&
        (form.elements.namedItem(key) as HTMLInputElement).closest("details"))) setAdvancedOpen(true);
      requestAnimationFrame(() => input?.focus());
      return;
    }
    const isParade = formationMode === "parade";
    await onCreate({
      title: trimmedTitle,
      formationMode,
      widthMeters: isParade ? paradeWidthMeters : widthMeters,
      heightMeters: isParade ? paradeTotalDistance : heightMeters,
      useGlobalStageSize: isParade ? true : useGlobalStageSize,
      gridSizeMeters: isParade ? paradeCellSizeMeters : gridSizeMeters,
      horizontalGuideMode,
      memberDiameterMeters,
      paradeSettings: isParade
        ? {
            totalDistance: paradeTotalDistance,
            width: paradeWidthMeters,
            cellSizeMeters: paradeCellSizeMeters,
            direction: "up",
            rulerPosition: paradeRulerPosition,
            horizontalMeasureMode: paradeHorizontalMeasureMode,
            emphasizeEvery5m: paradeEmphasizeEvery5m,
            emphasizeEvery10m: paradeEmphasizeEvery10m,
          }
        : undefined,
      audioFile,
    });
    closeDialog();
  };

  const openMenu = (
    project: ProjectSummary,
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

  const openRenameDialog = (project: ProjectSummary) => {
    setRenameTarget(project);
    setRenameTitle(project.title || "");
    setLibraryMenu(null);
  };

  const openExportDialog = (project: ProjectSummary) => {
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
    await onDeleteProject(deleteTarget.id);
    setDeleteTarget(null);
  };

  const submitExport = async () => {
    if (!exportTarget) return;
    setIsExporting(true);
    try {
      await onExportProject(exportTarget.id, includeAudioInExport && Boolean(exportTarget.audioId));
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

      {notice && <p className="library-notice" role="status">{notice}</p>}
      {storageTools}
      {collaborationSlot}

      <section className="library-grid" aria-label="隊列表一覧">
        <button
          className="formation-card formation-card--new"
          disabled={disabled} onClick={() => setIsAddDialogOpen(true)}
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
            onClick={() => void onOpenProject(project.id)}
            onContextMenu={(event) => openMenu(project, event)}
            onKeyDown={(event) => {
              if (isActivationKey(event)) {
                event.preventDefault();
                void onOpenProject(project.id);
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
            <span className="formation-card__badge">{renderProjectBadge?.(project) ?? "ローカル"}</span>
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

      <LegalLinks className="library-legal-links" onOpenHelp={onOpenHelp} />

      {libraryMenu && menuProject && (
        <div
          className="library-context-menu"
          ref={menuRef}
          style={{ left: libraryMenu.left, top: libraryMenu.top }}
          role="menu"
        >
          <button
            type="button"
            onClick={() => runMenuAction(() => onOpenProject(menuProject.id))}
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
            onClick={() => runMenuAction(() => onDuplicateProject(menuProject.id))}
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
        accept=".zip,.tairetsu,.json,application/json,application/zip,application/x-zip-compressed,application/octet-stream"
        multiple
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
              {onJoinInvitation && <button type="button" onClick={() => { setIsAddDialogOpen(false); onJoinInvitation(); }}>
                <Users size={22} /><span><strong>招待リンクで参加</strong><small>招待リンクを貼り付けて参加します。</small></span>
              </button>}
              <button type="button" onClick={openCreateTypeDialog}>
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
                  <small>共有された .zip / .tairetsu ファイルを読み込みます。</small>
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

      {isTypeDialogOpen && (
        <div
          className="new-formation-backdrop"
          onPointerDown={() => setIsTypeDialogOpen(false)}
        >
          <div
            className="new-formation-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="作成タイプを選択"
          >
            <header>
              <h2>作成タイプを選択</h2>
              <button
                className="share-export-close"
                onClick={() => setIsTypeDialogOpen(false)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <div className="formation-type-grid">
              <button
                type="button"
                className="formation-type-card"
                onClick={() => openCreateDialog("stage")}
              >
                <strong>ステージ隊列</strong>
                <span>
                  固定されたステージ上で、シーンごとの隊形を作成します。
                </span>
                <small>ダンスステージ、体育館ステージ、発表会、ライブ向け</small>
              </button>
              <button
                type="button"
                className="formation-type-card"
                onClick={() => openCreateDialog("parade")}
              >
                <strong>パレード隊列</strong>
                <span>
                  長い移動ルート上で、前進しながら変化する隊形を作成します。
                </span>
                <small>パレード、行進、縦長い演出向け</small>
              </button>
            </div>
            <footer>
              <button
                className="mini-button"
                onClick={() => setIsTypeDialogOpen(false)}
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
            noValidate
            onSubmit={(event) => void submit(event)}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="新しい隊列表を作成"
          >
            <header>
              <h2>
                {formationMode === "parade"
                  ? "新しいパレード隊列を作成"
                  : "新しいステージ隊列を作成"}
              </h2>
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
                name="title"
                aria-invalid={Boolean(fieldErrors.title)}
                aria-describedby={fieldErrors.title ? "create-title-error" : undefined}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例：2026春 オープニング"
                autoFocus
              />
            </label>

            {fieldErrors.title && <small id="create-title-error" className="formation-field-error">{fieldErrors.title}</small>}

            <div className="new-formation-field">
              <span>音源（任意）</span>
              <AudioFilePickerButton
                className="audio-file-picker-button"
                onError={setError}
                onFileSelected={(file) => {
                  setAudioFile(file);
                  setError(null);
                }}
              >
                <Upload size={16} />
                音源ファイルを選択
              </AudioFilePickerButton>
              <small>{audioFile ? audioFile.name : "任意です。音源なしでも作成できます。"}</small>
            </div>

            {formationMode === "stage" ? (
              <section className="new-formation-size">
                <h3>ステージの大きさ</h3>

                <CreationNumberField name="widthMeters" label="横幅" min={0.1} step="0.1"
                  value={widthMeters} onChange={setWidthMeters} error={fieldErrors.widthMeters} />
                <CreationNumberField name="heightMeters" label="縦幅" min={0.1} step="0.1"
                  value={heightMeters} onChange={setHeightMeters} error={fieldErrors.heightMeters} />

                <HorizontalCountingCards value={horizontalGuideMode} onChange={setHorizontalGuideMode} />
                <details className="settings-disclosure" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                  <summary>詳しい設定（あとから変更できます）</summary>
                <CreationNumberField name="gridSizeMeters" label="グリッド間隔" min={0.05} step="0.05"
                  value={gridSizeMeters} onChange={setGridSizeMeters} error={fieldErrors.gridSizeMeters} />
                <label>
                  すべてのシーンで同じ大きさを使う
                  <select
                    value={String(useGlobalStageSize)}
                    onChange={(event) => setUseGlobalStageSize(event.target.value === "true")}
                  >
                    <option value="true">同じ大きさ</option>
                    <option value="false">シーンごとに設定</option>
                  </select>
                </label>

                <CreationNumberField name="memberDiameterMeters" label="メンバー円の直径" min={0.1} step="0.05"
                  value={memberDiameterMeters} onChange={setMemberDiameterMeters} error={fieldErrors.memberDiameterMeters} />
                </details>
              </section>
            ) : (
              <section className="new-formation-size">
                <h3>パレード設定</h3>

                <CreationNumberField name="paradeTotalDistance" label="全体距離" min={1} step="1"
                  value={paradeTotalDistance} onChange={setParadeTotalDistance} error={fieldErrors.paradeTotalDistance} />
                <CreationNumberField name="paradeWidthMeters" label="横幅" min={1} step="0.5"
                  value={paradeWidthMeters} onChange={setParadeWidthMeters} error={fieldErrors.paradeWidthMeters} />
                <CreationNumberField name="paradeCellSizeMeters" label="1マスあたりの距離" min={0.1} step="0.1"
                  value={paradeCellSizeMeters} onChange={setParadeCellSizeMeters} error={fieldErrors.paradeCellSizeMeters} />
                <HorizontalCountingCards value={toHorizontalCountingMode(paradeHorizontalMeasureMode)} onChange={(value) => setParadeHorizontalMeasureMode(toParadeHorizontalMeasureMode(value))} />
                <details className="settings-disclosure" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                  <summary>詳しい設定（あとから変更できます）</summary>

                <label>
                  距離目盛り表示
                  <select
                    value={paradeRulerPosition}
                    onChange={(event) =>
                      setParadeRulerPosition(event.target.value as ParadeRulerPosition)
                    }
                  >
                    <option value="both">左右に表示</option>
                    <option value="left">左のみ表示</option>
                    <option value="right">右のみ表示</option>
                    <option value="none">非表示</option>
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={paradeEmphasizeEvery5m}
                    onChange={(event) => setParadeEmphasizeEvery5m(event.target.checked)}
                  />
                  5mごとのライン強調
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={paradeEmphasizeEvery10m}
                    onChange={(event) => setParadeEmphasizeEvery10m(event.target.checked)}
                  />
                  10mごとのライン強調
                </label>
                <CreationNumberField name="memberDiameterMeters" label="メンバー円の直径" min={0.1} step="0.05"
                  value={memberDiameterMeters} onChange={setMemberDiameterMeters} error={fieldErrors.memberDiameterMeters} />
                </details>
                <small>作成後の初期表示はスタート地点です。</small>
              </section>
            )}

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
              「{exportTarget.title || "名称未設定"}」を .zip ファイルとして書き出します。
            </p>
            <label className="library-export-check">
              <input
                type="checkbox"
                checked={includeAudioInExport}
                onChange={(event) => setIncludeAudioInExport(event.target.checked)}
                disabled={!exportTarget.audioId}
              />
              音源ファイルも含める
            </label>
            {!exportTarget.audioId && (
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
