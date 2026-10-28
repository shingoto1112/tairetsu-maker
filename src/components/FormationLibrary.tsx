import type { AudioSelection } from "../platform/audioStorage";
import { paradeDistanceError } from "../project/paradeLimits";
import { creationNumberError } from "../project/creationValidation";
import { ChangeEvent, FormEvent, MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cloud, CloudUpload, Copy, Download, Edit3, ExternalLink, Folder, MoreHorizontal, Plus, Trash2, Upload, Users, X } from "lucide-react";
import type { ProjectSummary } from "../repositories/types";
import type { CloudLibraryCard } from "../collaboration/libraryCards";
import { LibraryHeader, type LibraryHeaderAccount } from "./LibraryHeader";

import type {
  FormationMode,
  HorizontalGuideMode,
  ParadeHorizontalMeasureMode,
  ParadeRulerPosition,
  ParadeSettings,
} from "../types";

import { AudioFilePickerButton } from "./AudioFilePickerButton";
import { createEmptyFormationProject } from "../project/createEmptyFormationProject";
import { oversizedRosterObjects, type OversizedObjectPolicy } from "../project/rosterCopy";
import { RosterCopySizeDialog } from "./RosterCopySizeDialog";
import type { Project } from "../types";

import { LegalLinks } from "./LegalLinks";
import { HorizontalCountingCards } from "./HorizontalCountingCards";
import { MemberDiameterPicker } from "./MemberDiameterPicker";
import { applyMemberDiameterAction, MEMBER_DIAMETER_MIN, MEMBER_DIAMETER_MAX, NEW_MEMBER_DIAMETER } from "../utils/memberDiameter";
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
  rosterCopy?: { source: Project; includeObjects: boolean; oversizedPolicy?: OversizedObjectPolicy };
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
  onSaveToCloud?: (projectId: string) => void | Promise<void>;
  cloudSaveBusy?: boolean;
  /** Header account button (lazy collaboration state). */
  account?: LibraryHeaderAccount;
  /** "…" → 保存データの管理 (StorageTools stays mounted in storageTools). */
  onOpenStorageManager?: () => void;
  /** "…" → 旧クラウドのデータを取り込む (LegacyRescuePanel stays mounted in collaborationSlot). */
  onOpenLegacyImport?: () => void;
  /** Card picture for a stored formation; the folder icon is used without it. */
  renderProjectPreview?: (summary: ProjectSummary) => ReactNode;
  /** Formations only in the cloud, shown after the local ones in the same grid. */
  cloudProjects?: CloudLibraryCard[];
  onOpenCloudProject?: (documentId: string) => void;
  onRefreshCloud?: () => void;
  onLoadMoreCloud?: () => void;
  cloudBusy?: boolean;
  onImportProjectFiles?: (files: File[]) => void | Promise<void>;

  onLoadRosterSource?: (projectId: string) => Promise<Project>;
  onCreate: (input: NewFormationInput) => void | boolean | Promise<void | boolean>;
  onOpenProject: (projectId: string) => void | Promise<void | boolean>;
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
const MENU_MARGIN = 12;

const clampMenuPosition = (left: number, top: number, width = MENU_WIDTH, height = 0): { left: number; top: number } => {
  const viewport = window.visualViewport;
  const maxLeft = Math.max(MENU_MARGIN, (viewport?.width ?? window.innerWidth) - width - MENU_MARGIN);
  const maxTop = Math.max(MENU_MARGIN, (viewport?.height ?? window.innerHeight) - height - MENU_MARGIN);
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

const formationTypeOptions: { value: FormationMode; title: string; description: string }[] = [
  { value: "stage", title: "ステージ隊列", description: "決まったステージの上で、シーンごとの隊形を作ります。発表会・ライブ向け" },
  { value: "parade", title: "パレード隊列", description: "長いルートを進みながら変わる隊形を作ります。パレード・行進向け" },
];

type CreationNumberFieldProps = {
  name: string; label: string; min: number; max?: number; step: string; value: number;
  onChange: (value: number) => void; error?: string;
};
const CreationNumberField = ({ name, label, min, max, step, value, onChange, error }: CreationNumberFieldProps) => (
  <div className="creation-number-field">
    <label>
      {label}
      <span className="meter-input">
        <input type="number" name={name} aria-label={label} data-number-field data-field-label={label}
          min={min} max={max} step={step} value={Number.isFinite(value) ? value : ""}
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
  onSaveToCloud,
  cloudSaveBusy = false,
  account,
  onOpenStorageManager,
  onOpenLegacyImport,
  renderProjectPreview,
  cloudProjects = [],
  onOpenCloudProject,
  onRefreshCloud,
  onLoadMoreCloud,
  cloudBusy = false,
  onImportProjectFiles,
  onCreate,
  onLoadRosterSource,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onExportProject,
  onImportProjectFile,
  onDeleteProject,
}: FormationLibraryProps) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formationMode, setFormationMode] = useState<FormationMode>("stage");
  const [title, setTitle] = useState("");
  const [widthMeters, setWidthMeters] = useState(12);
  const [heightMeters, setHeightMeters] = useState(8);
  const [useGlobalStageSize, setUseGlobalStageSize] = useState(true);
  const [gridSizeMeters, setGridSizeMeters] = useState(0.5);
  const [horizontalGuideMode, setHorizontalGuideMode] =
    useState<HorizontalGuideMode>("centerSplit");
  const [memberDiameterMeters, setMemberDiameterMeters] = useState(NEW_MEMBER_DIAMETER);
  const [paradeTotalDistance, setParadeTotalDistance] = useState(100);
  // New parade defaults (user decision 2026-10-06): 10m wide, 0.5m cells.
  const [paradeWidthMeters, setParadeWidthMeters] = useState(10);
  const [paradeCellSizeMeters, setParadeCellSizeMeters] = useState(0.5);
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
  const [rosterSourceId, setRosterSourceId] = useState("");
  const [rosterSource, setRosterSource] = useState<Project | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [includeObjects, setIncludeObjects] = useState(true);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [pendingCreation, setPendingCreation] = useState<NewFormationInput | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRosterSource(null);
    if (!rosterSourceId || !onLoadRosterSource) { setRosterLoading(false); return; }
    setRosterLoading(true);
    void onLoadRosterSource(rosterSourceId).then(source => {
      if (!cancelled) setRosterSource(source);
    }).catch(() => {
      if (!cancelled) setError("コピー元の名簿を読み込めませんでした。端末に保存された隊列表を確認して、もう一度作成してください。");
    }).finally(() => { if (!cancelled) setRosterLoading(false); });
    return () => { cancelled = true; };
  }, [rosterSourceId, onLoadRosterSource]);
  const [libraryMenu, setLibraryMenu] = useState<LibraryMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  const [exportTarget, setExportTarget] = useState<ProjectSummary | null>(null);
  const [includeAudioInExport, setIncludeAudioInExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!libraryMenu || !menuRef.current) return;
    const place = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLibraryMenu(previous => {
        if (!previous) return previous;
        const position = clampMenuPosition(previous.left, previous.top, rect.width, rect.height);
        return position.left === previous.left && position.top === previous.top ? previous : { ...previous, ...position };
      });
    };
    place();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    observer?.observe(menuRef.current);
    window.addEventListener("resize", place); window.visualViewport?.addEventListener("resize", place);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); };
  }, [libraryMenu]);
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
    setRosterSourceId("");
    setRosterSource(null);
    setIncludeObjects(true);
    setPendingCreation(null);
    setFieldErrors({});
    setAdvancedOpen(false);
    setFormationMode("stage");
    setTitle("");
    setWidthMeters(12);
    setHeightMeters(8);
    setUseGlobalStageSize(true);
    setGridSizeMeters(0.5);
    setHorizontalGuideMode("centerSplit");
    setMemberDiameterMeters(NEW_MEMBER_DIAMETER);
    setParadeTotalDistance(100);
    setParadeWidthMeters(10);
    setParadeCellSizeMeters(0.5);
    setParadeRulerPosition("both");
    setParadeHorizontalMeasureMode("centerSplit");
    setParadeEmphasizeEvery5m(true);
    setParadeEmphasizeEvery10m(true);
    setAudioFile(null);
    setError(null);
  };

  const closeDialog = () => {
    if (creatingRef.current) return;
    setIsDialogOpen(false);
    resetDialog();
  };

  const openCreateDialog = (nextMode: FormationMode, sourceId = "") => {
    resetDialog();
    setFormationMode(nextMode);
    setRosterSourceId(sourceId);
    setIsAddDialogOpen(false);
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

  const finishCreation = async (input: NewFormationInput) => {
    if (creatingRef.current) return;
    creatingRef.current = true; setCreating(true); setError(null);
    try {
      if (await onCreate(input) !== false) {
        setIsDialogOpen(false); resetDialog();
      }
    } catch (cause) {
      setPendingCreation(null);
      setError(cause instanceof Error ? cause.message : "隊列表を作成できませんでした。もう一度お試しください。");
    } finally { creatingRef.current = false; setCreating(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || creatingRef.current || rosterLoading) return;
    const form = event.currentTarget;
    const trimmedTitle = title.trim() || "新しい隊列表";
    const errors: Record<string, string> = {};
    form.querySelectorAll<HTMLInputElement>('input[data-number-field]').forEach(input => {
      const error = creationNumberError(input.valueAsNumber, input.dataset.fieldLabel ?? "",
        Number(input.min), input.max === "" ? undefined : Number(input.max));
      if (error) errors[input.name] = error;
    });
    const diameterError = creationNumberError(memberDiameterMeters, "メンバーの丸の直径",
      MEMBER_DIAMETER_MIN, MEMBER_DIAMETER_MAX);
    if (diameterError) errors.memberDiameterMeters = diameterError;
    if (formationMode === "parade") {
      const distanceError = paradeDistanceError({ totalDistance: paradeTotalDistance });
      if (distanceError) errors.paradeTotalDistance = distanceError;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      const input = form.elements.namedItem(Object.keys(errors)[0]) as HTMLInputElement | null;
      // Reveal every invalid advanced field, even when the first error is elsewhere.
      if (Object.keys(errors).some(key => form.elements.namedItem(key) instanceof HTMLInputElement &&
        (form.elements.namedItem(key) as HTMLInputElement).closest("details"))) setAdvancedOpen(true);
      if (errors.memberDiameterMeters) setAdvancedOpen(true);
      requestAnimationFrame(() => {
        if (input) input.focus();
        else form.querySelector<HTMLInputElement>(".member-diameter-picker input")?.focus();
      });
      return;
    }
    const isParade = formationMode === "parade";
    const input: NewFormationInput = {
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
    };
    if (rosterSourceId) {
      if (!onLoadRosterSource) return;
      creatingRef.current = true; setCreating(true); setError(null);
      try {
        // Re-read the device snapshot on submit; confirmation and creation use this same snapshot.
        const source = await onLoadRosterSource(rosterSourceId);
        input.rosterCopy = { source, includeObjects: includeObjects && source.stageObjects.length > 0 };
      } catch {
        setError("コピー元の名簿を読み込めませんでした。端末に保存された隊列表を確認して、もう一度作成してください。");
        return;
      } finally { creatingRef.current = false; setCreating(false); }
      if (input.rosterCopy.includeObjects && oversizedRosterObjects(input.rosterCopy.source,
        createEmptyFormationProject(input.title, input, null)).length) {
        setPendingCreation(input); return;
      }
    }
    await finishCreation(input);
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

  const runMenuAction = async (action: () => void | Promise<void | boolean>) => {
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
      <LibraryHeader onOpenHelp={onOpenHelp} account={account} onOpenStorageManager={onOpenStorageManager}
        onRefreshCloud={onRefreshCloud} cloudBusy={cloudBusy} onOpenLegacyImport={onOpenLegacyImport} />
      <p className="library-lead">作成済みの隊列表を開くか、新しい隊列表を作成します。</p>

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
          // The upper action row has no open handler; the gap is non-interactive.
          <div
            className="formation-card formation-card--saved"
            data-project-id={project.id}
            key={project.id ?? `${project.title}-${index}`}
            onContextMenu={(event) => openMenu(project, event)}
          >
            <div className="formation-card__actions">
              <span className="formation-card__badge">{renderProjectBadge?.(project) ?? "ローカル"}</span>
              <button className="formation-card__menu" type="button" disabled={disabled}
                aria-label={`${project.title || "名称未設定"}のメニュー`} title="隊列表の操作"
                aria-haspopup="menu" aria-expanded={libraryMenu?.projectId === project.id}
                onClick={(event) => openMenu(project, event, "button")}>
                <MoreHorizontal size={20} />
              </button>
            </div>
            <button
              className="formation-card__open"
              type="button"
              onClick={() => void onOpenProject(project.id)}
              aria-label={`${project.title || "名称未設定"}を開く`}
            >
              <span className="formation-card__preview" aria-hidden="true">
                {renderProjectPreview?.(project) ?? (
                  <span className={`formation-folder formation-folder--${(index % 6) + 1}`}>
                    <Folder size={56} />
                  </span>
                )}
              </span>
              <strong>{project.title || "名称未設定"}</strong>
              <small>最終使用: {formatProjectDate(project)}</small>
            </button>
          </div>
        ))}

        {cloudProjects.map((card) => (
          <div
            className="formation-card formation-card--saved formation-card--cloud"
            key={`cloud-${card.documentId}`}
          >
            <div className="formation-card__actions">
              <span className="formation-card__badge formation-card__badge--cloud">{card.badge}</span>
            </div>
          <button
            className="formation-card__open"
            type="button"
            disabled={!card.openable || cloudBusy || !onOpenCloudProject}
            onClick={() => onOpenCloudProject?.(card.documentId)}
            aria-label={`${card.title}をクラウドから開く`}
            aria-describedby={`cloud-card-${card.documentId}`}
          >
            <span className="formation-card__preview formation-card__preview--cloud" aria-hidden="true">
              <Cloud size={44} />
            </span>
            <strong>{card.title}</strong>
            <span className="formation-card__details" id={`cloud-card-${card.documentId}`}>
              <span className="sr-only">{card.badge}・</span>
              <small>{card.detail}</small>
              <small className={card.openable ? "formation-card__note" : "formation-card__note is-blocked"}>{card.note}</small>
            </span>
          </button>
          </div>
        ))}
      </section>

      {onLoadMoreCloud && (
        <div className="library-cloud-more">
          <button type="button" className="mini-button" disabled={cloudBusy} onClick={onLoadMoreCloud}>クラウドの続きを表示</button>
        </div>
      )}

      {sortedProjects.length === 0 && cloudProjects.length === 0 && (
        <p className="library-empty">
          まだ保存済みの隊列表はありません。「追加」の新規 / 読込から始めてください。
        </p>
      )}

      <LegalLinks className="library-legal-links" />

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
          {onLoadRosterSource && <button type="button" onClick={() => {
            openCreateDialog(menuProject.mode, menuProject.id); setLibraryMenu(null);
          }}><Users size={15} />この名簿で新しく作る</button>}
          {onSaveToCloud && !menuProject.sharing && <button type="button" disabled={cloudSaveBusy}
            onClick={() => runMenuAction(() => onSaveToCloud(menuProject.id))}>
            <CloudUpload size={15} />クラウドに保存
          </button>}
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
              <button type="button" onClick={() => openCreateDialog("stage")}>
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

      {isDialogOpen && !pendingCreation && (
        <div className="new-formation-backdrop" onPointerDown={closeDialog}>
          <form
            className="new-formation-dialog roster-copy-creation-dialog"
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

            <fieldset className="horizontal-counting formation-type-choice" disabled={creating}>
              <legend>作成タイプ</legend>
              <div className="horizontal-counting__cards">
                {formationTypeOptions.map(option => <label key={option.value} className={"counting-card" + (formationMode === option.value ? " is-selected" : "")}>
                  <span className="counting-card__heading">
                    <input type="radio" name="formationMode" value={option.value} checked={formationMode === option.value}
                      onChange={() => setFormationMode(option.value)} />
                    <strong>{option.title}</strong>
                    <span className="counting-card__check" aria-hidden="true">{formationMode === option.value ? "✓" : ""}</span>
                  </span>
                  <small>{option.description}</small>
                </label>)}
              </div>
            </fieldset>

            <label>
              隊列表名（任意）
              <input
                name="title"
                aria-describedby="create-title-hint"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例：2026春 オープニング"
                autoFocus
              />
            </label>

            <small id="create-title-hint" className="creation-title-hint">空欄の場合：新しい隊列表</small>

            {onLoadRosterSource && <section className="roster-copy-field">
              <label>名簿をコピー（任意）
                <select value={rosterSourceId} disabled={creating} aria-describedby="roster-copy-description"
                  onChange={event => { setRosterSourceId(event.target.value); setIncludeObjects(true); setError(null); }}>
                  <option value="">コピーしない</option>
                  {sortedProjects.map(source => <option key={source.id} value={source.id}>
                    {source.title} ／ 更新 {formatProjectDate({ ...source, lastOpenedAt: undefined })} ／ {source.memberCount}人
                  </option>)}
                </select>
              </label>
              <small id="roster-copy-description">この端末に保存された内容からコピーします。配置・シーン・音源・道具の担当はコピーしません。</small>
              {rosterSourceId && <>
                <label className="checkbox-row"><input type="checkbox" checked={includeObjects}
                  disabled={creating || rosterLoading || !rosterSource?.stageObjects.length}
                  onChange={event => setIncludeObjects(event.target.checked)} />道具もコピーする</label>
                <small>{rosterLoading ? "名簿を読み込み中…" : rosterSource
                  ? `${rosterSource.members.length}人・道具${rosterSource.stageObjects.length}個。最初のシーンでは全員・全道具が非表示です。`
                  : "コピー元を読み込めていません。作成時に再試行します。"}</small>
              </>}
            </section>}

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

                <CreationNumberField name="widthMeters" label="横幅" min={1} step="0.1"
                  value={widthMeters} onChange={setWidthMeters} error={fieldErrors.widthMeters} />
                <CreationNumberField name="heightMeters" label="縦幅" min={1} step="0.1"
                  value={heightMeters} onChange={setHeightMeters} error={fieldErrors.heightMeters} />

                <HorizontalCountingCards value={horizontalGuideMode} onChange={setHorizontalGuideMode} />
                <details className="settings-disclosure" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                  <summary>詳しい設定（あとから変更できます）</summary>
                <div className="creation-advanced-fields">
                <CreationNumberField name="gridSizeMeters" label="グリッド間隔" min={0.1} step="0.05"
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

                <MemberDiameterPicker value={memberDiameterMeters} disabled={disabled || creating}
                  onChange={action => setMemberDiameterMeters(current => applyMemberDiameterAction(current, action))}
                  error={fieldErrors.memberDiameterMeters} />
                </div>
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
                <div className="creation-advanced-fields">

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
                <MemberDiameterPicker value={memberDiameterMeters} disabled={disabled || creating}
                  onChange={action => setMemberDiameterMeters(current => applyMemberDiameterAction(current, action))}
                  error={fieldErrors.memberDiameterMeters} />
                </div>
                </details>
                <small>作成後の初期表示はスタート地点です。</small>
              </section>
            )}

            {error && <p className="dialog-error" role="alert">{error}</p>}

            <footer>
              <button className="mini-button" onClick={closeDialog} type="button" disabled={creating}>
                キャンセル
              </button>
              <button className="mini-button primary" type="submit" disabled={creating || rosterLoading}>
                {creating ? "作成中…" : "作成する"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {pendingCreation?.rosterCopy && <RosterCopySizeDialog
        input={pendingCreation} busy={creating}
        onBack={() => setPendingCreation(null)}
        onChoose={oversizedPolicy => void finishCreation({ ...pendingCreation,
          rosterCopy: { ...pendingCreation.rosterCopy!, oversizedPolicy } })} />}

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
