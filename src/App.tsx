import { normalizeProject } from "./project/normalizeProject";
import {
  createProjectId,
  positiveNumber,
  clampNumber,
  createDefaultParadeSettings,
  groupColorPalette,
} from "./project/defaults";
import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createVisibilityMemory } from "./utils/sceneVisibility";
import { selectionScrollBounds } from "./utils/selectionScrollBounds";
import { useWorkspaceLayout } from "./hooks/useWorkspaceLayout";
import { useNotice, type NoticeKind } from "./hooks/useNotice";
import { App as CapacitorApp } from "@capacitor/app";
import { CircleHelp } from "lucide-react";
import { AssignmentPanel } from "./components/AssignmentPanel";
import { AudioPanel } from "./components/AudioPanel";
const CloudCollaborationHelpModal = lazy(() => import("./components/CloudCollaborationHelpModal").then(module => ({ default: module.CloudCollaborationHelpModal })));
const CloudPasswordModal = lazy(() => import("./components/CloudPasswordModal").then(module => ({ default: module.CloudPasswordModal })));
const CloudShareModal = lazy(() => import("./components/CloudShareModal").then(module => ({ default: module.CloudShareModal })));
const DetailsPanel = lazy(() => import("./components/DetailsPanel").then((module) => ({ default: module.DetailsPanel })));
import { ExportImportPanel } from "./components/ExportImportPanel";
import { FormationLibrary, type NewFormationInput } from "./components/FormationLibrary";
import { GroupToolsPanel } from "./components/GroupToolsPanel";
import { MemberPanel } from "./components/MemberPanel";
import { ObjectPanel } from "./components/ObjectPanel";
import { PanelTabId, PanelTabs } from "./components/PanelTabs";
import { getPrintOrientation, PrintPreview } from "./components/PrintPreview";
import { nextNumberedName } from "./utils/numberedName";
import { nextRosterItemName } from "./utils/rosterColumns";
import { confirmAssignmentUpdate, runSavedAssignmentUpdate } from "./utils/assignmentUpdate";
import { isModalOpen } from "./utils/modal";
import { formatExportTimestamp, withFileExtension } from "./utils/exportFileName";
const ExportCompletionDialog = lazy(() => import("./components/ExportCompletionPanel").then((module) => ({ default: module.ExportCompletionDialog })));
import { SceneNotesPanel } from "./components/SceneNotesPanel";
import { SceneThumbnailRail } from "./components/SceneThumbnailRail";
import type {
  ShareExportOptions,
  ShareExportRequest,
} from "./components/ShareExportModal";
const ShareExportModal = lazy(() => import("./components/ShareExportModal").then(module => ({ default: module.ShareExportModal })));
import { StageCanvas } from "./components/StageCanvas";
import {
  ParadeCanvas,
  type ParadeReflectOptions,
} from "./components/ParadeCanvas";
import { StageSettingsPanel } from "./components/StageSettingsPanel";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import {
  buildProjectFromCloudParts,
  clearCloudLockTokenFromSession,
  clearCloudAuthSession,
  CLOUD_SCHEMA_VERSION,
  createCloudApiClient,
  createCloudAuthClient,
  createCloudLeaseId,
  createCloudLockToken,
  createCloudOperationId,
  createCloudProjectDraft,
  createProjectLockTarget,
  createSceneCellLockTarget,
  createSceneCellVersionKey,
  createSceneLockTarget,
  extractCloudProjectResourceData,
  extractCloudSceneData,
  getCloudConfig,
  getCloudAuthErrorMessage,
  hydrateCloudAuthSessionFromNativeStorage,
  isCloudAuthSessionExpired,
  readCloudAuthSession,
  readCloudClientIdFromSession,
  readCloudLockTokenFromSession,
  parseSceneCellLockTargetId,
  saveCloudAuthSession,
  saveCloudLockTokenToSession,
  type CloudActiveLockSummary,
  type CloudApiClient,
  type CloudAuthSession,
  type CloudCollaborationItem,
  type CloudContactItem,
  type CloudLockTarget,
  type CloudPermissionRole,
  type CloudProjectParts,
  type CloudProjectLockKey,
  type CloudProjectResourceData,
  type CloudProjectSummary,
  type CloudResourceKey,
  type CloudSceneCellPatchType,
  type CloudSceneCellVersion,
} from "./cloud";
import type {
  CloudCommitEvent,
  CloudLockTakeoverRequest,
  CloudProjectPresence,
  CloudPreviewEvent,
  CloudRealtimeSubscription,
  CloudSaveNotification,
} from "./cloud/realtime";
import { createSampleProject } from "./sampleProject";
import {
  deletePersonalCloudDraft,
  getAppFeatureFlags,
  readPersonalCloudDraft,
  writePersonalCloudDraft,
} from "./platform";
import {
  AnimationSettings,
  AlignmentAction,
  AudioMeta,
  EditingMode,
  FormationTemplate,
  FormationFrame,
  Member,
  MemberCreateInput,
  MemberGroup,
  MovementPathMode,
  MovementPath,
  MovementPlan,
  MovementPathType,
  MovementTargetType,
  ObjectGroup,
  ObjectState,
  ParadeSettings,
  Position,
  Project,
  SceneElementEditTarget,
  SceneViewState,
  Selection,
  StageConfig,
  StageObject,
  StageObjectDraft,
  StageContextMenuRequest,
  StageSnapshot,
  ViewerPerspective,
} from "./types";
import {
  constrainMemberPosition,
  constrainObjectPosition,
  getObjectCenter,
  objectTopLeftFromCenter,
  roundMeters,
  snapToGrid,
} from "./utils/coordinates";
import {
  elementToJpegDataUrl,
  elementToPngBlob,
} from "./utils/exportImage";
import type { CompletedExport } from "./utils/mobileExportTypes";
import {
  deleteAudioBlobFromIndexedDb,
  loadAudioBlobFromIndexedDb,
  saveAudioBlobToIndexedDb,
  saveAudioFileToIndexedDb,
} from "./utils/audioStorage";
import { createId } from "./utils/ids";
import {
  createDefaultObjectState,
  getActiveFrameAtTime,
  findMovementPath,
  findMovementPlan,
  getAnimationSettings,
  getSnapshotForFrame,
  getMovementPathType,
  getPlanTiming,
  interpolateProjectAtTime,
  resolveMovementPlan,
  sortFrames,
} from "./utils/interpolation";
import { getMemberDisplayColor } from "./utils/memberAppearance";
import {
  getSafeParadeBackwardDistance,
  getSafeParadeCanvasDistance,
} from "./utils/parade";
import { readProjectFromHash } from "./utils/share";
import {
  hydrateProjectsFromNativeStorage,
  loadProjectFromStorage,
  loadProjectsFromStorage,
  saveProjectToStorage,
  saveProjectsToStorage,
  sortStoredProjects,
} from "./utils/storage";
import {
  createTairetsuArchive,
  createTairetsuFileName,
  readTairetsuArchive,
} from "./utils/tairetsuFile";

type InitialLoad = {
  project: Project;
  projects: Project[];
  shared: boolean;
  error: string | null;
};

type InternalClipboard =
  | {
      type: "member";
      member: Member;
      positionsByFrame: Record<string, Position>;
    }
  | {
      type: "object";
      object: StageObject;
      objectStatesByFrame: Record<string, ObjectState>;
    }
  | {
      type: "frame";
      frame: FormationFrame;
    };

type AnimationPreviewTarget = {
  targetType: MovementTargetType;
  targetId: string;
};

type PanelVisibilityTab = "visible" | "hidden";

type MemberColorScope = "scene" | "following";

type MemberColorEditor = {
  memberId: string;
  color: string;
  scope: MemberColorScope;
  clientX: number;
  clientY: number;
};

type FloatingMenuPosition = {
  left: number;
  top: number;
};

type SceneContextMenu = {
  frameId: string;
  clientX: number;
  clientY: number;
};

type PanelScrollTarget =
  | { type: "member"; id: string; token: number }
  | { type: "object"; id: string; token: number }
  | { type: "member-tools"; token: number };

type StageSelectOptions = {
  append?: boolean;
};

type HistoryEntry = {
  project: Project;
  label?: string;
};

const RosterManagementModal = lazy(() =>
  import("./components/RosterManagementModal").then((module) => ({
    default: module.RosterManagementModal,
  })),
);

const HISTORY_LIMIT = 50;
const HISTORY_COALESCE_MS = 1200;
const FLOATING_MENU_MARGIN_PX = 10;
const APP_NAME = "隊列メーカー";
const APP_FEATURES = getAppFeatureFlags();
const IPAD_AUTH_REDIRECT_URL = "jp.tairetsu.maker://auth/callback";
const getCloudEmailRedirectUrl = (): string =>
  APP_FEATURES.nativeFileShare
    ? IPAD_AUTH_REDIRECT_URL
    : `${window.location.origin}${window.location.pathname}`;
const MEMBER_COLOR_PRESETS = [
  { label: "赤 ライト", value: "#fca5a5" },
  { label: "赤 明るめ", value: "#f87171" },
  { label: "赤", value: "#ef4444" },
  { label: "赤橙", value: "#ff6b35" },
  { label: "オレンジ", value: "#fb923c" },
  { label: "オレンジ ライト", value: "#fdba74" },
  { label: "アンバー", value: "#fbbf24" },
  { label: "黄色", value: "#facc15" },
  { label: "黄 ライト", value: "#fde047" },
  { label: "ゴールド", value: "#ffd54f" },
  { label: "ローズ ライト", value: "#fda4af" },
  { label: "ローズ 明るめ", value: "#fb7185" },
  { label: "ローズ", value: "#f43f5e" },
  { label: "ピンク ライト", value: "#f9a8d4" },
  { label: "ピンク 明るめ", value: "#f472b6" },
  { label: "ピンク", value: "#ec4899" },
  { label: "マゼンタ", value: "#ff4db8" },
  { label: "フクシア 明るめ", value: "#e879f9" },
  { label: "フクシア", value: "#d946ef" },
  { label: "紫 明るめ", value: "#c084fc" },
  { label: "紫 ライト", value: "#d8b4fe" },
  { label: "ラベンダー", value: "#b388ff" },
  { label: "紫", value: "#a855f7" },
  { label: "明るい紫", value: "#ab47bc" },
  { label: "バイオレット", value: "#8b5cf6" },
  { label: "藍 明るめ", value: "#818cf8" },
  { label: "インディゴ", value: "#6366f1" },
  { label: "青 明るめ", value: "#60a5fa" },
  { label: "青", value: "#3b82f6" },
  { label: "明るい青", value: "#42a5f5" },
  { label: "青 ライト", value: "#93c5fd" },
  { label: "空 ライト", value: "#7dd3fc" },
  { label: "空 明るめ", value: "#38bdf8" },
  { label: "スカイ", value: "#29b6f6" },
  { label: "空色", value: "#0ea5e9" },
  { label: "水色 ライト", value: "#67e8f9" },
  { label: "水色 明るめ", value: "#22d3ee" },
  { label: "シアン", value: "#06b6d4" },
  { label: "アクア", value: "#00bcd4" },
  { label: "明るい青緑", value: "#00e5c0" },
  { label: "青緑 ライト", value: "#5eead4" },
  { label: "青緑 明るめ", value: "#2dd4bf" },
  { label: "ターコイズ", value: "#20c997" },
  { label: "青緑", value: "#14b8a6" },
  { label: "ミント", value: "#34d399" },
  { label: "エメラルド", value: "#10b981" },
  { label: "緑 ライト", value: "#86efac" },
  { label: "緑 明るめ", value: "#4ade80" },
  { label: "緑", value: "#22c55e" },
  { label: "ライトグリーン", value: "#76ff03" },
  { label: "黄緑 明るめ", value: "#a3e635" },
  { label: "ライム", value: "#84cc16" },
  { label: "ライム ライト", value: "#bef264" },
  { label: "濃い緑", value: "#16a34a" },
  { label: "琥珀", value: "#f59e0b" },
  { label: "濃いオレンジ", value: "#f97316" },
  { label: "コーラル", value: "#ff7f50" },
  { label: "サーモン", value: "#ff8a80" },
  { label: "グレー", value: "#64748b" },
  { label: "黒", value: "#111827" },
];

const clampFloatingMenuPosition = (
  anchor: FloatingMenuPosition,
  element: HTMLElement | null,
): FloatingMenuPosition => {
  if (!element || typeof window === "undefined") {
    return anchor;
  }
  const rect = element.getBoundingClientRect();
  const maxLeft = Math.max(
    FLOATING_MENU_MARGIN_PX,
    window.innerWidth - rect.width - FLOATING_MENU_MARGIN_PX,
  );
  const maxTop = Math.max(
    FLOATING_MENU_MARGIN_PX,
    window.innerHeight - rect.height - FLOATING_MENU_MARGIN_PX,
  );
  return {
    left: Math.min(Math.max(FLOATING_MENU_MARGIN_PX, anchor.left), maxLeft),
    top: Math.min(Math.max(FLOATING_MENU_MARGIN_PX, anchor.top), maxTop),
  };
};

const cloneProject = (project: Project): Project => {
  if (typeof structuredClone === "function") {
    return structuredClone(project);
  }
  return JSON.parse(JSON.stringify(project)) as Project;
};

const cloneFrame = (frame: FormationFrame): FormationFrame => ({
  ...frame,
  memberVisibility: frame.memberVisibility
    ? { ...frame.memberVisibility }
    : undefined,
  groupVisibility: frame.groupVisibility
    ? { ...frame.groupVisibility }
    : undefined,
  objectAssignments: frame.objectAssignments
    ? Object.fromEntries(
        Object.entries(frame.objectAssignments).map(([objectId, memberIds]) => [
          objectId,
          [...memberIds],
        ]),
      )
    : undefined,
  memberAppearanceOverrides: frame.memberAppearanceOverrides
    ? Object.fromEntries(
        Object.entries(frame.memberAppearanceOverrides).map(
          ([memberId, override]) => [memberId, { ...override }],
        ),
      )
    : undefined,
  positions: { ...frame.positions },
  objectStates: { ...frame.objectStates },
});

const mergeFrameContents = (
  target: FormationFrame,
  source: FormationFrame,
): FormationFrame => {
  const clonedSource = cloneFrame(source);
  return {
    ...target,
    section: clonedSource.section,
    notes: clonedSource.notes,
    stageWidthMeters: clonedSource.stageWidthMeters,
    stageDepthMeters: clonedSource.stageDepthMeters,
    memberVisibility: clonedSource.memberVisibility,
    groupVisibility: clonedSource.groupVisibility,
    objectAssignments: clonedSource.objectAssignments,
    memberAppearanceOverrides: clonedSource.memberAppearanceOverrides,
    positions: clonedSource.positions,
    objectStates: clonedSource.objectStates,
  };
};

const createSingleTargetPreviewProject = (
  project: Project,
  fromFrame: FormationFrame,
  toFrame: FormationFrame,
  target: AnimationPreviewTarget,
): Project => {
  const disabledPlans: MovementPlan[] = [
    ...project.members.map((member) => ({
      id: `preview-lock-${fromFrame.id}-${toFrame.id}-member-${member.id}`,
      fromFrameId: fromFrame.id,
      toFrameId: toFrame.id,
      targetType: "member" as const,
      targetId: member.id,
      enabled: false,
      startSec: fromFrame.timeSec,
      endSec: toFrame.timeSec,
      pathType: "straight" as const,
    })),
    ...project.stageObjects.map((object) => ({
      id: `preview-lock-${fromFrame.id}-${toFrame.id}-object-${object.id}`,
      fromFrameId: fromFrame.id,
      toFrameId: toFrame.id,
      targetType: "object" as const,
      targetId: object.id,
      enabled: false,
      startSec: fromFrame.timeSec,
      endSec: toFrame.timeSec,
      pathType: "straight" as const,
    })),
  ].filter(
    (plan) =>
      !(
        plan.targetType === target.targetType &&
        plan.targetId === target.targetId
      ),
  );

  return {
    ...project,
    movementPlans: [...disabledPlans, ...(project.movementPlans ?? [])],
  };
};

const defaultStageObjectDraft: StageObjectDraft = {
  type: "prop",
  shape: "rectangle",
  name: "道具",
  color: "#2563eb",
  widthMeters: 1.2,
  heightMeters: 0.8,
};

const curtainDraft: StageObjectDraft = {
  type: "curtain",
  shape: "curtain",
  name: "移動幕",
  color: "#7c3aed",
  widthMeters: 1.4,
  heightMeters: 5,
};

const markDraft: StageObjectDraft = {
  type: "mark",
  shape: "circle",
  name: "立ち位置マーク",
  color: "#0f766e",
  widthMeters: 0.4,
  heightMeters: 0.4,
};

const KEYBOARD_NUDGE_SMALL = 0.01;
const KEYBOARD_NUDGE_DEFAULT = 0.25;
const KEYBOARD_NUDGE_LARGE_FALLBACK = 0.5;
const PARADE_BASE_PX_PER_METER = 32;
const PARADE_RULER_WIDTH_PX = 58;
const PARADE_HORIZONTAL_RULER_HEIGHT_PX = 28;
const PARADE_VIEWPORT_PADDING_LEFT_PX = 14;
const PARADE_VIEWPORT_PADDING_TOP_PX = 10;

const isTextEditingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
};

const escapeSelectorValue = (value: string): string => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
};

const getKeyboardNudgeMeters = (
  event: KeyboardEvent,
  gridSizeMeters?: number,
): number => {
  if (event.ctrlKey || event.metaKey) {
    return KEYBOARD_NUDGE_SMALL;
  }
  if (event.shiftKey) {
    return typeof gridSizeMeters === "number" && gridSizeMeters > 0
      ? gridSizeMeters
      : KEYBOARD_NUDGE_LARGE_FALLBACK;
  }
  return KEYBOARD_NUDGE_DEFAULT;
};

type AppConfirmOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  message: string;
  tone?: "default" | "danger";
  title: string;
};

type ExportProgressState = {
  detail?: string;
  title: string;
};

type CloudSceneOrderSaveStatus = {
  label: string;
  status: "pending" | "saving" | "saved" | "error";
};

type ClipboardItemLike = unknown;

type ClipboardItemConstructor = new (
  items: Record<string, Blob>,
) => ClipboardItemLike;

type NavigatorWithImageClipboard = Navigator & {
  clipboard?: {
    write?: (items: ClipboardItemLike[]) => Promise<void>;
  };
};

type WindowWithClipboardItem = Window & {
  ClipboardItem?: ClipboardItemConstructor;
};

const sortFormationFramesByTime = (
  frames: FormationFrame[],
): { changed: boolean; frames: FormationFrame[] } => {
  const ordered = frames
    .map((frame, index) => ({ frame, index }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.frame.timeSec)
        ? left.frame.timeSec
        : Number.POSITIVE_INFINITY;
      const rightTime = Number.isFinite(right.frame.timeSec)
        ? right.frame.timeSec
        : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.index - right.index;
    })
    .map(({ frame }) => frame);
  return {
    changed: ordered.some((frame, index) => frame.id !== frames[index]?.id),
    frames: ordered,
  };
};

const copyImageToClipboard = async (blob: Blob): Promise<boolean> => {
  const ClipboardItemCtor = (window as WindowWithClipboardItem).ClipboardItem;
  const clipboardWrite = (navigator as NavigatorWithImageClipboard).clipboard
    ?.write;
  if (!ClipboardItemCtor || !clipboardWrite) {
    return false;
  }
  try {
    await clipboardWrite([new ClipboardItemCtor({ "image/png": blob })]);
    return true;
  } catch (error) {
    console.error("画像のクリップボードコピーに失敗しました。", error);
    return false;
  }
};

const createUniqueProjectTitle = (
  baseTitle: string,
  projects: Project[],
): string => {
  const base = baseTitle.trim() || "読み込んだ隊列表";
  const existingTitles = new Set(projects.map((item) => item.title));
  if (!existingTitles.has(base)) {
    return base;
  }
  const firstCopy = `${base} のコピー`;
  if (!existingTitles.has(firstCopy)) {
    return firstCopy;
  }
  let index = 2;
  while (existingTitles.has(`${firstCopy} ${index}`)) {
    index += 1;
  }
  return `${firstCopy} ${index}`;
};

const getKeyboardNudgeDelta = (
  event: KeyboardEvent,
  viewerPerspective: ViewerPerspective,
  gridSizeMeters?: number,
): Position | null => {
  const step = getKeyboardNudgeMeters(event, gridSizeMeters);
  const displayDelta =
    event.key === "ArrowUp"
      ? { x: 0, y: -step }
      : event.key === "ArrowDown"
        ? { x: 0, y: step }
        : event.key === "ArrowLeft"
          ? { x: -step, y: 0 }
          : event.key === "ArrowRight"
            ? { x: step, y: 0 }
            : null;
  if (!displayDelta) {
    return null;
  }

  // 踊る人側視点では表示が反転しているため、画面上の矢印方向を優先して内部座標を反転する。
  const direction = viewerPerspective === "performer" ? -1 : 1;
  return {
    x: roundMeters(displayDelta.x * direction),
    y: roundMeters(displayDelta.y * direction),
  };
};

const getParadeVisibleCenterPosition = (
  project: Project,
  frame?: FormationFrame | null,
): Position | null => {
  if (project.mode !== "parade" || !frame?.sceneViewState) {
    return null;
  }
  const viewState = frame.sceneViewState;
  if (!viewState.viewportWidth || !viewState.viewportHeight) {
    return null;
  }

  const settings = createDefaultParadeSettings({
    width: project.paradeSettings?.width ?? project.stage.widthMeters,
    totalDistance:
      project.paradeSettings?.totalDistance ?? project.stage.depthMeters,
    cellSizeMeters:
      project.paradeSettings?.cellSizeMeters ?? project.stage.gridSizeMeters,
    backwardDistanceMeters: project.paradeSettings?.backwardDistanceMeters,
    rulerPosition: project.paradeSettings?.rulerPosition,
    horizontalMeasureMode: project.paradeSettings?.horizontalMeasureMode,
    emphasizeEvery5m: project.paradeSettings?.emphasizeEvery5m,
    emphasizeEvery10m: project.paradeSettings?.emphasizeEvery10m,
  });
  const backwardDistanceMeters = getSafeParadeBackwardDistance(
    settings.backwardDistanceMeters,
  );
  const canvasDistanceMeters = getSafeParadeCanvasDistance(
    settings.totalDistance,
    backwardDistanceMeters,
  );
  const zoom = positiveNumber(viewState.zoom, 1, 0.1);
  const pxPerMeter = PARADE_BASE_PX_PER_METER * zoom;
  const leftRulerWidth =
    settings.rulerPosition === "both" || settings.rulerPosition === "left"
      ? PARADE_RULER_WIDTH_PX
      : 0;
  const rightRulerWidth =
    settings.rulerPosition === "both" || settings.rulerPosition === "right"
      ? PARADE_RULER_WIDTH_PX
      : 0;
  const contentWidth =
    leftRulerWidth + settings.width * pxPerMeter + rightRulerWidth;
  const centeredContentOffset = Math.max(
    0,
    (viewState.viewportWidth -
      PARADE_VIEWPORT_PADDING_LEFT_PX * 2 -
      contentWidth) /
      2,
  );
  const stageXInPx =
    viewState.scrollLeft +
    viewState.viewportWidth / 2 -
    PARADE_VIEWPORT_PADDING_LEFT_PX -
    centeredContentOffset -
    leftRulerWidth;
  const stageYInPx =
    viewState.scrollTop +
    viewState.viewportHeight / 2 -
    PARADE_VIEWPORT_PADDING_TOP_PX -
    PARADE_HORIZONTAL_RULER_HEIGHT_PX;

  return {
    x: roundMeters(clampNumber(stageXInPx / pxPerMeter, 0, settings.width)),
    y: roundMeters(
      clampNumber(stageYInPx / pxPerMeter, 0, canvasDistanceMeters),
    ),
  };
};

const createEmptyFormationProject = (
  title: string,
  settings: Pick<
    NewFormationInput,
    | "widthMeters"
    | "heightMeters"
    | "useGlobalStageSize"
    | "gridSizeMeters"
    | "horizontalGuideMode"
    | "memberDiameterMeters"
    | "formationMode"
    | "paradeSettings"
  >,
  audio: AudioMeta | null,
): Project => {
  const now = new Date().toISOString();
  const formationMode = settings.formationMode ?? "stage";
  const paradeSettings =
    formationMode === "parade"
      ? createDefaultParadeSettings(
          settings.paradeSettings ?? {
            width: settings.widthMeters,
            totalDistance: settings.heightMeters,
            cellSizeMeters: settings.gridSizeMeters,
          },
        )
      : undefined;
  const widthMeters =
    formationMode === "parade"
      ? paradeSettings?.width ?? 20
      : Math.max(1, settings.widthMeters);
  const depthMeters =
    formationMode === "parade"
      ? paradeSettings?.totalDistance ?? 100
      : Math.max(1, settings.heightMeters);
  const gridSizeMeters =
    formationMode === "parade"
      ? paradeSettings?.cellSizeMeters ?? 1
      : Math.max(0.05, settings.gridSizeMeters);
  const memberDiameterMeters = Math.min(
    1,
    Math.max(0.1, settings.memberDiameterMeters),
  );
  return {
    id: createProjectId(),
    version: 1,
    title,
    mode: formationMode,
    paradeSettings,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    audio,
    stage: {
      widthMeters,
      depthMeters,
      gridSizeMeters,
      showGrid: true,
      showCenterLine: true,
      audienceSide: "bottom",
      showStageLabels: true,
      frontDirection: "bottom",
      originMode: "center",
      showCenterMarker: true,
      memberDiameterMeters,
      horizontalGuideMode: settings.horizontalGuideMode,
      fixedForAllScenes: settings.useGlobalStageSize,
      gridIntervalM: gridSizeMeters,
      horizontalDisplayMode: settings.horizontalGuideMode,
      memberCircleDiameterM: memberDiameterMeters,
    },
    useGlobalStageSize: settings.useGlobalStageSize,
    useGlobalStageWidth: settings.useGlobalStageSize,
    members: [],
    memberGroups: [],
    stageObjects: [],
    objectGroups: [],
    movementPaths: [],
    movementPlans: [],
    animationSettings: {
      membersEnabled: false,
      objectsEnabled: false,
      curtainsEnabled: false,
    },
    guideSettings: {
      snapGuideEnabled: true,
      snapToGuideEnabled: false,
    },
    focusMemberId: undefined,
    viewerPerspective: "audience",
    frames: [
      {
        id: createId("f"),
        label: "Scene 1",
        timeSec: 0,
        sceneViewState: undefined,
        positions: {},
        objectStates: {},
      },
    ],
  };
};

const readInitialProject = (): InitialLoad => {
  try {
    const sharedProject = readProjectFromHash();
    if (sharedProject) {
      return {
        project: normalizeProject(sharedProject),
        projects: loadProjectsFromStorage().map(normalizeProject),
        shared: true,
        error: null,
      };
    }
  } catch (error) {
    const stored = loadProjectFromStorage();
    const storedProjects = loadProjectsFromStorage().map(normalizeProject);
    return {
      project:
        storedProjects[0] ??
        (stored ? normalizeProject(stored) : normalizeProject(createSampleProject())),
      projects: storedProjects,
      shared: false,
      error:
        error instanceof Error
          ? error.message
          : "共有データから隊列表データを復元できませんでした。",
    };
  }

  const stored = loadProjectFromStorage();
  const storedProjects = loadProjectsFromStorage().map(normalizeProject);
  return {
    project:
      storedProjects[0] ??
      (stored ? normalizeProject(stored) : normalizeProject(createSampleProject())),
    projects: storedProjects,
    shared: false,
    error: null,
  };
};

const updateObjectStateInFrame = (
  frame: FormationFrame,
  object: StageObject,
  patch: Partial<ObjectState>,
): FormationFrame => {
  const current = frame.objectStates[object.id] ?? createDefaultObjectState(object);
  const next = {
    ...current,
    ...patch,
    widthMeters: Math.max(0.1, patch.widthMeters ?? current.widthMeters),
    heightMeters: Math.max(0.1, patch.heightMeters ?? current.heightMeters),
  };

  return {
    ...frame,
    objectStates: {
      ...frame.objectStates,
      [object.id]: next,
    },
  };
};

const resolvePreviousObjectStateForApply = (
  object: StageObject,
  sortedFrames: FormationFrame[],
  previousFrameIndex: number,
  currentFrame: FormationFrame,
): ObjectState => {
  for (let index = previousFrameIndex; index >= 0; index -= 1) {
    const state = sortedFrames[index]?.objectStates[object.id];
    if (state) {
      return state;
    }
  }
  return currentFrame.objectStates[object.id] ?? createDefaultObjectState(object);
};

const resolvePreviousMemberPositionForApply = (
  memberId: string,
  sortedFrames: FormationFrame[],
  previousFrameIndex: number,
  currentFrame: FormationFrame,
  fallbackPosition: Position,
): Position => {
  for (let index = previousFrameIndex; index >= 0; index -= 1) {
    const position = sortedFrames[index]?.positions[memberId];
    if (position) {
      return position;
    }
  }
  return currentFrame.positions[memberId] ?? fallbackPosition;
};

const resolvePreviousMemberVisibilityForApply = (
  memberId: string,
  sortedFrames: FormationFrame[],
  previousFrameIndex: number,
): boolean => sortedFrames[previousFrameIndex]?.memberVisibility?.[memberId] !== false;

const getFrameLabel = (frame: FormationFrame | undefined): string =>
  frame?.label ?? "未選択";

const getFrameTime = (frame: FormationFrame | undefined): number =>
  frame?.timeSec ?? 0;

const getEffectiveStageSize = (
  project: Project,
  frame: FormationFrame | undefined,
): Pick<Project["stage"], "widthMeters" | "depthMeters"> => {
  if (project.mode === "parade") {
    const totalDistance = positiveNumber(
      project.paradeSettings?.totalDistance,
      project.stage.depthMeters,
      1,
    );
    return {
      widthMeters: positiveNumber(
        project.paradeSettings?.width,
        project.stage.widthMeters,
        1,
      ),
      depthMeters: getSafeParadeCanvasDistance(
        totalDistance,
        project.paradeSettings?.backwardDistanceMeters,
      ),
    };
  }
  if (project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true) {
    return {
      widthMeters: project.stage.widthMeters,
      depthMeters: project.stage.depthMeters,
    };
  }
  return {
    widthMeters: positiveNumber(
      frame?.stageWidthMeters,
      project.stage.widthMeters,
      1,
    ),
    depthMeters: positiveNumber(
      frame?.stageDepthMeters,
      project.stage.depthMeters,
      1,
    ),
  };
};

type CanvasScrollBounds = {
  heightMeters: number;
  widthMeters: number;
  x: number;
  y: number;
};

type StageExportElement = HTMLDivElement & {
  scrollTargetIntoView?: (bounds: CanvasScrollBounds) => void;
};

const unionCanvasBounds = (
  boundsList: CanvasScrollBounds[],
): CanvasScrollBounds | null => {
  if (boundsList.length === 0) {
    return null;
  }
  const minX = Math.min(...boundsList.map((bounds) => bounds.x));
  const minY = Math.min(...boundsList.map((bounds) => bounds.y));
  const maxX = Math.max(
    ...boundsList.map((bounds) => bounds.x + bounds.widthMeters),
  );
  const maxY = Math.max(
    ...boundsList.map((bounds) => bounds.y + bounds.heightMeters),
  );
  return {
    heightMeters: maxY - minY,
    widthMeters: maxX - minX,
    x: minX,
    y: minY,
  };
};

type CloudActiveSceneLock = {
  baseVersion: number;
  expiresAt: string | null;
  lockToken: string;
  sceneId: string;
};

type CloudActiveProjectLock = {
  baseVersion: number;
  expiresAt: string | null;
  lockKey: CloudProjectLockKey;
  lockToken: string;
};

type CloudActiveCellLock = {
  baseVersion: number;
  cellId: string;
  holderClientId: string | null;
  expiresAt: string | null;
  leaseId: string | null;
  lockToken: string;
  operationId: string | null;
  patchType: CloudSceneCellPatchType;
  sceneId: string;
  targetId: string;
};

type CloudActiveProjectState = {
  activeProjectLock: CloudActiveProjectLock | null;
  activeSceneLock: CloudActiveSceneLock | null;
  projectId: string;
  resourceVersions: Partial<Record<CloudResourceKey, number>>;
  role: CloudPermissionRole;
  sceneCellVersions: Record<string, number>;
  sceneVersions: Record<string, number>;
  title: string;
  updatedAt?: string;
};

const CLOUD_RESOURCE_LABELS: Record<CloudProjectLockKey, string> = {
  audio: "音源設定",
  import: "クラウド上書き",
  members: "メンバー名簿",
  objects: "道具マスター",
  sceneOrder: "シーン構成",
  settings: "全体設定",
};

const CLOUD_OWNER_RESOURCE_KEYS: CloudResourceKey[] = [
  "settings",
  "members",
  "objects",
  "audio",
  "sceneOrder",
];

const getSceneCellPatchType = (
  target: SceneElementEditTarget,
): CloudSceneCellPatchType => {
  if (target.type === "member-position") return "member_position";
  if (target.type === "member-visibility") return "member_visibility";
  if (target.type === "object-visibility") return "object_visibility";
  if (target.type === "object-assignment") return "object_assignment";
  if (target.type === "notes") return "notes";
  return "object_state";
};

const getSceneCellPatchSummary = (
  patchType: CloudSceneCellPatchType,
): string => {
  if (patchType === "member_position") return "member position patch";
  if (patchType === "member_visibility") return "member visibility patch";
  if (patchType === "object_visibility") return "object visibility patch";
  if (patchType === "object_assignment") return "object assignment patch";
  if (patchType === "notes") return "scene notes patch";
  return "object state patch";
};

const OWNER_TAKEOVER_WAIT_MS = 10_000;
const OWNER_TAKEOVER_POLL_MS = 1_000;
const CLOUD_STALE_SCENE_CELL_LOCK_ACTIVITY_MS = 45_000;

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

type CloudPendingUpdate = CloudSaveNotification & {
  label: string;
};

type CloudMemberPositionPreview = {
  holderClientId: string;
  leaseId: string;
  memberId: string;
  operationId: string;
  position: Position;
  sceneId: string;
  sentAt: string;
  seq: number;
};

type CloudObjectStatePreview = {
  holderClientId: string;
  leaseId: string;
  objectId: string;
  operationId: string;
  sceneId: string;
  sentAt: string;
  seq: number;
  state: ObjectState;
};

const CLOUD_PREVIEW_SEND_INTERVAL_MS = 80;

const getCloudMemberPositionPreviewKey = (
  sceneId: string,
  memberId: string,
): string => `${sceneId}:member_position:${memberId}`;

const getCloudObjectStatePreviewKey = (
  sceneId: string,
  objectId: string,
): string => `${sceneId}:object_state:${objectId}`;

const readPreviewPosition = (value: unknown): Position | null => {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Position).x !== "number" ||
    typeof (value as Position).y !== "number"
  ) {
    return null;
  }
  return {
    x: (value as Position).x,
    y: (value as Position).y,
  };
};

const readPreviewObjectState = (value: unknown): ObjectState | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const state = value as ObjectState;
  if (
    typeof state.objectId !== "string" ||
    typeof state.x !== "number" ||
    typeof state.y !== "number" ||
    typeof state.widthMeters !== "number" ||
    typeof state.heightMeters !== "number" ||
    typeof state.rotation !== "number" ||
    typeof state.visible !== "boolean" ||
    typeof state.zIndex !== "number"
  ) {
    return null;
  }
  return state;
};

const doesCloudLockMatchMemberPreview = (
  lock: CloudActiveLockSummary,
  preview: Pick<
    CloudMemberPositionPreview,
    "holderClientId" | "leaseId" | "memberId" | "operationId" | "sceneId"
  >,
): boolean => {
  if (lock.targetType !== "scene_cell") {
    return false;
  }
  const parsed = parseSceneCellLockTargetId(lock.targetId);
  return Boolean(
    parsed &&
      parsed.sceneId === preview.sceneId &&
      parsed.patchType === "member_position" &&
      parsed.cellId === preview.memberId &&
      lock.leaseId === preview.leaseId &&
      lock.operationId === preview.operationId &&
      lock.holderClientId === preview.holderClientId,
  );
};

const doesCloudLockMatchObjectPreview = (
  lock: CloudActiveLockSummary,
  preview: Pick<
    CloudObjectStatePreview,
    "holderClientId" | "leaseId" | "objectId" | "operationId" | "sceneId"
  >,
): boolean => {
  if (lock.targetType !== "scene_cell") {
    return false;
  }
  const parsed = parseSceneCellLockTargetId(lock.targetId);
  return Boolean(
    parsed &&
      parsed.sceneId === preview.sceneId &&
      parsed.patchType === "object_state" &&
      parsed.cellId === preview.objectId &&
      lock.leaseId === preview.leaseId &&
      lock.operationId === preview.operationId &&
      lock.holderClientId === preview.holderClientId,
  );
};

const readCloudDisplayName = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("@") || trimmed === "名前未設定") {
    return null;
  }
  return trimmed;
};

const readIsoTime = (value: string | null | undefined): number | null => {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
};

const isCloudActiveLockFresh = (
  lock: Pick<CloudActiveLockSummary, "expiresAt">,
  now = Date.now(),
): boolean => {
  const expiresAt = readIsoTime(lock.expiresAt);
  return expiresAt !== null && expiresAt > now;
};

const isCloudSceneCellLockStale = (
  lock: CloudActiveLockSummary,
  now = Date.now(),
): boolean => {
  if (lock.targetType !== "scene_cell") {
    return false;
  }
  const lastActivityAt =
    readIsoTime(lock.lastActivityAt) ??
    readIsoTime(lock.renewedAt) ??
    readIsoTime(lock.lastHeartbeatAt) ??
    readIsoTime(lock.lockedAt);
  return (
    lastActivityAt !== null &&
    now - lastActivityAt > CLOUD_STALE_SCENE_CELL_LOCK_ACTIVITY_MS
  );
};

const formatCloudPresenceNames = (names: string[]): string => {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  if (uniqueNames.length <= 2) {
    return uniqueNames.join("、");
  }
  return `${uniqueNames.slice(0, 2).join("、")}ほか${uniqueNames.length - 2}人`;
};

const readCloudInviteTokenFromLocation = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash.startsWith("cloudInvite=")) {
    return null;
  }
  const token = hash.slice("cloudInvite=".length);
  return token ? decodeURIComponent(token) : null;
};

const clearCloudInviteHash = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash.startsWith("cloudInvite=")) {
    return;
  }
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
};

const stripCloudEditableSceneFields = (
  frame: FormationFrame,
): Omit<
  FormationFrame,
  | "groupVisibility"
  | "memberAppearanceOverrides"
  | "memberVisibility"
  | "notes"
  | "objectAssignments"
  | "objectStates"
  | "positions"
  | "sceneViewState"
  | "stageDepthMeters"
  | "stageWidthMeters"
> => {
  const {
    groupVisibility,
    memberAppearanceOverrides,
    memberVisibility,
    notes,
    objectAssignments,
    objectStates,
    positions,
    sceneViewState,
    stageDepthMeters,
    stageWidthMeters,
    ...rest
  } = frame;
  void groupVisibility;
  void memberAppearanceOverrides;
  void memberVisibility;
  void notes;
  void objectAssignments;
  void objectStates;
  void positions;
  void sceneViewState;
  void stageDepthMeters;
  void stageWidthMeters;
  return rest;
};

const stripCloudSceneOnlyProjectGuard = (
  project: Project,
  sceneId: string,
): unknown => {
  const { lastOpenedAt, updatedAt, ...rest } = project;
  void lastOpenedAt;
  void updatedAt;
  return {
    ...rest,
    frames: project.frames.map((frame) =>
      frame.id === sceneId ? stripCloudEditableSceneFields(frame) : frame,
    ),
  };
};

const isCloudSceneOnlyProjectChange = (
  previous: Project,
  nextProject: Project,
  sceneId: string,
): boolean =>
  JSON.stringify(stripCloudSceneOnlyProjectGuard(previous, sceneId)) ===
  JSON.stringify(stripCloudSceneOnlyProjectGuard(nextProject, sceneId));

const stripCloudSceneCellProjectGuard = (
  project: Project,
  lock: CloudActiveCellLock,
): unknown => {
  const { lastOpenedAt, updatedAt, ...rest } = project;
  void lastOpenedAt;
  void updatedAt;
  return {
    ...rest,
    frames: project.frames.map((frame) => {
      if (frame.id !== lock.sceneId) {
        return frame;
      }
      if (lock.patchType === "member_position") {
        const { [lock.cellId]: _ignored, ...positions } = frame.positions;
        void _ignored;
        return { ...frame, positions };
      }
      if (lock.patchType === "object_state") {
        const { [lock.cellId]: _ignored, ...objectStates } = frame.objectStates;
        void _ignored;
        return { ...frame, objectStates };
      }
      if (lock.patchType === "member_visibility") {
        const visibility = { ...(frame.memberVisibility ?? {}) };
        delete visibility[lock.cellId];
        return { ...frame, memberVisibility: visibility };
      }
      if (lock.patchType === "object_visibility") {
        const objectState = frame.objectStates[lock.cellId];
        const objectStates = {
          ...frame.objectStates,
          [lock.cellId]: objectState
            ? { ...objectState, visible: undefined }
            : objectState,
        };
        return { ...frame, objectStates };
      }
      if (lock.patchType === "object_assignment") {
        const assignments = { ...(frame.objectAssignments ?? {}) };
        delete assignments[lock.cellId];
        return { ...frame, objectAssignments: assignments };
      }
      const { notes, ...frameRest } = frame;
      void notes;
      return frameRest;
    }),
  };
};

const stripCloudSceneCellsProjectGuard = (
  project: Project,
  locks: CloudActiveCellLock[],
): unknown => {
  const { lastOpenedAt, updatedAt, ...rest } = project;
  void lastOpenedAt;
  void updatedAt;
  return locks.reduce<unknown>(
    (guardedProject, lock) =>
      stripCloudSceneCellProjectGuard(guardedProject as Project, lock),
    rest as Project,
  );
};

const isCloudSceneCellsOnlyProjectChange = (
  previous: Project,
  nextProject: Project,
  locks: CloudActiveCellLock[],
): boolean =>
  locks.length > 0 &&
  JSON.stringify(stripCloudSceneCellsProjectGuard(previous, locks)) ===
    JSON.stringify(stripCloudSceneCellsProjectGuard(nextProject, locks));

const stripCloudSettingsResourceGuard = (project: Project): unknown => {
  const {
    animationSettings,
    focusMemberId,
    guideSettings,
    lastOpenedAt,
    mode,
    paradeSettings,
    stage,
    updatedAt,
    useGlobalStageSize,
    useGlobalStageWidth,
    viewerPerspective,
    ...rest
  } = project;
  void animationSettings;
  void focusMemberId;
  void guideSettings;
  void lastOpenedAt;
  void mode;
  void paradeSettings;
  void stage;
  void updatedAt;
  void useGlobalStageSize;
  void useGlobalStageWidth;
  void viewerPerspective;
  return rest;
};

const stripCloudMembersResourceGuard = (project: Project): unknown => {
  const { lastOpenedAt, memberGroups, members, updatedAt, ...rest } = project;
  void lastOpenedAt;
  void memberGroups;
  void members;
  void updatedAt;
  return rest;
};

const stripCloudObjectsResourceGuard = (project: Project): unknown => {
  const { lastOpenedAt, objectGroups, stageObjects, updatedAt, ...rest } =
    project;
  void lastOpenedAt;
  void objectGroups;
  void stageObjects;
  void updatedAt;
  return rest;
};

const stripCloudAudioResourceGuard = (project: Project): unknown => {
  const { audio, lastOpenedAt, updatedAt, ...rest } = project;
  void audio;
  void lastOpenedAt;
  void updatedAt;
  return rest;
};

const getComparableCommonSceneData = (
  leftProject: Project,
  rightProject: Project,
): unknown => {
  const leftFramesById = new Map(
    leftProject.frames.map((frame) => [frame.id, frame]),
  );
  const rightFrameIds = new Set(rightProject.frames.map((frame) => frame.id));
  return [...leftFramesById.entries()]
    .filter(([frameId]) => rightFrameIds.has(frameId))
    .map(([frameId, frame]) => ({
      data: extractCloudSceneData(frame),
      id: frameId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const stripCloudSceneOrderResourceGuard = (
  previous: Project,
  nextProject: Project,
): { previous: unknown; next: unknown } => {
  const strip = (project: Project) => {
    const {
      frames,
      lastOpenedAt,
      movementPaths,
      movementPlans,
      updatedAt,
      ...rest
    } = project;
    void frames;
    void lastOpenedAt;
    void movementPaths;
    void movementPlans;
    void updatedAt;
    return rest;
  };

  return {
    next: {
      project: strip(nextProject),
      sceneData: getComparableCommonSceneData(nextProject, previous),
    },
    previous: {
      project: strip(previous),
      sceneData: getComparableCommonSceneData(previous, nextProject),
    },
  };
};

const isCloudProjectResourceOnlyChange = (
  previous: Project,
  nextProject: Project,
  resourceKey: CloudResourceKey,
): boolean => {
  if (resourceKey === "settings") {
    return (
      JSON.stringify(stripCloudSettingsResourceGuard(previous)) ===
      JSON.stringify(stripCloudSettingsResourceGuard(nextProject))
    );
  }
  if (resourceKey === "members") {
    return (
      JSON.stringify(stripCloudMembersResourceGuard(previous)) ===
      JSON.stringify(stripCloudMembersResourceGuard(nextProject))
    );
  }
  if (resourceKey === "objects") {
    return (
      JSON.stringify(stripCloudObjectsResourceGuard(previous)) ===
      JSON.stringify(stripCloudObjectsResourceGuard(nextProject))
    );
  }
  if (resourceKey === "audio") {
    return (
      JSON.stringify(stripCloudAudioResourceGuard(previous)) ===
      JSON.stringify(stripCloudAudioResourceGuard(nextProject))
    );
  }
  const guarded = stripCloudSceneOrderResourceGuard(previous, nextProject);
  return JSON.stringify(guarded.previous) === JSON.stringify(guarded.next);
};

const createCloudVersionMaps = (
  parts: CloudProjectParts,
): Pick<CloudActiveProjectState, "resourceVersions" | "sceneVersions"> => ({
  resourceVersions: Object.fromEntries(
    Object.entries(parts.resources).map(([key, resource]) => [
      key,
      resource?.version ?? 1,
    ]),
  ) as Partial<Record<CloudResourceKey, number>>,
  sceneVersions: Object.fromEntries(
    parts.scenes.map((scene) => [scene.sceneId, scene.version]),
  ),
});

const createCloudSceneCellVersionMap = (
  versions: CloudSceneCellVersion[],
): Record<string, number> =>
  Object.fromEntries(
    versions.map((item) => [
      createSceneCellVersionKey(item.sceneId, item.cellKind, item.cellId),
      item.version,
    ]),
  );

function App() {
  const workspaceLayout = useWorkspaceLayout();
  const initial = useMemo(readInitialProject, []);
  const [project, setProject] = useState<Project>(initial.project);
  const [savedProjects, setSavedProjects] = useState<Project[]>(initial.projects);
  const [appView, setAppView] = useState<"library" | "editor">(
    initial.shared ? "editor" : "library",
  );
  // View-only stage navigation never enters Project or cloud scene writes.
  const stageViewMemoryRef = useRef({ projectId: project.id, appView, views: new Map<string, SceneViewState>() });
  if (stageViewMemoryRef.current.projectId !== project.id || stageViewMemoryRef.current.appView !== appView) {
    stageViewMemoryRef.current = { projectId: project.id, appView, views: new Map() };
  }
  const stageViewStates = stageViewMemoryRef.current.views;
  const cloudConfig = useMemo(getCloudConfig, []);
  const [cloudSession, setCloudSession] = useState<CloudAuthSession | null>(
    () => readCloudAuthSession(),
  );
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [isCloudBusy, setIsCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [isCloudPasswordRecoveryOpen, setIsCloudPasswordRecoveryOpen] =
    useState(false);
  const [activeCloudProject, setActiveCloudProject] =
    useState<CloudActiveProjectState | null>(null);
  const [cloudActiveLocks, setCloudActiveLocks] = useState<CloudActiveLockSummary[]>([]);
  const [cloudMemberPositionPreviews, setCloudMemberPositionPreviews] =
    useState<Record<string, CloudMemberPositionPreview>>({});
  const [cloudObjectStatePreviews, setCloudObjectStatePreviews] =
    useState<Record<string, CloudObjectStatePreview>>({});
  const [cloudCollaborationItems, setCloudCollaborationItems] = useState<
    CloudCollaborationItem[]
  >([]);
  const [cloudContacts, setCloudContacts] = useState<CloudContactItem[]>([]);
  const [cloudPendingUpdates, setCloudPendingUpdates] = useState<
    CloudPendingUpdate[]
  >([]);
  const [cloudPresenceItems, setCloudPresenceItems] = useState<
    CloudProjectPresence[]
  >([]);
  const [activeCloudCellLocks, setActiveCloudCellLocks] = useState<
    CloudActiveCellLock[]
  >([]);
  const [cloudInviteToken, setCloudInviteToken] = useState<string | null>(
    () => readCloudInviteTokenFromLocation(),
  );
  const [isCloudHelpOpen, setIsCloudHelpOpen] = useState(false);
  const [isCloudShareOpen, setIsCloudShareOpen] = useState(false);
  const [isSharedProject, setIsSharedProject] = useState(initial.shared);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(
    initial.project.frames[0]?.id ?? null,
  );
  const [selected, setSelected] = useState<Selection>(null);
  const [mode, setMode] = useState<EditingMode>("members");
  const [activePanelTab, setActivePanelTab] = useState<PanelTabId>("members");
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isStageFullscreen, setIsStageFullscreen] = useState(false);
  const [isShareExportOpen, setIsShareExportOpen] = useState(false);
  const [completedExport, setCompletedExport] = useState<CompletedExport | null>(null);
  const [canCopyExport, setCanCopyExport] = useState(false);
  const exportGenerationPending = useRef(false);
  const [isRosterManagerOpen, setIsRosterManagerOpen] = useState(false);
  const [rosterInitialMode, setRosterInitialMode] = useState<
    "members" | "objects" | undefined
  >();
  const [appConfirm, setAppConfirm] = useState<AppConfirmOptions | null>(null);
  const [exportProgress, setExportProgress] =
    useState<ExportProgressState | null>(null);
  const [cloudSceneOrderSaveStatus, setCloudSceneOrderSaveStatus] =
    useState<CloudSceneOrderSaveStatus | null>(null);
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [printScope, setPrintScope] = useState<"all" | "current">("all");
  const [printOptions, setPrintOptions] = useState<ShareExportOptions | null>(
    null,
  );
  const [printVariant, setPrintVariant] = useState<
    "document" | "stage-only"
  >("document");
  const [isPrintPreviewMounted, setIsPrintPreviewMounted] = useState(false);
  const [isSceneThumbnailRailCollapsed, setIsSceneThumbnailRailCollapsed] =
    useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const visibilityMemories = useMemo(() => ({ members: createVisibilityMemory(), objects: createVisibilityMemory() }), [project.id]);
  const [isMemberSelectionMode, setIsMemberSelectionMode] = useState(false);
  const [memberVisibilityTab, setMemberVisibilityTab] =
    useState<PanelVisibilityTab>("visible");
  const [objectVisibilityTab, setObjectVisibilityTab] =
    useState<PanelVisibilityTab>("visible");
  const [panelScrollTarget, setPanelScrollTarget] =
    useState<PanelScrollTarget | null>(null);
  const [viewerPerspective, setViewerPerspective] = useState<ViewerPerspective>(
    initial.project.viewerPerspective ?? "audience",
  );
  const [showMovementPaths, setShowMovementPaths] = useState(false);
  const [showMeterRulers, setShowMeterRulers] = useState(true);
  const movementPathMode: MovementPathMode = "all";
  const [templateSpacing, setTemplateSpacing] = useState(1.5);
  const [animationPreviewTimeSec, setAnimationPreviewTimeSec] =
    useState<number | null>(null);
  const [animationPreviewTarget, setAnimationPreviewTarget] =
    useState<AnimationPreviewTarget | null>(null);
  const [previewUseActualDuration, setPreviewUseActualDuration] =
    useState(false);
  const [transitionPreviewSpeed, setTransitionPreviewSpeed] = useState(1);
  const { notice, notification, setNotice, dismissNotice } = useNotice(initial.error);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sharedAudioNotice, setSharedAudioNotice] = useState(initial.shared);
  const [isPlaying, setIsPlaying] = useState(false);
  const canvasPlaybackRef = useRef(false);
  canvasPlaybackRef.current = isPlaying || animationPreviewTimeSec !== null;
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(0);
  const [clipboard, setClipboard] = useState<InternalClipboard | null>(null);
  const [contextMenu, setContextMenu] =
    useState<StageContextMenuRequest | null>(null);
  const [contextMenuPosition, setContextMenuPosition] =
    useState<FloatingMenuPosition | null>(null);
  const [sceneContextMenu, setSceneContextMenu] =
    useState<SceneContextMenu | null>(null);
  const [sceneContextMenuPosition, setSceneContextMenuPosition] =
    useState<FloatingMenuPosition | null>(null);
  const [memberColorEditor, setMemberColorEditor] =
    useState<MemberColorEditor | null>(null);
  const [memberColorEditorPosition, setMemberColorEditorPosition] =
    useState<FloatingMenuPosition | null>(null);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const historyBatchRef = useRef<{ label?: string } | null>(null);
  const isProjectEditBatchActiveRef = useRef(false);
  const lastHistoryPushRef = useRef<{ label?: string; time: number } | null>(
    null,
  );
  const lastStagePointerPositionRef = useRef<Position | null>(null);
  const projectRef = useRef(project);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restoredAudioKeyRef = useRef<string | null>(null);
  const stageExportRef = useRef<StageExportElement | null>(null);
  const printExportRef = useRef<HTMLDivElement | null>(null);
  const cloudImportInputRef = useRef<HTMLInputElement | null>(null);
  const appConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const cloudSceneOrderSaveTimerRef = useRef<number | null>(null);
  const cloudSceneOrderStatusTimerRef = useRef<number | null>(null);
  const stageFullscreenRef = useRef<HTMLDivElement | null>(null);
  const animationPreviewRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const sceneContextMenuRef = useRef<HTMLDivElement | null>(null);
  const memberColorEditorRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const pendingAutoSaveProjectRef = useRef<Project | null>(null);
  const personalCloudDraftTimerRef = useRef<number | null>(null);
  const activeCloudProjectRef = useRef<CloudActiveProjectState | null>(null);
  const cloudRealtimeSubscriptionRef =
    useRef<CloudRealtimeSubscription | null>(null);
  const cloudActiveLocksRef = useRef<CloudActiveLockSummary[]>([]);
  const cloudPreviewLastSentAtRef = useRef<Record<string, number>>({});
  const cloudPreviewSeqByOperationRef = useRef<Record<string, number>>({});
  const cloudLockActivityRef = useRef(false);
  const cloudProjectLockActivityRef = useRef(false);
  const activeCloudCellLocksRef = useRef<CloudActiveCellLock[]>([]);
  const ownerAutoSceneLockKeyRef = useRef<string | null>(null);
  const ownerSceneSwitchKeyRef = useRef<string | null>(null);
  const cloudSessionRef = useRef<CloudAuthSession | null>(cloudSession);
  const isCloudBusyRef = useRef(isCloudBusy);
  const isCloudShareOpenRef = useRef(isCloudShareOpen);
  const isDirtyRef = useRef(isDirty);
  const selectedFrameIdRef = useRef<string | null>(selectedFrameId);

  useEffect(() => {
    document.title =
      appView === "editor" && project.title
        ? `${project.title} - ${APP_NAME}`
        : APP_NAME;
  }, [appView, project.title]);

  useEffect(() => {
    if (!APP_FEATURES.nativeFileShare || initial.shared) {
      return undefined;
    }
    let cancelled = false;
    void hydrateProjectsFromNativeStorage()
      .then((projects) => {
        if (!cancelled && projects) {
          setSavedProjects(projects.map(normalizeProject));
        }
      })
      .catch((error) => {
        console.warn("iPadのローカル隊列表を復元できませんでした。", error);
      });
    return () => {
      cancelled = true;
    };
  }, [initial.shared]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    activeCloudProjectRef.current = activeCloudProject;
    if (!activeCloudProject) {
      activeCloudCellLocksRef.current = [];
      setActiveCloudCellLocks([]);
    }
  }, [activeCloudProject]);

  useEffect(() => {
    activeCloudCellLocksRef.current = activeCloudCellLocks;
  }, [activeCloudCellLocks]);

  useEffect(() => {
    cloudActiveLocksRef.current = cloudActiveLocks;
  }, [cloudActiveLocks]);

  useEffect(() => {
    if (!activeCloudProject) {
      setCloudMemberPositionPreviews({});
      setCloudObjectStatePreviews({});
      return;
    }
    setCloudMemberPositionPreviews((previous) => {
      const entries = Object.entries(previous).filter(([, preview]) =>
        cloudActiveLocks.some((lock) =>
          doesCloudLockMatchMemberPreview(lock, preview),
        ),
      );
      if (entries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(entries);
    });
    setCloudObjectStatePreviews((previous) => {
      const entries = Object.entries(previous).filter(([, preview]) =>
        cloudActiveLocks.some((lock) =>
          doesCloudLockMatchObjectPreview(lock, preview),
        ),
      );
      if (entries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(entries);
    });
  }, [activeCloudProject?.projectId, cloudActiveLocks]);

  useEffect(() => {
    cloudSessionRef.current = cloudSession;
  }, [cloudSession]);

  useEffect(() => {
    isCloudBusyRef.current = isCloudBusy;
  }, [isCloudBusy]);

  useEffect(() => {
    isCloudShareOpenRef.current = isCloudShareOpen;
  }, [isCloudShareOpen]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    selectedFrameIdRef.current = selectedFrameId;
  }, [selectedFrameId]);

  const closeAppConfirm = useCallback((confirmed: boolean) => {
    appConfirmResolverRef.current?.(confirmed);
    appConfirmResolverRef.current = null;
    setAppConfirm(null);
  }, []);

  const requestAppConfirm = useCallback(
    (options: AppConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        appConfirmResolverRef.current?.(false);
        appConfirmResolverRef.current = resolve;
        setAppConfirm(options);
      }),
    [],
  );

  const clearCloudSceneOrderAutoSave = useCallback(() => {
    if (cloudSceneOrderSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSceneOrderSaveTimerRef.current);
      cloudSceneOrderSaveTimerRef.current = null;
    }
  }, []);

  const clearCloudSceneOrderStatusTimer = useCallback(() => {
    if (cloudSceneOrderStatusTimerRef.current !== null) {
      window.clearTimeout(cloudSceneOrderStatusTimerRef.current);
      cloudSceneOrderStatusTimerRef.current = null;
    }
  }, []);

  const showCloudSceneOrderSaveStatus = useCallback(
    (status: CloudSceneOrderSaveStatus["status"], label: string) => {
      clearCloudSceneOrderStatusTimer();
      setCloudSceneOrderSaveStatus({ label, status });
      if (status === "saved") {
        cloudSceneOrderStatusTimerRef.current = window.setTimeout(() => {
          setCloudSceneOrderSaveStatus((current) =>
            current?.status === "saved" && current.label === label ? null : current,
          );
          cloudSceneOrderStatusTimerRef.current = null;
        }, 2500);
      }
    },
    [clearCloudSceneOrderStatusTimer],
  );

  useEffect(() => {
    if (!appConfirm) {
      return undefined;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeAppConfirm(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [appConfirm, closeAppConfirm]);

  useEffect(
    () => () => {
      clearCloudSceneOrderAutoSave();
      clearCloudSceneOrderStatusTimer();
    },
    [clearCloudSceneOrderAutoSave, clearCloudSceneOrderStatusTimer],
  );

  useEffect(() => {
    if (!activeCloudProject || activeCloudProject.role !== "owner") {
      clearCloudSceneOrderStatusTimer();
      setCloudSceneOrderSaveStatus(null);
    }
  }, [
    activeCloudProject?.projectId,
    activeCloudProject?.role,
    clearCloudSceneOrderStatusTimer,
  ]);

  useEffect(() => {
    if (!isSearchDialogOpen) {
      return undefined;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSearchDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchDialogOpen]);

  const setAudioSource = useCallback(
    (url: string | null, name: string | null) => {
      setAudioUrl((previous) => {
        if (previous && previous !== url) {
          URL.revokeObjectURL(previous);
        }
        return url;
      });
      setAudioName(name);
      if (audioRef.current) {
        if (url) {
          audioRef.current.src = url;
          audioRef.current.load();
          audioRef.current.playbackRate = playbackRate;
        } else {
          audioRef.current.removeAttribute("src");
          audioRef.current.load();
        }
      }
      if (!url) {
        setDuration(0);
        setCurrentTime(0);
        setIsPlaying(false);
      }
    },
    [playbackRate],
  );

  const restoreAudioForProject = useCallback(
    async (targetProject: Project) => {
      const meta = targetProject.audio;
      if (!meta?.id) {
        setAudioSource(null, null);
        setSharedAudioNotice(false);
        return true;
      }
      const blob = await loadAudioBlobFromIndexedDb(meta.id);
      if (!blob) {
        setAudioSource(null, meta.name);
        setSharedAudioNotice(true);
        setNotice("保存済み音源が見つかりませんでした。必要なら音源を読み込み直してください。");
        return false;
      }
      const url = URL.createObjectURL(blob);
      setAudioSource(url, meta.name);
      setSharedAudioNotice(false);
      return true;
    },
    [setAudioSource, setNotice],
  );

  const refreshHistoryCounts = useCallback(() => {
    setHistoryCounts({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
  }, []);

  const pushUndoSnapshot = useCallback((source: Project, label?: string) => {
    undoStackRef.current = [
      ...undoStackRef.current,
      { project: cloneProject(source), label },
    ].slice(-HISTORY_LIMIT);
    redoStackRef.current = [];
    lastHistoryPushRef.current = { label, time: Date.now() };
  }, []);

  const allowCloudProjectChange = useCallback(
    (previous: Project, nextProject: Project): boolean => {
      const cloudState = activeCloudProjectRef.current;
      if (!cloudState) {
        return true;
      }
      if (!APP_FEATURES.collaboration && cloudState.role === "owner") {
        return true;
      }
      const activeProjectLock = cloudState.activeProjectLock;
      if (activeProjectLock) {
        if (
          activeProjectLock.lockKey !== "import" &&
          isCloudProjectResourceOnlyChange(
            previous,
            nextProject,
            activeProjectLock.lockKey,
          )
        ) {
          cloudProjectLockActivityRef.current = true;
          return true;
        }
        setNotice(
          `${CLOUD_RESOURCE_LABELS[activeProjectLock.lockKey]}の編集中です。このロックでは他の全体データやシーンは変更できません。`,
        );
        return false;
      }
      const sceneId = selectedFrameIdRef.current;
      const activeLock = cloudState.activeSceneLock;
      const matchingCellLocks = activeCloudCellLocksRef.current.filter(
        (cellLock) => cellLock.sceneId === sceneId,
      );
      if (
        isCloudSceneCellsOnlyProjectChange(
          previous,
          nextProject,
          matchingCellLocks,
        )
      ) {
        cloudLockActivityRef.current = true;
        return true;
      }
      if (!sceneId || !activeLock || activeLock.sceneId !== sceneId) {
        setNotice("この操作はまだセル単位共同編集に対応していません。対象の編集ロックを取得してください。");
        return false;
      }
      if (!isCloudSceneOnlyProjectChange(previous, nextProject, activeLock.sceneId)) {
        setNotice(
          "初期クラウド編集では、シーン内の配置・表示・メモだけ編集できます。全体設定や名簿は後続対応です。",
        );
        return false;
      }
      cloudLockActivityRef.current = true;
      return true;
    },
    [],
  );

  const allowCloudLockedSceneChange = useCallback(
    (previous: Project, nextProject: Project): boolean => {
      const cloudState = activeCloudProjectRef.current;
      if (!cloudState) {
        return true;
      }
      if (!APP_FEATURES.collaboration && cloudState.role === "owner") {
        return true;
      }
      const activeProjectLock = cloudState.activeProjectLock;
      if (activeProjectLock) {
        if (
          activeProjectLock.lockKey !== "import" &&
          isCloudProjectResourceOnlyChange(
            previous,
            nextProject,
            activeProjectLock.lockKey,
          )
        ) {
          cloudProjectLockActivityRef.current = true;
          return true;
        }
        setNotice(
          `${CLOUD_RESOURCE_LABELS[activeProjectLock.lockKey]}の編集中です。このロックでは他の全体データやシーンは変更できません。`,
        );
        return false;
      }
      const activeLock = cloudState.activeSceneLock;
      if (
        isCloudSceneCellsOnlyProjectChange(
          previous,
          nextProject,
          activeCloudCellLocksRef.current,
        )
      ) {
        cloudLockActivityRef.current = true;
        return true;
      }
      if (!activeLock) {
        setNotice("クラウド共同編集では、この操作の編集ロックを取得してから変更します。");
        return false;
      }
      if (!isCloudSceneOnlyProjectChange(previous, nextProject, activeLock.sceneId)) {
        setNotice(
          "初期クラウド編集では、シーン内の配置・表示・メモだけ編集できます。全体設定や名簿は後続対応です。",
        );
        return false;
      }
      cloudLockActivityRef.current = true;
      return true;
    },
    [],
  );

  const updateProject = useCallback(
    (
      recipe: (previous: Project) => Project,
      label?: string,
      options: { coalesceHistory?: boolean } = {},
    ) => {
      const previous = projectRef.current;
      const nextProject = recipe(previous);
      if (nextProject === previous) {
        return;
      }
      if (!allowCloudProjectChange(previous, nextProject)) {
        return;
      }
      if (
        (!activeCloudProjectRef.current || !APP_FEATURES.collaboration) &&
        !historyBatchRef.current
      ) {
        const lastHistoryPush = lastHistoryPushRef.current;
        const shouldCoalesce =
          options.coalesceHistory !== false &&
          Boolean(label) &&
          undoStackRef.current.length > 0 &&
          lastHistoryPush !== null &&
          lastHistoryPush.label === label &&
          Date.now() - lastHistoryPush.time < HISTORY_COALESCE_MS;
        if (!shouldCoalesce) {
          pushUndoSnapshot(previous, label);
        } else {
          lastHistoryPushRef.current = { label, time: Date.now() };
          redoStackRef.current = [];
        }
      }
      const withUpdatedAt = {
        ...nextProject,
        updatedAt: new Date().toISOString(),
      };
      projectRef.current = withUpdatedAt;
      setProject(withUpdatedAt);
      setIsDirty(true);
      refreshHistoryCounts();
    },
    [allowCloudProjectChange, pushUndoSnapshot, refreshHistoryCounts],
  );

  const replaceProjectWithHistory = useCallback(
    (nextProject: Project, label?: string) => {
      if (!allowCloudLockedSceneChange(projectRef.current, nextProject)) {
        return;
      }
      pushUndoSnapshot(projectRef.current, label);
      projectRef.current = nextProject;
      setProject(nextProject);
      setIsDirty(true);
      refreshHistoryCounts();
    },
    [allowCloudLockedSceneChange, pushUndoSnapshot, refreshHistoryCounts],
  );

  const undoProject = useCallback(() => {
    const entry = undoStackRef.current[undoStackRef.current.length - 1];
    if (!entry) {
      return;
    }
    const nextProject = cloneProject(entry.project);
    if (!allowCloudLockedSceneChange(projectRef.current, nextProject)) {
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [
      ...redoStackRef.current,
      { project: cloneProject(projectRef.current), label: entry.label },
    ].slice(-HISTORY_LIMIT);
    historyBatchRef.current = null;
    isProjectEditBatchActiveRef.current = false;
    lastHistoryPushRef.current = null;
    projectRef.current = nextProject;
    setProject(nextProject);
    setIsDirty(true);
    refreshHistoryCounts();
    setNotice(entry.label ? `${entry.label}を元に戻しました。` : "元に戻しました。", "success");
  }, [allowCloudLockedSceneChange, refreshHistoryCounts]);

  const redoProject = useCallback(() => {
    const entry = redoStackRef.current[redoStackRef.current.length - 1];
    if (!entry) {
      return;
    }
    const nextProject = cloneProject(entry.project);
    if (!allowCloudLockedSceneChange(projectRef.current, nextProject)) {
      return;
    }
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current,
      { project: cloneProject(projectRef.current), label: entry.label },
    ].slice(-HISTORY_LIMIT);
    historyBatchRef.current = null;
    isProjectEditBatchActiveRef.current = false;
    lastHistoryPushRef.current = null;
    projectRef.current = nextProject;
    setProject(nextProject);
    setIsDirty(true);
    refreshHistoryCounts();
    setNotice(entry.label ? `${entry.label}をやり直しました。` : "やり直しました。", "success");
  }, [allowCloudLockedSceneChange, refreshHistoryCounts]);

  const clearPendingAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    pendingAutoSaveProjectRef.current = null;
  }, []);

  const flushPendingAutoSave = useCallback(() => {
    if (appView !== "editor" || isSharedProject || activeCloudProjectRef.current) {
      clearPendingAutoSave();
      return;
    }
    const targetProject = pendingAutoSaveProjectRef.current;
    if (!targetProject) {
      return;
    }
    clearPendingAutoSave();
    try {
      saveProjectToStorage(targetProject);
      setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
      if (projectRef.current.updatedAt === targetProject.updatedAt) {
        setIsDirty(false);
      }
    } catch (error) {
      console.error("自動保存に失敗しました。", error);
      setIsDirty(true);
      setNotice("自動保存に失敗しました。保存ボタンで再度保存してください。");
    }
  }, [appView, clearPendingAutoSave, isSharedProject]);

  useEffect(() => {
    if (appView !== "editor" || isSharedProject || activeCloudProject) {
      clearPendingAutoSave();
      return;
    }
    pendingAutoSaveProjectRef.current = project;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (isProjectEditBatchActiveRef.current) {
      return;
    }
    autoSaveTimerRef.current = window.setTimeout(flushPendingAutoSave, 800);
  }, [
    appView,
    activeCloudProject,
    clearPendingAutoSave,
    flushPendingAutoSave,
    isSharedProject,
    project,
  ]);

  useEffect(() => {
    if (
      APP_FEATURES.collaboration ||
      appView !== "editor" ||
      !activeCloudProject ||
      activeCloudProject.role !== "owner" ||
      !isDirty
    ) {
      if (personalCloudDraftTimerRef.current !== null) {
        window.clearTimeout(personalCloudDraftTimerRef.current);
        personalCloudDraftTimerRef.current = null;
      }
      return undefined;
    }
    if (personalCloudDraftTimerRef.current !== null) {
      window.clearTimeout(personalCloudDraftTimerRef.current);
    }
    personalCloudDraftTimerRef.current = window.setTimeout(() => {
      personalCloudDraftTimerRef.current = null;
      void writePersonalCloudDraft({
        baseUpdatedAt: activeCloudProject.updatedAt ?? null,
        cloudProjectId: activeCloudProject.projectId,
        project: cloneProject(projectRef.current),
        savedAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn("本人専用クラウドの端末ドラフトを保存できませんでした。", error);
        setNotice("端末内の一時保存に失敗しました。保存ボタンを押してください。");
      });
    }, 600);
    return () => {
      if (personalCloudDraftTimerRef.current !== null) {
        window.clearTimeout(personalCloudDraftTimerRef.current);
        personalCloudDraftTimerRef.current = null;
      }
    };
  }, [activeCloudProject, appView, isDirty, project]);

  async function releaseCloudSceneCellLock(
    lock: CloudActiveCellLock,
    options: { silent?: boolean } = {},
  ): Promise<boolean> {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || !cloudConfig) {
      return false;
    }
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        if (!options.silent) {
          setNotice("クラウドにログインしてください。");
        }
        return false;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const target = createSceneCellLockTarget(
        lock.sceneId,
        lock.patchType,
        lock.cellId,
      );
      const result = await api.releaseEditLock(
        cloudState.projectId,
        target,
        lock.lockToken,
        {
          holderClientId: lock.holderClientId,
          leaseId: lock.leaseId,
          operationId: lock.operationId,
        },
      );
      if (!result.success && result.reason !== "lock_not_found_or_token_mismatch") {
        if (!options.silent) {
          setNotice("セル編集ロックの解除に失敗しました。");
        }
        return false;
      }
      clearCloudLockTokenFromSession(cloudState.projectId, target);
      delete cloudPreviewLastSentAtRef.current[lock.targetId];
      if (lock.leaseId && lock.operationId) {
        delete cloudPreviewSeqByOperationRef.current[
          `${lock.leaseId}:${lock.operationId}`
        ];
      }
      if (lock.patchType === "member_position") {
        clearCloudMemberPositionPreview(lock.sceneId, lock.cellId);
      }
      if (lock.patchType === "object_state") {
        clearCloudObjectStatePreview(lock.sceneId, lock.cellId);
      }
      const nextLocks = activeCloudCellLocksRef.current.filter(
        (item) => item.targetId !== lock.targetId,
      );
      activeCloudCellLocksRef.current = nextLocks;
      setActiveCloudCellLocks(nextLocks);
      void refreshCloudActiveLocks(activeSession);
      return true;
    } catch (error) {
      if (!options.silent) {
        setNotice(getCloudErrorMessage(error));
      }
      return false;
    }
  }

  async function saveCloudSceneCellPatch(
    lock: CloudActiveCellLock,
    sourceProject: Project,
  ): Promise<boolean> {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || !cloudConfig) {
      return false;
    }
    const frame = sourceProject.frames.find((item) => item.id === lock.sceneId);
    if (!frame) {
      setNotice("クラウドへ保存するシーンが見つかりません。");
      return false;
    }
    const value =
      lock.patchType === "member_position"
        ? frame.positions[lock.cellId]
        : lock.patchType === "object_state"
          ? frame.objectStates[lock.cellId]
          : lock.patchType === "member_visibility"
            ? frame.memberVisibility?.[lock.cellId] ?? true
            : lock.patchType === "object_visibility"
              ? frame.objectStates[lock.cellId]?.visible ?? true
              : lock.patchType === "object_assignment"
                ? frame.objectAssignments?.[lock.cellId] ?? []
                : frame.notes ?? "";
    if (value === undefined) {
      setNotice("保存対象が見つからなかったため、クラウド保存を中止しました。");
      return false;
    }
    if (isSaving) {
      return false;
    }
    setIsSaving(true);
    clearPendingAutoSave();
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.saveSceneCellPatchWithLock(
        cloudState.projectId,
        lock.sceneId,
        lock.patchType,
        lock.cellId,
        value,
        lock.lockToken,
        CLOUD_SCHEMA_VERSION,
        getSceneCellPatchSummary(lock.patchType),
        lock.baseVersion,
        {
          holderClientId: lock.holderClientId,
          leaseId: lock.leaseId,
          operationId: lock.operationId,
        },
      );
      if (!result.success || result.version === null) {
        setNotice(
          result.reason === "version_conflict"
            ? "クラウド側が更新されています。最新を再読み込みしてから再度操作してください。"
            : "セル単位のクラウド保存に失敗しました。編集ロックを確認してください。",
        );
        return false;
      }
      const updatedAt = result.updated_at ?? new Date().toISOString();
      const savedProject = {
        ...sourceProject,
        updatedAt,
      };
      projectRef.current = savedProject;
      setProject(savedProject);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              sceneVersions: {
                ...previous.sceneVersions,
                [lock.sceneId]: result.version ?? previous.sceneVersions[lock.sceneId] ?? 1,
              },
              sceneCellVersions: {
                ...previous.sceneCellVersions,
                [createSceneCellVersionKey(lock.sceneId, lock.patchType, lock.cellId)]:
                  result.cell_version ?? lock.baseVersion + 1,
              },
              updatedAt,
            }
          : previous,
      );
      const cellVersion = result.cell_version ?? lock.baseVersion + 1;
      if (lock.patchType === "member_position") {
        clearCloudMemberPositionPreview(lock.sceneId, lock.cellId);
      }
      if (lock.patchType === "object_state") {
        clearCloudObjectStatePreview(lock.sceneId, lock.cellId);
      }
      if (lock.leaseId && lock.operationId) {
        void cloudRealtimeSubscriptionRef.current?.sendCommit({
          cellId: lock.cellId,
          cellKind: lock.patchType,
          cellVersion,
          holderClientId: lock.holderClientId,
          leaseId: lock.leaseId,
          operationId: lock.operationId,
          projectId: cloudState.projectId,
          sceneId: lock.sceneId,
          sentAt: new Date().toISOString(),
        });
      }
      setIsDirty(false);
      return true;
    } catch (error) {
      setNotice(`${getCloudErrorMessage(error)} クラウド保存に失敗しました。`);
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function beginCloudSceneCellEdit(
    label: string | undefined,
    target: SceneElementEditTarget,
  ): Promise<boolean> {
    let cloudState = activeCloudProjectRef.current;
    const sceneId = selectedFrameIdRef.current;
    if (!cloudState || !sceneId) {
      return false;
    }
    if (cloudState.role === "viewer") {
      setNotice("閲覧のみの権限では編集できません。");
      return false;
    }
    if (cloudState.activeProjectLock) {
      setNotice("全体データの編集中です。保存または編集終了してからシーン編集を開始してください。");
      return false;
    }
    if (cloudState.activeSceneLock) {
      const sceneLock = cloudState.activeSceneLock;
      const saved = isDirtyRef.current
        ? await saveCloudCurrentScene(projectRef.current, sceneLock.sceneId, {
            showNotice: false,
          })
        : true;
      if (!saved) {
        return false;
      }
      const released = await releaseActiveCloudSceneLock({ silent: true });
      if (!released) {
        return false;
      }
      cloudState = activeCloudProjectRef.current;
      if (!cloudState) {
        return false;
      }
    }
    if (!cloudConfig) {
      setNotice("Supabase接続が未設定です。");
      return false;
    }
    const patchType = getSceneCellPatchType(target);
    const lockTarget = createSceneCellLockTarget(sceneId, patchType, target.id);
    const existingLock = activeCloudCellLocksRef.current.find(
      (item) => item.targetId === lockTarget.targetId,
    );
    if (existingLock) {
      return true;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const lockToken = createCloudLockToken();
      const holderClientId = readCloudClientIdFromSession();
      const leaseId = createCloudLeaseId();
      const operationId = createCloudOperationId();
      const result = await acquireCloudEditLock(
        api,
        cloudState,
        lockTarget,
        lockToken,
        activeSession.user.id,
        {
          holderClientId,
          leaseId,
          operationId,
        },
      );
      if (!result.success) {
        if (result.reason === "project_lock_active") {
          setNotice("全体データの編集中です。シーンは閲覧のみです。");
          return false;
        }
        const lockedBy = result.locked_by
          ? cloudMemberNameById.get(result.locked_by) ?? "他の参加者"
          : "他の参加者";
        setNotice(
          result.reason === "scene_cell_lock_active"
            ? `${lockedBy}がこの対象を操作中です。`
            : "セル編集ロックを取得できませんでした。",
        );
        return false;
      }
      saveCloudLockTokenToSession(cloudState.projectId, lockTarget, lockToken);
      const nextLock: CloudActiveCellLock = {
        baseVersion:
          cloudState.sceneCellVersions[
            createSceneCellVersionKey(sceneId, patchType, target.id)
          ] ?? 0,
        cellId: target.id,
        expiresAt: result.expires_at,
        holderClientId,
        leaseId: result.lease_id ?? leaseId,
        lockToken,
        operationId: result.operation_id ?? operationId,
        patchType,
        sceneId,
        targetId: lockTarget.targetId,
      };
      const nextLocks = [
        ...activeCloudCellLocksRef.current.filter(
          (item) => item.targetId !== lockTarget.targetId,
        ),
        nextLock,
      ];
      activeCloudCellLocksRef.current = nextLocks;
      setActiveCloudCellLocks(nextLocks);
      void refreshCloudActiveLocks(activeSession);
      if (label) {
        setNotice(`${label}を共同編集モードで開始しました。`);
      }
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      setIsCloudBusy(false);
    }
  }

  async function endCloudSceneCellEdit(
    target: SceneElementEditTarget,
  ): Promise<boolean> {
    const sceneId = selectedFrameIdRef.current;
    if (!sceneId) {
      return false;
    }
    const patchType = getSceneCellPatchType(target);
    const lockTarget = createSceneCellLockTarget(sceneId, patchType, target.id);
    const lock = activeCloudCellLocksRef.current.find(
      (item) => item.targetId === lockTarget.targetId,
    );
    if (!lock) {
      return true;
    }
    const saved = await saveCloudSceneCellPatch(lock, projectRef.current);
    if (saved) {
      await releaseCloudSceneCellLock(lock, { silent: true });
    }
    return saved;
  }

  async function beginCloudSceneCellEdits(
    label: string | undefined,
    targets: SceneElementEditTarget[],
  ): Promise<boolean> {
    const sceneId = selectedFrameIdRef.current;
    if (!sceneId) {
      setNotice("変更するシーンがありません。");
      return false;
    }
    const uniqueTargets = [
      ...new Map(targets.map((target) => [`${target.type}:${target.id}`, target])).values(),
    ];
    if (uniqueTargets.length === 0) {
      return false;
    }
    const existingTargetIds = new Set(
      activeCloudCellLocksRef.current.map((lock) => lock.targetId),
    );
    const newlyAcquiredTargets: SceneElementEditTarget[] = [];
    for (let index = 0; index < uniqueTargets.length; index += 1) {
      const target = uniqueTargets[index];
      const ok = await beginCloudSceneCellEdit(index === 0 ? label : undefined, target);
      if (!ok) {
        for (const acquiredTarget of [...newlyAcquiredTargets].reverse()) {
          const patchType = getSceneCellPatchType(acquiredTarget);
          const lockTarget = createSceneCellLockTarget(
            sceneId,
            patchType,
            acquiredTarget.id,
          );
          const lock = activeCloudCellLocksRef.current.find(
            (item) => item.targetId === lockTarget.targetId,
          );
          if (lock && !existingTargetIds.has(lock.targetId)) {
            await releaseCloudSceneCellLock(lock, { silent: true });
          }
        }
        return false;
      }
      const patchType = getSceneCellPatchType(target);
      const lockTarget = createSceneCellLockTarget(sceneId, patchType, target.id);
      if (!existingTargetIds.has(lockTarget.targetId)) {
        newlyAcquiredTargets.push(target);
      }
    }
    return true;
  }

  async function endCloudSceneCellEdits(
    targets: SceneElementEditTarget[],
  ): Promise<boolean> {
    const uniqueTargets = [
      ...new Map(targets.map((target) => [`${target.type}:${target.id}`, target])).values(),
    ];
    let allSaved = true;
    for (const target of uniqueTargets) {
      const saved = await endCloudSceneCellEdit(target);
      allSaved = allSaved && saved;
    }
    return allSaved;
  }

  async function runCloudSceneCellPatchEditMany(
    label: string,
    targets: SceneElementEditTarget[],
    applyChange: () => void,
  ): Promise<boolean> {
    if (!activeCloudProjectRef.current || !APP_FEATURES.collaboration) {
      applyChange();
      return true;
    }
    const sceneId = selectedFrameIdRef.current;
    if (!sceneId) {
      setNotice("変更するシーンがありません。");
      return false;
    }
    const uniqueTargets = [
      ...new Map(targets.map((target) => [`${target.type}:${target.id}`, target])).values(),
    ];
    if (uniqueTargets.length === 0) {
      applyChange();
      return true;
    }
    const existingTargetIds = new Set(
      activeCloudCellLocksRef.current.map((lock) => lock.targetId),
    );
    const newlyAcquiredTargets: SceneElementEditTarget[] = [];
    for (let index = 0; index < uniqueTargets.length; index += 1) {
      const target = uniqueTargets[index];
      const ok = await beginCloudSceneCellEdit(index === 0 ? label : undefined, target);
      if (!ok) {
        for (const acquiredTarget of [...newlyAcquiredTargets].reverse()) {
          const acquiredPatchType = getSceneCellPatchType(acquiredTarget);
          const acquiredLockTarget = createSceneCellLockTarget(
            sceneId,
            acquiredPatchType,
            acquiredTarget.id,
          );
          const acquiredLock = activeCloudCellLocksRef.current.find(
            (lock) => lock.targetId === acquiredLockTarget.targetId,
          );
          if (acquiredLock && !existingTargetIds.has(acquiredLock.targetId)) {
            await releaseCloudSceneCellLock(acquiredLock, { silent: true });
          }
        }
        return false;
      }
      const patchType = getSceneCellPatchType(target);
      const lockTarget = createSceneCellLockTarget(sceneId, patchType, target.id);
      if (!existingTargetIds.has(lockTarget.targetId)) {
        newlyAcquiredTargets.push(target);
      }
    }

    const beforeProject = projectRef.current;
    applyChange();
    if (projectRef.current === beforeProject) {
      for (const target of newlyAcquiredTargets) {
        const patchType = getSceneCellPatchType(target);
        const lockTarget = createSceneCellLockTarget(sceneId, patchType, target.id);
        const lock = activeCloudCellLocksRef.current.find(
          (item) => item.targetId === lockTarget.targetId,
        );
        if (lock) {
          await releaseCloudSceneCellLock(lock, { silent: true });
        }
      }
      return true;
    }

    let allSaved = true;
    for (const target of uniqueTargets) {
      const saved = await endCloudSceneCellEdit(target);
      allSaved = allSaved && saved;
    }
    return allSaved;
  }

  useEffect(() => {
    const handlePageHide = () => {
      flushPendingAutoSave();
      const cloudState = activeCloudProjectRef.current;
      if (
        !APP_FEATURES.collaboration &&
        cloudState?.role === "owner" &&
        isDirtyRef.current
      ) {
        void writePersonalCloudDraft({
          baseUpdatedAt: cloudState.updatedAt ?? null,
          cloudProjectId: cloudState.projectId,
          project: cloneProject(projectRef.current),
          savedAt: new Date().toISOString(),
        });
      }
    };
    let disposed = false;
    let removeAppStateListener: (() => Promise<void>) | null = null;
    if (APP_FEATURES.nativeFileShare) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          handlePageHide();
        }
      }).then((listener) => {
        if (disposed) {
          void listener.remove();
          return;
        }
        removeAppStateListener = () => listener.remove();
      });
    }
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    return () => {
      disposed = true;
      if (removeAppStateListener) {
        void removeAppStateListener();
      }
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      flushPendingAutoSave();
    };
  }, [flushPendingAutoSave]);

  const beginProjectHistoryBatch = useCallback(
    (
      label?: string,
      target?: SceneElementEditTarget | SceneElementEditTarget[],
    ): boolean | Promise<boolean> => {
      if (activeCloudProjectRef.current && APP_FEATURES.collaboration) {
        if (!target) {
          setNotice("クラウド共同編集では、この操作はまだセル単位保存に対応していません。");
          return false;
        }
        const targets = Array.isArray(target) ? target : [target];
        return targets.length === 1
          ? beginCloudSceneCellEdit(label, targets[0])
          : beginCloudSceneCellEdits(label, targets);
      }
      isProjectEditBatchActiveRef.current = true;
      if (historyBatchRef.current) {
        return true;
      }
      historyBatchRef.current = { label };
      pushUndoSnapshot(projectRef.current, label);
      refreshHistoryCounts();
      return true;
    },
    [pushUndoSnapshot, refreshHistoryCounts],
  );

  const endProjectHistoryBatch = useCallback((
    target?: SceneElementEditTarget | SceneElementEditTarget[],
  ) => {
    if (activeCloudProjectRef.current && APP_FEATURES.collaboration) {
      if (target) {
        const targets = Array.isArray(target) ? target : [target];
        void endCloudSceneCellEdits(targets);
      }
      return;
    }
    historyBatchRef.current = null;
    isProjectEditBatchActiveRef.current = false;
    if (
      appView !== "editor" ||
      isSharedProject ||
      !pendingAutoSaveProjectRef.current
    ) {
      return;
    }
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(flushPendingAutoSave, 250);
  }, [appView, flushPendingAutoSave, isSharedProject]);

  useEffect(() => {
    if (project.frames.length === 0) {
      return;
    }
    if (!selectedFrameId || !project.frames.some((frame) => frame.id === selectedFrameId)) {
      setSelectedFrameId(project.frames[0].id);
    }
  }, [project.frames, selectedFrameId]);

  useEffect(() => {
    if (
      selected?.type === "member" &&
      !project.members.some((member) => member.id === selected.id)
    ) {
      setSelected(null);
    }
    if (
      selected?.type === "object" &&
      !project.stageObjects.some((object) => object.id === selected.id)
    ) {
      setSelected(null);
    }
    setSelectedMemberIds((previous) =>
      previous.filter((id) => project.members.some((member) => member.id === id)),
    );
  }, [project.members, project.stageObjects, selected]);

  useEffect(() => {
    if (appView !== "editor") {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audioUrl) {
      if (audio.src !== audioUrl) {
        audio.src = audioUrl;
        audio.load();
      }
      audio.playbackRate = playbackRate;
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
  }, [appView, audioUrl, playbackRate]);

  useEffect(() => {
    if (appView !== "editor") {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const getResolvedDuration = () => {
      const fallbackDuration =
        project.audio?.duration && Number.isFinite(project.audio.duration)
          ? project.audio.duration
          : 0;
      return (
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : fallbackDuration
      );
    };
    const handleLoaded = () => {
      const nextDuration = getResolvedDuration();
      setDuration(nextDuration);
      setCurrentTime((previous) =>
        nextDuration > 0 ? Math.min(previous, nextDuration) : 0,
      );
      setLoopEnd((previous) => (previous > 0 ? previous : nextDuration));
    };
    const handleEnded = () => {
      const nextDuration = getResolvedDuration();
      setIsPlaying(false);
      setCurrentTime(nextDuration > 0 ? nextDuration : audio.currentTime);
    };

    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("durationchange", handleLoaded);
    audio.addEventListener("ended", handleEnded);
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA || project.audio?.duration) {
      handleLoaded();
    }
    return () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("durationchange", handleLoaded);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [appView, audioUrl, project.audio?.duration]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    // 再生中はaudio.currentTimeをrequestAnimationFrameで追い、ステージ表示を滑らかに更新する。
    let animationFrame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        if (
          loopEnabled &&
          loopEnd > loopStart &&
          audio.currentTime >= loopEnd
        ) {
          audio.currentTime = loopStart;
        }
        setCurrentTime(audio.currentTime);
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPlaying, loopEnabled, loopEnd, loopStart]);

  useEffect(
    () => () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (animationPreviewRef.current !== null) {
        window.cancelAnimationFrame(animationPreviewRef.current);
      }
    },
    [audioUrl],
  );

  useEffect(() => {
    if (appView !== "editor") {
      return;
    }
    const key = `${project.id ?? "project"}:${project.audio?.id ?? "no-audio"}`;
    if (restoredAudioKeyRef.current === key) {
      return;
    }
    restoredAudioKeyRef.current = key;
    void restoreAudioForProject(project);
  }, [appView, project, restoreAudioForProject]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        return;
      }
      setIsStageFullscreen(
        document.fullscreenElement === stageFullscreenRef.current,
      );
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isStageFullscreen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen()) return;
      if (event.key === "Escape") {
        void exitStageFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStageFullscreen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen() || isTextEditingTarget(event.target)) {
        return;
      }
      if (nudgeSelectionByKeyboard(event)) {
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowLeft") {
        goToScene(-1);
      }
      if (event.key === "ArrowRight") {
        goToScene(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    animationPreviewTimeSec,
    isPlaying,
    project,
    selected,
    selectedFrameId,
    selectedMemberIds,
    viewerPerspective,
  ]);

  useEffect(() => {
    const handleUndoRedoShortcut = (event: KeyboardEvent) => {
      if (isModalOpen()) return;
      if (isTextEditingTarget(event.target)) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (
        activeCloudProjectRef.current &&
        APP_FEATURES.collaboration &&
        (key === "z" || key === "y")
      ) {
        event.preventDefault();
        setNotice("クラウド共同編集では元に戻す/やり直しは使えません。");
        return;
      }
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoProject();
        return;
      }
      if (key === "z") {
        event.preventDefault();
        undoProject();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        redoProject();
      }
    };
    window.addEventListener("keydown", handleUndoRedoShortcut);
    return () =>
      window.removeEventListener("keydown", handleUndoRedoShortcut);
  }, [redoProject, undoProject]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const close = () => {
      setContextMenu(null);
      setContextMenuPosition(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen()) return;
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu) {
      setContextMenuPosition(null);
      return;
    }
    const anchor = {
      left: contextMenu.clientX,
      top: contextMenu.clientY,
    };
    const nextPosition = clampFloatingMenuPosition(
      anchor,
      contextMenuRef.current,
    );
    setContextMenuPosition((previous) =>
      previous &&
      Math.abs(previous.left - nextPosition.left) < 0.5 &&
      Math.abs(previous.top - nextPosition.top) < 0.5
        ? previous
        : nextPosition,
    );
  }, [contextMenu]);

  useEffect(() => {
    if (!sceneContextMenu) {
      return undefined;
    }
    const close = () => {
      setSceneContextMenu(null);
      setSceneContextMenuPosition(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen()) return;
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sceneContextMenu]);

  useLayoutEffect(() => {
    if (!sceneContextMenu) {
      setSceneContextMenuPosition(null);
      return;
    }
    const anchor = {
      left: sceneContextMenu.clientX,
      top: sceneContextMenu.clientY,
    };
    const nextPosition = clampFloatingMenuPosition(
      anchor,
      sceneContextMenuRef.current,
    );
    setSceneContextMenuPosition((previous) =>
      previous &&
      Math.abs(previous.left - nextPosition.left) < 0.5 &&
      Math.abs(previous.top - nextPosition.top) < 0.5
        ? previous
        : nextPosition,
    );
  }, [sceneContextMenu]);

  useEffect(() => {
    if (!memberColorEditor) {
      return undefined;
    }
    const close = () => {
      setMemberColorEditor(null);
      setMemberColorEditorPosition(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen()) return;
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [memberColorEditor]);

  useLayoutEffect(() => {
    if (!memberColorEditor) {
      setMemberColorEditorPosition(null);
      return;
    }
    const anchor = {
      left: memberColorEditor.clientX,
      top: memberColorEditor.clientY,
    };
    const nextPosition = clampFloatingMenuPosition(
      anchor,
      memberColorEditorRef.current,
    );
    setMemberColorEditorPosition((previous) =>
      previous &&
      Math.abs(previous.left - nextPosition.left) < 0.5 &&
      Math.abs(previous.top - nextPosition.top) < 0.5
        ? previous
        : nextPosition,
    );
  }, [memberColorEditor]);

  const selectedFrame = useMemo(
    () =>
      project.frames.find((frame) => frame.id === selectedFrameId) ??
      project.frames[0],
    [project.frames, selectedFrameId],
  );

  const selectedNextFrame = useMemo(() => {
    const sortedFrames = sortFrames(project.frames);
    const selectedIndex = sortedFrames.findIndex(
      (frame) => frame.id === selectedFrame?.id,
    );
    return selectedIndex >= 0 ? sortedFrames[selectedIndex + 1] : undefined;
  }, [project.frames, selectedFrame?.id]);

  const selectedPreviousFrame = useMemo(() => {
    if (!selectedFrame) {
      return null;
    }
    const sortedFrames = sortFrames(project.frames);
    const selectedIndex = sortedFrames.findIndex(
      (frame) => frame.id === selectedFrame.id,
    );
    return selectedIndex > 0 ? sortedFrames[selectedIndex - 1] : null;
  }, [project.frames, selectedFrame]);

  const selectedSceneNumber = useMemo(() => {
    const index = project.frames.findIndex((frame) => frame.id === selectedFrame?.id);
    return index >= 0 ? index + 1 : 0;
  }, [project.frames, selectedFrame?.id]);

  const currentSceneFrame = useMemo(
    () => getActiveFrameAtTime(project.frames, currentTime) ?? selectedFrame,
    [currentTime, project.frames, selectedFrame],
  );
  const displayFrame = isPlaying ? currentSceneFrame : selectedFrame;

  useEffect(() => {
    if (!isPlaying || !currentSceneFrame?.id) {
      return;
    }
    if (currentSceneFrame.id !== selectedFrameId) {
      setSelectedFrameId(currentSceneFrame.id);
    }
  }, [currentSceneFrame?.id, isPlaying, selectedFrameId]);

  const effectiveStageSize = getEffectiveStageSize(project, displayFrame);
  const effectiveStage = useMemo(
    () => ({
      ...project.stage,
      widthMeters: effectiveStageSize.widthMeters,
      depthMeters: effectiveStageSize.depthMeters,
    }),
    [effectiveStageSize.depthMeters, effectiveStageSize.widthMeters, project.stage],
  );
  const projectForStage = useMemo(
    () => ({
      ...project,
      stage: effectiveStage,
    }),
    [effectiveStage, project],
  );

  const getSnappedStagePosition = (
    position: Position,
    stage: Project["stage"],
  ): Position =>
    constrainMemberPosition(
      {
        x: snapToGrid(position.x, stage.gridSizeMeters, stage.showGrid),
        y: snapToGrid(position.y, stage.gridSizeMeters, stage.showGrid),
      },
      stage,
    );

  const getPasteStagePosition = (stage: Project["stage"] = effectiveStage) =>
    getSnappedStagePosition(
      lastStagePointerPositionRef.current ?? {
        x: stage.widthMeters / 2,
        y: stage.depthMeters / 2,
      },
      stage,
    );

  const handleStagePointerPositionChange = useCallback((position: Position) => {
    lastStagePointerPositionRef.current = position;
  }, []);

  const snapshot = useMemo<StageSnapshot>(() => {
    if (project.mode === "parade") {
      return getSnapshotForFrame(project, displayFrame?.id ?? selectedFrame?.id ?? null);
    }
    if (isPlaying || mode === "preview") {
      return interpolateProjectAtTime(project, currentTime);
    }
    return getSnapshotForFrame(project, selectedFrame?.id ?? null);
  }, [
    currentTime,
    displayFrame?.id,
    isPlaying,
    mode,
    project,
    selectedFrame?.id,
  ]);

  const selectedFrameSnapshot = useMemo<StageSnapshot>(
    () => getSnapshotForFrame(project, selectedFrame?.id ?? null),
    [project, selectedFrame?.id],
  );
  const selectedPreviousFrameSnapshot = useMemo<StageSnapshot | null>(
    () =>
      selectedPreviousFrame
        ? getSnapshotForFrame(project, selectedPreviousFrame.id)
        : null,
    [project, selectedPreviousFrame?.id],
  );

  const updateFrameViewState = useCallback(
    (frameId: string, viewState: SceneViewState) => {
      const previous = projectRef.current;
      const nextProject = {
        ...previous,
        updatedAt: new Date().toISOString(),
        frames: previous.frames.map((frame) =>
          frame.id === frameId
            ? {
                ...frame,
                sceneViewState: {
                  scrollTop: Math.max(0, viewState.scrollTop),
                  scrollLeft: Math.max(0, viewState.scrollLeft),
                  zoom: Math.min(3, Math.max(0.2, viewState.zoom)),
                  viewportWidth: viewState.viewportWidth,
                  viewportHeight: viewState.viewportHeight,
                },
              }
            : frame,
        ),
      };
      projectRef.current = nextProject;
      setProject(nextProject);
      if (activeCloudProjectRef.current && APP_FEATURES.collaboration) {
        return;
      }
      setIsDirty(true);
    },
    [],
  );

  const reflectPreviousParadeFrame = useCallback(
    (options: ParadeReflectOptions) => {
      if (!selectedFrame || !selectedPreviousFrame) {
        setNotice("直前シーンがありません。");
        return;
      }
      const activeFrameId = selectedFrame.id;
      const previousFrameId = selectedPreviousFrame.id;
      updateProject((previous) => {
        const sourceFrame = previous.frames.find((frame) => frame.id === previousFrameId);
        const targetFrame = previous.frames.find((frame) => frame.id === activeFrameId);
        if (!sourceFrame || !targetFrame) {
          return previous;
        }
        const settings = createDefaultParadeSettings({
          ...(previous.paradeSettings ?? {}),
          width: previous.stage.widthMeters,
          totalDistance: previous.stage.depthMeters,
          cellSizeMeters: previous.stage.gridSizeMeters,
        });
        const canvasDistanceMeters = getSafeParadeCanvasDistance(
          settings.totalDistance,
          settings.backwardDistanceMeters,
        );
        const copyAssignments = (assignments?: FormationFrame["objectAssignments"]) =>
          assignments
            ? Object.fromEntries(
                Object.entries(assignments).map(([objectId, memberIds]) => [
                  objectId,
                  [...memberIds],
                ]),
              )
            : undefined;
        const copyAppearanceOverrides = (
          overrides?: FormationFrame["memberAppearanceOverrides"],
        ) =>
          overrides
            ? Object.fromEntries(
                Object.entries(overrides).map(([memberId, override]) => [
                  memberId,
                  { ...override },
                ]),
              )
            : undefined;
        const groupMemberIds =
          options.target === "group" && options.groupId
            ? new Set(
                (previous.memberGroups ?? []).find((group) => group.id === options.groupId)
                  ?.memberIds ?? [],
              )
            : null;
        const moveMeters = Math.max(0, options.moveMeters || 0);
        const moveDirection = options.direction ?? "forward";
        const movePosition = (position: Position): Position => {
          if (moveMeters <= 0) {
            return position;
          }
          switch (moveDirection) {
            case "backward":
              return { ...position, y: roundMeters(position.y + moveMeters) };
            case "left":
              return { ...position, x: roundMeters(position.x - moveMeters) };
            case "right":
              return { ...position, x: roundMeters(position.x + moveMeters) };
            case "forward":
            default:
              return { ...position, y: roundMeters(position.y - moveMeters) };
          }
        };
        const isMoveOperation = moveMeters > 0;
        const positionEntries = new Map<string, Position>(
          Object.entries(sourceFrame.positions),
        );
        if (isMoveOperation) {
          Object.entries(targetFrame.positions).forEach(([memberId, position]) => {
            positionEntries.set(memberId, position);
          });
        }
        const objectStateEntries = new Map<string, ObjectState>(
          Object.entries(sourceFrame.objectStates),
        );
        if (isMoveOperation) {
          Object.entries(targetFrame.objectStates).forEach(([objectId, state]) => {
            objectStateEntries.set(objectId, state);
          });
        }
        let outOfRangeCount = 0;
        const shouldMoveMember = (memberId: string) =>
          options.target === "all" || Boolean(groupMemberIds?.has(memberId));
        const nextPositions = Object.fromEntries(
          Array.from(positionEntries.entries()).map(([memberId, position]) => {
            const moved =
              shouldMoveMember(memberId) && isMoveOperation
                ? movePosition(position)
                : position;
            if (
              moved.x < 0 ||
              moved.x > settings.width ||
              moved.y < 0 ||
              moved.y > canvasDistanceMeters
            ) {
              outOfRangeCount += 1;
            }
            return [memberId, moved];
          }),
        );
        const nextObjectStates = Object.fromEntries(
          Array.from(objectStateEntries.entries()).map(([objectId, state]) => {
            const moved =
              options.moveObjects && isMoveOperation
                ? { ...state, ...movePosition({ x: state.x, y: state.y }) }
                : state;
            if (
              moved.x < 0 ||
              moved.x > settings.width ||
              moved.y < 0 ||
              moved.y > canvasDistanceMeters
            ) {
              outOfRangeCount += 1;
            }
            return [objectId, moved];
          }),
        );
        const nextMemberVisibility = isMoveOperation
          ? targetFrame.memberVisibility !== undefined
            ? { ...targetFrame.memberVisibility }
            : sourceFrame.memberVisibility
              ? { ...sourceFrame.memberVisibility }
              : undefined
          : sourceFrame.memberVisibility
            ? { ...sourceFrame.memberVisibility }
            : undefined;
        const nextObjectAssignments =
          isMoveOperation && targetFrame.objectAssignments !== undefined
            ? copyAssignments(targetFrame.objectAssignments)
            : copyAssignments(sourceFrame.objectAssignments);
        const nextMemberAppearanceOverrides = isMoveOperation
          ? targetFrame.memberAppearanceOverrides !== undefined
            ? copyAppearanceOverrides(targetFrame.memberAppearanceOverrides)
            : copyAppearanceOverrides(sourceFrame.memberAppearanceOverrides)
          : copyAppearanceOverrides(sourceFrame.memberAppearanceOverrides);
        if (outOfRangeCount > 0) {
          setNotice(
            `${outOfRangeCount}件がパレード範囲外に移動しました。位置データは保持しています。`,
          );
        } else {
          setNotice(
            isMoveOperation
              ? "現在シーンを基準に隊列を移動しました。"
              : "前シーンの隊列を反映しました。",
            "success",
          );
        }
        return {
          ...previous,
          frames: previous.frames.map((frame) =>
            frame.id === activeFrameId
              ? {
                  ...frame,
                  positions: nextPositions,
                  objectStates: nextObjectStates,
                  memberVisibility: nextMemberVisibility,
                  objectAssignments: nextObjectAssignments,
                  memberAppearanceOverrides: nextMemberAppearanceOverrides,
                }
              : frame,
          ),
        };
      }, "パレード前シーン反映", { coalesceHistory: false });
    },
    [selectedFrame, selectedPreviousFrame, setNotice, updateProject],
  );

  const requestPanelScroll = (type: "member" | "object", id: string) => {
    setPanelScrollTarget((previous) => ({
      type,
      id,
      token: (previous?.token ?? 0) + 1,
    }));
  };

  const requestMemberToolsScroll = () => {
    setPanelScrollTarget((previous) => ({
      type: "member-tools",
      token: (previous?.token ?? 0) + 1,
    }));
  };

  const toggleMemberSelectionMode = () => {
    setIsMemberSelectionMode((previous) => {
      const next = !previous;
      if (next) {
        setActivePanelTab("members");
        setMode("members");
        requestMemberToolsScroll();
      }
      return next;
    });
  };

  const clearMemberSelection = () => {
    setSelectedMemberIds([]);
    if (selected?.type === "member") {
      setSelected(null);
    }
  };

  useEffect(() => {
    if (panelScrollTarget?.type !== "member-tools") {
      return undefined;
    }

    let firstFrame = 0;
    let secondFrame = 0;
    let clearTimer = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(
          "[data-member-tools-panel='true']",
        );
        if (!element) {
          return;
        }
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("is-scroll-target");
        clearTimer = window.setTimeout(() => {
          element.classList.remove("is-scroll-target");
        }, 950);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (clearTimer) {
        window.clearTimeout(clearTimer);
      }
    };
  }, [panelScrollTarget]);

  const selectStageElement = (
    selection: Selection,
    options: StageSelectOptions = {},
  ) => {
    if (!selection) {
      setSelected(selection);
      setSelectedMemberIds([]);
      return;
    }

    if (activePanelTab === "animation") {
      setSelected(selection);
      setIsPanelOpen(true);
      setSelectedMemberIds([]);
      setMode("preview");
      return;
    }

    setIsPanelOpen(true);
    if (workspaceLayout.isPortrait) {
      if (selection.type === "member" && options.append) {
        const previousId = selected?.type === "member" ? selected.id : undefined;
        setSelected(null);
        setSelectedMemberIds((previous) => {
          const base = previous.length ? previous : previousId ? [previousId] : [];
          return base.includes(selection.id) ? base.filter((id) => id !== selection.id) : [...base, selection.id];
        });
      }
      else { setSelected(selection); setSelectedMemberIds([]); }
      setActivePanelTab(selection.type === "member" ? "members" : "objects");
      setMode(selection.type === "member" ? "members" : "objects");
      requestPanelScroll(selection.type, selection.id);
      return;
    }
    if (selection.type === "member") {
      const member = project.members.find((item) => item.id === selection.id);
      const visible =
        (member?.visible ?? true) &&
        (snapshot.memberVisibility[selection.id] ?? true);
      setActivePanelTab("members");
      setMode("members");
      setMemberVisibilityTab(visible ? "visible" : "hidden");

      if (options.append) {
        const previouslySelected =
          selected?.type === "member" ? selected.id : undefined;
        setSelected(null);
        setSelectedMemberIds((previous) => {
          const base =
            previous.length > 0
              ? previous
              : previouslySelected
                ? [previouslySelected]
                : [];
          return base.includes(selection.id)
            ? base.filter((id) => id !== selection.id)
            : [...base, selection.id];
        });
        requestMemberToolsScroll();
        return;
      }

      setSelected(selection);
      setSelectedMemberIds([]);
      requestPanelScroll("member", selection.id);
      return;
    }

    setSelected(selection);
    const object = project.stageObjects.find((item) => item.id === selection.id);
    const visible =
      snapshot.objectStates[selection.id]?.visible ?? object?.visible ?? true;
    setActivePanelTab("objects");
    setMode("objects");
    setObjectVisibilityTab(visible ? "visible" : "hidden");
    requestPanelScroll("object", selection.id);
  };

  const objectAssignmentLabelsByMemberId = useMemo(() => {
    const labels: Record<string, string[]> = {};
    const assignments = selectedFrame?.objectAssignments ?? {};
    const objectsById = new Map(project.stageObjects.map((object) => [object.id, object]));
    Object.entries(assignments).forEach(([objectId, memberIds]) => {
      const object = objectsById.get(objectId);
      if (!object) {
        return;
      }
      const objectState = selectedFrame?.objectStates?.[objectId];
      const label =
        objectState?.visible ?? object.visible
          ? object.name
          : `${object.name}（道具は非表示）`;
      memberIds.forEach((memberId) => {
        labels[memberId] = [...(labels[memberId] ?? []), label];
      });
    });
    return labels;
  }, [project.stageObjects, selectedFrame?.objectAssignments, selectedFrame?.objectStates]);

  const selectedMovementTarget = useMemo(() => {
    if (!selected) {
      return null;
    }
    return {
      targetType: selected.type as MovementTargetType,
      targetId: selected.id,
    };
  }, [selected]);

  const selectedMovementPath = useMemo(() => {
    if (!selectedMovementTarget || !selectedFrame || !selectedNextFrame) {
      return undefined;
    }
    return findMovementPath(
      project.movementPaths,
      selectedMovementTarget.targetType,
      selectedMovementTarget.targetId,
      selectedFrame.id,
      selectedNextFrame.id,
    );
  }, [
    project.movementPaths,
    selectedFrame,
    selectedMovementTarget,
    selectedNextFrame,
  ]);

  const selectedMovementPlan = useMemo(() => {
    if (!selectedMovementTarget || !selectedFrame || !selectedNextFrame) {
      return undefined;
    }
    return resolveMovementPlan(
      project,
      selectedMovementTarget.targetType,
      selectedMovementTarget.targetId,
      selectedFrame,
      selectedNextFrame,
    );
  }, [project, selectedFrame, selectedMovementTarget, selectedNextFrame]);

  const selectedMovementPathType = getMovementPathType(
    selectedMovementPlan ?? selectedMovementPath,
  );
  const selectedPlanTiming =
    selectedFrame && selectedNextFrame
      ? getPlanTiming(selectedMovementPlan, selectedFrame, selectedNextFrame)
      : null;

  const selectedTargetDetails = useMemo(() => {
    if (!selected || !selectedFrame || !selectedNextFrame) {
      return null;
    }
    const fromSnapshot = getSnapshotForFrame(project, selectedFrame.id);
    const toSnapshot = getSnapshotForFrame(project, selectedNextFrame.id);
    if (selected.type === "member") {
      const member = project.members.find((item) => item.id === selected.id);
      if (!member) {
        return null;
      }
      return {
        id: selected.id,
        label: member.name,
        targetType: "member" as const,
        kindLabel: "メンバー",
        startPosition: fromSnapshot.positions[selected.id],
        endPosition: toSnapshot.positions[selected.id],
      };
    }
    const object = project.stageObjects.find((item) => item.id === selected.id);
    if (!object) {
      return null;
    }
    return {
      id: selected.id,
      label: object.name,
      targetType: "object" as const,
      kindLabel: object.type === "curtain" ? "幕" : "道具",
      startPosition: fromSnapshot.objectStates[selected.id],
      endPosition: toSnapshot.objectStates[selected.id],
    };
  }, [project, selected, selectedFrame, selectedNextFrame]);

  const warnings = useMemo(() => {
    const messages: string[] = [];
    const timeCounts = new Map<number, number>();
    project.frames.forEach((frame) => {
      const rounded = Number(frame.timeSec.toFixed(2));
      timeCounts.set(rounded, (timeCounts.get(rounded) ?? 0) + 1);
    });
    if ([...timeCounts.values()].some((count) => count > 1)) {
      messages.push("同じtimeSecのフレームがあります。再生順が分かりにくくなる可能性があります。");
    }

    const outMember = project.members.find((member) => {
      const position = snapshot.positions[member.id];
      return (
          (member.visible ?? true) &&
          (snapshot.memberVisibility[member.id] ?? true) &&
          position &&
          (position.x < 0 ||
            position.y < 0 ||
          position.x > effectiveStage.widthMeters ||
          position.y > effectiveStage.depthMeters)
      );
    });
    if (outMember) {
      messages.push(`${outMember.name} がこのシーンの横・縦の範囲外にあります。`);
    }

    const outObject = project.stageObjects.find((object) => {
      const state = snapshot.objectStates[object.id];
      return (
          state &&
          (state.x < 0 ||
            state.y < 0 ||
          state.x + state.widthMeters > effectiveStage.widthMeters ||
          state.y + state.heightMeters > effectiveStage.depthMeters)
      );
    });
    if (outObject) {
      messages.push(`${outObject.name} がこのシーンの横・縦の範囲外にはみ出しています。`);
    }

    return messages;
  }, [
    effectiveStage.depthMeters,
    effectiveStage.widthMeters,
    project.frames,
    project.members,
    project.stageObjects,
    snapshot,
  ]);

  const updateTitle = (title: string) => {
    updateProject((previous) => ({ ...previous, title }), "隊列表名編集");
  };

  const nextGroupMemberName = (groupName: string): string => {
    return nextNumberedName(
      groupName.trim() || "グループ",
      project.members.map((member) => member.name),
    );
  };

  const nextUngroupedMemberName = (): string => {
    return nextNumberedName(
      "メンバー",
      project.members.map((member) => member.name),
    );
  };

  const nextGroupObjectName = (groupName: string): string => {
    return nextNumberedName(
      groupName.trim() || "道具",
      project.stageObjects.map((object) => object.name),
    );
  };

  const getMemberGroupForMemberId = (memberId: string): MemberGroup | undefined =>
    (project.memberGroups ?? []).find((group) => group.memberIds.includes(memberId));

  const getObjectGroupForObjectId = (objectId: string): ObjectGroup | undefined =>
    (project.objectGroups ?? []).find((group) => group.objectIds.includes(objectId));

  const getNumberedDuplicateBaseName = (
    name: string,
    fallback: string,
  ): string => {
    const withoutCopy = name.replace(/\s*コピー\s*$/, "").trim();
    const withoutTrailingNumber = withoutCopy.replace(/\d+$/, "").trim();
    return withoutTrailingNumber || withoutCopy || name.trim() || fallback;
  };

  const nextNumberedMemberName = (member: Member): string => {
    const group = getMemberGroupForMemberId(member.id);
    if (group) {
      return nextGroupMemberName(group.name);
    }
    const baseName = getNumberedDuplicateBaseName(member.name, "メンバー");
    let nextNumber = 1;
    while (
      project.members.some((item) => item.name === `${baseName}${nextNumber}`)
    ) {
      nextNumber += 1;
    }
    return `${baseName}${nextNumber}`;
  };

  const nextNumberedObjectName = (object: StageObject): string => {
    const group = getObjectGroupForObjectId(object.id);
    if (group) {
      return nextGroupObjectName(group.name);
    }
    const baseName = getNumberedDuplicateBaseName(object.name, "道具");
    let nextNumber = 1;
    while (
      project.stageObjects.some((item) => item.name === `${baseName}${nextNumber}`)
    ) {
      nextNumber += 1;
    }
    return `${baseName}${nextNumber}`;
  };

  const isMemberVisibleInFrame = (member: Member, frameId: string): boolean => {
    const frameSnapshot = getSnapshotForFrame(project, frameId);
    return (
      (member.visible ?? true) &&
      (frameSnapshot.memberVisibility[member.id] ?? true)
    );
  };

  const isObjectVisibleInFrame = (object: StageObject, frameId: string): boolean => {
    const frameSnapshot = getSnapshotForFrame(project, frameId);
    return (
      frameSnapshot.objectStates[object.id]?.visible ?? object.visible ?? true
    ) !== false;
  };

  const nextObjectGroupName = (): string => {
    let nextNumber = 1;
    while (
      (project.objectGroups ?? []).some(
        (group) => group.name === `道具グループ${nextNumber}`,
      )
    ) {
      nextNumber += 1;
    }
    return `道具グループ${nextNumber}`;
  };

  const addMember = (input: MemberCreateInput = {}) => {
    const id = createId("m");
    const membersOnlyLock =
      activeCloudProjectRef.current?.activeProjectLock?.lockKey === "members";
    const group = (project.memberGroups ?? []).find(
      (item) => item.id === input.groupId,
    );
    const activeFrameId = selectedFrame?.id ?? project.frames[0]?.id;
    const visibleInCurrentFrame = input.visibleInCurrentFrame ?? true;
    const requestedPosition = input.position;
    const member: Member = {
      id,
      name:
        input.name?.trim() ||
        (group ? nextGroupMemberName(group.name) : nextUngroupedMemberName()),
      color:
        group?.color ??
        input.color ??
        ["#ef476f", "#118ab2", "#06d6a0", "#f59e0b", "#7c3aed"][
          project.members.length % 5
        ],
      visible: true,
      zIndex: 20 + project.members.length,
    };

    updateProject((previous) => {
      const activeFrame = previous.frames.find((frame) => frame.id === activeFrameId);
      const paradeDefaultPosition = getParadeVisibleCenterPosition(
        previous,
        activeFrame,
      );
      return {
        ...previous,
        members: [...previous.members, member],
        memberGroups: (previous.memberGroups ?? []).map((item) =>
          item.id === group?.id
            ? {
                ...item,
                memberIds: [...new Set([...item.memberIds, id])],
              }
            : item,
        ),
        frames: membersOnlyLock
          ? previous.frames
          : previous.frames.map((frame) => {
              const frameStage = {
                ...previous.stage,
                ...getEffectiveStageSize(previous, frame),
              };
              const basePosition = requestedPosition
                ? constrainMemberPosition(requestedPosition, frameStage)
                : paradeDefaultPosition
                  ? constrainMemberPosition(paradeDefaultPosition, frameStage)
                  : {
                      x: frameStage.widthMeters / 2,
                      y: frameStage.depthMeters / 2,
                    };
              const isActiveFrame = frame.id === activeFrameId;
              return {
                ...frame,
                positions: {
                  ...frame.positions,
                  [id]: basePosition,
                },
                memberVisibility: {
                  ...(frame.memberVisibility ?? {}),
                  [id]: isActiveFrame ? visibleInCurrentFrame : false,
                },
                groupVisibility:
                  group && isActiveFrame
                    ? {
                        ...(frame.groupVisibility ?? {}),
                        [group.id]: visibleInCurrentFrame,
                      }
                    : frame.groupVisibility,
              };
            }),
      };
    });
    setSelected({ type: "member", id });
    setMode("members");
    setActivePanelTab("members");
    setMemberVisibilityTab(visibleInCurrentFrame ? "visible" : "hidden");
    setIsPanelOpen(true);
    if (input.shouldScrollToNewMember !== false) {
      requestPanelScroll("member", id);
    }
    setNotice(
      group
        ? `${group.name} に ${member.name} を追加しました。`
        : "メンバーを追加しました。",
      "success",
    );
  };

  const addMemberToGroup = (
    group: MemberGroup,
    visibleInCurrentFrame = true,
  ) => {
    addMember({
      groupId: group.id,
      visibleInCurrentFrame,
      shouldScrollToNewMember: false,
    });
  };

  const addStageObject = (
    draft: StageObjectDraft = defaultStageObjectDraft,
    visibleInCurrentFrame = true,
    position?: Position,
    objectGroupId?: string,
    shouldScrollToNewObject = true,
  ) => {
    const id = createId("o");
    const objectsOnlyLock =
      activeCloudProjectRef.current?.activeProjectLock?.lockKey === "objects";
    const group = (project.objectGroups ?? []).find(
      (item) => item.id === objectGroupId,
    );
    const effectiveDraft: StageObjectDraft = group
      ? {
          ...draft,
          name: nextGroupObjectName(group.name),
          color: group.color ?? draft.color,
          type: group.defaultType ?? draft.type,
          shape: group.defaultShape ?? draft.shape,
        }
      : draft;
    const activeFrameId = selectedFrame?.id ?? project.frames[0]?.id;
    const paradeDefaultPosition = getParadeVisibleCenterPosition(
      project,
      selectedFrame ?? project.frames[0],
    );
    const center = constrainMemberPosition(
      position ??
        paradeDefaultPosition ?? {
          x: effectiveStage.widthMeters / 2,
          y: effectiveStage.depthMeters / 2,
        },
      effectiveStage,
    );
    const topLeft = constrainObjectPosition(
      {
        x: center.x - effectiveDraft.widthMeters / 2,
        y: center.y - effectiveDraft.heightMeters / 2,
      },
      effectiveDraft.widthMeters,
      effectiveDraft.heightMeters,
      effectiveStage,
    );
    const object: StageObject = {
      id,
      ...effectiveDraft,
      defaultX: topLeft.x,
      defaultY: topLeft.y,
      defaultRotation: 0,
      visible: true,
      locked: false,
      zIndex: 10 + project.stageObjects.length,
    };
    const objectState = createDefaultObjectState(object);

    updateProject((previous) => ({
      ...previous,
      stageObjects: [...previous.stageObjects, object],
      objectGroups: (previous.objectGroups ?? []).map((item) =>
        item.id === group?.id
          ? {
              ...item,
              objectIds: [...new Set([...item.objectIds, id])],
            }
          : item,
      ),
      frames: objectsOnlyLock
        ? previous.frames
        : previous.frames.map((frame) => ({
            ...frame,
            objectStates: {
              ...frame.objectStates,
              [id]: {
                ...objectState,
                visible: frame.id === activeFrameId ? visibleInCurrentFrame : false,
              },
            },
          })),
    }));
    setSelected({ type: "object", id });
    setMode("objects");
    setActivePanelTab("objects");
    setObjectVisibilityTab(visibleInCurrentFrame ? "visible" : "hidden");
    setIsPanelOpen(true);
    if (shouldScrollToNewObject) {
      requestPanelScroll("object", id);
    }
    setNotice(
      group
        ? `${group.name} に ${object.name} を追加しました。`
        : `${effectiveDraft.name}を追加しました。`,
      "success",
    );
  };

  const updateMember = (id: string, patch: Partial<Member>) => {
    updateProject((previous) => ({
      ...previous,
      members: previous.members.map((member) =>
        member.id === id ? { ...member, ...patch } : member,
      ),
    }), "メンバー編集");
  };

  const updateMembersGlobalVisibility = (ids: string[], visible: boolean) => {
    const targetIds = new Set(ids);
    updateProject((previous) => ({
      ...previous,
      members: previous.members.map((member) =>
        targetIds.has(member.id) ? { ...member, visible } : member,
      ),
    }));
  };

  const setMembersFrameVisibility = (ids: string[], visible: boolean, restore = false) => {
    if (!selectedFrame) {
      setNotice("表示状態を変更するシーンがありません。");
      return;
    }
    const targetIds = [...new Set(ids)];
    if (targetIds.length === 0) {
      return;
    }
    const activeFrameId = selectedFrame.id;
    const noticeText =
      visible
        ? `${targetIds.length}人をステージへ戻しました。`
        : `${targetIds.length}人をこのシーンで隊列外にしました。`;
    const applyChange = () => {
      updateProject((previous) => ({
        ...previous,
        members: restore ? previous.members.map((member) => targetIds.includes(member.id) && member.visible === false ? { ...member, visible: true } : member) : previous.members,
        frames: previous.frames.map((frame) => {
          if (frame.id !== activeFrameId) {
            return frame;
          }
          const frameStage = {
            ...previous.stage,
            ...getEffectiveStageSize(previous, frame),
          };
          const memberVisibility = { ...(frame.memberVisibility ?? {}) };
          const positions = { ...frame.positions };
          let objectAssignments = frame.objectAssignments;
          if (restore) targetIds.forEach((id) => { objectAssignments = removeMemberFromAssignments(objectAssignments, id); });
          targetIds.forEach((id, index) => {
            memberVisibility[id] = visible;
            if (visible && !positions[id]) {
              positions[id] = constrainMemberPosition(
                {
                  x: frameStage.widthMeters / 2 + index * 0.25,
                  y: frameStage.depthMeters / 2 + index * 0.25,
                },
                frameStage,
              );
            }
          });
          return {
            ...frame,
            memberVisibility,
            objectAssignments,
            positions,
          };
        }),
      }), restore ? "ステージへ戻す" : undefined, { coalesceHistory: !restore });
      setNotice(noticeText, "success");
    };
    if (activeCloudProjectRef.current && !activeCloudProjectRef.current.activeSceneLock) {
      const targets: SceneElementEditTarget[] = targetIds.flatMap((id) => [
        { id, type: "member-visibility" },
        ...(visible && !selectedFrame.positions[id]
          ? [{ id, type: "member-position" } as SceneElementEditTarget]
          : []),
      ]);
      if (restore) Object.entries(selectedFrame.objectAssignments ?? {}).forEach(([objectId, memberIds]) => {
        if (memberIds.some((id) => targetIds.includes(id))) targets.push({ id: objectId, type: "object-assignment" });
      });
      void runCloudSceneCellPatchEditMany("メンバー表示編集", targets, applyChange);
      return;
    }
    applyChange();
  };

  const setAllMembersFrameVisibility = (visible: boolean) => {
    if (!selectedFrame) {
      setNotice("表示状態を変更するシーンがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;
    const isCloudScenePatch =
      Boolean(activeCloudProjectRef.current) &&
      !activeCloudProjectRef.current?.activeSceneLock;
    const noticeText =
      visible
        ? "すべてのメンバーを表示し、道具割当を解除しました。"
        : "すべてのメンバーをこのシーンで非表示にしました。";
    const applyChange = () => {
      updateProject((previous) => ({
        ...previous,
        members:
          visible && !activeCloudProjectRef.current
            ? previous.members.map((member) => ({ ...member, visible: true }))
            : previous.members,
        frames: previous.frames.map((frame) => {
          if (frame.id !== activeFrameId) {
            return frame;
          }
          const frameStage = {
            ...previous.stage,
            ...getEffectiveStageSize(previous, frame),
          };
          const memberVisibility = { ...(frame.memberVisibility ?? {}) };
          const positions = { ...frame.positions };
          previous.members.forEach((member, index) => {
            memberVisibility[member.id] = visible;
            if (visible && !positions[member.id]) {
              positions[member.id] = constrainMemberPosition(
                {
                  x: frameStage.widthMeters / 2 + index * 0.18,
                  y: frameStage.depthMeters / 2 + index * 0.18,
                },
                frameStage,
              );
            }
          });
          return {
            ...frame,
            memberVisibility,
            objectAssignments: visible ? {} : frame.objectAssignments,
            positions,
          };
        }),
      }));
      setNotice(noticeText, "success");
    };
    if (isCloudScenePatch) {
      const assignmentObjectIds = visible
        ? Object.keys(selectedFrame.objectAssignments ?? {})
        : [];
      const memberTargets: SceneElementEditTarget[] = project.members.flatMap(
        (member) => [
          { id: member.id, type: "member-visibility" },
          ...(visible && !selectedFrame.positions[member.id]
            ? [{ id: member.id, type: "member-position" } as SceneElementEditTarget]
            : []),
        ],
      );
      const assignmentTargets: SceneElementEditTarget[] = assignmentObjectIds.map(
        (objectId) => ({ id: objectId, type: "object-assignment" }),
      );
      void runCloudSceneCellPatchEditMany(
        "メンバー一括表示編集",
        [...memberTargets, ...assignmentTargets],
        applyChange,
      );
      return;
    }
    applyChange();
  };

  const setGroupsFrameVisibility = (ids: string[], visible: boolean) => {
    if (!selectedFrame) {
      setNotice("表示状態を変更するシーンがありません。");
      return;
    }
    const targetIds = [...new Set(ids)];
    if (targetIds.length === 0) {
      return;
    }
    const activeFrameId = selectedFrame.id;
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((frame) =>
        frame.id === activeFrameId
          ? {
              ...frame,
              groupVisibility: targetIds.reduce<Record<string, boolean>>(
                (record, id) => {
                  record[id] = visible;
                  return record;
                },
                { ...(frame.groupVisibility ?? {}) },
              ),
            }
          : frame,
      ),
    }));
  };

  const removeMemberFromAssignments = (
    assignments: Record<string, string[]> | undefined,
    memberId: string,
  ): Record<string, string[]> => {
    const next = { ...(assignments ?? {}) };
    Object.entries(next).forEach(([objectId, memberIds]) => {
      const filtered = memberIds.filter((id) => id !== memberId);
      if (filtered.length === 0) {
        delete next[objectId];
      } else {
        next[objectId] = filtered;
      }
    });
    return next;
  };

  const updateMemberAssignmentsInCurrentFrame = async (
    updater: (
      frame: FormationFrame,
      frameStage: Project["stage"],
    ) => Pick<FormationFrame, "objectAssignments" | "memberVisibility" | "positions">,
    notice: string,
    cloudTargets: SceneElementEditTarget[] = [],
  ): Promise<boolean> => {
    if (!selectedFrame) {
      setNotice("割当を変更するシーンがありません。");
      return false;
    }
    const activeFrameId = selectedFrame.id;
    const requiresCellSave = Boolean(
      APP_FEATURES.collaboration && activeCloudProjectRef.current &&
      !activeCloudProjectRef.current.activeSceneLock && cloudTargets.length > 0,
    );
    let applied = false;
    const applyChange = () => {
      const before = projectRef.current.frames.find((frame) => frame.id === activeFrameId);
      let expected: Pick<FormationFrame, "objectAssignments" | "memberVisibility" | "positions"> | undefined;
      updateProject((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) => {
          if (frame.id !== activeFrameId) {
            return frame;
          }
          const frameStage = {
            ...previous.stage,
            ...getEffectiveStageSize(previous, frame),
          };
          expected = updater(frame, frameStage);
          return { ...frame, ...expected };
        }),
      }));
      applied = confirmAssignmentUpdate(
        before,
        projectRef.current.frames.find((frame) => frame.id === activeFrameId),
        expected,
        () => { if (!requiresCellSave) setNotice(notice, "success"); },
      );
    };
    if (requiresCellSave) {
      const savedAndApplied = await runSavedAssignmentUpdate(
        () => runCloudSceneCellPatchEditMany("道具割当編集", cloudTargets, applyChange),
        () => applied,
      );
      if (savedAndApplied) setNotice(notice, "success");
      return savedAndApplied;
    }
    applyChange();
    return applied;
  };

  const applyPreviousAssignmentsToCurrentFrame = () => {
    if (!selectedFrame) {
      setNotice("割当を反映するシーンがありません。");
      return false;
    }
    if (!selectedPreviousFrame || !selectedPreviousFrameSnapshot) {
      setNotice("反映できる直前シーンがありません。");
      return false;
    }

    const validMemberIds = new Set(project.members.map((member) => member.id));
    const transferableEntries = project.stageObjects
      .map((object) => {
        const currentVisible =
          (selectedFrameSnapshot.objectStates[object.id]?.visible ??
            object.visible ??
            true) !== false;
        const previousVisible =
          (selectedPreviousFrameSnapshot.objectStates[object.id]?.visible ??
            object.visible ??
            true) !== false;
        if (!currentVisible || !previousVisible) {
          return null;
        }
        const memberIds = [
          ...new Set(selectedPreviousFrame.objectAssignments?.[object.id] ?? []),
        ].filter((memberId) => validMemberIds.has(memberId));
        return memberIds.length > 0
          ? {
              objectId: object.id,
              memberIds,
            }
          : null;
      })
      .filter(
        (entry): entry is { objectId: string; memberIds: string[] } =>
          entry !== null,
      );

    if (transferableEntries.length === 0) {
      setNotice("反映できる前シーンの割当がありません。");
      return false;
    }

    const assignedMemberIds = new Set(
      transferableEntries.flatMap((entry) => entry.memberIds),
    );

    return updateMemberAssignmentsInCurrentFrame(
      (frame) => {
        const objectAssignments = { ...(frame.objectAssignments ?? {}) };
        transferableEntries.forEach(({ objectId, memberIds }) => {
          objectAssignments[objectId] = [...memberIds];
        });
        const memberVisibility = { ...(frame.memberVisibility ?? {}) };
        assignedMemberIds.forEach((memberId) => {
          memberVisibility[memberId] = false;
        });
        return {
          objectAssignments,
          memberVisibility,
          positions: frame.positions,
        };
      },
      `${transferableEntries.length}件の道具割当を前シーンから反映しました。`,
      [
        ...transferableEntries.map<SceneElementEditTarget>(({ objectId }) => ({
          id: objectId,
          type: "object-assignment",
        })),
        ...[...assignedMemberIds].map<SceneElementEditTarget>((memberId) => ({
          id: memberId,
          type: "member-visibility",
        })),
      ],
    );
  };

  const assignMemberToObject = (objectId: string, memberId: string) => {
    const object = project.stageObjects.find((item) => item.id === objectId);
    const member = project.members.find((item) => item.id === memberId);
    if (!object || !member) {
      setNotice("割り当てる道具またはメンバーが見つかりません。");
      return false;
    }
    return updateMemberAssignmentsInCurrentFrame(
      (frame) => {
        const objectAssignments = { ...(frame.objectAssignments ?? {}) };
        objectAssignments[objectId] = [
          ...new Set([...(objectAssignments[objectId] ?? []), memberId]),
        ];
        return {
          objectAssignments,
          memberVisibility: {
            ...(frame.memberVisibility ?? {}),
            [memberId]: false,
          },
          positions: frame.positions,
        };
      },
      `${member.name} を ${object.name} に割り当てました。`,
      [
        { id: objectId, type: "object-assignment" },
        { id: memberId, type: "member-visibility" },
      ],
    );
  };

  const removeObjectAssignment = (
    objectId: string,
    memberId: string,
    restoreMember = false,
  ) => {
    const object = project.stageObjects.find((item) => item.id === objectId);
    const member = project.members.find((item) => item.id === memberId);
    return updateMemberAssignmentsInCurrentFrame(
      (frame, frameStage) => {
        const objectAssignments = { ...(frame.objectAssignments ?? {}) };
        const nextMembers = (objectAssignments[objectId] ?? []).filter(
          (id) => id !== memberId,
        );
        if (nextMembers.length === 0) {
          delete objectAssignments[objectId];
        } else {
          objectAssignments[objectId] = nextMembers;
        }
        const memberVisibility = { ...(frame.memberVisibility ?? {}) };
        const positions = { ...frame.positions };
        if (restoreMember) {
          memberVisibility[memberId] = true;
          if (!positions[memberId]) {
            positions[memberId] = constrainMemberPosition(
              {
                x: frameStage.widthMeters / 2,
                y: frameStage.depthMeters / 2,
              },
              frameStage,
            );
          }
        }
        return { objectAssignments, memberVisibility, positions };
      },
      restoreMember
        ? `${member?.name ?? "メンバー"} をステージへ戻しました。`
            : `${object?.name ?? "道具"} の割当を解除しました。`,
      [
        { id: objectId, type: "object-assignment" },
        ...(restoreMember
          ? [
              { id: memberId, type: "member-visibility" } as SceneElementEditTarget,
              ...(!selectedFrame?.positions[memberId]
                ? [{ id: memberId, type: "member-position" } as SceneElementEditTarget]
                : []),
            ]
          : []),
      ],
    );
  };

  const clearMemberObjectAssignments = (
    memberId: string,
    restoreMember = false,
  ) => {
    const member = project.members.find((item) => item.id === memberId);
    const assignedObjectIds = Object.entries(selectedFrame?.objectAssignments ?? {})
      .filter(([, memberIds]) => memberIds.includes(memberId))
      .map(([objectId]) => objectId);
    updateMemberAssignmentsInCurrentFrame(
      (frame, frameStage) => {
        const objectAssignments = removeMemberFromAssignments(
          frame.objectAssignments,
          memberId,
        );
        const memberVisibility = { ...(frame.memberVisibility ?? {}) };
        const positions = { ...frame.positions };
        if (restoreMember) {
          memberVisibility[memberId] = true;
          if (!positions[memberId]) {
            positions[memberId] = constrainMemberPosition(
              {
                x: frameStage.widthMeters / 2,
                y: frameStage.depthMeters / 2,
              },
              frameStage,
            );
          }
        }
        return { objectAssignments, memberVisibility, positions };
      },
      restoreMember
        ? `${member?.name ?? "メンバー"} の割当を解除してステージへ戻しました。`
        : `${member?.name ?? "メンバー"} の道具割当を解除しました。`,
      [
        ...assignedObjectIds.map<SceneElementEditTarget>((objectId) => ({
          id: objectId,
          type: "object-assignment",
        })),
        ...(restoreMember
          ? [
              { id: memberId, type: "member-visibility" } as SceneElementEditTarget,
              ...(!selectedFrame?.positions[memberId]
                ? [{ id: memberId, type: "member-position" } as SceneElementEditTarget]
                : []),
            ]
          : []),
      ],
    );
  };

  const deleteMember = (id: string) => {
    const membersOnlyLock =
      activeCloudProjectRef.current?.activeProjectLock?.lockKey === "members";
    updateProject((previous) => ({
      ...previous,
      members: previous.members.filter((member) => member.id !== id),
      memberGroups: (previous.memberGroups ?? []).map((group) => ({
        ...group,
        memberIds: group.memberIds.filter((memberId) => memberId !== id),
      })),
      focusMemberId:
        previous.focusMemberId === id ? undefined : previous.focusMemberId,
      frames: membersOnlyLock
        ? previous.frames
        : previous.frames.map((frame) => {
            const { [id]: removed, ...positions } = frame.positions;
            const { [id]: removedVisibility, ...memberVisibility } =
              frame.memberVisibility ?? {};
            const {
              [id]: removedAppearance,
              ...memberAppearanceOverrides
            } = frame.memberAppearanceOverrides ?? {};
            void removed;
            void removedVisibility;
            void removedAppearance;
            return {
              ...frame,
              memberVisibility,
              memberAppearanceOverrides:
                Object.keys(memberAppearanceOverrides).length > 0
                  ? memberAppearanceOverrides
                  : undefined,
              objectAssignments: removeMemberFromAssignments(
                frame.objectAssignments,
                id,
              ),
              positions,
            };
          }),
    }));
    if (projectRef.current.members.some((item) => item.id === id)) return false;
    if (selected?.type === "member" && selected.id === id) {
      setSelected(null);
    }
    setSelectedMemberIds((previous) =>
      previous.filter((memberId) => memberId !== id),
    );
    return true;
  };

  const updateObject = (id: string, patch: Partial<StageObject>) => {
    updateProject((previous) => ({
      ...previous,
      stageObjects: previous.stageObjects.map((object) =>
        object.id === id
          ? {
              ...object,
              ...patch,
              widthMeters: Math.max(
                0.1,
                patch.widthMeters ?? object.widthMeters,
              ),
              heightMeters: Math.max(
                0.1,
                patch.heightMeters ?? object.heightMeters,
              ),
            }
          : object,
      ),
    }), "道具編集");
  };

  const updateObjectState = (id: string, patch: Partial<ObjectState>) => {
    if (!selectedFrame || canvasPlaybackRef.current) {
      return;
    }
    const activeFrameId = selectedFrame.id;
    const applyChange = () => {
      if (canvasPlaybackRef.current) return;
      updateProject((previous) => {
        const object = previous.stageObjects.find((item) => item.id === id);
        if (!object) {
          return previous;
        }
        return {
          ...previous,
          frames: previous.frames.map((frame) =>
            frame.id === activeFrameId
              ? updateObjectStateInFrame(frame, object, patch)
              : frame,
          ),
        };
      }, "道具配置編集");
    };
    if (activeCloudProjectRef.current && !activeCloudProjectRef.current.activeSceneLock) {
      const patchKeys = Object.keys(patch);
      const target: SceneElementEditTarget =
        patchKeys.length === 1 &&
        Object.prototype.hasOwnProperty.call(patch, "visible") &&
        Boolean(selectedFrame.objectStates[id])
          ? { id, type: "object-visibility" }
          : { id, type: "object-state" };
      const lockTarget = createSceneCellLockTarget(
        activeFrameId,
        getSceneCellPatchType(target),
        target.id,
      );
      const alreadyLocked = activeCloudCellLocksRef.current.some(
        (lock) => lock.targetId === lockTarget.targetId,
      );
      if (!alreadyLocked) {
        void runCloudSceneCellPatchEditMany(
          target.type === "object-visibility" ? "道具表示編集" : "道具配置編集",
          [target],
          applyChange,
        );
        return;
      }
    }
    applyChange();
  };

  const deleteObject = (id: string) => {
    const objectsOnlyLock =
      activeCloudProjectRef.current?.activeProjectLock?.lockKey === "objects";
    updateProject((previous) => ({
      ...previous,
      stageObjects: previous.stageObjects.filter((object) => object.id !== id),
      objectGroups: (previous.objectGroups ?? []).map((group) => ({
        ...group,
        objectIds: group.objectIds.filter((objectId) => objectId !== id),
      })),
      frames: objectsOnlyLock
        ? previous.frames
        : previous.frames.map((frame) => {
            const { [id]: removed, ...objectStates } = frame.objectStates;
            const { [id]: removedAssignments, ...objectAssignments } =
              frame.objectAssignments ?? {};
            void removed;
            void removedAssignments;
            return { ...frame, objectStates, objectAssignments };
          }),
    }));
    if (projectRef.current.stageObjects.some((item) => item.id === id)) return false;
    if (selected?.type === "object" && selected.id === id) {
      setSelected(null);
    }
    return true;
  };

  const confirmAndDeleteMember = async (id: string) => {
    const member = projectRef.current.members.find((item) => item.id === id);
    if (!member) {
      return false;
    }
    const confirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "名簿から削除",
      message: `「${member.name}」を名簿から削除します。全シーンの配置と道具割当からも削除されます。`,
      title: "名簿から削除",
      tone: "danger",
    });
    if (!confirmed) {
      return false;
    }
    if (!deleteMember(id)) return false;
    setNotice(`${member.name} を名簿から削除しました。`, "success");
    return true;
  };

  const confirmAndDeleteObject = async (id: string) => {
    const object = projectRef.current.stageObjects.find((item) => item.id === id);
    if (!object) {
      return false;
    }
    const confirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "名簿から削除",
      message: `「${object.name}」を名簿から削除します。全シーンの配置と道具割当からも削除されます。`,
      title: "名簿から削除",
      tone: "danger",
    });
    if (!confirmed) {
      return false;
    }
    if (!deleteObject(id)) return false;
    setNotice(`${object.name} を名簿から削除しました。`, "success");
    return true;
  };

  const nudgeObjectZ = (id: string, delta: number) => {
    const current = snapshot.objectStates[id];
    updateObject(id, { zIndex: Math.max(0, (current?.zIndex ?? 0) + delta) });
    updateObjectState(id, { zIndex: Math.max(0, (current?.zIndex ?? 0) + delta) });
  };

  const updateStage = (patch: Partial<Project["stage"]>) => {
    updateProject((previous) => ({
      ...previous,
      stage: {
        ...previous.stage,
        ...patch,
        widthMeters: Math.max(1, patch.widthMeters ?? previous.stage.widthMeters),
        depthMeters: Math.max(1, patch.depthMeters ?? previous.stage.depthMeters),
        gridSizeMeters: Math.max(
          0.1,
          patch.gridSizeMeters ?? previous.stage.gridSizeMeters,
        ),
        frontDirection:
          patch.frontDirection ??
          previous.stage.frontDirection ??
          previous.stage.audienceSide ??
          "bottom",
        originMode: patch.originMode ?? previous.stage.originMode ?? "center",
        showCenterMarker:
          patch.showCenterMarker ?? previous.stage.showCenterMarker ?? true,
        horizontalGuideMode:
          patch.horizontalGuideMode ??
          previous.stage.horizontalGuideMode ??
          "meters",
        memberDiameterMeters: Math.min(
          1,
          Math.max(
            0.2,
            patch.memberDiameterMeters ??
              previous.stage.memberDiameterMeters ??
              0.5,
          ),
        ),
      },
    }), "ステージ設定編集");
  };

  const updateParadeSettings = (patch: Partial<ParadeSettings>) => {
    updateProject((previous) => {
      const nextParadeSettings = createDefaultParadeSettings({
        ...(previous.paradeSettings ?? {}),
        ...patch,
      });
      return {
        ...previous,
        paradeSettings: nextParadeSettings,
        stage: {
          ...previous.stage,
          widthMeters: nextParadeSettings.width,
          depthMeters: nextParadeSettings.totalDistance,
          gridSizeMeters: nextParadeSettings.cellSizeMeters,
          gridIntervalM: nextParadeSettings.cellSizeMeters,
        },
      };
    }, "パレード設定編集");
  };

  const setAllObjectsFrameVisibility = (visible: boolean) => {
    if (!selectedFrame) {
      setNotice("表示状態を変更するシーンがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;
    const noticeText =
      visible
        ? "すべての道具をこのシーンで表示しました。"
        : "すべての道具をこのシーンで非表示にしました。";
    const applyChange = () => {
      updateProject((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) => {
          if (frame.id !== activeFrameId) {
            return frame;
          }
          const objectStates = { ...frame.objectStates };
          previous.stageObjects.forEach((object) => {
            objectStates[object.id] = {
              ...(objectStates[object.id] ?? createDefaultObjectState(object)),
              visible,
            };
          });
          return {
            ...frame,
            objectStates,
          };
        }),
      }));
      setNotice(noticeText, "success");
    };
    if (activeCloudProjectRef.current && !activeCloudProjectRef.current.activeSceneLock) {
      const targets: SceneElementEditTarget[] = project.stageObjects.map((object) => ({
        id: object.id,
        type: selectedFrame.objectStates[object.id] ? "object-visibility" : "object-state",
      }));
      void runCloudSceneCellPatchEditMany("道具一括表示編集", targets, applyChange);
      return;
    }
    applyChange();
  };

  const applyPreviousSceneStateToCurrentFrame = (
    includeVisible: boolean,
    selectedOnly = false,
  ) => {
    if (!selectedFrame) {
      setNotice("反映するシーンがありません。");
      return;
    }
    const sortedFrames = sortFrames(project.frames);
    const selectedIndex = sortedFrames.findIndex(
      (frame) => frame.id === selectedFrame.id,
    );
    if (selectedIndex <= 0) {
      setNotice("反映できる直前シーンがありません。");
      return;
    }
    if (selectedOnly && !selected) {
      setNotice("選択中のメンバーまたは道具がありません。");
      return;
    }

    const targetMemberIds =
      selectedOnly && selected?.type === "member"
        ? [selected.id]
        : selectedOnly
          ? []
          : project.members.map((member) => member.id);
    const targetObjectIds =
      selectedOnly && selected?.type === "object"
        ? [selected.id]
        : selectedOnly
          ? []
          : project.stageObjects.map((object) => object.id);
    if (targetMemberIds.length + targetObjectIds.length === 0) {
      setNotice("反映するメンバーまたは道具がありません。");
      return;
    }

    const activeFrameId = selectedFrame.id;
    updateProject((previous) => {
      const nextSortedFrames = sortFrames(previous.frames);
      const currentIndex = nextSortedFrames.findIndex(
        (frame) => frame.id === activeFrameId,
      );
      if (currentIndex <= 0) {
        return previous;
      }
      const targetMembers = previous.members.filter((member) =>
        targetMemberIds.includes(member.id),
      );
      const targetIds = new Set(targetObjectIds);
      const targetObjects = previous.stageObjects.filter((object) =>
        targetIds.has(object.id),
      );

      return {
        ...previous,
        frames: previous.frames.map((frame) => {
          if (frame.id !== activeFrameId) {
            return frame;
          }
          const stageSize = getEffectiveStageSize(previous, frame);
          const fallbackPosition = {
            x: stageSize.widthMeters / 2,
            y: stageSize.depthMeters / 2,
          };
          const positions = { ...frame.positions };
          const memberVisibility = { ...(frame.memberVisibility ?? {}) };
          const objectStates = { ...frame.objectStates };
          targetMembers.forEach((member) => {
            const source = resolvePreviousMemberPositionForApply(
              member.id,
              nextSortedFrames,
              currentIndex - 1,
              frame,
              fallbackPosition,
            );
            positions[member.id] = {
              x: source.x,
              y: source.y,
            };
            if (includeVisible) {
              memberVisibility[member.id] = resolvePreviousMemberVisibilityForApply(
                member.id,
                nextSortedFrames,
                currentIndex - 1,
              );
            }
          });
          targetObjects.forEach((object) => {
            const current =
              objectStates[object.id] ?? createDefaultObjectState(object);
            const source = resolvePreviousObjectStateForApply(
              object,
              nextSortedFrames,
              currentIndex - 1,
              frame,
            );
            objectStates[object.id] = {
              ...current,
              x: source.x,
              y: source.y,
              widthMeters: Math.max(0.1, source.widthMeters),
              heightMeters: Math.max(0.1, source.heightMeters),
              rotation: source.rotation,
              zIndex: source.zIndex,
              visible: includeVisible ? source.visible : current.visible,
            };
          });
          return {
            ...frame,
            memberVisibility,
            positions,
            objectStates,
          };
        }),
      };
    }, selectedOnly ? "選択中を前シーン反映" : "前シーン反映");
    const targetSummary = [
      targetMemberIds.length > 0 ? `${targetMemberIds.length}人のメンバー` : null,
      targetObjectIds.length > 0 ? `${targetObjectIds.length}件の道具` : null,
    ]
      .filter(Boolean)
      .join("と");
    setNotice(
      includeVisible
        ? `${targetSummary}を直前シーンから反映しました。`
        : `${targetSummary}を直前シーンから反映しました。表示/非表示は維持しています。`,
      "success",
    );
  };

  const updateUseGlobalStageSize = (enabled: boolean) => {
    updateProject((previous) => ({
      ...previous,
      useGlobalStageSize: enabled,
      useGlobalStageWidth: enabled,
      frames: enabled
        ? previous.frames
        : previous.frames.map((frame) => ({
            ...frame,
            stageWidthMeters:
              frame.stageWidthMeters ?? previous.stage.widthMeters,
            stageDepthMeters:
              frame.stageDepthMeters ?? previous.stage.depthMeters,
      })),
    }));
  };

  const clearCloudMemberPositionPreview = (
    sceneId: string,
    memberId: string,
  ) => {
    const previewKey = getCloudMemberPositionPreviewKey(sceneId, memberId);
    setCloudMemberPositionPreviews((previous) => {
      if (!(previewKey in previous)) {
        return previous;
      }
      const { [previewKey]: _ignored, ...rest } = previous;
      void _ignored;
      return rest;
    });
  };

  const clearCloudObjectStatePreview = (
    sceneId: string,
    objectId: string,
  ) => {
    const previewKey = getCloudObjectStatePreviewKey(sceneId, objectId);
    setCloudObjectStatePreviews((previous) => {
      if (!(previewKey in previous)) {
        return previous;
      }
      const { [previewKey]: _ignored, ...rest } = previous;
      void _ignored;
      return rest;
    });
  };

  const sendCloudSceneCellPreview = (
    sceneId: string,
    patchType: "member_position" | "object_state",
    cellId: string,
    value: Position | ObjectState,
  ) => {
    const cloudState = activeCloudProjectRef.current;
    const subscription = cloudRealtimeSubscriptionRef.current;
    if (!cloudState || !subscription || cloudState.role === "viewer") {
      return;
    }
    const target = createSceneCellLockTarget(
      sceneId,
      patchType,
      cellId,
    );
    const activeLock = activeCloudCellLocksRef.current.find(
      (lock) =>
        lock.targetId === target.targetId &&
        lock.patchType === patchType &&
        lock.sceneId === sceneId &&
        lock.cellId === cellId,
    );
    if (
      !activeLock ||
      !activeLock.holderClientId ||
      !activeLock.leaseId ||
      !activeLock.operationId
    ) {
      return;
    }
    const now = Date.now();
    const lastSentAt = cloudPreviewLastSentAtRef.current[target.targetId] ?? 0;
    if (now - lastSentAt < CLOUD_PREVIEW_SEND_INTERVAL_MS) {
      return;
    }
    cloudPreviewLastSentAtRef.current[target.targetId] = now;
    const operationKey = `${activeLock.leaseId}:${activeLock.operationId}`;
    const seq = (cloudPreviewSeqByOperationRef.current[operationKey] ?? 0) + 1;
    cloudPreviewSeqByOperationRef.current[operationKey] = seq;
    cloudLockActivityRef.current = true;
    void subscription.sendPreview({
      cellId,
      cellKind: patchType,
      holderClientId: activeLock.holderClientId,
      leaseId: activeLock.leaseId,
      operationId: activeLock.operationId,
      projectId: cloudState.projectId,
      sceneId,
      seq,
      sentAt: new Date().toISOString(),
      value,
    });
  };

  const moveMember = (id: string, position: Position) => {
    if (!selectedFrame || canvasPlaybackRef.current) {
      return;
    }
    const activeFrameId = selectedFrame.id;
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((frame) =>
        frame.id === activeFrameId
          ? {
              ...frame,
              positions: {
                ...frame.positions,
                [id]: position,
              },
            }
          : frame,
      ),
    }));
    sendCloudSceneCellPreview(activeFrameId, "member_position", id, position);
  };

  const moveObject = (id: string, patch: Partial<ObjectState>) => {
    if (canvasPlaybackRef.current) return;
    const objectState = snapshot.objectStates[id];
    if (!objectState) {
      updateObjectState(id, patch);
      return;
    }
    const nextPatch: Partial<ObjectState> =
      patch.x !== undefined || patch.y !== undefined
        ? constrainObjectPosition(
            {
              x: patch.x ?? objectState.x,
              y: patch.y ?? objectState.y,
            },
            patch.widthMeters ?? objectState.widthMeters,
            patch.heightMeters ?? objectState.heightMeters,
            effectiveStage,
          )
        : patch;
    updateObjectState(id, nextPatch);
    if (selectedFrame) {
      const nextState = {
        ...objectState,
        ...nextPatch,
        widthMeters: Math.max(
          0.1,
          nextPatch.widthMeters ?? objectState.widthMeters,
        ),
        heightMeters: Math.max(
          0.1,
          nextPatch.heightMeters ?? objectState.heightMeters,
        ),
      };
      sendCloudSceneCellPreview(
        selectedFrame.id,
        "object_state",
        id,
        nextState,
      );
    }
  };

  const scrollKeyboardTargetIntoView = (bounds: CanvasScrollBounds | null) => {
    if (!bounds) {
      return;
    }
    window.requestAnimationFrame(() => {
      stageExportRef.current?.scrollTargetIntoView?.(bounds);
    });
  };

  const getKeyboardMoveBounds = (
    memberIds: string[],
    objectId: string | null,
    delta: Position,
  ): CanvasScrollBounds | null => {
    const boundsList: CanvasScrollBounds[] = [];
    const memberDiameter = project.stage.memberDiameterMeters ?? 0.5;

    memberIds.forEach((memberId) => {
      const current = snapshot.positions[memberId];
      if (!current) {
        return;
      }
      const position = constrainMemberPosition(
        {
          x: roundMeters(current.x + delta.x),
          y: roundMeters(current.y + delta.y),
        },
        effectiveStage,
      );
      boundsList.push({
        heightMeters: memberDiameter,
        widthMeters: memberDiameter,
        x: position.x - memberDiameter / 2,
        y: position.y - memberDiameter / 2,
      });
    });

    if (objectId) {
      const object = project.stageObjects.find((item) => item.id === objectId);
      const current =
        snapshot.objectStates[objectId] ??
        (object ? createDefaultObjectState(object) : null);
      if (current) {
        const position = constrainObjectPosition(
          {
            x: roundMeters(current.x + delta.x),
            y: roundMeters(current.y + delta.y),
          },
          current.widthMeters,
          current.heightMeters,
          effectiveStage,
        );
        boundsList.push({
          heightMeters: current.heightMeters,
          widthMeters: current.widthMeters,
          x: position.x,
          y: position.y,
        });
      }
    }

    return unionCanvasBounds(boundsList);
  };

  function nudgeSelectionByKeyboard(event: KeyboardEvent): boolean {
    const delta = getKeyboardNudgeDelta(
      event,
      project.mode === "parade" ? "audience" : viewerPerspective,
      project.stage.gridSizeMeters,
    );
    if (!delta) {
      return false;
    }

    const memberIds =
      selected?.type === "object"
        ? []
        : [
            ...new Set([
              ...(selected?.type === "member" ? [selected.id] : []),
              ...selectedMemberIds,
            ]),
          ];
    const objectId = selected?.type === "object" ? selected.id : null;
    if (memberIds.length === 0 && !objectId) {
      return false;
    }
    if (!selectedFrame) {
      setNotice("移動するシーンがありません。");
      return true;
    }
    if (isPlaying || animationPreviewTimeSec !== null) {
      setNotice("キーボード移動は停止中に使えます。");
      return true;
    }

    const lockedObject = objectId
      ? project.stageObjects.find((object) => object.id === objectId)
      : undefined;
    if (lockedObject?.locked) {
      setNotice(`${lockedObject.name} はロック中です。`);
      return true;
    }

    const activeFrameId = selectedFrame.id;
    const scrollBounds = getKeyboardMoveBounds(memberIds, objectId, delta);
    const applyKeyboardMove = () => {
      updateProject((previous) => {
        const targetFrame = previous.frames.find(
          (frame) => frame.id === activeFrameId,
        );
        if (!targetFrame) {
          return previous;
        }
        const frameStage = {
          ...previous.stage,
          ...getEffectiveStageSize(previous, targetFrame),
        };

        return {
          ...previous,
          frames: previous.frames.map((frame) => {
            if (frame.id !== activeFrameId) {
              return frame;
            }

            const nextPositions = { ...frame.positions };
            memberIds.forEach((memberId) => {
              if (!previous.members.some((member) => member.id === memberId)) {
                return;
              }
              const current = nextPositions[memberId] ?? {
                x: frameStage.widthMeters / 2,
                y: frameStage.depthMeters / 2,
              };
              const constrained = constrainMemberPosition(
                {
                  x: roundMeters(current.x + delta.x),
                  y: roundMeters(current.y + delta.y),
                },
                frameStage,
              );
              nextPositions[memberId] = {
                x: roundMeters(constrained.x),
                y: roundMeters(constrained.y),
              };
            });

            let nextObjectStates = frame.objectStates;
            if (objectId) {
              const object = previous.stageObjects.find(
                (item) => item.id === objectId,
              );
              if (object) {
                const current =
                  frame.objectStates[objectId] ?? createDefaultObjectState(object);
                const position = constrainObjectPosition(
                  {
                    x: roundMeters(current.x + delta.x),
                    y: roundMeters(current.y + delta.y),
                  },
                  current.widthMeters,
                  current.heightMeters,
                  frameStage,
                );
                nextObjectStates = {
                  ...frame.objectStates,
                  [objectId]: {
                    ...current,
                    ...position,
                  },
                };
              }
            }

            return {
              ...frame,
              positions: nextPositions,
              objectStates: nextObjectStates,
            };
          }),
        };
      }, "キーボード移動");
      scrollKeyboardTargetIntoView(scrollBounds);
    };
    if (activeCloudProjectRef.current && !activeCloudProjectRef.current.activeSceneLock) {
      const targets: SceneElementEditTarget[] = [
        ...memberIds.map<SceneElementEditTarget>((memberId) => ({
          id: memberId,
          type: "member-position",
        })),
        ...(objectId ? [{ id: objectId, type: "object-state" } as SceneElementEditTarget] : []),
      ];
      void runCloudSceneCellPatchEditMany("キーボード移動", targets, applyKeyboardMove);
      return true;
    }
    applyKeyboardMove();

    return true;
  }

  const saveCurrentFormation = async () => {
    if (!selectedFrame) {
      setNotice("保存先のフレームがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;
    const currentSnapshot = snapshot;
    // 現在表示されている隊形を、選択中フレームのProjectデータとして固定する。
    const nextProject = {
      ...projectRef.current,
      frames: projectRef.current.frames.map((frame) =>
        frame.id === activeFrameId
          ? {
              ...frame,
              positions: currentSnapshot.positions,
              objectStates: currentSnapshot.objectStates,
            }
          : frame,
      ),
      updatedAt: new Date().toISOString(),
    };
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((frame) =>
        frame.id === activeFrameId
          ? {
              ...frame,
              positions: currentSnapshot.positions,
              objectStates: currentSnapshot.objectStates,
            }
          : frame,
      ),
    }));
    if (activeCloudProjectRef.current && APP_FEATURES.collaboration) {
      await saveCloudCurrentScene(nextProject, activeFrameId);
      return;
    }
    setNotice(`「${selectedFrame.label}」に現在の隊形を保存しました。`, "success");
  };

  const savePersonalCloudProject = async (
    sourceProject: Project,
    options: { showNotice?: boolean } = { showNotice: true },
  ): Promise<boolean> => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      setNotice("自分専用クラウドの保存情報を確認できませんでした。");
      return false;
    }
    const localDraft = {
      baseUpdatedAt: cloudState.updatedAt ?? null,
      cloudProjectId: cloudState.projectId,
      project: cloneProject(sourceProject),
      savedAt: new Date().toISOString(),
    };
    try {
      await writePersonalCloudDraft(localDraft);
    } catch (error) {
      console.warn("本人専用クラウドの端末ドラフトを保存できませんでした。", error);
      setNotice("端末内の一時保存に失敗しました。空き容量を確認してください。");
      return false;
    }
    if (!navigator.onLine) {
      setNotice("オフラインのため端末へ保存しました。接続後に保存するとクラウドへ同期します。");
      return true;
    }
    if (isSaving) {
      return false;
    }
    setIsSaving(true);
    let api: CloudApiClient | null = null;
    let lockToken: string | null = null;
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("端末へ保存しました。クラウドへ同期するには再度ログインしてください。");
        return true;
      }
      api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const remoteParts = await api.loadCloudProjectParts(cloudState.projectId);
      const remoteUpdatedAt = remoteParts.updatedAt ?? null;
      const hasConflict =
        Boolean(cloudState.updatedAt) &&
        Boolean(remoteUpdatedAt) &&
        cloudState.updatedAt !== remoteUpdatedAt;
      if (hasConflict) {
        const overwrite = await requestAppConfirm({
          cancelLabel: "端末に残す",
          confirmLabel: "クラウドを上書き",
          message:
            "この隊列表を開いた後にクラウド側も更新されています。端末の内容で上書きすると、現在のクラウド版は履歴へ退避されます。",
          title: "クラウド側に新しい更新があります",
          tone: "default",
        });
        if (!overwrite) {
          setNotice("同期せず端末へ保存しました。次回開いた時も続きを選べます。");
          return true;
        }
      }

      const target = createProjectLockTarget("import");
      lockToken = createCloudLockToken();
      const lockResult = await api.acquireEditLock(
        cloudState.projectId,
        target,
        lockToken,
      );
      if (!lockResult.success) {
        setNotice("端末へ保存しました。クラウドが処理中のため同期は保留しました。");
        return true;
      }
      saveCloudLockTokenToSession(cloudState.projectId, target, lockToken);
      const result = await api.importCloudProjectWithLock(
        cloudState.projectId,
        createCloudProjectDraft(sourceProject, {
          resourceVersion: 1,
          sceneVersion: 1,
        }),
        lockToken,
        "iPad personal cloud sync",
      );
      clearCloudLockTokenFromSession(cloudState.projectId, target);
      lockToken = null;
      if (!result.success) {
        setNotice("端末へ保存しましたが、クラウド同期に失敗しました。後でもう一度保存してください。");
        return true;
      }

      const syncedParts = await api.loadCloudProjectParts(cloudState.projectId);
      const { resourceVersions, sceneVersions } = createCloudVersionMaps(syncedParts);
      const sceneCellVersions = createCloudSceneCellVersionMap(
        await api.listSceneCellVersions(cloudState.projectId),
      );
      const updatedAt =
        syncedParts.updatedAt ?? result.updated_at ?? new Date().toISOString();
      const syncedProject = normalizeProject({
        ...sourceProject,
        updatedAt,
      });
      projectRef.current = syncedProject;
      setProject(syncedProject);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              resourceVersions,
              sceneCellVersions,
              sceneVersions,
              title: syncedProject.title,
              updatedAt,
            }
          : previous,
      );
      await deletePersonalCloudDraft(cloudState.projectId);
      setIsDirty(false);
      if (options.showNotice ?? true) {
        setNotice("端末の変更を自分専用クラウドへ同期しました。");
      }
      return true;
    } catch (error) {
      console.warn("本人専用クラウドの同期に失敗しました。", error);
      setNotice("端末へ保存しました。通信を確認し、後でもう一度保存してください。");
      return true;
    } finally {
      if (api && lockToken) {
        const target = createProjectLockTarget("import");
        try {
          await api.releaseEditLock(cloudState.projectId, target, lockToken);
        } catch {
          // TTL also releases an interrupted import lock.
        }
        clearCloudLockTokenFromSession(cloudState.projectId, target);
      }
      setIsSaving(false);
    }
  };

  const saveProjectManually = async (
    options: { showNotice?: boolean } = { showNotice: true },
  ): Promise<boolean> => {
    if (isSharedProject) {
      setNotice("共有データで開いた隊列表は、自分の一覧に追加してから保存できます。");
      return false;
    }
    const cloudState = activeCloudProjectRef.current;
    if (cloudState && !APP_FEATURES.collaboration) {
      return savePersonalCloudProject(projectRef.current, options);
    }
    if (cloudState?.activeProjectLock) {
      if (cloudState.activeProjectLock.lockKey === "import") {
        setNotice("クラウド上書き中です。完了まで待ってください。");
        return false;
      }
      return saveCloudProjectResource(
        projectRef.current,
        cloudState.activeProjectLock.lockKey,
        options,
      );
    }
    if (cloudState) {
      return saveCloudCurrentScene(projectRef.current, selectedFrameIdRef.current, options);
    }
    if (isSaving) {
      return false;
    }
    setIsSaving(true);
    clearPendingAutoSave();
    const nextProject = {
      ...projectRef.current,
      updatedAt: new Date().toISOString(),
    };
    try {
      projectRef.current = nextProject;
      setProject(nextProject);
      saveProjectToStorage(nextProject);
      setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
      setIsDirty(false);
      if (options.showNotice ?? true) {
        setNotice("隊列表を保存しました。", "success");
      }
      return true;
    } catch {
      setIsDirty(true);
      setNotice("保存に失敗しました。もう一度保存してから戻ってください。");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const createFrameDraft = (sourceProject: Project, timeSec?: number): FormationFrame => {
    const sortedFrames = sortFrames(sourceProject.frames);
    const lastFrame = sortedFrames[sortedFrames.length - 1];
    const fallbackTime = (lastFrame?.timeSec ?? 0) + 8;
    const frameTime = Math.max(0, timeSec ?? (currentTime > 0 ? currentTime : fallbackTime));
    const id = createId("f");
    return {
      id,
      label: `Scene ${sourceProject.frames.length + 1}`,
      timeSec: Number(frameTime.toFixed(2)),
      section: "",
      notes: "",
      stageWidthMeters:
        project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
          ? undefined
          : effectiveStage.widthMeters,
      stageDepthMeters:
        project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
          ? undefined
          : effectiveStage.depthMeters,
      memberVisibility: selectedFrame?.memberVisibility
        ? { ...selectedFrame.memberVisibility }
        : undefined,
      groupVisibility: selectedFrame?.groupVisibility
        ? { ...selectedFrame.groupVisibility }
        : undefined,
      objectAssignments: selectedFrame?.objectAssignments
        ? Object.fromEntries(
            Object.entries(selectedFrame.objectAssignments).map(
              ([objectId, memberIds]) => [objectId, [...memberIds]],
            ),
          )
        : undefined,
      memberAppearanceOverrides: selectedFrame?.memberAppearanceOverrides
        ? { ...selectedFrame.memberAppearanceOverrides }
        : undefined,
      positions: Object.fromEntries(
        Object.entries(snapshot.positions).map(([memberId, position]) => [
          memberId,
          { ...position },
        ]),
      ),
      objectStates: Object.fromEntries(
        Object.entries(snapshot.objectStates).map(([objectId, objectState]) => [
          objectId,
          { ...objectState },
        ]),
      ),
    };
  };

  const addCloudFrame = async (timeSec?: number) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState) {
      return;
    }
    if (cloudState.role !== "owner") {
      setNotice("クラウドでシーンを追加できるのはownerのみです。");
      return;
    }
    if (isCloudBusyRef.current || isSaving) {
      setNotice("クラウド処理中です。少し待ってからもう一度試してください。");
      return;
    }
    const lockReady = await beginCloudProjectResourceEdit("sceneOrder", {
      silent: true,
    });
    if (!lockReady) {
      return;
    }
    let saved = false;
    try {
      const sourceProject = projectRef.current;
      const frame = createFrameDraft(sourceProject, timeSec);
      const nextProject = {
        ...sourceProject,
        frames: [...sourceProject.frames, frame],
      };
      saved = await saveCloudProjectResource(nextProject, "sceneOrder", {
        showNotice: false,
      });
      if (!saved) {
        return;
      }
      setSelectedFrameId(frame.id);
      setActivePanelTab("timeline");
    } finally {
      if (activeCloudProjectRef.current?.activeProjectLock?.lockKey === "sceneOrder") {
        const released = await releaseActiveCloudProjectLock({ silent: true });
        if (saved) {
          setNotice(
            released
              ? "シーンを追加してクラウドへ保存しました。"
              : "シーンを追加しました。全体編集ロックはTTLで自動解除されます。",
          );
        } else if (!released) {
          setNotice("シーン追加は保存されませんでした。全体編集ロックはTTLで自動解除されます。");
        }
      }
    }
  };

  const addFrame = (timeSec?: number) => {
    const cloudState = activeCloudProjectRef.current;
    if (
      APP_FEATURES.collaboration &&
      cloudState &&
      cloudState.activeProjectLock?.lockKey !== "sceneOrder"
    ) {
      void addCloudFrame(timeSec);
      return;
    }
    const frame = createFrameDraft(projectRef.current, timeSec);
    updateProject((previous) => ({
      ...previous,
      frames: [...previous.frames, frame],
    }));
    setSelectedFrameId(frame.id);
    setNotice("シーンを追加しました。", "success");
  };

  async function flushCloudSceneOrderAutoSave(summary: string): Promise<void> {
    clearCloudSceneOrderAutoSave();
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner") {
      return;
    }
    if (isCloudBusyRef.current || isSaving) {
      scheduleCloudSceneOrderAutoSave(summary, 500);
      return;
    }
    showCloudSceneOrderSaveStatus("saving", summary);
    const alreadyHadSceneOrderLock =
      cloudState.activeProjectLock?.lockKey === "sceneOrder";
    const lockReady =
      alreadyHadSceneOrderLock ||
      (await beginCloudProjectResourceEdit("sceneOrder", { silent: true }));
    if (!lockReady) {
      showCloudSceneOrderSaveStatus("error", summary);
      return;
    }
    let saved = false;
    try {
      saved = await saveCloudProjectResource(
        projectRef.current,
        "sceneOrder",
        { showNotice: false },
      );
      if (saved) {
        showCloudSceneOrderSaveStatus("saved", summary);
        setNotice(`${summary}をクラウドへ保存しました。`);
      } else {
        showCloudSceneOrderSaveStatus("error", summary);
      }
    } catch (error) {
      console.error(`${summary}のクラウド保存に失敗しました。`, error);
      showCloudSceneOrderSaveStatus("error", summary);
      setNotice(`${summary}のクラウド保存に失敗しました。`);
    } finally {
      if (
        !alreadyHadSceneOrderLock &&
        activeCloudProjectRef.current?.activeProjectLock?.lockKey === "sceneOrder"
      ) {
        const released = await releaseActiveCloudProjectLock({ silent: true });
        if (saved && !released) {
          setNotice(`${summary}をクラウドへ保存しました。全体編集ロックはTTLで自動解除されます。`);
        }
      }
    }
  }

  function scheduleCloudSceneOrderAutoSave(
    summary = "シーン構成",
    delayMs = 700,
  ): void {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner") {
      return;
    }
    clearCloudSceneOrderAutoSave();
    showCloudSceneOrderSaveStatus("pending", summary);
    cloudSceneOrderSaveTimerRef.current = window.setTimeout(() => {
      void flushCloudSceneOrderAutoSave(summary);
    }, delayMs);
  }

  const updateFrame = (id: string, patch: Partial<FormationFrame>) => {
    const applyChange = () => {
      updateProject((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) =>
          frame.id === id ? { ...frame, ...patch } : frame,
        ),
      }), "シーン編集");
    };
    const patchKeys = Object.keys(patch);
    if (
      activeCloudProjectRef.current &&
      APP_FEATURES.collaboration &&
      activeCloudProjectRef.current.role === "owner" &&
      patchKeys.some((key) => key === "label" || key === "section" || key === "timeSec")
    ) {
      applyChange();
      scheduleCloudSceneOrderAutoSave("シーン情報");
      return;
    }
    if (
      activeCloudProjectRef.current &&
      !activeCloudProjectRef.current.activeSceneLock &&
      id === selectedFrameIdRef.current &&
      patchKeys.length === 1 &&
      Object.prototype.hasOwnProperty.call(patch, "notes")
    ) {
      void runCloudSceneCellPatchEditMany(
        "シーンメモ編集",
        [{ id: "_", type: "notes" }],
        applyChange,
      );
      return;
    }
    applyChange();
  };

  const deleteFrame = async (id: string) => {
    if (project.frames.length <= 1) {
      setNotice("シーンは最低1個必要です。");
      return;
    }
    const targetFrame = project.frames.find((frame) => frame.id === id);
    if (!targetFrame) {
      return;
    }
    const confirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "削除する",
      message: `「${targetFrame.label || "無題"}」を削除します。配置、メモ、道具割当もこのシーンごと削除されます。`,
      title: "シーンを削除しますか？",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    const remaining = projectRef.current.frames.filter((frame) => frame.id !== id);
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.filter((frame) => frame.id !== id),
    }));
    if (selectedFrameIdRef.current === id) {
      setSelectedFrameId(remaining[0]?.id ?? null);
    }
    if (
      APP_FEATURES.collaboration &&
      activeCloudProjectRef.current?.role === "owner"
    ) {
      scheduleCloudSceneOrderAutoSave("シーン削除", 100);
    }
  };

  const reorderFrames = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) {
      return;
    }
    updateProject((previous) => {
      const sourceIndex = previous.frames.findIndex((frame) => frame.id === draggedId);
      const targetIndex = previous.frames.findIndex((frame) => frame.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return previous;
      }
      const frames = [...previous.frames];
      const [movedFrame] = frames.splice(sourceIndex, 1);
      const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      frames.splice(adjustedTargetIndex, 0, movedFrame);
      return { ...previous, frames };
    });
    setSelectedFrameId(draggedId);
    setNotice("シーン順を変更しました。曲同期する場合は時刻も確認してください。");
    if (
      APP_FEATURES.collaboration &&
      activeCloudProjectRef.current?.role === "owner"
    ) {
      scheduleCloudSceneOrderAutoSave("シーン順変更", 100);
    }
  };

  const sortCloudFramesByTime = async () => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState) {
      return;
    }
    if (cloudState.role !== "owner") {
      setNotice("クラウドでシーン順を変更できるのはownerのみです。");
      return;
    }
    if (isCloudBusyRef.current || isSaving) {
      setNotice("クラウド処理中です。少し待ってからもう一度試してください。");
      return;
    }
    const lockReady = await beginCloudProjectResourceEdit("sceneOrder", {
      silent: true,
    });
    if (!lockReady) {
      return;
    }
    let changed = false;
    let saved = false;
    try {
      const sourceProject = projectRef.current;
      const ordered = sortFormationFramesByTime(sourceProject.frames);
      changed = ordered.changed;
      if (!changed) {
        setNotice("シーンはすでに時刻順です。");
        return;
      }
      saved = await saveCloudProjectResource(
        { ...sourceProject, frames: ordered.frames },
        "sceneOrder",
        { showNotice: false },
      );
      if (!saved) {
        return;
      }
      setNotice("シーンを時刻順に並び替えてクラウドへ保存しました。");
    } finally {
      if (activeCloudProjectRef.current?.activeProjectLock?.lockKey === "sceneOrder") {
        const released = await releaseActiveCloudProjectLock({ silent: true });
        if (changed && saved && !released) {
          setNotice("シーンを時刻順に並び替えました。全体編集ロックはTTLで自動解除されます。");
        } else if (changed && !saved && !released) {
          setNotice("シーンの並び替えは保存されませんでした。全体編集ロックはTTLで自動解除されます。");
        }
      }
    }
  };

  const sortFramesByTime = () => {
    const cloudState = activeCloudProjectRef.current;
    if (
      APP_FEATURES.collaboration &&
      cloudState &&
      cloudState.activeProjectLock?.lockKey !== "sceneOrder"
    ) {
      void sortCloudFramesByTime();
      return;
    }
    let changed = false;
    updateProject((previous) => {
      const ordered = sortFormationFramesByTime(previous.frames);
      changed = ordered.changed;
      if (!changed) {
        return previous;
      }
      return {
        ...previous,
        frames: ordered.frames,
      };
    }, "シーン時刻順並び替え");
    setNotice(
      changed
        ? "シーンを時刻順に並び替えました。"
        : "シーンはすでに時刻順です。",
      "success",
    );
  };

  const copyMemberToClipboard = (memberId?: string) => {
    const id =
      memberId ??
      (selected?.type === "member" ? selected.id : selectedMemberIds[0]);
    const member = project.members.find((item) => item.id === id);
    if (!member) {
      setNotice("コピーするメンバーを選択してください。");
      return;
    }
    const positionsByFrame = project.frames.reduce<Record<string, Position>>(
      (record, frame) => {
        const position = frame.positions[member.id];
        if (position) {
          record[frame.id] = position;
        }
        return record;
      },
      {},
    );
    setClipboard({ type: "member", member, positionsByFrame });
    setNotice(`${member.name} をコピーしました。`, "success");
  };

  const pasteMemberFromClipboard = (visibleInCurrentFrame = true) => {
    if (clipboard?.type !== "member") {
      setNotice("貼り付けるメンバーがコピーされていません。");
      return;
    }
    const activeFrameId = selectedFrame?.id ?? project.frames[0]?.id;
    if (!activeFrameId) {
      setNotice("貼り付け先のシーンがありません。");
      return;
    }
    const existingMember = project.members.find(
      (member) => member.id === clipboard.member.id,
    );
    const pastePosition = getPasteStagePosition();
    if (existingMember && !isMemberVisibleInFrame(existingMember, activeFrameId)) {
      updateProject((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) => {
          if (frame.id !== activeFrameId) {
            return frame;
          }
          return {
            ...frame,
            positions: {
              ...frame.positions,
              [existingMember.id]: pastePosition,
            },
            memberVisibility: {
              ...(frame.memberVisibility ?? {}),
              [existingMember.id]: true,
            },
            objectAssignments: removeMemberFromAssignments(
              frame.objectAssignments,
              existingMember.id,
            ),
          };
        }),
      }), "メンバー貼り付け");
      setSelected({ type: "member", id: existingMember.id });
      setSelectedMemberIds([]);
      setActivePanelTab("members");
      setMemberVisibilityTab("visible");
      setIsPanelOpen(true);
      setMode("members");
      requestPanelScroll("member", existingMember.id);
      setNotice(
        `${existingMember.name} をこのシーンのステージ上に表示しました。`,
        "success",
      );
      return;
    }

    const id = createId("m");
    const sourceActivePosition =
      clipboard.positionsByFrame[activeFrameId] ??
      Object.values(clipboard.positionsByFrame)[0] ??
      pastePosition;
    const delta = {
      x: pastePosition.x - sourceActivePosition.x,
      y: pastePosition.y - sourceActivePosition.y,
    };
    const member: Member = {
      ...clipboard.member,
      id,
      name: nextNumberedMemberName(clipboard.member),
      zIndex: (clipboard.member.zIndex ?? 20) + 1,
    };
    const sourceGroup = getMemberGroupForMemberId(clipboard.member.id);
    updateProject((previous) => ({
      ...previous,
      members: [...previous.members, member],
      memberGroups: (previous.memberGroups ?? []).map((group) =>
        group.id === sourceGroup?.id
          ? {
              ...group,
              memberIds: [...new Set([...group.memberIds, id])],
            }
          : group,
      ),
      frames: previous.frames.map((frame) => {
        const frameStage = {
          ...previous.stage,
          ...getEffectiveStageSize(previous, frame),
        };
        const sourcePosition =
          clipboard.positionsByFrame[frame.id] ??
          frame.positions[clipboard.member.id] ?? {
            x: frameStage.widthMeters / 2,
            y: frameStage.depthMeters / 2,
          };
        const nextPosition =
          frame.id === activeFrameId
            ? pastePosition
            : constrainMemberPosition(
                {
                  x: roundMeters(sourcePosition.x + delta.x),
                  y: roundMeters(sourcePosition.y + delta.y),
                },
                frameStage,
              );
        return {
          ...frame,
          positions: {
            ...frame.positions,
            [id]: nextPosition,
          },
          memberVisibility: {
            ...(frame.memberVisibility ?? {}),
            [id]: frame.id === activeFrameId ? visibleInCurrentFrame : false,
          },
        };
      }),
    }));
    setSelected({ type: "member", id });
    setSelectedMemberIds([]);
    setActivePanelTab("members");
    setMemberVisibilityTab(visibleInCurrentFrame ? "visible" : "hidden");
    setIsPanelOpen(true);
    setMode("members");
    requestPanelScroll("member", id);
    setNotice(`${member.name} を新しいメンバーとして追加しました。`, "success");
  };

  const copyObjectToClipboard = (objectId?: string) => {
    const id = objectId ?? (selected?.type === "object" ? selected.id : undefined);
    const object = project.stageObjects.find((item) => item.id === id);
    if (!object) {
      setNotice("コピーする道具を選択してください。");
      return;
    }
    const objectStatesByFrame = project.frames.reduce<Record<string, ObjectState>>(
      (record, frame) => {
        const objectState = frame.objectStates[object.id];
        if (objectState) {
          record[frame.id] = objectState;
        }
        return record;
      },
      {},
    );
    setClipboard({ type: "object", object, objectStatesByFrame });
    setNotice(`${object.name} をコピーしました。`, "success");
  };

  const pasteObjectFromClipboard = (visibleInCurrentFrame = true) => {
    if (clipboard?.type !== "object") {
      setNotice("貼り付ける道具がコピーされていません。");
      return;
    }
    const activeFrameId = selectedFrame?.id ?? project.frames[0]?.id;
    if (!activeFrameId) {
      setNotice("貼り付け先のシーンがありません。");
      return;
    }
    const existingObject = project.stageObjects.find(
      (object) => object.id === clipboard.object.id,
    );
    const sourceActiveState =
      clipboard.objectStatesByFrame[activeFrameId] ??
      selectedFrame?.objectStates?.[clipboard.object.id] ??
      createDefaultObjectState(clipboard.object);
    const intendedPasteCenter = getPasteStagePosition();
    const activeTopLeft = constrainObjectPosition(
      objectTopLeftFromCenter(
        intendedPasteCenter,
        sourceActiveState.widthMeters,
        sourceActiveState.heightMeters,
      ),
      sourceActiveState.widthMeters,
      sourceActiveState.heightMeters,
      effectiveStage,
    );
    const pasteCenter = getObjectCenter(
      activeTopLeft,
      sourceActiveState.widthMeters,
      sourceActiveState.heightMeters,
    );
    const sourceActiveCenter = getObjectCenter(
      sourceActiveState,
      sourceActiveState.widthMeters,
      sourceActiveState.heightMeters,
    );
    const delta = {
      x: pasteCenter.x - sourceActiveCenter.x,
      y: pasteCenter.y - sourceActiveCenter.y,
    };
    if (existingObject && !isObjectVisibleInFrame(existingObject, activeFrameId)) {
      updateProject((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) =>
          frame.id === activeFrameId
            ? {
                ...frame,
                objectStates: {
                  ...frame.objectStates,
                  [existingObject.id]: {
                    ...sourceActiveState,
                    objectId: existingObject.id,
                    x: activeTopLeft.x,
                    y: activeTopLeft.y,
                    visible: true,
                  },
                },
              }
            : frame,
        ),
      }), "道具貼り付け");
      setSelected({ type: "object", id: existingObject.id });
      setActivePanelTab("objects");
      setObjectVisibilityTab("visible");
      setIsPanelOpen(true);
      setMode("objects");
      requestPanelScroll("object", existingObject.id);
      setNotice(`${existingObject.name} をこのシーンのステージ上に表示しました。`, "success");
      return;
    }

    const id = createId("o");
    const object: StageObject = {
      ...clipboard.object,
      id,
      name: nextNumberedObjectName(clipboard.object),
      defaultX: activeTopLeft.x,
      defaultY: activeTopLeft.y,
      zIndex: clipboard.object.zIndex + 1,
    };
    const sourceGroup = getObjectGroupForObjectId(clipboard.object.id);
    updateProject((previous) => ({
      ...previous,
      stageObjects: [...previous.stageObjects, object],
      objectGroups: (previous.objectGroups ?? []).map((group) =>
        group.id === sourceGroup?.id
          ? {
              ...group,
              objectIds: [...new Set([...group.objectIds, id])],
            }
          : group,
      ),
      frames: previous.frames.map((frame) => {
        const frameStage = {
          ...previous.stage,
          ...getEffectiveStageSize(previous, frame),
        };
        const sourceState =
          clipboard.objectStatesByFrame[frame.id] ??
          frame.objectStates[clipboard.object.id] ??
          createDefaultObjectState(clipboard.object);
        const sourceCenter = getObjectCenter(
          sourceState,
          sourceState.widthMeters,
          sourceState.heightMeters,
        );
        const nextCenter =
          frame.id === activeFrameId
            ? pasteCenter
            : {
                x: roundMeters(sourceCenter.x + delta.x),
                y: roundMeters(sourceCenter.y + delta.y),
              };
        const shifted = constrainObjectPosition(
          objectTopLeftFromCenter(
            nextCenter,
            sourceState.widthMeters,
            sourceState.heightMeters,
          ),
          sourceState.widthMeters,
          sourceState.heightMeters,
          frameStage,
        );
        return {
          ...frame,
          objectStates: {
            ...frame.objectStates,
            [id]: {
              ...sourceState,
              objectId: id,
              x: shifted.x,
              y: shifted.y,
              visible:
                frame.id === activeFrameId
                  ? visibleInCurrentFrame
                  : false,
              zIndex: sourceState.zIndex + 1,
            },
          },
        };
      }),
    }));
    setSelected({ type: "object", id });
    setActivePanelTab("objects");
    setObjectVisibilityTab(visibleInCurrentFrame ? "visible" : "hidden");
    setIsPanelOpen(true);
    setMode("objects");
    requestPanelScroll("object", id);
    setNotice(`${object.name} を新しい道具として追加しました。`, "success");
  };

  const copyFrameToClipboard = (frameId?: string) => {
    const frame = project.frames.find(
      (item) => item.id === (frameId ?? selectedFrame?.id),
    );
    if (!frame) {
      setNotice("コピーするシーンを選択してください。");
      return;
    }
    setClipboard({
      type: "frame",
      frame: cloneFrame(frame),
    });
    setNotice(`「${frame.label}」をコピーしました。`, "success");
  };

  const pasteFrameFromClipboard = () => {
    if (clipboard?.type !== "frame") {
      setNotice("貼り付けるシーンがコピーされていません。");
      return;
    }
    const id = createId("f");
    const frame: FormationFrame = {
      ...cloneFrame(clipboard.frame),
      id,
      label: `${clipboard.frame.label} コピー`,
      timeSec: Number((clipboard.frame.timeSec + 4).toFixed(2)),
    };
    updateProject((previous) => {
      const selectedIndex = previous.frames.findIndex(
        (item) => item.id === selectedFrameId,
      );
      const frames = [...previous.frames];
      frames.splice(selectedIndex >= 0 ? selectedIndex + 1 : frames.length, 0, frame);
      return { ...previous, frames };
    });
    setSelectedFrameId(id);
    setActivePanelTab("timeline");
    setMode("preview");
    setNotice(`「${frame.label}」を貼り付けました。`, "success");
    if (
      APP_FEATURES.collaboration &&
      activeCloudProjectRef.current?.role === "owner"
    ) {
      scheduleCloudSceneOrderAutoSave("シーン貼り付け", 100);
    }
  };

  const pasteFrameIntoExisting = async (targetFrameId?: string) => {
    if (clipboard?.type !== "frame") {
      setNotice("貼り付けるシーンがコピーされていません。");
      return;
    }
    const targetFrame = project.frames.find(
      (frame) => frame.id === (targetFrameId ?? selectedFrame?.id),
    );
    if (!targetFrame) {
      setNotice("貼り付け先のシーンを選択してください。");
      return;
    }
    const sourceFrame = clipboard.frame;
    const confirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "上書きする",
      message: `「${targetFrame.label || "無題"}」の配置、メモ、道具割当を、コピー中の「${sourceFrame.label || "無題"}」の内容で上書きします。`,
      title: "このシーンへ貼り付けますか？",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((frame) =>
        frame.id === targetFrame.id
          ? mergeFrameContents(frame, sourceFrame)
          : frame,
      ),
    }), "シーン貼り付け");
    setSelectedFrameId(targetFrame.id);
    setActivePanelTab("timeline");
    setMode("preview");
    setNotice(`「${targetFrame.label}」へシーン内容を貼り付けました。`, "success");
    if (
      APP_FEATURES.collaboration &&
      activeCloudProjectRef.current?.role === "owner"
    ) {
      scheduleCloudSceneOrderAutoSave("シーン貼り付け", 100);
    }
  };

  const copySelectionToClipboard = () => {
    if (selected?.type === "member") {
      copyMemberToClipboard(selected.id);
      return;
    }
    if (selected?.type === "object") {
      copyObjectToClipboard(selected.id);
      return;
    }
    if (selectedFrame) {
      copyFrameToClipboard();
      return;
    }
    setNotice("コピーするメンバー、道具、またはシーンを選択してください。");
  };

  const handleStageContextMenu = (request: StageContextMenuRequest) => {
    lastStagePointerPositionRef.current = request.stagePosition;
    setMemberColorEditor(null);
    setMemberColorEditorPosition(null);
    setSceneContextMenu(null);
    setSceneContextMenuPosition(null);
    if (request.target.type === "member") {
      selectStageElement({ type: "member", id: request.target.id });
    } else if (request.target.type === "object") {
      selectStageElement({ type: "object", id: request.target.id });
    }
    setContextMenuPosition({ left: request.clientX, top: request.clientY });
    setContextMenu(request);
  };

  const handleSceneThumbnailContextMenu = (
    frame: FormationFrame,
    clientX: number,
    clientY: number,
  ) => {
    setSelectedFrameId(frame.id);
    seek(frame.timeSec);
    setContextMenu(null);
    setContextMenuPosition(null);
    setMemberColorEditor(null);
    setMemberColorEditorPosition(null);
    setSceneContextMenuPosition({ left: clientX, top: clientY });
    setSceneContextMenu({ frameId: frame.id, clientX, clientY });
  };

  const runContextMenuAction = (action: () => void | Promise<void>) => {
    void action();
    setContextMenu(null);
  };

  const runSceneContextMenuAction = (action: () => void | Promise<void>) => {
    void action();
    setSceneContextMenu(null);
    setSceneContextMenuPosition(null);
  };

  const hideContextTarget = () => {
    if (!contextMenu) return;
    if (contextMenu.target.type === "member") {
      setMembersFrameVisibility([contextMenu.target.id], false);
      return;
    }
    if (contextMenu.target.type === "object") {
      updateObjectState(contextMenu.target.id, { visible: false });
    }
  };

  const openMemberColorEditor = (memberId: string) => {
    const member = project.members.find((item) => item.id === memberId);
    if (!member) {
      return;
    }
    setMemberColorEditor({
      memberId,
      color: getMemberDisplayColor(member, {
        frame: selectedFrame,
        groups: project.memberGroups ?? [],
      }),
      scope: "scene",
      clientX: contextMenu?.clientX ?? window.innerWidth / 2,
      clientY: contextMenu?.clientY ?? window.innerHeight / 2,
    });
    setMemberColorEditorPosition({
      left: contextMenu?.clientX ?? window.innerWidth / 2,
      top: contextMenu?.clientY ?? window.innerHeight / 2,
    });
    setContextMenuPosition(null);
    setContextMenu(null);
  };

  const applyMemberColorOverride = (
    memberId: string,
    color: string,
    scope: MemberColorScope,
  ) => {
    const activeFrameId = selectedFrame?.id;
    if (!activeFrameId) {
      setNotice("色を変更するシーンがありません。");
      return;
    }
    updateProject((previous) => {
      const sortedFrames = sortFrames(previous.frames);
      const currentIndex = sortedFrames.findIndex(
        (frame) => frame.id === activeFrameId,
      );
      if (currentIndex < 0) {
        return previous;
      }
      const targetFrameIds = new Set(
        scope === "following"
          ? sortedFrames.slice(currentIndex).map((frame) => frame.id)
          : [activeFrameId],
      );
      return {
        ...previous,
        frames: previous.frames.map((frame) =>
          targetFrameIds.has(frame.id)
            ? {
                ...frame,
                memberAppearanceOverrides: {
                  ...(frame.memberAppearanceOverrides ?? {}),
                  [memberId]: {
                    ...(frame.memberAppearanceOverrides?.[memberId] ?? {}),
                    color,
                  },
                },
              }
            : frame,
        ),
      };
    }, "メンバー色変更");
    setMemberColorEditor(null);
    setMemberColorEditorPosition(null);
    setNotice(
      scope === "following"
        ? "このシーン以降のメンバー色を変更しました。"
        : "このシーンだけメンバー色を変更しました。",
      "success",
    );
  };

  const clearMemberColorOverride = (
    memberId: string,
    scope: MemberColorScope,
  ) => {
    const activeFrameId = selectedFrame?.id;
    if (!activeFrameId) {
      setNotice("色変更を解除するシーンがありません。");
      return;
    }
    updateProject((previous) => {
      const sortedFrames = sortFrames(previous.frames);
      const currentIndex = sortedFrames.findIndex(
        (frame) => frame.id === activeFrameId,
      );
      if (currentIndex < 0) {
        return previous;
      }
      const targetFrameIds = new Set(
        scope === "following"
          ? sortedFrames.slice(currentIndex).map((frame) => frame.id)
          : [activeFrameId],
      );
      return {
        ...previous,
        frames: previous.frames.map((frame) => {
          if (!targetFrameIds.has(frame.id) || !frame.memberAppearanceOverrides) {
            return frame;
          }
          const {
            [memberId]: removedOverride,
            ...memberAppearanceOverrides
          } = frame.memberAppearanceOverrides;
          void removedOverride;
          return {
            ...frame,
            memberAppearanceOverrides:
              Object.keys(memberAppearanceOverrides).length > 0
                ? memberAppearanceOverrides
                : undefined,
          };
        }),
      };
    }, "メンバー色変更解除");
    setMemberColorEditor(null);
    setMemberColorEditorPosition(null);
    setNotice(
      scope === "following"
        ? "このシーン以降のメンバー色変更を解除しました。"
        : "このシーンだけメンバー色変更を解除しました。",
      "success",
    );
  };

  const addObjectAtContextPosition = (draft: StageObjectDraft) => {
    addStageObject(draft, true, contextMenu?.stagePosition);
  };

  const pasteClipboard = () => {
    if (clipboard?.type === "member") {
      pasteMemberFromClipboard();
      return;
    }
    if (clipboard?.type === "object") {
      pasteObjectFromClipboard();
      return;
    }
    if (clipboard?.type === "frame") {
      void pasteFrameIntoExisting(selectedFrame?.id);
      return;
    }
    setNotice("貼り付ける内容がありません。");
  };

  const selectAllVisibleMembersInCurrentScene = () => {
    const assignedMemberIds = new Set(
      Object.values(selectedFrame?.objectAssignments ?? {}).flat(),
    );
    const visibleMemberIds = project.members
      .filter(
        (member) =>
          (member.visible ?? true) &&
          (snapshot.memberVisibility[member.id] ?? true) &&
          Boolean(snapshot.positions[member.id]) &&
          !assignedMemberIds.has(member.id),
      )
      .map((member) => member.id);

    setSelected(null);
    setSelectedMemberIds(visibleMemberIds);
    setIsPanelOpen(true);
    setActivePanelTab("members");
    setMode("members");
    setMemberVisibilityTab("visible");
    setNotice(`${visibleMemberIds.length}人を選択しました。`, "success");
  };

  const focusSelectedNameInput = () => {
    const target =
      selected ??
      (selectedMemberIds.length === 1
        ? ({ type: "member", id: selectedMemberIds[0] } as Selection)
        : null);

    if (!target) {
      setNotice("名前を編集するセルを選択してください。");
      return;
    }

    if (target.type === "member") {
      const member = project.members.find((item) => item.id === target.id);
      if (!member) {
        setNotice("選択中のメンバーが見つかりません。");
        return;
      }
      setSelected({ type: "member", id: target.id });
      setSelectedMemberIds([]);
      setIsPanelOpen(true);
      setActivePanelTab("members");
      setMode("members");
      setMemberVisibilityTab(
        (member.visible ?? true) && (snapshot.memberVisibility[target.id] ?? true)
          ? "visible"
          : "hidden",
      );
      requestPanelScroll("member", target.id);
    } else {
      const object = project.stageObjects.find((item) => item.id === target.id);
      if (!object) {
        setNotice("選択中の道具が見つかりません。");
        return;
      }
      setSelected({ type: "object", id: target.id });
      setSelectedMemberIds([]);
      setIsPanelOpen(true);
      setActivePanelTab("objects");
      setMode("objects");
      setObjectVisibilityTab(
        snapshot.objectStates[target.id]?.visible ?? object.visible ?? true
          ? "visible"
          : "hidden",
      );
      requestPanelScroll("object", target.id);
    }

    const selector =
      target.type === "member"
        ? `[data-member-id="${escapeSelectorValue(target.id)}"] input[aria-label$=" の名前"]`
        : `[data-object-id="${escapeSelectorValue(target.id)}"] input[aria-label$=" の名前"]`;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>(selector);
        if (!input) {
          setNotice("名前入力欄を表示できませんでした。");
          return;
        }
        input.focus();
        input.select();
      });
    });
  };

  const removeSelectedFromCurrentScene = () => {
    const memberIds =
      selectedMemberIds.length > 0
        ? selectedMemberIds
        : selected?.type === "member"
          ? [selected.id]
          : [];

    if (memberIds.length > 0) {
      setMembersFrameVisibility(memberIds, false);
      setSelected(null);
      setSelectedMemberIds([]);
      return;
    }

    if (selected?.type === "object") {
      updateObjectState(selected.id, { visible: false });
      setSelected(null);
      setNotice("選択中の道具をこのシーンで非表示にしました。", "success");
      return;
    }

    setNotice("現在シーンから外すセルを選択してください。");
  };

  const clearSelectionAndMenus = () => {
    let changed = false;
    if (contextMenu) {
      setContextMenu(null);
      setContextMenuPosition(null);
      changed = true;
    }
    if (sceneContextMenu) {
      setSceneContextMenu(null);
      setSceneContextMenuPosition(null);
      changed = true;
    }
    if (memberColorEditor) {
      setMemberColorEditor(null);
      setMemberColorEditorPosition(null);
      changed = true;
    }
    if (isShareExportOpen) {
      setIsShareExportOpen(false);
      changed = true;
    }
    if (selected || selectedMemberIds.length > 0) {
      setSelected(null);
      setSelectedMemberIds([]);
      changed = true;
    }
    if (changed) {
      setNotice("選択を解除しました。", "success");
    }
  };

  const goToSceneIndex = (index: number) => {
    const sortedFrames = sortFrames(project.frames);
    const nextFrame = sortedFrames[index];
    if (!nextFrame) {
      setNotice("移動できるシーンがありません。");
      return;
    }
    setSelectedFrameId(nextFrame.id);
    if (!isPlaying) {
      setMode((previous) => (previous === "preview" ? "members" : previous));
    }
  };

  const openDetailsTab = () => {
    setIsPanelOpen(true);
    setActivePanelTab("animation");
    setMode("preview");
  };

  const executeProjectSearch = (query: string) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return;
    }

    const member = project.members.find((item) =>
      item.name.toLowerCase().includes(keyword),
    );
    if (member) {
      setSelected({ type: "member", id: member.id });
      setSelectedMemberIds([]);
      setIsPanelOpen(true);
      setActivePanelTab("members");
      setMode("members");
      setMemberVisibilityTab(
        (member.visible ?? true) && (snapshot.memberVisibility[member.id] ?? true)
          ? "visible"
          : "hidden",
      );
      requestPanelScroll("member", member.id);
      setNotice(`「${member.name}」を見つけました。`, "success");
      return;
    }

    const object = project.stageObjects.find((item) =>
      item.name.toLowerCase().includes(keyword),
    );
    if (object) {
      setSelected({ type: "object", id: object.id });
      setSelectedMemberIds([]);
      setIsPanelOpen(true);
      setActivePanelTab("objects");
      setMode("objects");
      setObjectVisibilityTab(
        snapshot.objectStates[object.id]?.visible ?? object.visible ?? true
          ? "visible"
          : "hidden",
      );
      requestPanelScroll("object", object.id);
      setNotice(`「${object.name}」を見つけました。`, "success");
      return;
    }

    const frame = sortFrames(project.frames).find((item) =>
      `${item.label} ${item.section ?? ""}`.toLowerCase().includes(keyword),
    );
    if (frame) {
      setSelectedFrameId(frame.id);
      setIsPanelOpen(true);
      setActivePanelTab("timeline");
      setMode("preview");
      setNotice(`「${frame.label}」を見つけました。`, "success");
      return;
    }

    setNotice(`「${query}」は見つかりませんでした。`);
  };

  const runProjectSearch = () => {
    setSearchQuery("");
    setIsSearchDialogOpen(true);
  };

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if (isModalOpen()) return;
      if (isTextEditingTarget(event.target)) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        copySelectionToClipboard();
      }
      if (key === "v") {
        event.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener("keydown", handleClipboardShortcut);
    return () => window.removeEventListener("keydown", handleClipboardShortcut);
  });

  useEffect(() => {
    const handleAppShortcuts = (event: KeyboardEvent) => {
      if (isModalOpen()) return;
      const key = event.key.toLowerCase();
      const isCommand = event.ctrlKey || event.metaKey;
      const isEditingText = isTextEditingTarget(event.target);

      if (isCommand && key === "s") {
        event.preventDefault();
        void saveProjectManually();
        return;
      }

      if (isCommand && key === "p") {
        event.preventDefault();
        setIsShareExportOpen(true);
        return;
      }

      if (isEditingText) {
        return;
      }

      if (isCommand && key === "a") {
        event.preventDefault();
        selectAllVisibleMembersInCurrentScene();
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        focusSelectedNameInput();
        return;
      }

      if (event.key === "Delete") {
        event.preventDefault();
        removeSelectedFromCurrentScene();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearSelectionAndMenus();
        return;
      }

      if (isCommand && event.key === "PageUp") {
        event.preventDefault();
        goToScene(-1);
        return;
      }

      if (isCommand && event.key === "PageDown") {
        event.preventDefault();
        goToScene(1);
        return;
      }

      if (isCommand && event.key === "Home") {
        event.preventDefault();
        goToSceneIndex(0);
        return;
      }

      if (isCommand && event.key === "End") {
        event.preventDefault();
        goToSceneIndex(sortFrames(project.frames).length - 1);
        return;
      }

      if (isCommand && key === "f") {
        event.preventDefault();
        runProjectSearch();
        return;
      }

      if (isCommand && key === "1") {
        event.preventDefault();
        openDetailsTab();
      }
    };

    window.addEventListener("keydown", handleAppShortcuts);
    return () =>
      window.removeEventListener("keydown", handleAppShortcuts);
  });

  const loadAudio = async (file: File) => {
    const nextUrl = URL.createObjectURL(file);
    setAudioSource(nextUrl, file.name);
    setSharedAudioNotice(false);
    const cloudState = activeCloudProjectRef.current;
    if (cloudState && cloudState.activeProjectLock?.lockKey !== "audio") {
      setNotice("音源をこの端末で読み込みました。クラウドへ保存するにはownerが音源設定の編集ロックを取得してください。");
      return;
    }
    try {
      const audio = await saveAudioFileToIndexedDb(file);
      updateProject(
        (previous) => ({
          ...previous,
          audio,
        }),
        "音源読み込み",
      );
      restoredAudioKeyRef.current = `${projectRef.current.id ?? "project"}:${audio.id}`;
      setNotice(
        cloudState
          ? "音源を読み込みました。クラウド保存すると音源メタ情報だけ共有されます。"
          : "音源を読み込みました。次回から再選択なしで再生できます。",
        "success",
      );
    } catch {
      setNotice("音源を読み込みました。音源本体の保存には失敗したため、次回は読み込み直してください。");
    }
  };

  const openProjectInEditor = async (
    rawProject: Project,
    message?: string,
    options: {
      cloudProject?: CloudActiveProjectState | null;
      persistLocal?: boolean;
      noticeKind?: NoticeKind;
    } = {},
  ) => {
    const now = new Date().toISOString();
    const nextProject = normalizeProject({
      ...rawProject,
      lastOpenedAt: now,
    });
    undoStackRef.current = [];
    redoStackRef.current = [];
    historyBatchRef.current = null;
    lastHistoryPushRef.current = null;
    clearPendingAutoSave();
    refreshHistoryCounts();
    projectRef.current = nextProject;
    activeCloudProjectRef.current = options.cloudProject ?? null;
    selectedFrameIdRef.current = nextProject.frames[0]?.id ?? null;
    ownerAutoSceneLockKeyRef.current = null;
    ownerSceneSwitchKeyRef.current = null;
    setProject(nextProject);
    setSelectedFrameId(nextProject.frames[0]?.id ?? null);
    setSelected(null);
    setSelectedMemberIds([]);
    setMode("members");
    setActivePanelTab("members");
    setViewerPerspective(nextProject.viewerPerspective ?? "audience");
    setCurrentTime(0);
    setIsPlaying(false);
    setIsSharedProject(false);
    setActiveCloudProject(options.cloudProject ?? null);
    setAppView("editor");
    setIsDirty(false);
    if (options.persistLocal !== false) {
      saveProjectToStorage(nextProject);
      setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
    }
    restoredAudioKeyRef.current = `${nextProject.id ?? "project"}:${nextProject.audio?.id ?? "no-audio"}`;
    const audioRestored = await restoreAudioForProject(nextProject);
    if (audioRestored) {
      setNotice(message ?? "隊列表を開きました。", options.noticeKind ?? (message === undefined ? "success" : "persistent"));
    }
  };

  const createNewFormationProject = async (input: NewFormationInput) => {
    let audio: AudioMeta | null = null;
    let audioNotice: string | null = null;
    if (input.audioFile) {
      try {
        audio = await saveAudioFileToIndexedDb(input.audioFile);
      } catch {
        audioNotice = "音源保存に失敗したため、音源なしで作成しました。";
      }
    }
    const nextProject = normalizeProject(
      createEmptyFormationProject(
        input.title,
        input,
        audio,
      ),
    );
    await openProjectInEditor(
      nextProject,
      audioNotice ?? "新しい隊列表を作成しました。",
      { noticeKind: audioNotice ? "persistent" : "success" },
    );
  };

  const returnToLibrary = async () => {
    if (isSharedProject) {
      setIsSharedProject(false);
      setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
      setAppView("library");
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (window.location.hash) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
      return;
    }
    if (activeCloudProject) {
      if (isDirty) {
        const saved = await saveProjectManually({ showNotice: false });
        if (!saved) {
          return;
        }
      }
      await releaseActiveCloudSceneLock({ silent: true });
      await releaseActiveCloudProjectLock({ silent: true });
      setActiveCloudProject(null);
      setCloudActiveLocks([]);
      setCloudCollaborationItems([]);
      setCloudContacts([]);
      setCloudPendingUpdates([]);
      setIsCloudShareOpen(false);
      setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
      setAppView("library");
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      return;
    }
    if (isDirty) {
      const saved = await saveProjectManually({ showNotice: false });
      if (!saved) {
        return;
      }
    } else {
      setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
    }
    setAppView("library");
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const renameStoredProject = async (projectId: string, title: string) => {
    const now = new Date().toISOString();
    const nextProjects = sortStoredProjects(
      savedProjects.map((item) =>
        item.id === projectId
          ? normalizeProject({ ...item, title, updatedAt: now })
          : item,
      ),
    );
    saveProjectsToStorage(nextProjects);
    setSavedProjects(nextProjects);
    if (projectRef.current.id === projectId) {
      const nextProject = normalizeProject({
        ...projectRef.current,
        title,
        updatedAt: now,
      });
      projectRef.current = nextProject;
      setProject(nextProject);
      setIsDirty(false);
    }
    setNotice("隊列表名を変更しました。", "success");
  };

  const duplicateStoredProject = async (source: Project) => {
    const now = new Date().toISOString();
    const duplicated = normalizeProject({
      ...cloneProject(source),
      id: createProjectId(),
      title: `${source.title || "名称未設定"} のコピー`,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    });
    const nextProjects = sortStoredProjects([duplicated, ...savedProjects]);
    saveProjectsToStorage(nextProjects);
    setSavedProjects(nextProjects);
    setNotice("隊列表を複製しました。", "success");
  };

  const deleteStoredProject = async (target: Project) => {
    const nextProjects = savedProjects.filter((item) => item.id !== target.id);
    saveProjectsToStorage(nextProjects);
    setSavedProjects(sortStoredProjects(nextProjects));
    if (
      target.audio?.id &&
      !nextProjects.some((item) => item.audio?.id === target.audio?.id)
    ) {
      await deleteAudioBlobFromIndexedDb(target.audio.id);
    }
    setNotice("隊列表を削除しました。", "success");
  };

  const exportTairetsuProject = async (source: Project, includeAudio: boolean) => {
    if (exportGenerationPending.current) return;
    exportGenerationPending.current = true;
    const projectToExport = normalizeProject(source);
    try {
      const audioBlob = includeAudio && projectToExport.audio?.id
        ? await loadAudioBlobFromIndexedDb(projectToExport.audio.id) : null;
      const audioMissing = includeAudio && Boolean(projectToExport.audio?.id) && !audioBlob;
      const blob = await createTairetsuArchive(projectToExport, { audioBlob });
      setCanCopyExport(false);
      setCompletedExport({ files: [new File([blob], createTairetsuFileName(projectToExport), { type: "application/zip" })],
        preview: null, targetLabel: "隊列表ZIP", scopeLabel: audioMissing ? "音源が見つからないため音源なし"
          : audioBlob ? "音源あり" : "音源なし", pageCount: 1 });
    } catch (error) {
      setNotice(error instanceof Error ? `隊列表を書き出せませんでした: ${error.message}` : "隊列表を書き出せませんでした。");
    } finally { exportGenerationPending.current = false; }
  };

  const importTairetsuProjectFile = async (file: File) => {
    try {
      const imported = await readTairetsuArchive(file);
      const now = new Date().toISOString();
      let audio: AudioMeta | null = null;
      let audioNotice: string | null = null;
      if (imported.audioBlob) {
        try {
          audio = await saveAudioBlobToIndexedDb(imported.audioBlob, {
            duration: imported.project.audio?.duration,
            name: imported.project.audio?.name ?? imported.audioFileName ?? "audio",
            type:
              imported.project.audio?.type ||
              imported.audioBlob.type ||
              "audio/mpeg",
          });
        } catch {
          audioNotice =
            "音源の読み込みに失敗しました。隊列表は音源なしで読み込みました。";
        }
      }

      const nextProject = normalizeProject({
        ...cloneProject(imported.project),
        audio,
        createdAt: now,
        id: createProjectId(),
        lastOpenedAt: now,
        title: createUniqueProjectTitle(imported.project.title, savedProjects),
        updatedAt: now,
      });
      const nextProjects = sortStoredProjects([nextProject, ...savedProjects]);
      saveProjectsToStorage(nextProjects);
      setSavedProjects(nextProjects);
      await openProjectInEditor(
        nextProject,
        audioNotice ??
          (audio
            ? "隊列表と音源を読み込みました。"
            : "音源なしで隊列表を読み込みました。"),
        { noticeKind: audioNotice ? "persistent" : "success" },
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "隊列表ファイルを読み込めませんでした。",
      );
    }
  };

  const importCloudProjectFile = async (file: File) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner") {
      setNotice("クラウド上書きはownerのみ利用できます。");
      return;
    }
    if (cloudState.activeSceneLock || cloudState.activeProjectLock || isDirtyRef.current) {
      setNotice("クラウド上書きは、保存または編集終了してから実行してください。");
      return;
    }
    if (!cloudConfig) {
      setNotice("Supabase接続が未設定です。");
      return;
    }
    const confirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "上書きする",
      message:
        "現在のクラウド隊列表を、選択したファイルの内容で上書きします。実行前の状態はクラウド履歴に退避します。",
      title: "クラウド隊列表を上書きしますか？",
      tone: "danger",
    });
    if (!confirmed) {
      setNotice("クラウド上書きをキャンセルしました。");
      return;
    }
    setIsCloudBusy(true);
    let importLockToken: string | null = null;
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return;
      }
      const imported = await readTairetsuArchive(file);
      const importedProject = normalizeProject({
        ...cloneProject(imported.project),
        audio: imported.project.audio ?? null,
        id: projectRef.current.id,
        title: imported.project.title || projectRef.current.title,
        updatedAt: new Date().toISOString(),
      });
      const target = createProjectLockTarget("import");
      const lockToken = createCloudLockToken();
      importLockToken = lockToken;
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const lockResult = await api.acquireEditLock(
        cloudState.projectId,
        target,
        lockToken,
      );
      if (!lockResult.success) {
        setNotice(
          lockResult.reason === "project_lock_wait_for_active_scene"
            ? "クラウド上書きは、現在のシーン編集が終わるまで待ってください。"
            : "クラウド上書きロックを取得できませんでした。",
        );
        return;
      }
      saveCloudLockTokenToSession(cloudState.projectId, target, lockToken);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              activeProjectLock: {
                baseVersion: 0,
                expiresAt: lockResult.expires_at,
                lockKey: "import",
                lockToken,
              },
            }
          : previous,
      );
      const draft = createCloudProjectDraft(importedProject, {
        resourceVersion: 1,
        sceneVersion: 1,
      });
      const result = await api.importCloudProjectWithLock(
        cloudState.projectId,
        draft,
        lockToken,
        "cloud import",
      );
      clearCloudLockTokenFromSession(cloudState.projectId, target);
      if (!result.success) {
        setActiveCloudProject((previous) =>
          previous ? { ...previous, activeProjectLock: null } : previous,
        );
        setNotice(`クラウド上書きに失敗しました: ${result.reason}`);
        return;
      }
      const parts = await api.loadCloudProjectParts(cloudState.projectId);
      const nextProject = normalizeProject({
        ...buildProjectFromCloudParts(parts),
        lastOpenedAt: new Date().toISOString(),
        updatedAt: parts.updatedAt ?? result.updated_at ?? new Date().toISOString(),
      });
      const { resourceVersions, sceneVersions } = createCloudVersionMaps(parts);
      const sceneCellVersions = createCloudSceneCellVersionMap(
        await api.listSceneCellVersions(cloudState.projectId),
      );
      projectRef.current = nextProject;
      setProject(nextProject);
      setSelectedFrameId(nextProject.frames[0]?.id ?? null);
      setSelected(null);
      setSelectedMemberIds([]);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              activeProjectLock: null,
              resourceVersions,
              sceneCellVersions,
              sceneVersions,
              title: nextProject.title,
              updatedAt: parts.updatedAt ?? result.updated_at ?? previous.updatedAt,
            }
          : previous,
      );
      setCloudPendingUpdates([]);
      setIsDirty(false);
      setNotice("クラウド隊列表を上書きしました。");
      void refreshCloudActiveLocks(activeSession);
    } catch (error) {
      const latestCloudState = activeCloudProjectRef.current;
      if (latestCloudState?.activeProjectLock?.lockKey === "import") {
        clearCloudLockTokenFromSession(
          latestCloudState.projectId,
          createProjectLockTarget("import"),
        );
        setActiveCloudProject((previous) =>
          previous ? { ...previous, activeProjectLock: null } : previous,
        );
      } else if (cloudState && importLockToken) {
        clearCloudLockTokenFromSession(
          cloudState.projectId,
          createProjectLockTarget("import"),
        );
      }
      setNotice(
        error instanceof Error
          ? error.message
          : "クラウド上書きに失敗しました。",
      );
    } finally {
      setIsCloudBusy(false);
    }
  };

  const addSharedProjectToLibrary = async () => {
    const now = new Date().toISOString();
    const nextProject = normalizeProject({
      ...cloneProject(projectRef.current),
      audio: null,
      createdAt: now,
      id: createProjectId(),
      lastOpenedAt: now,
      title: createUniqueProjectTitle(projectRef.current.title, savedProjects),
      updatedAt: now,
    });
    setIsSharedProject(false);
    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    await openProjectInEditor(nextProject, "共有隊列表を自分の一覧に追加しました。");
  };

  const getCloudErrorMessage = (error: unknown): string =>
    getCloudAuthErrorMessage(error);

  const getActiveCloudSession = async (
    sessionOverride?: CloudAuthSession | null,
  ): Promise<CloudAuthSession | null> => {
    if (!cloudConfig) {
      return null;
    }
    const session = sessionOverride ?? cloudSessionRef.current;
    if (!session) {
      return null;
    }
    if (!isCloudAuthSessionExpired(session)) {
      return session;
    }
    const auth = createCloudAuthClient(cloudConfig);
    const refreshed = await auth.refreshSession(session.refreshToken);
    saveCloudAuthSession(refreshed);
    cloudSessionRef.current = refreshed;
    setCloudSession(refreshed);
    return refreshed;
  };

  const refreshCloudActiveLocks = async (
    sessionOverride?: CloudAuthSession | null,
  ) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || !cloudConfig) {
      setCloudActiveLocks([]);
      return;
    }
    try {
      const activeSession = await getActiveCloudSession(sessionOverride);
      if (!activeSession) {
        setCloudActiveLocks([]);
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      setCloudActiveLocks(await api.listActiveEditLocks(cloudState.projectId));
    } catch (error) {
      console.warn("クラウドロック一覧の更新に失敗しました。", error);
    }
  };

  const refreshCloudCollaboration = async (
    sessionOverride?: CloudAuthSession | null,
  ) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      setCloudCollaborationItems([]);
      return;
    }
    try {
      const activeSession = await getActiveCloudSession(sessionOverride);
      if (!activeSession) {
        setCloudCollaborationItems([]);
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      setCloudCollaborationItems(
        await api.listProjectCollaboration(cloudState.projectId),
      );
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
    }
  };

  const refreshCloudContacts = async (
    sessionOverride?: CloudAuthSession | null,
  ) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      setCloudContacts([]);
      return;
    }
    try {
      const activeSession = await getActiveCloudSession(sessionOverride);
      if (!activeSession) {
        setCloudContacts([]);
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      setCloudContacts(await api.listUserContacts());
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
    }
  };

  const refreshCloudShareData = async (
    sessionOverride?: CloudAuthSession | null,
  ) => {
    await Promise.all([
      refreshCloudCollaboration(sessionOverride),
      refreshCloudContacts(sessionOverride),
    ]);
  };

  const restoreCloudLockFromSession = async (
    projectId: string,
    parts: CloudProjectParts,
    session: CloudAuthSession,
  ): Promise<{
    activeProjectLock: CloudActiveProjectLock | null;
    activeSceneLock: CloudActiveSceneLock | null;
  }> => {
    if (!cloudConfig) {
      return { activeProjectLock: null, activeSceneLock: null };
    }
    const api = createCloudApiClient(cloudConfig, () => session.accessToken);
    for (const resourceKey of CLOUD_OWNER_RESOURCE_KEYS) {
      const target = createProjectLockTarget(resourceKey);
      const lockToken = readCloudLockTokenFromSession(projectId, target);
      if (!lockToken) {
        continue;
      }
      const result = await api.heartbeatEditLock(
        projectId,
        target,
        lockToken,
        false,
      );
      if (result.success) {
        return {
          activeProjectLock: {
            baseVersion: parts.resources[resourceKey]?.version ?? 1,
            expiresAt: result.expires_at,
            lockKey: resourceKey,
            lockToken,
          },
          activeSceneLock: null,
        };
      }
      clearCloudLockTokenFromSession(projectId, target);
    }

    for (const scene of parts.scenes) {
      const target = createSceneLockTarget(scene.sceneId);
      const lockToken = readCloudLockTokenFromSession(projectId, target);
      if (!lockToken) {
        continue;
      }
      const result = await api.heartbeatEditLock(
        projectId,
        target,
        lockToken,
        false,
      );
      if (result.success) {
        return {
          activeProjectLock: null,
          activeSceneLock: {
            baseVersion: scene.version,
            expiresAt: result.expires_at,
            lockToken,
            sceneId: scene.sceneId,
          },
        };
      }
      clearCloudLockTokenFromSession(projectId, target);
    }

    return { activeProjectLock: null, activeSceneLock: null };
  };

  const saveCloudCurrentScene = async (
    sourceProject: Project,
    frameId: string | null,
    options: { showNotice?: boolean } = { showNotice: true },
  ): Promise<boolean> => {
    const cloudState = activeCloudProjectRef.current;
    const activeLock = cloudState?.activeSceneLock ?? null;
    if (!cloudState || !activeLock || !frameId || activeLock.sceneId !== frameId) {
      setNotice("クラウドへ保存するには、このシーンの編集ロックを取得してください。");
      return false;
    }
    if (!cloudConfig) {
      setNotice("Supabase接続が未設定です。");
      return false;
    }
    if (isSaving) {
      return false;
    }
    const frame = sourceProject.frames.find((item) => item.id === frameId);
    if (!frame) {
      setNotice("クラウドへ保存するシーンが見つかりません。");
      return false;
    }
    setIsSaving(true);
    clearPendingAutoSave();
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.saveSceneWithLock(
        cloudState.projectId,
        frameId,
        activeLock.baseVersion,
        extractCloudSceneData(frame),
        activeLock.lockToken,
        CLOUD_SCHEMA_VERSION,
        "scene save",
      );
      if (!result.success || result.version === null) {
        setNotice(
          result.reason === "version_conflict"
            ? "クラウド側が更新されています。最新を再読み込みしてください。"
            : "クラウド保存に失敗しました。編集ロックを確認してください。",
        );
        return false;
      }
      const updatedAt = result.updated_at ?? new Date().toISOString();
      const savedProject = {
        ...sourceProject,
        updatedAt,
      };
      projectRef.current = savedProject;
      setProject(savedProject);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              activeSceneLock:
                previous.activeSceneLock?.sceneId === frameId
                  ? {
                      ...previous.activeSceneLock,
                      baseVersion: result.version ?? previous.activeSceneLock.baseVersion,
                    }
                  : previous.activeSceneLock,
              sceneVersions: {
                ...previous.sceneVersions,
                [frameId]: result.version ?? previous.sceneVersions[frameId] ?? 1,
              },
              updatedAt,
            }
          : previous,
      );
      cloudLockActivityRef.current = false;
      setIsDirty(false);
      if (options.showNotice ?? true) {
        setNotice("現在のシーンをクラウドへ保存しました。");
      }
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveCloudProjectResource = async (
    sourceProject: Project,
    resourceKey: CloudResourceKey,
    options: { showNotice?: boolean } = { showNotice: true },
  ): Promise<boolean> => {
    const cloudState = activeCloudProjectRef.current;
    const activeLock = cloudState?.activeProjectLock ?? null;
    if (!cloudState || !activeLock || activeLock.lockKey !== resourceKey) {
      setNotice("クラウドへ保存するには、対象の全体編集ロックを取得してください。");
      return false;
    }
    if (!cloudConfig) {
      setNotice("Supabase接続が未設定です。");
      return false;
    }
    if (isSaving) {
      return false;
    }
    setIsSaving(true);
    clearPendingAutoSave();
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const resourceData = extractCloudProjectResourceData(sourceProject, resourceKey);
      const existingSceneIds = new Set(Object.keys(cloudState.sceneVersions));
      const currentSceneIds = new Set(sourceProject.frames.map((frame) => frame.id));
      const result =
        resourceKey === "sceneOrder"
          ? await api.saveSceneOrderWithLock(
              cloudState.projectId,
              activeLock.baseVersion,
              resourceData as CloudProjectResourceData["sceneOrder"],
              sourceProject.frames
                .filter((frame) => !existingSceneIds.has(frame.id))
                .map((frame) => ({
                  data: extractCloudSceneData(frame),
                  sceneId: frame.id,
                  schemaVersion: CLOUD_SCHEMA_VERSION,
                  version: 1,
                })),
              Object.keys(cloudState.sceneVersions).filter(
                (sceneId) => !currentSceneIds.has(sceneId),
              ),
              activeLock.lockToken,
              CLOUD_SCHEMA_VERSION,
              `${resourceKey} save`,
            )
          : await api.saveProjectResourceWithLock(
              cloudState.projectId,
              resourceKey,
              activeLock.baseVersion,
              resourceData as CloudProjectResourceData[Exclude<
                CloudResourceKey,
                "sceneOrder"
              >],
              activeLock.lockToken,
              CLOUD_SCHEMA_VERSION,
              `${resourceKey} save`,
            );
      if (!result.success || result.version === null) {
        setNotice(
          result.reason === "version_conflict"
            ? "クラウド側が更新されています。最新を再読み込みしてください。"
            : "クラウド保存に失敗しました。編集ロックを確認してください。",
        );
        return false;
      }
      const updatedAt = result.updated_at ?? new Date().toISOString();
      const savedProject = {
        ...sourceProject,
        updatedAt,
      };
      projectRef.current = savedProject;
      setProject(savedProject);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              activeProjectLock:
                previous.activeProjectLock?.lockKey === resourceKey
                  ? {
                      ...previous.activeProjectLock,
                      baseVersion:
                        result.version ?? previous.activeProjectLock.baseVersion,
                    }
                  : previous.activeProjectLock,
              resourceVersions: {
                ...previous.resourceVersions,
                [resourceKey]:
                  result.version ?? previous.resourceVersions[resourceKey] ?? 1,
              },
              sceneVersions:
                resourceKey === "sceneOrder"
                  ? Object.fromEntries(
                      sourceProject.frames.map((frame) => [
                        frame.id,
                        previous.sceneVersions[frame.id] ?? 1,
                      ]),
                    )
                  : previous.sceneVersions,
              updatedAt,
            }
          : previous,
      );
      cloudProjectLockActivityRef.current = false;
      setIsDirty(false);
      if (options.showNotice ?? true) {
        setNotice(`${CLOUD_RESOURCE_LABELS[resourceKey]}をクラウドへ保存しました。`);
      }
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const getCloudLockLabel = (target: CloudLockTarget): string => {
    if (target.targetType === "project") {
      return CLOUD_RESOURCE_LABELS[target.targetId as CloudProjectLockKey] ?? "全体データ";
    }
    if (target.targetType === "scene_cell") {
      const parsed = parseSceneCellLockTargetId(target.targetId);
      const frameLabel =
        parsed &&
        (projectRef.current.frames.find((frame) => frame.id === parsed.sceneId)
          ?.label ??
          "シーン");
      return `${frameLabel || "シーン"}の対象`;
    }
    return (
      projectRef.current.frames.find((frame) => frame.id === target.targetId)?.label ??
      "シーン"
    );
  };

  const getConflictingCloudLocks = async (
    api: CloudApiClient,
    projectId: string,
    target: CloudLockTarget,
    currentUserId: string,
    options: { includeCurrentUser?: boolean } = {},
  ): Promise<CloudActiveLockSummary[]> => {
    const locks = await api.listActiveEditLocks(projectId);
    const now = Date.now();
    return locks.filter((lock) => {
      if (!isCloudActiveLockFresh(lock, now)) {
        return false;
      }
      if (!options.includeCurrentUser && lock.lockedBy === currentUserId) {
        return false;
      }
      if (target.targetType === "project") {
        return true;
      }
      if (target.targetType === "scene_cell") {
        const targetCell = parseSceneCellLockTargetId(target.targetId);
        const lockCell =
          lock.targetType === "scene_cell"
            ? parseSceneCellLockTargetId(lock.targetId)
            : null;
        return (
          lock.targetType === "project" ||
          (targetCell !== null &&
            lock.targetType === "scene" &&
            lock.targetId === targetCell.sceneId) ||
          (targetCell !== null &&
            lockCell !== null &&
            lockCell.sceneId === targetCell.sceneId &&
            lock.targetId === target.targetId)
        );
      }
      return (
        lock.targetType === "project" ||
        (lock.targetType === "scene" && lock.targetId === target.targetId) ||
        (lock.targetType === "scene_cell" &&
          parseSceneCellLockTargetId(lock.targetId)?.sceneId === target.targetId)
      );
    });
  };

  const createCloudLockTargetFromSummary = (
    lock: CloudActiveLockSummary,
  ): CloudLockTarget =>
    lock.targetType === "project"
      ? createProjectLockTarget(lock.targetId as CloudProjectLockKey)
      : lock.targetType === "scene_cell"
        ? {
            targetId: lock.targetId,
            targetType: "scene_cell",
          }
        : createSceneLockTarget(lock.targetId);

  const forceReleaseCloudLockSummaries = async (
    api: CloudApiClient,
    projectId: string,
    locks: CloudActiveLockSummary[],
  ): Promise<boolean> => {
    for (const lock of locks) {
      const result = await api.forceReleaseEditLock(
        projectId,
        createCloudLockTargetFromSummary(lock),
      );
      if (!result.success && result.reason !== "lock_not_found") {
        return false;
      }
    }
    return true;
  };

  const waitForCloudLockConflictsToClear = async (
    api: CloudApiClient,
    projectId: string,
    target: CloudLockTarget,
    currentUserId: string,
  ): Promise<boolean> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < OWNER_TAKEOVER_WAIT_MS) {
      await wait(OWNER_TAKEOVER_POLL_MS);
      const conflicts = await getConflictingCloudLocks(
        api,
        projectId,
        target,
        currentUserId,
      );
      if (conflicts.length === 0) {
        return true;
      }
    }
    return false;
  };

  const resolveOwnerLockConflict = async (
    api: CloudApiClient,
    cloudState: CloudActiveProjectState,
    target: CloudLockTarget,
    currentUserId: string,
    lockedBy?: string | null,
  ): Promise<boolean> => {
    if (cloudState.role !== "owner") {
      return false;
    }
    let conflicts = await getConflictingCloudLocks(
      api,
      cloudState.projectId,
      target,
      currentUserId,
    );
    if (conflicts.length === 0) {
      return true;
    }
    const staleCellLocks = conflicts.filter((lock) =>
      isCloudSceneCellLockStale(lock),
    );
    if (staleCellLocks.length > 0) {
      const released = await forceReleaseCloudLockSummaries(
        api,
        cloudState.projectId,
        staleCellLocks,
      );
      if (!released) {
        setNotice("古い編集状態の解除に失敗しました。");
        return false;
      }
      conflicts = await getConflictingCloudLocks(
        api,
        cloudState.projectId,
        target,
        currentUserId,
      );
      if (conflicts.length === 0) {
        setNotice("古い編集状態を解除しました。");
        return true;
      }
    }
    const targetLabel = getCloudLockLabel(target);
    const displayLockedBy = conflicts[0]?.lockedBy ?? lockedBy ?? null;
    const lockedByName = displayLockedBy
      ? cloudMemberNameById.get(displayLockedBy) ?? "他の参加者"
      : "他の参加者";
    const takeoverConfirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "保存を依頼する",
      message: `${lockedByName}が編集中です。相手に保存を依頼してから、${targetLabel}の編集を続行しますか？`,
      title: "編集中の操作を引き継ぎますか？",
      tone: "default",
    });
    if (!takeoverConfirmed) {
      return false;
    }
    const requestResult = await api.requestLockTakeover(
      cloudState.projectId,
      target,
    );
    if (!requestResult.success) {
      setNotice("編集引き継ぎの依頼を送信できませんでした。");
      return false;
    }
    setNotice("相手に保存と編集終了を依頼しました。最大10秒待機します。");
    const cleared = await waitForCloudLockConflictsToClear(
      api,
      cloudState.projectId,
      target,
      currentUserId,
    );
    if (cleared) {
      return true;
    }
    const forceConfirmed = await requestAppConfirm({
      cancelLabel: "待つ",
      confirmLabel: "強制解除する",
      message:
        "相手の保存完了を確認できませんでした。未保存内容が残っている可能性があります。強制的に編集を続行しますか？",
      title: "ロックを強制解除しますか？",
      tone: "danger",
    });
    if (!forceConfirmed) {
      return false;
    }
    conflicts = await getConflictingCloudLocks(
      api,
      cloudState.projectId,
      target,
      currentUserId,
    );
    for (const conflict of conflicts) {
      const result = await api.forceReleaseEditLock(
        cloudState.projectId,
        createCloudLockTargetFromSummary(conflict),
      );
      if (!result.success && result.reason !== "lock_not_found") {
        setNotice("編集中ロックの強制解除に失敗しました。");
        return false;
      }
    }
    return true;
  };

  const acquireCloudEditLock = async (
    api: CloudApiClient,
    cloudState: CloudActiveProjectState,
    target: CloudLockTarget,
    lockToken: string,
    currentUserId: string,
    metadata?: {
      holderClientId?: string | null;
      leaseId?: string | null;
      operationId?: string | null;
    },
  ) => {
    let result = await api.acquireEditLock(
      cloudState.projectId,
      target,
      lockToken,
      metadata,
    );
    if (
      !result.success &&
      cloudState.role === "owner" &&
      result.locked_by === currentUserId
    ) {
      const ownConflicts = (
        await getConflictingCloudLocks(
          api,
          cloudState.projectId,
          target,
          currentUserId,
          { includeCurrentUser: true },
        )
      ).filter((lock) => lock.lockedBy === currentUserId);
      if (ownConflicts.length > 0) {
        const released = await forceReleaseCloudLockSummaries(
          api,
          cloudState.projectId,
          ownConflicts,
        );
        if (released) {
          result = await api.acquireEditLock(
            cloudState.projectId,
            target,
            lockToken,
            metadata,
          );
        }
      }
    }
    if (
      !result.success &&
      cloudState.role === "owner" &&
      result.reason !== "owner_required" &&
      result.reason !== "permission_denied"
    ) {
      const canRetry = await resolveOwnerLockConflict(
        api,
        cloudState,
        target,
        currentUserId,
        result.locked_by,
      );
      if (canRetry) {
        result = await api.acquireEditLock(
          cloudState.projectId,
          target,
          lockToken,
          metadata,
        );
      }
    }
    return result;
  };

  const beginCloudProjectResourceEdit = async (
    resourceKey: CloudResourceKey,
    options: { silent?: boolean } = {},
  ): Promise<boolean> => {
    let cloudState = activeCloudProjectRef.current;
    if (!cloudState) {
      return false;
    }
    if (cloudState.role !== "owner") {
      setNotice("全体データの編集はownerのみ可能です。");
      return false;
    }
    void CLOUD_OWNER_RESOURCE_KEYS;
    if (activeCloudCellLocksRef.current.length > 0) {
      for (const lock of [...activeCloudCellLocksRef.current]) {
        const saved = await saveCloudSceneCellPatch(lock, projectRef.current);
        if (!saved) {
          setNotice("操作中の対象を保存できませんでした。保存状態を確認してから全体編集を開始してください。");
          return false;
        }
        const released = await releaseCloudSceneCellLock(lock, { silent: true });
        if (!released) {
          return false;
        }
      }
      cloudState = activeCloudProjectRef.current;
      if (!cloudState) {
        return false;
      }
    }
    if (cloudState.activeSceneLock) {
      const sceneLock = cloudState.activeSceneLock;
      const saved = isDirtyRef.current
        ? await saveCloudCurrentScene(projectRef.current, sceneLock.sceneId, {
            showNotice: false,
          })
        : true;
      if (!saved) {
        setNotice("現在のシーンを保存できませんでした。保存状態を確認してから全体編集を開始してください。");
        return false;
      }
      const released = await releaseActiveCloudSceneLock({ silent: true });
      if (!released) {
        return false;
      }
      cloudState = {
        ...cloudState,
        activeSceneLock: null,
      };
    }
    if (cloudState.activeProjectLock?.lockKey === resourceKey) {
      if (!options.silent) {
        setNotice(`${CLOUD_RESOURCE_LABELS[resourceKey]}は編集中です。`);
      }
      return true;
    }
    if (cloudState.activeProjectLock) {
      const projectLock = cloudState.activeProjectLock;
      const saved =
        isDirtyRef.current && projectLock.lockKey !== "import"
          ? await saveCloudProjectResource(projectRef.current, projectLock.lockKey, {
              showNotice: false,
            })
          : true;
      if (!saved) {
        setNotice("編集中の全体データを保存できませんでした。保存状態を確認してから切り替えてください。");
        return false;
      }
      const released = await releaseActiveCloudProjectLock({ silent: true });
      if (!released) {
        return false;
      }
      cloudState = {
        ...cloudState,
        activeProjectLock: null,
      };
    }
    if (!cloudConfig) {
      setNotice("Supabase接続が未設定です。");
      return false;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const target = createProjectLockTarget(resourceKey);
      const lockToken = createCloudLockToken();
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await acquireCloudEditLock(
        api,
        cloudState,
        target,
        lockToken,
        activeSession.user.id,
      );
      if (!result.success) {
        setNotice(
          result.reason === "project_lock_wait_for_active_scene"
            ? `${CLOUD_RESOURCE_LABELS[resourceKey]}を編集するには、現在のシーン編集が終わるまで待ってください。`
            : "全体編集ロックを取得できませんでした。",
        );
        return false;
      }
      saveCloudLockTokenToSession(cloudState.projectId, target, lockToken);
      const nextCloudState: CloudActiveProjectState = {
        ...cloudState,
        activeProjectLock: {
          baseVersion: cloudState.resourceVersions[resourceKey] ?? 1,
          expiresAt: result.expires_at,
          lockKey: resourceKey,
          lockToken,
        },
      };
      activeCloudProjectRef.current = nextCloudState;
      setActiveCloudProject(nextCloudState);
      const panelByResource: Record<CloudResourceKey, PanelTabId> = {
        audio: "audio",
        members: "members",
        objects: "objects",
        sceneOrder: "timeline",
        settings: "stage",
      };
      setActivePanelTab(panelByResource[resourceKey]);
      if (resourceKey === "members" || resourceKey === "objects") {
        setIsRosterManagerOpen(true);
      }
      if (!options.silent) {
        setNotice(`${CLOUD_RESOURCE_LABELS[resourceKey]}を編集モードにしました。`);
      }
      void refreshCloudActiveLocks(activeSession);
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      setIsCloudBusy(false);
    }
  };

  const beginCloudSceneEdit = async (
    options: { silent?: boolean } = {},
  ): Promise<boolean> => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState) {
      return false;
    }
    if (cloudState.role === "viewer") {
      setNotice("閲覧のみの権限では編集できません。");
      return false;
    }
    if (!selectedFrame) {
      setNotice("編集するシーンを選択してください。");
      return false;
    }
    if (cloudState.activeSceneLock?.sceneId === selectedFrame.id) {
      setNotice("このシーンは編集中です。");
      return true;
    }
    if (cloudState.activeSceneLock) {
      setNotice("別のシーンを編集中です。保存または編集終了してから切り替えてください。");
      return false;
    }
    if (cloudState.activeProjectLock) {
      setNotice("全体設定の編集中です。保存または編集終了してからシーン編集を開始してください。");
      return false;
    }
    if (!cloudConfig) {
      setNotice("Supabase接続が未設定です。");
      return false;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const target = createSceneLockTarget(selectedFrame.id);
      const lockToken = createCloudLockToken();
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await acquireCloudEditLock(
        api,
        cloudState,
        target,
        lockToken,
        activeSession.user.id,
      );
      if (!result.success) {
        if (result.reason === "project_lock_active") {
          await refreshCloudActiveLocks(activeSession);
          if (!options.silent) {
            setNotice("全体データの編集中です。シーンは閲覧のみです。");
          }
          return false;
        }
        const lockedBy = result.locked_by
          ? cloudMemberNameById.get(result.locked_by) ?? "他の参加者"
          : null;
        if (!options.silent) {
          setNotice(
            result.locked_by
              ? `このシーンは${lockedBy}が編集中です。`
              : "このシーンの編集ロックを取得できませんでした。",
          );
        }
        return false;
      }
      saveCloudLockTokenToSession(cloudState.projectId, target, lockToken);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              activeSceneLock: {
                baseVersion: previous.sceneVersions[selectedFrame.id] ?? 1,
                expiresAt: result.expires_at,
                lockToken,
                sceneId: selectedFrame.id,
              },
            }
          : previous,
      );
      if (!options.silent) {
        setNotice(`「${selectedFrame.label}」を編集モードにしました。`);
      }
      void refreshCloudActiveLocks(activeSession);
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      setIsCloudBusy(false);
    }
  };

  const switchOwnerCloudSceneEdit = async (nextSceneId: string) => {
    const cloudState = activeCloudProjectRef.current;
    const activeSceneLock = cloudState?.activeSceneLock ?? null;
    if (
      !cloudState ||
      cloudState.role !== "owner" ||
      !activeSceneLock ||
      activeSceneLock.sceneId === nextSceneId ||
      cloudState.activeProjectLock
    ) {
      return;
    }
    const switchKey = `${cloudState.projectId}:${activeSceneLock.sceneId}->${nextSceneId}`;
    if (ownerSceneSwitchKeyRef.current === switchKey) {
      return;
    }
    ownerSceneSwitchKeyRef.current = switchKey;
    try {
      const saved = isDirtyRef.current
        ? await saveCloudCurrentScene(projectRef.current, activeSceneLock.sceneId, {
            showNotice: false,
          })
        : true;
      if (!saved) {
        setNotice("前のシーンを保存できませんでした。保存内容を確認してから次のシーンを編集してください。");
        return;
      }
      const released = await releaseActiveCloudSceneLock({ silent: true });
      if (!released) {
        return;
      }
      const latestCloudState = activeCloudProjectRef.current;
      if (latestCloudState) {
        activeCloudProjectRef.current = {
          ...latestCloudState,
          activeSceneLock: null,
        };
      }
      const currentUserId = cloudSessionRef.current?.user.id;
      const hasBlockingRemoteLock = cloudActiveLocks.some(
        (lock) =>
          lock.lockedBy !== currentUserId &&
          (lock.targetType === "project" ||
            (lock.targetType === "scene" && lock.targetId === nextSceneId)),
      );
      if (hasBlockingRemoteLock) {
        setNotice("このシーンは他の参加者が編集中です。閲覧のみで開きます。");
        return;
      }
      ownerAutoSceneLockKeyRef.current = null;
      setNotice("前のシーンの編集を終了しました。次のシーンは操作開始時に対象ごとのロックを取得します。");
    } finally {
      ownerSceneSwitchKeyRef.current = null;
    }
  };

  useEffect(() => {
    const cloudState = activeCloudProjectRef.current;
    const currentFrameId = selectedFrame?.id ?? null;
    if (
      cloudState?.role === "owner" &&
      currentFrameId &&
      cloudState.activeSceneLock &&
      cloudState.activeSceneLock.sceneId !== currentFrameId &&
      !cloudState.activeProjectLock &&
      !isCloudBusy
    ) {
      void switchOwnerCloudSceneEdit(currentFrameId);
      return;
    }
  }, [
    activeCloudProject?.activeProjectLock?.lockKey,
    activeCloudProject?.activeSceneLock?.sceneId,
    activeCloudProject?.projectId,
    activeCloudProject?.role,
    cloudActiveLocks,
    cloudSession?.user.id,
    isCloudBusy,
    selectedFrame?.id,
  ]);

  const releaseActiveCloudProjectLock = async (
    options: { silent?: boolean } = {},
  ): Promise<boolean> => {
    const cloudState = activeCloudProjectRef.current;
    const activeLock = cloudState?.activeProjectLock ?? null;
    if (!cloudState || !activeLock) {
      return true;
    }
    if (!cloudConfig) {
      return false;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const target = createProjectLockTarget(activeLock.lockKey);
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.releaseEditLock(
        cloudState.projectId,
        target,
        activeLock.lockToken,
      );
      if (!result.success) {
        setNotice("全体編集ロックの解除に失敗しました。TTLで自動解除されます。");
        return false;
      }
      clearCloudLockTokenFromSession(cloudState.projectId, target);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              activeProjectLock: null,
            }
          : previous,
      );
      if (activeLock.lockKey === "members" || activeLock.lockKey === "objects") {
        setIsRosterManagerOpen(false);
      }
      cloudProjectLockActivityRef.current = false;
      if (!options.silent) {
        setNotice("全体編集を終了しました。");
      }
      void refreshCloudActiveLocks(activeSession);
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      setIsCloudBusy(false);
    }
  };

  const releaseActiveCloudSceneLock = async (
    options: { silent?: boolean } = {},
  ): Promise<boolean> => {
    const cloudState = activeCloudProjectRef.current;
    const activeLock = cloudState?.activeSceneLock ?? null;
    if (!cloudState || !activeLock) {
      return true;
    }
    if (!cloudConfig) {
      return false;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const target = createSceneLockTarget(activeLock.sceneId);
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.releaseEditLock(
        cloudState.projectId,
        target,
        activeLock.lockToken,
      );
      if (!result.success) {
        setNotice("編集ロックの解除に失敗しました。TTLで自動解除されます。");
        return false;
      }
      clearCloudLockTokenFromSession(cloudState.projectId, target);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              activeSceneLock: null,
            }
          : previous,
      );
      cloudLockActivityRef.current = false;
      if (!options.silent) {
        setNotice("シーン編集を終了しました。");
      }
      void refreshCloudActiveLocks(activeSession);
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      setIsCloudBusy(false);
    }
  };

  const handleCloudLockTakeoverRequest = async (
    request: CloudLockTakeoverRequest,
  ) => {
    const cloudState = activeCloudProjectRef.current;
    if (
      !cloudState ||
      !cloudConfig ||
      request.projectId !== cloudState.projectId ||
      request.actorId === cloudSessionRef.current?.user.id
    ) {
      return;
    }
    const activeSceneLock = cloudState.activeSceneLock;
    const activeProjectLock = cloudState.activeProjectLock;
    const activeCellLocks = activeCloudCellLocksRef.current;
    const cellLocksToRelease = activeCellLocks.filter((lock) => {
      if (request.targetType === "project") {
        return true;
      }
      if (request.targetType === "scene") {
        return lock.sceneId === request.targetId;
      }
      return lock.targetId === request.targetId;
    });
    const shouldReleaseScene =
      Boolean(activeSceneLock) &&
      (request.targetType === "project" ||
        activeSceneLock?.sceneId === request.targetId);
    const shouldReleaseProject =
      Boolean(activeProjectLock) &&
      (request.targetType === "project" ||
        request.targetType === "scene");
    if (
      !shouldReleaseScene &&
      !shouldReleaseProject &&
      cellLocksToRelease.length === 0
    ) {
      return;
    }

    setNotice("ownerが編集を開始しようとしています。現在の変更を保存します。");
    if (cellLocksToRelease.length > 0) {
      let allSaved = true;
      for (const lock of cellLocksToRelease) {
        const saved = await saveCloudSceneCellPatch(lock, projectRef.current);
        allSaved = allSaved && saved;
        await releaseCloudSceneCellLock(lock, { silent: true });
      }
      setNotice(
        allSaved
          ? "ownerが編集を開始するため、操作中の対象を保存して編集を終了しました。"
          : "ownerが編集を開始するため、保存できなかった操作を終了しました。",
      );
      if (!shouldReleaseScene && !shouldReleaseProject) {
        return;
      }
    }

    if (shouldReleaseScene && activeSceneLock) {
      const saved = isDirtyRef.current
        ? await saveCloudCurrentScene(projectRef.current, activeSceneLock.sceneId, {
            showNotice: false,
          })
        : true;
      await releaseActiveCloudSceneLock({ silent: true });
      setNotice(
        saved
          ? "ownerが編集を開始するため、シーンを保存して編集を終了しました。"
          : "ownerが編集を開始するため、保存できなかったシーン編集を終了しました。",
      );
      return;
    }

    if (shouldReleaseProject && activeProjectLock) {
      const saved =
        isDirtyRef.current && activeProjectLock.lockKey !== "import"
          ? await saveCloudProjectResource(
              projectRef.current,
              activeProjectLock.lockKey,
              { showNotice: false },
            )
          : true;
      await releaseActiveCloudProjectLock({ silent: true });
      setNotice(
        saved
          ? "ownerが編集を開始するため、全体データを保存して編集を終了しました。"
          : "ownerが編集を開始するため、保存できなかった全体編集を終了しました。",
      );
    }
  };

  function handleCloudPreviewEvent(event: CloudPreviewEvent): void {
    const cloudState = activeCloudProjectRef.current;
    if (
      !cloudState ||
      event.projectId !== cloudState.projectId ||
      (event.cellKind !== "member_position" &&
        event.cellKind !== "object_state") ||
      event.holderClientId === readCloudClientIdFromSession()
    ) {
      return;
    }
    const isMemberPositionPreview = event.cellKind === "member_position";
    const position = isMemberPositionPreview
      ? readPreviewPosition(event.value)
      : null;
    const objectState = !isMemberPositionPreview
      ? readPreviewObjectState(event.value)
      : null;
    if (isMemberPositionPreview && !position) {
      return;
    }
    if (!isMemberPositionPreview && !objectState) {
      return;
    }
    const previewPosition = position;
    const previewObjectState = objectState;
    const target = createSceneCellLockTarget(
      event.sceneId,
      event.cellKind,
      event.cellId,
    );
    const hasLocalLock = activeCloudCellLocksRef.current.some(
      (lock) => lock.targetId === target.targetId,
    );
    if (hasLocalLock) {
      return;
    }
    const preview = {
      holderClientId: event.holderClientId,
      leaseId: event.leaseId,
      memberId: event.cellId,
      operationId: event.operationId,
      sceneId: event.sceneId,
    };
    const hasValidLock = cloudActiveLocksRef.current.some((lock) =>
      isMemberPositionPreview
        ? doesCloudLockMatchMemberPreview(lock, {
            ...preview,
            memberId: event.cellId,
          })
        : doesCloudLockMatchObjectPreview(lock, {
            ...preview,
            objectId: event.cellId,
          }),
    );
    if (!hasValidLock) {
      return;
    }
    if (!isMemberPositionPreview) {
      if (!previewObjectState) {
        return;
      }
      const previewKey = getCloudObjectStatePreviewKey(
        event.sceneId,
        event.cellId,
      );
      setCloudObjectStatePreviews((previous) => {
        const current = previous[previewKey];
        if (
          current &&
          current.operationId === event.operationId &&
          event.seq <= current.seq
        ) {
          return previous;
        }
        return {
          ...previous,
          [previewKey]: {
            holderClientId: event.holderClientId,
            leaseId: event.leaseId,
            objectId: event.cellId,
            operationId: event.operationId,
            sceneId: event.sceneId,
            sentAt: event.sentAt,
            seq: event.seq,
            state: previewObjectState,
          },
        };
      });
      return;
    }
    if (!previewPosition) {
      return;
    }
    const previewKey = getCloudMemberPositionPreviewKey(
      event.sceneId,
      event.cellId,
    );
    setCloudMemberPositionPreviews((previous) => {
      const current = previous[previewKey];
      if (
        current &&
        current.operationId === event.operationId &&
        event.seq <= current.seq
      ) {
        return previous;
      }
      return {
        ...previous,
        [previewKey]: {
          ...preview,
          position: previewPosition,
          sentAt: event.sentAt,
          seq: event.seq,
        },
      };
    });
  }

  function handleCloudCommitEvent(event: CloudCommitEvent): void {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || event.projectId !== cloudState.projectId) {
      return;
    }
    if (event.cellKind === "member_position") {
      clearCloudMemberPositionPreview(event.sceneId, event.cellId);
    }
    if (event.cellKind === "object_state") {
      clearCloudObjectStatePreview(event.sceneId, event.cellId);
    }
  }

  function applyCloudScenePatchNotification(
    notification: CloudSaveNotification,
  ): boolean {
    if (
      notification.targetType !== "scene" ||
      !notification.patchType ||
      !activeCloudProjectRef.current ||
      activeCloudProjectRef.current.projectId !== notification.projectId ||
      activeCloudProjectRef.current.activeSceneLock ||
      activeCloudProjectRef.current.activeProjectLock ||
      activeCloudCellLocksRef.current.length > 0 ||
      isDirtyRef.current
    ) {
      return false;
    }
    const cellId = notification.cellId ?? "_";
    const patchType = notification.patchType as CloudSceneCellPatchType;
    const patchValue = notification.patchValue;
    const sourceProject = projectRef.current;
    const frame = sourceProject.frames.find(
      (item) => item.id === notification.targetId,
    );
    if (!frame) {
      return false;
    }
    const nextFrames = sourceProject.frames.map((item) => {
      if (item.id !== notification.targetId) {
        return item;
      }
      if (patchType === "member_position") {
        if (
          !patchValue ||
          typeof patchValue !== "object" ||
          typeof (patchValue as Position).x !== "number" ||
          typeof (patchValue as Position).y !== "number"
        ) {
          return item;
        }
        return {
          ...item,
          positions: {
            ...item.positions,
            [cellId]: patchValue as Position,
          },
        };
      }
      if (patchType === "object_state") {
        if (!patchValue || typeof patchValue !== "object") {
          return item;
        }
        return {
          ...item,
          objectStates: {
            ...item.objectStates,
            [cellId]: patchValue as ObjectState,
          },
        };
      }
      if (patchType === "member_visibility") {
        return {
          ...item,
          memberVisibility: {
            ...(item.memberVisibility ?? {}),
            [cellId]: Boolean(patchValue),
          },
        };
      }
      if (patchType === "object_visibility") {
        const previousState = item.objectStates[cellId];
        if (!previousState) {
          return item;
        }
        return {
          ...item,
          objectStates: {
            ...item.objectStates,
            [cellId]: {
              ...previousState,
              visible: Boolean(patchValue),
            },
          },
        };
      }
      if (patchType === "object_assignment") {
        return {
          ...item,
          objectAssignments: {
            ...(item.objectAssignments ?? {}),
            [cellId]: Array.isArray(patchValue) ? (patchValue as string[]) : [],
          },
        };
      }
      return {
        ...item,
        notes: typeof patchValue === "string" ? patchValue : "",
      };
    });
    const updatedAt = new Date().toISOString();
    const nextProject = {
      ...sourceProject,
      frames: nextFrames,
      updatedAt,
    };
    projectRef.current = nextProject;
    setProject(nextProject);
    if (patchType === "member_position") {
      clearCloudMemberPositionPreview(notification.targetId, cellId);
    }
    if (patchType === "object_state") {
      clearCloudObjectStatePreview(notification.targetId, cellId);
    }
    if (notification.version !== null) {
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              sceneVersions: {
                ...previous.sceneVersions,
                [notification.targetId]: notification.version ?? previous.sceneVersions[notification.targetId] ?? 1,
              },
              sceneCellVersions:
                notification.cellVersion !== null && notification.patchType
                  ? {
                      ...previous.sceneCellVersions,
                      [createSceneCellVersionKey(
                        notification.targetId,
                        notification.patchType as CloudSceneCellPatchType,
                        cellId,
                      )]: notification.cellVersion,
                    }
                  : previous.sceneCellVersions,
              updatedAt,
            }
          : previous,
      );
    }
    setNotice("他の参加者の保存済み変更を取り込みました。");
    return true;
  }

  useEffect(() => {
    const activeLock = activeCloudProject?.activeSceneLock;
    if (!activeCloudProject || !activeLock || !cloudConfig) {
      return undefined;
    }

    const heartbeat = async () => {
      const cloudState = activeCloudProjectRef.current;
      const lock = cloudState?.activeSceneLock ?? null;
      if (!cloudState || !lock || !cloudConfig) {
        return;
      }
      try {
        const activeSession = await getActiveCloudSession(cloudSessionRef.current);
        if (!activeSession) {
          return;
        }
        const target = createSceneLockTarget(lock.sceneId);
        const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
        const result = await api.heartbeatEditLock(
          cloudState.projectId,
          target,
          lock.lockToken,
          cloudLockActivityRef.current,
        );
        cloudLockActivityRef.current = false;
        if (!result.success) {
          clearCloudLockTokenFromSession(cloudState.projectId, target);
          setActiveCloudProject((previous) =>
            previous
              ? {
                  ...previous,
                  activeSceneLock: null,
                }
              : previous,
          );
          setNotice(
            isDirtyRef.current
              ? "シーン編集ロックが解除されました。未保存の変更は保存されていません。"
              : "シーン編集ロックが解除されました。必要なら再度編集を開始してください。",
          );
          return;
        }
        setActiveCloudProject((previous) =>
          previous?.activeSceneLock?.sceneId === lock.sceneId
            ? {
                ...previous,
                activeSceneLock: {
                  ...previous.activeSceneLock,
                  expiresAt: result.expires_at,
                },
              }
            : previous,
        );
      } catch (error) {
        console.warn("クラウド編集ロックのheartbeatに失敗しました。", error);
      }
    };

    const intervalId = window.setInterval(() => {
      void heartbeat();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [
    activeCloudProject?.activeSceneLock?.lockToken,
    activeCloudProject?.activeSceneLock?.sceneId,
    activeCloudProject?.projectId,
    cloudConfig,
  ]);

  useEffect(() => {
    if (!activeCloudProject || activeCloudCellLocks.length === 0 || !cloudConfig) {
      return undefined;
    }

    const heartbeat = async () => {
      const cloudState = activeCloudProjectRef.current;
      const locks = activeCloudCellLocksRef.current;
      if (!cloudState || locks.length === 0 || !cloudConfig) {
        return;
      }
      try {
        const activeSession = await getActiveCloudSession(cloudSessionRef.current);
        if (!activeSession) {
          return;
        }
        const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
        const nextLocks: CloudActiveCellLock[] = [];
        for (const lock of locks) {
          const target = createSceneCellLockTarget(
            lock.sceneId,
            lock.patchType,
            lock.cellId,
          );
          const result = await api.heartbeatEditLock(
            cloudState.projectId,
            target,
            lock.lockToken,
            cloudLockActivityRef.current,
            {
              holderClientId: lock.holderClientId,
              leaseId: lock.leaseId,
              operationId: lock.operationId,
            },
          );
          if (!result.success) {
            clearCloudLockTokenFromSession(cloudState.projectId, target);
            setNotice("セル編集ロックが解除されました。未保存の変更は保存されていません。");
            continue;
          }
          nextLocks.push({
            ...lock,
            expiresAt: result.expires_at,
          });
        }
        cloudLockActivityRef.current = false;
        activeCloudCellLocksRef.current = nextLocks;
        setActiveCloudCellLocks(nextLocks);
      } catch (error) {
        console.warn("セル編集ロックのheartbeatに失敗しました。", error);
      }
    };

    const intervalId = window.setInterval(() => {
      void heartbeat();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [
    activeCloudCellLocks,
    activeCloudProject?.projectId,
    cloudConfig,
  ]);

  useEffect(() => {
    const activeLock = activeCloudProject?.activeProjectLock;
    if (!activeCloudProject || !activeLock || !cloudConfig) {
      return undefined;
    }

    const heartbeat = async () => {
      const cloudState = activeCloudProjectRef.current;
      const lock = cloudState?.activeProjectLock ?? null;
      if (!cloudState || !lock || !cloudConfig) {
        return;
      }
      try {
        const activeSession = await getActiveCloudSession(cloudSessionRef.current);
        if (!activeSession) {
          return;
        }
        const target = createProjectLockTarget(lock.lockKey);
        const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
        const result = await api.heartbeatEditLock(
          cloudState.projectId,
          target,
          lock.lockToken,
          cloudProjectLockActivityRef.current,
        );
        cloudProjectLockActivityRef.current = false;
        if (!result.success) {
          clearCloudLockTokenFromSession(cloudState.projectId, target);
          setActiveCloudProject((previous) =>
            previous
              ? {
                  ...previous,
                  activeProjectLock: null,
                }
              : previous,
          );
          setNotice(
            isDirtyRef.current
              ? "全体編集ロックが解除されました。未保存の変更は保存されていません。"
              : "全体編集ロックが解除されました。必要なら再度編集を開始してください。",
          );
          return;
        }
        setActiveCloudProject((previous) =>
          previous?.activeProjectLock?.lockKey === lock.lockKey
            ? {
                ...previous,
                activeProjectLock: {
                  ...previous.activeProjectLock,
                  expiresAt: result.expires_at,
                },
              }
            : previous,
        );
      } catch (error) {
        console.warn("クラウド全体編集ロックのheartbeatに失敗しました。", error);
      }
    };

    const intervalId = window.setInterval(() => {
      void heartbeat();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [
    activeCloudProject?.activeProjectLock?.lockKey,
    activeCloudProject?.activeProjectLock?.lockToken,
    activeCloudProject?.projectId,
    cloudConfig,
  ]);

  useEffect(() => {
    if (
      !APP_FEATURES.collaboration ||
      !activeCloudProject ||
      !cloudConfig ||
      !cloudSession
    ) {
      return undefined;
    }
    let isDisposed = false;
    let cleanup: (() => Promise<void>) | null = null;

    const start = async () => {
      try {
        const activeSession = await getActiveCloudSession(cloudSessionRef.current);
        if (!activeSession || isDisposed) {
          return;
        }
        await refreshCloudActiveLocks(activeSession);
        if (activeCloudProject.role === "owner") {
          await refreshCloudCollaboration(activeSession);
        }
        const { subscribeCloudProjectRealtime } = await import(
          "./cloud/realtime"
        );
        const subscription = subscribeCloudProjectRealtime({
          accessToken: activeSession.accessToken,
          config: cloudConfig,
          onError: (message) => setNotice(message),
          onLockChange: () => {
            void refreshCloudActiveLocks(cloudSessionRef.current);
          },
          onCommit: (event) => {
            handleCloudCommitEvent(event);
          },
          onLockEvent: (event) => {
            if (
              (event.type === "lock_released" ||
                event.type === "lock_expired") &&
              event.targetType === "scene_cell" &&
              event.targetId
            ) {
              const parsed = parseSceneCellLockTargetId(event.targetId);
              if (parsed?.patchType === "member_position") {
                clearCloudMemberPositionPreview(parsed.sceneId, parsed.cellId);
              }
              if (parsed?.patchType === "object_state") {
                clearCloudObjectStatePreview(parsed.sceneId, parsed.cellId);
              }
            }
          },
          onPresenceChange: setCloudPresenceItems,
          onPreview: (event) => {
            handleCloudPreviewEvent(event);
          },
          onSave: (notification) => {
            if (notification.actorId === cloudSessionRef.current?.user.id) {
              return;
            }
            const label =
              notification.targetType === "scene"
                ? projectRef.current.frames.find(
                    (frame) => frame.id === notification.targetId,
                  )?.label ?? "シーン"
                : CLOUD_RESOURCE_LABELS[
                    notification.targetId as CloudProjectLockKey
                  ] ?? "全体データ";
            const queuePendingUpdate = () => {
              setCloudPendingUpdates((previous) => {
                const nextUpdate = { ...notification, label };
                const filtered = previous.filter(
                  (item) =>
                    item.targetType !== notification.targetType ||
                    item.targetId !== notification.targetId,
                );
                return [...filtered, nextUpdate].slice(-8);
              });
              setNotice("クラウド側に更新があります。必要なら再読み込みしてください。");
            };
            const cloudState = activeCloudProjectRef.current;
            if (applyCloudScenePatchNotification(notification)) {
              return;
            }
            const canAutoReload =
              cloudState?.projectId === notification.projectId &&
              !cloudState.activeSceneLock &&
              !cloudState.activeProjectLock &&
              activeCloudCellLocksRef.current.length === 0 &&
              !isDirtyRef.current &&
              !isCloudBusyRef.current &&
              !isCloudShareOpenRef.current;
            if (canAutoReload) {
              void reloadActiveCloudProject({ automatic: true }).then((success) => {
                if (!success) {
                  queuePendingUpdate();
                }
              });
              return;
            }
            queuePendingUpdate();
          },
          onTakeoverRequest: (request) => {
            void handleCloudLockTakeoverRequest(request);
          },
          presence: null,
          presenceKey: activeSession.user.id,
          projectId: activeCloudProject.projectId,
        });
        cloudRealtimeSubscriptionRef.current = subscription;
        const currentCloudState = activeCloudProjectRef.current;
        if (currentCloudState) {
          const activeCellLock = activeCloudCellLocksRef.current[0] ?? null;
          const sceneId =
            currentCloudState.activeSceneLock?.sceneId ??
            activeCellLock?.sceneId ??
            selectedFrameIdRef.current ??
            projectRef.current.frames[0]?.id ??
            null;
          const sceneLabel = sceneId
            ? projectRef.current.frames.find((frame) => frame.id === sceneId)
                ?.label ?? null
            : null;
          const projectLock = currentCloudState.activeProjectLock;
          const status = projectLock
            ? "project-editing"
            : currentCloudState.activeSceneLock || activeCellLock
              ? "editing"
              : "viewing";
          void subscription.updatePresence({
            displayName:
              readCloudDisplayName(activeSession.user.displayName) ??
              "名前未設定",
            role: currentCloudState.role,
            sceneId,
            sceneLabel,
            status,
            targetId: projectLock ? projectLock.lockKey : sceneId,
            targetType: projectLock ? "project" : sceneId ? "scene" : null,
            updatedAt: new Date().toISOString(),
            userId: activeSession.user.id,
          });
        }
        cleanup = subscription.unsubscribe;
      } catch (error) {
        console.warn("クラウド更新通知の開始に失敗しました。", error);
      }
    };

    void start();

    return () => {
      isDisposed = true;
      setCloudPresenceItems([]);
      cloudRealtimeSubscriptionRef.current = null;
      if (cleanup) {
        void cleanup();
      }
    };
  }, [activeCloudProject?.projectId, cloudConfig, cloudSession?.accessToken]);

  const refreshCloudProjects = async (
    sessionOverride?: CloudAuthSession | null,
  ) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession(sessionOverride);
      if (!activeSession) {
        setCloudProjects([]);
        setCloudError("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      setCloudProjects(await api.listCloudProjects());
      setCloudError(null);
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const signInToCloud = async (email: string, password: string) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const auth = createCloudAuthClient(cloudConfig);
      const session = await auth.signInWithPassword(email, password);
      saveCloudAuthSession(session);
      setCloudSession(session);
      setCloudError(null);
      const api = createCloudApiClient(cloudConfig, () => session.accessToken);
      setCloudProjects(await api.listCloudProjects());
      setNotice("クラウドにログインしました。");
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const signUpToCloud = async (
    email: string,
    password: string,
    displayName: string,
  ) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const auth = createCloudAuthClient(cloudConfig);
      const session = await auth.signUpWithPassword(
        email,
        password,
        displayName,
        APP_FEATURES.nativeFileShare ? IPAD_AUTH_REDIRECT_URL : undefined,
      );
      if (session) {
        saveCloudAuthSession(session);
        setCloudSession(session);
        const api = createCloudApiClient(cloudConfig, () => session.accessToken);
        setCloudProjects(await api.listCloudProjects());
        setNotice("クラウドアカウントを作成しました。");
      } else {
        setNotice("確認メールを送信しました。メール確認後にログインしてください。");
      }
      setCloudError(null);
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const requestCloudPasswordReset = async (
    email: string,
  ): Promise<{ message: string; success: boolean }> => {
    if (!cloudConfig) {
      return { message: "Supabase接続が未設定です。", success: false };
    }
    setIsCloudBusy(true);
    try {
      await createCloudAuthClient(cloudConfig).requestPasswordReset(
        email,
        getCloudEmailRedirectUrl(),
      );
      setCloudError(null);
      return {
        message: "パスワード再設定メールを送信しました。メールをご確認ください。",
        success: true,
      };
    } catch (error) {
      return { message: getCloudErrorMessage(error), success: false };
    } finally {
      setIsCloudBusy(false);
    }
  };

  const resendCloudSignupConfirmation = async (
    email: string,
  ): Promise<{ message: string; success: boolean }> => {
    if (!cloudConfig) {
      return { message: "Supabase接続が未設定です。", success: false };
    }
    setIsCloudBusy(true);
    try {
      await createCloudAuthClient(cloudConfig).resendSignupConfirmation(
        email,
        getCloudEmailRedirectUrl(),
      );
      setCloudError(null);
      return {
        message: "確認メールを再送しました。メールをご確認ください。",
        success: true,
      };
    } catch (error) {
      return { message: getCloudErrorMessage(error), success: false };
    } finally {
      setIsCloudBusy(false);
    }
  };

  const changeCloudPassword = async (
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string; success: boolean }> => {
    if (!cloudConfig || !cloudSession?.user.email) {
      return {
        message: "ログイン情報を確認できませんでした。再度ログインしてください。",
        success: false,
      };
    }
    setIsCloudBusy(true);
    try {
      const auth = createCloudAuthClient(cloudConfig);
      const verifiedSession = await auth.signInWithPassword(
        cloudSession.user.email,
        currentPassword,
      );
      await auth.updatePassword(verifiedSession.accessToken, newPassword);
      saveCloudAuthSession(verifiedSession);
      cloudSessionRef.current = verifiedSession;
      setCloudSession(verifiedSession);
      setCloudError(null);
      setNotice("パスワードを変更しました。");
      return { message: "パスワードを変更しました。", success: true };
    } catch (error) {
      return { message: getCloudErrorMessage(error), success: false };
    } finally {
      setIsCloudBusy(false);
    }
  };

  const finishCloudPasswordRecovery = async (
    _currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string; success: boolean }> => {
    if (!cloudConfig) {
      return { message: "Supabase接続が未設定です。", success: false };
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        return {
          message: "再設定用のログイン情報がありません。もう一度再設定メールを送信してください。",
          success: false,
        };
      }
      await createCloudAuthClient(cloudConfig).updatePassword(
        activeSession.accessToken,
        newPassword,
      );
      const completedSession = { ...activeSession, authFlow: undefined };
      saveCloudAuthSession(completedSession);
      cloudSessionRef.current = completedSession;
      setCloudSession(completedSession);
      setIsCloudPasswordRecoveryOpen(false);
      setCloudError(null);
      setNotice("新しいパスワードを設定しました。");
      return { message: "新しいパスワードを設定しました。", success: true };
    } catch (error) {
      return { message: getCloudErrorMessage(error), success: false };
    } finally {
      setIsCloudBusy(false);
    }
  };

  const signOutFromCloud = async () => {
    if (cloudConfig && cloudSession?.accessToken) {
      try {
        await createCloudAuthClient(cloudConfig).signOut(cloudSession.accessToken);
      } catch (error) {
        console.warn("クラウドログアウト通知に失敗しました。", error);
      }
    }
    clearCloudAuthSession();
    setCloudSession(null);
    setCloudProjects([]);
    setCloudContacts([]);
    setCloudCollaborationItems([]);
    setCloudError(null);
    setNotice("クラウドからログアウトしました。");
  };

  const deleteCloudAccount = async (
    password: string,
  ): Promise<{ message: string; success: boolean }> => {
    if (!cloudConfig || !cloudSession?.user.email) {
      return {
        message: "ログイン情報を確認できませんでした。再度ログインしてください。",
        success: false,
      };
    }

    setIsCloudBusy(true);
    try {
      // A fresh password sign-in prevents an old, unattended session from
      // deleting the account without the user proving ownership again.
      const verifiedSession = await createCloudAuthClient(
        cloudConfig,
      ).signInWithPassword(cloudSession.user.email, password);
      saveCloudAuthSession(verifiedSession);
      cloudSessionRef.current = verifiedSession;
      setCloudSession(verifiedSession);

      const api = createCloudApiClient(
        cloudConfig,
        () => verifiedSession.accessToken,
      );
      const result = await api.deleteCurrentAccount();
      if (!result.success) {
        const message =
          result.reason === "confirmation_required"
            ? "削除確認が完了していません。"
            : "アカウントを削除できませんでした。時間を置いて再度お試しください。";
        return { message, success: false };
      }

      const draftProjectIds = new Set(
        cloudProjects
          .filter((item) => item.role === "owner")
          .map((item) => item.id),
      );
      if (activeCloudProjectRef.current?.projectId) {
        draftProjectIds.add(activeCloudProjectRef.current.projectId);
      }
      await Promise.allSettled(
        [...draftProjectIds].map((projectId) =>
          deletePersonalCloudDraft(projectId),
        ),
      );

      clearCloudAuthSession();
      cloudSessionRef.current = null;
      activeCloudProjectRef.current = null;
      setCloudSession(null);
      setActiveCloudProject(null);
      setCloudProjects([]);
      setCloudContacts([]);
      setCloudCollaborationItems([]);
      setCloudError(null);
      setNotice(
        `クラウドアカウントを削除しました。ローカル隊列表は端末に残っています。`,
      );
      return {
        message: "クラウドアカウントを削除しました。",
        success: true,
      };
    } catch (error) {
      const message = getCloudErrorMessage(error);
      return {
        message:
          message.includes("Invalid login credentials") ||
          message.includes("invalid_credentials")
            ? "パスワードが正しくありません。"
            : message,
        success: false,
      };
    } finally {
      setIsCloudBusy(false);
    }
  };

  useEffect(() => {
    if (!cloudConfig) {
      return undefined;
    }
    let disposed = false;
    let removeNativeListener: (() => Promise<void>) | undefined;

    const activateSession = async (session: CloudAuthSession) => {
      const activeSession = isCloudAuthSessionExpired(session)
        ? {
            ...(await createCloudAuthClient(cloudConfig).refreshSession(
              session.refreshToken,
            )),
            authFlow: session.authFlow,
          }
        : session;
      if (disposed) {
        return;
      }
      saveCloudAuthSession(activeSession);
      cloudSessionRef.current = activeSession;
      setCloudSession(activeSession);
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const projects = await api.listCloudProjects();
      setCloudProjects(
        APP_FEATURES.collaboration
          ? projects
          : projects.filter((item) => item.role === "owner"),
      );
      setCloudError(null);
    };

    const restoreSession = async () => {
      try {
        const session = await hydrateCloudAuthSessionFromNativeStorage();
        if (session) {
          await activateSession(session);
          if (session.authFlow === "recovery" && !disposed) {
            setAppView("library");
            setIsCloudPasswordRecoveryOpen(true);
            setNotice("新しいパスワードを設定してください。");
          }
        }
      } catch (error) {
        if (!disposed) {
          console.warn("iPadのログイン情報を復元できませんでした。", error);
          setCloudError("ログイン情報を復元できませんでした。再度ログインしてください。");
        }
      }
    };

    const handleAuthUrl = async (url: string) => {
      const parsedUrl = new URL(url);
      const callbackParameters = new URLSearchParams(
        parsedUrl.hash.startsWith("#") ? parsedUrl.hash.slice(1) : parsedUrl.hash,
      );
      for (const [key, value] of parsedUrl.searchParams.entries()) {
        if (!callbackParameters.has(key)) {
          callbackParameters.set(key, value);
        }
      }
      if (
        !callbackParameters.has("access_token") &&
        !callbackParameters.has("error") &&
        !callbackParameters.has("error_description")
      ) {
        return;
      }
      setIsCloudBusy(true);
      try {
        const session = await createCloudAuthClient(
          cloudConfig,
        ).createSessionFromRedirectUrl(url);
        await activateSession(session);
        if (!disposed) {
          if (session.authFlow === "recovery") {
            setAppView("library");
            setIsCloudPasswordRecoveryOpen(true);
            setNotice("本人確認が完了しました。新しいパスワードを設定してください。");
          } else {
            setNotice("メール確認が完了し、クラウドへログインしました。");
          }
          if (!APP_FEATURES.nativeFileShare) {
            window.history.replaceState(null, "", parsedUrl.pathname || "/");
          }
        }
      } catch (error) {
        if (!disposed) {
          setCloudError(getCloudErrorMessage(error));
        }
      } finally {
        if (!disposed) {
          setIsCloudBusy(false);
        }
      }
    };

    if (APP_FEATURES.nativeFileShare) {
      void restoreSession();
      void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        void handleAuthUrl(url);
      }).then((handle) => {
        if (disposed) {
          void handle.remove();
        } else {
          removeNativeListener = () => handle.remove();
        }
      });
      void CapacitorApp.getLaunchUrl().then((launch) => {
        if (launch?.url) {
          void handleAuthUrl(launch.url);
        }
      });
    } else {
      void handleAuthUrl(window.location.href);
    }

    return () => {
      disposed = true;
      if (removeNativeListener) {
        void removeNativeListener();
      }
    };
  }, [cloudConfig]);

  const acceptCloudInvite = async (inviteToken: string) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setCloudError("クラウドにログインしてから招待を受け取ってください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.acceptProjectInvite(inviteToken);
      if (!result.success) {
        setCloudError(
          result.reason === "email_mismatch"
            ? "招待されたメールアドレスと、現在ログイン中のメールアドレスが違います。"
            : "招待を受け取れませんでした。リンクの期限やログイン中のメールを確認してください。",
        );
        return;
      }
      clearCloudInviteHash();
      setCloudInviteToken(null);
      setCloudProjects(await api.listCloudProjects());
      setCloudError(null);
      setNotice(
        result.reason === "already_member"
          ? "このクラウド隊列表にはすでに参加しています。"
          : "クラウド隊列表に参加しました。",
      );
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const createCloudProjectInvite = async (
    email: string,
    role: "editor" | "viewer",
  ): Promise<string | null> => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      setNotice("共有管理はownerのみ利用できます。");
      return null;
    }
    if (!email.trim()) {
      setNotice("招待するメールアドレスを入力してください。");
      return null;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return null;
      }
      const inviteToken = createCloudLockToken();
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.createProjectInvite(
        cloudState.projectId,
        email,
        role,
        inviteToken,
      );
      if (!result.success) {
        setNotice(`招待リンクを作成できませんでした: ${result.reason}`);
        return null;
      }
      await refreshCloudCollaboration(activeSession);
      const inviteLink = `${window.location.origin}${window.location.pathname}${window.location.search}#cloudInvite=${encodeURIComponent(inviteToken)}`;
      setNotice("招待リンクを作成しました。");
      return inviteLink;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return null;
    } finally {
      setIsCloudBusy(false);
    }
  };

  const addCloudContactByEmail = async (
    email: string,
  ): Promise<{ message: string; success: boolean }> => {
    if (!cloudConfig) {
      return { message: "Supabase接続が未設定です。", success: false };
    }
    if (!email.trim()) {
      return {
        message: "連絡先に追加するメールアドレスを入力してください。",
        success: false,
      };
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        return { message: "クラウドにログインしてください。", success: false };
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.addContactByEmail(email);
      if (!result.success) {
        const message =
          result.reason === "user_not_found"
            ? "このメールアドレスのアカウントが見つかりません。先に相手がアカウント作成してください。"
            : result.reason === "self_contact"
              ? "自分自身は連絡先に追加できません。"
              : result.reason === "invalid_email"
                ? "メールアドレスの形式を確認してください。"
                : "連絡先を追加できませんでした。";
        setNotice(message);
        return { message, success: false };
      }
      await refreshCloudContacts(activeSession);
      const label = result.display_name ?? "相手";
      const message =
        result.reason === "already_contact"
          ? `${label}は連絡先に登録済みです。`
          : `${label}を連絡先に追加しました。`;
      setNotice(message);
      return { message, success: true };
    } catch (error) {
      const message = getCloudErrorMessage(error);
      setNotice(message);
      return { message, success: false };
    } finally {
      setIsCloudBusy(false);
    }
  };

  const addCloudContactToProject = async (
    contactUserId: string,
    role: "editor" | "viewer",
  ): Promise<{ message: string; success: boolean }> => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      const message = "共有管理はownerのみ利用できます。";
      setNotice(message);
      return { message, success: false };
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        return { message: "クラウドにログインしてください。", success: false };
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.addProjectMemberFromContact(
        cloudState.projectId,
        contactUserId,
        role,
      );
      if (!result.success) {
        const message =
          result.reason === "already_member"
            ? "この連絡先はすでに参加者です。"
            : result.reason === "contact_not_found"
              ? "連絡先が見つかりません。更新してからもう一度試してください。"
              : result.reason === "owner_required"
                ? "プロジェクト参加者の追加はownerのみできます。"
                : "連絡先をプロジェクトに追加できませんでした。";
        setNotice(message);
        return { message, success: false };
      }
      await refreshCloudShareData(activeSession);
      const label = result.display_name ?? "連絡先";
      const message = `${label}をプロジェクトに追加しました。`;
      setNotice(message);
      return { message, success: true };
    } catch (error) {
      const message = getCloudErrorMessage(error);
      setNotice(message);
      return { message, success: false };
    } finally {
      setIsCloudBusy(false);
    }
  };

  const addCloudMemberToContacts = async (
    userId: string,
  ): Promise<{ message: string; success: boolean }> => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      const message = "共有管理はownerのみ利用できます。";
      setNotice(message);
      return { message, success: false };
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        return { message: "クラウドにログインしてください。", success: false };
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.addProjectMemberToContacts(
        cloudState.projectId,
        userId,
      );
      if (!result.success) {
        const message =
          result.reason === "already_contact"
            ? "この参加者は連絡先に登録済みです。"
            : result.reason === "member_not_found"
              ? "参加者が見つかりません。更新してからもう一度試してください。"
              : result.reason === "self_contact"
                ? "自分自身は連絡先に追加できません。"
                : "参加者を連絡先に追加できませんでした。";
        setNotice(message);
        return { message, success: false };
      }
      await refreshCloudContacts(activeSession);
      const label = result.display_name ?? "参加者";
      const message =
        result.reason === "already_contact"
          ? `${label}は連絡先に登録済みです。`
          : `${label}を連絡先に追加しました。`;
      setNotice(message);
      return { message, success: true };
    } catch (error) {
      const message = getCloudErrorMessage(error);
      setNotice(message);
      return { message, success: false };
    } finally {
      setIsCloudBusy(false);
    }
  };

  const updateCloudProjectMemberRole = async (
    userId: string,
    role: "editor" | "owner" | "viewer",
  ) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      setNotice("共有管理はownerのみ利用できます。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.updateProjectMemberRole(
        cloudState.projectId,
        userId,
        role,
      );
      if (!result.success) {
        setNotice(
          result.reason === "last_owner"
            ? "最後のownerは変更できません。"
            : "参加者の権限を変更できませんでした。",
        );
        return;
      }
      await refreshCloudCollaboration(activeSession);
      setNotice("参加者の権限を変更しました。");
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const removeCloudProjectMember = async (userId: string) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      setNotice("共有管理はownerのみ利用できます。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.removeProjectMember(cloudState.projectId, userId);
      if (!result.success) {
        setNotice(
          result.reason === "last_owner"
            ? "最後のownerは削除できません。"
            : "参加者を削除できませんでした。",
        );
        return;
      }
      await refreshCloudCollaboration(activeSession);
      await refreshCloudActiveLocks(activeSession);
      setNotice("参加者を削除しました。");
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const revokeCloudProjectInvite = async (inviteId: string) => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || cloudState.role !== "owner" || !cloudConfig) {
      setNotice("共有管理はownerのみ利用できます。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.revokeProjectInvite(cloudState.projectId, inviteId);
      if (!result.success) {
        setNotice("招待を取り消せませんでした。");
        return;
      }
      await refreshCloudCollaboration(activeSession);
      setNotice("招待を取り消しました。");
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const uploadProjectToCloud = async (source: Project) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setCloudError("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const draft = createCloudProjectDraft(normalizeProject(source));
      const result = await api.createCloudProject(draft);
      if (!result.success || !result.project_id) {
        setCloudError(`クラウド作成に失敗しました: ${result.reason}`);
        return;
      }
      setNotice("ローカル隊列表をクラウドへアップロードしました。");
      setCloudProjects(await api.listCloudProjects());
      setCloudError(null);
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const openCloudProject = async (
    cloudProject: CloudProjectSummary,
  ) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setCloudError("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const parts = await api.loadCloudProjectParts(cloudProject.id);
      const now = new Date().toISOString();
      let cloudOpenedProject = normalizeProject({
        ...buildProjectFromCloudParts(parts),
        lastOpenedAt: now,
        updatedAt: parts.updatedAt ?? cloudProject.updatedAt ?? now,
      });
      const { resourceVersions, sceneVersions } = createCloudVersionMaps(parts);
      const sceneCellVersions = createCloudSceneCellVersionMap(
        await api.listSceneCellVersions(cloudProject.id),
      );
      const restoredLock = APP_FEATURES.collaboration
        ? await restoreCloudLockFromSession(
            cloudProject.id,
            parts,
            activeSession,
          )
        : { activeProjectLock: null, activeSceneLock: null };
      let openedFromDraft = false;
      let draftBaseUpdatedAt: string | null = null;
      if (!APP_FEATURES.collaboration && cloudProject.role === "owner") {
        const draft = await readPersonalCloudDraft(cloudProject.id);
        if (draft) {
          const remoteUpdatedAt = parts.updatedAt ?? cloudProject.updatedAt ?? null;
          const hasRemoteConflict =
            Boolean(draft.baseUpdatedAt) &&
            Boolean(remoteUpdatedAt) &&
            draft.baseUpdatedAt !== remoteUpdatedAt;
          const useDraft = hasRemoteConflict
            ? await requestAppConfirm({
                cancelLabel: "クラウド版を開く",
                confirmLabel: "端末の続きを開く",
                message:
                  "前回の端末内編集後にクラウド側も更新されています。端末の続きを開いても、保存時にもう一度確認し、勝手には上書きしません。",
                title: "未同期の編集があります",
                tone: "default",
              })
            : true;
          if (useDraft) {
            cloudOpenedProject = normalizeProject({
              ...cloneProject(draft.project),
              lastOpenedAt: now,
            });
            openedFromDraft = true;
            draftBaseUpdatedAt = draft.baseUpdatedAt;
          } else {
            await deletePersonalCloudDraft(cloudProject.id);
          }
        }
      }
      const openMessage = openedFromDraft
        ? "端末に残っていた未同期の編集を開きました。保存ボタンでクラウドへ同期できます。"
        : restoredLock.activeSceneLock || restoredLock.activeProjectLock
          ? "クラウド隊列表を開き、前回の編集ロックを復帰しました。"
          : cloudProject.role === "owner"
            ? "クラウド隊列表を開きました。"
            : cloudProject.role === "editor"
              ? "クラウド隊列表を開きました。配置はドラッグ時に自動で編集ロックを取得します。"
              : "クラウド隊列表を閲覧モードで開きました。";
      await openProjectInEditor(
        cloudOpenedProject,
        openMessage,
        {
          cloudProject: {
            activeProjectLock: restoredLock.activeProjectLock,
            activeSceneLock: restoredLock.activeSceneLock,
            projectId: cloudProject.id,
            resourceVersions,
            role: cloudProject.role,
            sceneCellVersions,
            sceneVersions,
            title: cloudProject.title,
            updatedAt:
              draftBaseUpdatedAt ?? parts.updatedAt ?? cloudProject.updatedAt,
          },
          persistLocal: false,
        },
      );
      if (openedFromDraft) {
        setIsDirty(true);
      }
      setCloudPendingUpdates([]);
      setCloudError(null);
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const reloadActiveCloudProject = async (
    options: { automatic?: boolean } = {},
  ): Promise<boolean> => {
    const cloudState = activeCloudProjectRef.current;
    if (!cloudState || !cloudConfig) {
      return false;
    }
    if (
      cloudState.activeSceneLock ||
      cloudState.activeProjectLock ||
      activeCloudCellLocksRef.current.length > 0 ||
      isDirtyRef.current
    ) {
      setNotice("編集中の変更があります。保存または編集終了してから再読み込みしてください。");
      return false;
    }
    if (isCloudBusyRef.current) {
      return false;
    }
    isCloudBusyRef.current = true;
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setNotice("クラウドにログインしてください。");
        return false;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const parts = await api.loadCloudProjectParts(cloudState.projectId);
      const now = new Date().toISOString();
      const nextProject = normalizeProject({
        ...buildProjectFromCloudParts(parts),
        lastOpenedAt: now,
        updatedAt: parts.updatedAt ?? now,
      });
      const { resourceVersions, sceneVersions } = createCloudVersionMaps(parts);
      const sceneCellVersions = createCloudSceneCellVersionMap(
        await api.listSceneCellVersions(cloudState.projectId),
      );
      projectRef.current = nextProject;
      setProject(nextProject);
      setActiveCloudProject((previous) =>
        previous
          ? {
              ...previous,
              resourceVersions,
              sceneCellVersions,
              sceneVersions,
              title: parts.project.title,
              updatedAt: parts.updatedAt,
            }
          : previous,
      );
      setCloudPendingUpdates([]);
      await refreshCloudActiveLocks(activeSession);
      if (cloudState.role === "owner") {
        await refreshCloudCollaboration(activeSession);
      }
      setNotice(
        options.automatic
          ? "クラウド側の更新を自動で読み込みました。"
          : "クラウド側の最新状態を再読み込みしました。",
      );
      return true;
    } catch (error) {
      setNotice(getCloudErrorMessage(error));
      return false;
    } finally {
      isCloudBusyRef.current = false;
      setIsCloudBusy(false);
    }
  };

  const copyCloudProjectToLocal = async (
    cloudProject: CloudProjectSummary,
  ) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setCloudError("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const parts = await api.loadCloudProjectParts(cloudProject.id);
      const now = new Date().toISOString();
      const localCopy = normalizeProject({
        ...buildProjectFromCloudParts(parts),
        createdAt: now,
        id: createProjectId(),
        lastOpenedAt: now,
        title: createUniqueProjectTitle(cloudProject.title, savedProjects),
        updatedAt: now,
      });
      await openProjectInEditor(
        localCopy,
        "クラウド隊列表をローカルに複製して開きました。以後はクラウドと同期しません。",
        {
          cloudProject: null,
          persistLocal: true,
        },
      );
      setCloudError(null);
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const deleteCloudProject = async (cloudProject: CloudProjectSummary) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    if (cloudProject.role !== "owner") {
      setCloudError("クラウド隊列表を削除できるのはownerのみです。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setCloudError("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.deleteCloudProject(cloudProject.id);
      if (!result.success) {
        setCloudError(`クラウド隊列表を削除できませんでした: ${result.reason}`);
        return;
      }
      setCloudProjects(await api.listCloudProjects());
      setCloudError(null);
      setNotice("クラウド隊列表を削除しました。");
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const hideCloudProject = async (cloudProject: CloudProjectSummary) => {
    if (!cloudConfig) {
      setCloudError("Supabase接続が未設定です。");
      return;
    }
    setIsCloudBusy(true);
    try {
      const activeSession = await getActiveCloudSession();
      if (!activeSession) {
        setCloudError("クラウドにログインしてください。");
        return;
      }
      const api = createCloudApiClient(cloudConfig, () => activeSession.accessToken);
      const result = await api.hideCloudProject(cloudProject.id);
      if (!result.success) {
        setCloudError(`クラウド隊列表を非表示にできませんでした: ${result.reason}`);
        return;
      }
      setCloudProjects(await api.listCloudProjects());
      setCloudError(null);
      setNotice("クラウド隊列表を自分の一覧から非表示にしました。");
    } catch (error) {
      setCloudError(getCloudErrorMessage(error));
    } finally {
      setIsCloudBusy(false);
    }
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !audio.src) {
      setNotice("音源が読み込まれていません。先にMP3/WAV/M4Aなどを選択してください。");
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    try {
      setMode("preview");
      await audio.play();
      setIsPlaying(true);
    } catch {
      setNotice("ブラウザが再生をブロックしました。もう一度再生ボタンを押してください。");
    }
  };

  const seek = (time: number) => {
    const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
    const audio = audioRef.current;
    const maxDuration =
      audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : duration > 0
          ? duration
          : null;
    const nextTime =
      maxDuration !== null ? Math.min(safeTime, maxDuration) : safeTime;
    if (audio) {
      audio.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
    const activeFrame = getActiveFrameAtTime(project.frames, nextTime);
    if (activeFrame) {
      setSelectedFrameId(activeFrame.id);
    }
  };

  const waitForPaint = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

  const preparePrintExportElement = async (
    scope: "all" | "current",
    options: ShareExportOptions,
    variant: "document" | "stage-only" = "document",
  ): Promise<HTMLDivElement> => {
    setPrintScope(scope);
    setPrintOptions(options);
    setPrintVariant(variant);
    setIsPrintPreviewMounted(true);
    await waitForPaint();
    const element = printExportRef.current;
    if (!element) {
      throw new Error("印刷用レイアウトが見つかりません。");
    }
    element.classList.add("is-exporting");
    await waitForPaint();
    return element;
  };

  const cleanupPrintExportElement = () => {
    printExportRef.current?.classList.remove("is-exporting");
    setPrintVariant("document");
    setIsPrintPreviewMounted(false);
  };

  const generatePrintImageBlob = async (
    scope: "all" | "current",
    options: ShareExportOptions,
  ): Promise<Blob> => {
    const element = await preparePrintExportElement(scope, options, "document");
    try {
      return await elementToPngBlob(element);
    } finally {
      cleanupPrintExportElement();
    }
  };

  const generatePrintPdfBlob = async (
    scope: "all" | "current",
    options: ShareExportOptions,
    title: string,
  ): Promise<{ blob: Blob; preview: Blob; pageCount: number }> => {
    const element = await preparePrintExportElement(scope, options, "document");
    try {
      const pages = Array.from(
        element.querySelectorAll<HTMLElement>(".print-page"),
      );
      if (pages.length === 0) {
        throw new Error("PDF用ページが見つかりません。");
      }
      // The A4 sheets keep the original rendering: one JPEG (q0.95, 2x) per page, as users rely on it.
      const { jpegDataUrlsToPdfBlob } = await import("./utils/pdfExport");
      const pageDataUrls: string[] = [];
      for (const page of pages) pageDataUrls.push(await elementToJpegDataUrl(page));
      const blob = await jpegDataUrlsToPdfBlob(pageDataUrls, title, getPrintOrientation(project));
      const preview = await (await fetch(pageDataUrls[0])).blob();
      return { blob, preview, pageCount: pageDataUrls.length };
    } finally {
      cleanupPrintExportElement();
    }
  };

  const stageScreenshotOptions: ShareExportOptions = {
    includeAssignments: false,
    includeBackground: true,
    includeGrid: true,
    includeHiddenMembers: false,
    includeMeterRulers: true,
    includeNotes: false,
    includeSceneName: false,
    includeSceneTime: false,
    layout: "auto",
    sceneGapRows: 0,
  };

  const generateStageScreenshotBlob = async (): Promise<Blob> => {
    const captureOptions = {
      backgroundColor: "#ffffff",
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
    };

    const element = await preparePrintExportElement(
      "current",
      stageScreenshotOptions,
      "stage-only",
    );
    try {
      return await elementToPngBlob(element, captureOptions);
    } finally {
      cleanupPrintExportElement();
    }
  };

  const captureStageImage = async () => {
    if (exportGenerationPending.current) return;
    exportGenerationPending.current = true;
    const frameLabel = displayFrame?.label ?? selectedFrame?.label ?? "現在シーン";
    const filename = withFileExtension(
      `${APP_NAME}_${frameLabel}_${formatExportTimestamp()}`, "png",
    );
    setExportProgress({ title: "ステージ画像を作成中", detail: frameLabel });
    try {
      const blob = await generateStageScreenshotBlob();
      if (!blob.size) throw new Error("画像を作成できませんでした。");
      setCanCopyExport(true);
      setCompletedExport({ files: [new File([blob], filename, { type: "image/png" })], preview: blob,
        targetLabel: "ステージ画像", scopeLabel: frameLabel, pageCount: 1 });
    } catch (error) {
      setNotice(error instanceof Error ? `ステージ画像の作成に失敗しました: ${error.message}` : "ステージ画像の作成に失敗しました。");
    } finally { exportGenerationPending.current = false; setExportProgress(null); }
  };

  const printProject = async (scope: "all" | "current" = "all") => {
    setExportProgress({
      detail:
        scope === "current"
          ? selectedFrame?.label ?? "現在のシーン"
          : project.title || "隊列メーカー",
      title: "印刷用レイアウトを準備中",
    });
    try {
      setPrintScope(scope);
      setPrintVariant("document");
      setIsPrintPreviewMounted(true);
      setNotice(
        scope === "current"
          ? "現在のシーンを印刷画面でPDF保存できます。"
          : "全シーンの印刷用プレビューを開きます。ブラウザの印刷画面でPDF保存できます。",
      );
      await waitForPaint();
      const cleanupAfterPrint = () => {
        setIsPrintPreviewMounted(false);
        window.removeEventListener("afterprint", cleanupAfterPrint);
      };
      window.addEventListener("afterprint", cleanupAfterPrint, { once: true });
      setExportProgress(null);
      window.print();
      window.setTimeout(cleanupAfterPrint, 3000);
    } catch (error) {
      setExportProgress(null);
      setNotice(
        error instanceof Error
          ? `印刷用レイアウトの準備に失敗しました: ${error.message}`
          : "印刷用レイアウトの準備に失敗しました。",
      );
    }
  };

  const handleShareExport = async (request: ShareExportRequest) => {
    if (exportGenerationPending.current) return;
    exportGenerationPending.current = true;
    const filenameBase = request.fileName || (request.scope === "current"
      ? `${project.title || "隊列メーカー"}_${selectedFrame?.label ?? "現在シーン"}` : project.title || "隊列メーカー");
    const image = request.format === "image";
    const fileName = withFileExtension(filenameBase, image ? "png" : "pdf");
    setExportProgress({ title: image ? "画像を作成中" : "PDFを作成中", detail: fileName });
    try {
      const generated = image
        ? await generatePrintImageBlob(request.scope, request.options).then((blob) => ({ blob, preview: blob, pageCount: 1 }))
        : await generatePrintPdfBlob(request.scope, request.options, filenameBase);
      if (!generated.blob.size) throw new Error("ファイルを作成できませんでした。");
      setCanCopyExport(false);
      setCompletedExport({ files: [new File([generated.blob], fileName, { type: image ? "image/png" : "application/pdf" })],
        preview: generated.preview, pageCount: generated.pageCount, targetLabel: "隊列表（A4）",
        scopeLabel: request.scope === "current" ? selectedFrame?.label ?? "現在シーン" : "全シーン" });
    } catch (error) {
      setNotice(error instanceof Error ? `書き出しに失敗しました: ${error.message}` : "書き出しに失敗しました。");
    } finally { exportGenerationPending.current = false; setExportProgress(null); }
  };

  const handleShareExportZip = async (includeAudio: boolean) => {
    if (isDirty && !isSharedProject) {
      const saved = await saveProjectManually({ showNotice: false });
      if (!saved) {
        return;
      }
    }
    setExportProgress({
      detail: projectRef.current.title || "隊列メーカー",
      title: "隊列表を書き出し中",
    });
    try {
      await exportTairetsuProject(projectRef.current, includeAudio);
    } finally {
      setExportProgress(null);
    }
  };

  const changeLoop = (patch: {
    loopEnabled?: boolean;
    loopStart?: number;
    loopEnd?: number;
  }) => {
    if (patch.loopEnabled !== undefined) setLoopEnabled(patch.loopEnabled);
    if (patch.loopStart !== undefined) setLoopStart(patch.loopStart);
    if (patch.loopEnd !== undefined) setLoopEnd(patch.loopEnd);
  };

  const controlPointForPreset = (
    targetType: MovementTargetType,
    targetId: string,
    side: "left" | "right",
  ): Position | undefined => {
    if (!selectedFrame || !selectedNextFrame) return undefined;
    const fromSnapshot = getSnapshotForFrame(project, selectedFrame.id);
    const toSnapshot = getSnapshotForFrame(project, selectedNextFrame.id);
    const start =
      targetType === "member"
        ? fromSnapshot.positions[targetId]
        : fromSnapshot.objectStates[targetId];
    const end =
      targetType === "member"
        ? toSnapshot.positions[targetId]
        : toSnapshot.objectStates[targetId];
    if (!start || !end) return undefined;

    const startPoint = { x: start.x, y: start.y };
    const endPoint = { x: end.x, y: end.y };
    const mid = {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2,
    };
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.max(0.01, Math.hypot(dx, dy));
    const bend = Math.min(2, Math.max(0.6, length * 0.35));
    const sign = side === "left" ? -1 : 1;
    return constrainMemberPosition(
      {
        x: mid.x + sign * (-dy / length) * bend,
        y: mid.y + sign * (dx / length) * bend,
      },
      project.stage,
    );
  };

  const upsertMovementPath = (
    targetType: MovementTargetType,
    targetId: string,
    pathType: MovementPathType,
    controlPoint?: Position,
  ) => {
    if (!selectedFrame || !selectedNextFrame) {
      setNotice("次のシーンがないため、移動経路を設定できません。");
      return;
    }

    updateProject((previous) => {
      const existingPlans = previous.movementPlans ?? [];
      const existing = findMovementPlan(
        existingPlans,
        targetType,
        targetId,
        selectedFrame.id,
        selectedNextFrame.id,
      );
      const nextPlan: MovementPlan = {
        id: existing?.id ?? createId("plan"),
        fromFrameId: selectedFrame.id,
        toFrameId: selectedNextFrame.id,
        targetType,
        targetId,
        enabled: existing?.enabled ?? true,
        startSec: existing?.startSec ?? selectedFrame.timeSec,
        endSec: existing?.endSec ?? selectedNextFrame.timeSec,
        pathType,
        controlPoint,
        waypoints: existing?.waypoints,
        note: existing?.note,
      };
      return {
        ...previous,
        movementPlans: [
          ...existingPlans.filter(
            (plan) =>
              !(
                plan.targetType === targetType &&
                plan.targetId === targetId &&
                plan.fromFrameId === selectedFrame.id &&
                plan.toFrameId === selectedNextFrame.id
              ),
          ),
          nextPlan,
        ],
      };
    });
  };

  const setSelectedPathType = (pathType: MovementPathType) => {
    if (!selectedMovementTarget) {
      if (selectedMemberIds.length > 0) {
        selectedMemberIds.forEach((memberId) => {
          const controlPoint =
            pathType === "curve"
              ? controlPointForPreset("member", memberId, "right")
              : undefined;
          upsertMovementPath("member", memberId, pathType, controlPoint);
        });
        setShowMovementPaths(false);
        setMode("preview");
        return;
      }
      setNotice("ステージ上でメンバー、道具、幕のいずれかを選択してください。");
      return;
    }
    const controlPoint =
      pathType === "curve"
        ? selectedMovementPlan?.controlPoint ??
          selectedMovementPath?.controlPoint ??
          controlPointForPreset(
            selectedMovementTarget.targetType,
            selectedMovementTarget.targetId,
            "right",
          )
        : undefined;
    upsertMovementPath(
      selectedMovementTarget.targetType,
      selectedMovementTarget.targetId,
      pathType,
      controlPoint,
    );
    setShowMovementPaths(false);
    setMode("preview");
  };

  const setSelectedCurvePreset = (side: "left" | "right") => {
    if (!selectedMovementTarget) {
      if (selectedMemberIds.length > 0) {
        selectedMemberIds.forEach((memberId) => {
          upsertMovementPath(
            "member",
            memberId,
            "curve",
            controlPointForPreset("member", memberId, side),
          );
        });
        setShowMovementPaths(false);
        setMode("preview");
        return;
      }
      setNotice("カーブを設定する対象を選択してください。");
      return;
    }
    upsertMovementPath(
      selectedMovementTarget.targetType,
      selectedMovementTarget.targetId,
      "curve",
      controlPointForPreset(
        selectedMovementTarget.targetType,
        selectedMovementTarget.targetId,
        side,
      ),
    );
    setShowMovementPaths(false);
    setMode("preview");
  };

  const updateAnimationSettings = (patch: Partial<AnimationSettings>) => {
    updateProject((previous) => ({
      ...previous,
      animationSettings: {
        ...getAnimationSettings(previous),
        ...patch,
      },
    }));
  };

  const setAllAnimationSettings = (enabled: boolean) => {
    updateAnimationSettings({
      membersEnabled: enabled,
      objectsEnabled: enabled,
      curtainsEnabled: enabled,
    });
  };

  const updateSelectedMovementPlan = (patch: Partial<MovementPlan>) => {
    if (!selectedMovementTarget || !selectedFrame || !selectedNextFrame) {
      setNotice("移動設定する対象、または次のシーンがありません。");
      return;
    }
    updateProject((previous) => {
      const existingPlans = previous.movementPlans ?? [];
      const existing = findMovementPlan(
        existingPlans,
        selectedMovementTarget.targetType,
        selectedMovementTarget.targetId,
        selectedFrame.id,
        selectedNextFrame.id,
      );
      const nextPlan: MovementPlan = {
        id: existing?.id ?? createId("plan"),
        fromFrameId: selectedFrame.id,
        toFrameId: selectedNextFrame.id,
        targetType: selectedMovementTarget.targetType,
        targetId: selectedMovementTarget.targetId,
        enabled: true,
        startSec: selectedFrame.timeSec,
        endSec: selectedNextFrame.timeSec,
        pathType: "straight",
        ...existing,
        ...patch,
      };
      return {
        ...previous,
        movementPlans: [
          ...existingPlans.filter(
            (plan) =>
              !(
                plan.targetType === selectedMovementTarget.targetType &&
                plan.targetId === selectedMovementTarget.targetId &&
                plan.fromFrameId === selectedFrame.id &&
                plan.toFrameId === selectedNextFrame.id
              ),
          ),
          nextPlan,
        ],
      };
    });
  };

  const updateSelectedDestination = (position: Position) => {
    if (!selected || !selectedNextFrame) {
      setNotice("到着位置を保存する次のシーンがありません。");
      return;
    }
    const targetFrameId = selectedNextFrame.id;
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((frame) => {
        if (frame.id !== targetFrameId) {
          return frame;
        }
        const frameStage = {
          ...previous.stage,
          ...getEffectiveStageSize(previous, frame),
        };
        if (selected.type === "member") {
          return {
            ...frame,
            positions: {
              ...frame.positions,
              [selected.id]: constrainMemberPosition(position, frameStage),
            },
          };
        }
        const object = previous.stageObjects.find((item) => item.id === selected.id);
        if (!object) {
          return frame;
        }
        const current = frame.objectStates[selected.id] ?? createDefaultObjectState(object);
        const constrained = constrainObjectPosition(
          position,
          current.widthMeters,
          current.heightMeters,
          frameStage,
        );
        return {
          ...frame,
          objectStates: {
            ...frame.objectStates,
            [selected.id]: {
              ...current,
              ...constrained,
            },
          },
        };
      }),
    }));
  };

  const setDestinationFromCurrentPosition = () => {
    if (!selected || !selectedTargetDetails?.startPosition) {
      setNotice("現在位置を取得できる対象を選択してください。");
      return;
    }
    updateSelectedDestination(selectedTargetDetails.startPosition);
    setNotice("現在位置を次シーンの到着位置にしました。", "success");
  };

  const jumpToStartFrame = () => {
    if (!selectedFrame) return;
    setSelectedFrameId(selectedFrame.id);
    seek(selectedFrame.timeSec);
  };

  const jumpToDestinationFrame = () => {
    if (!selectedNextFrame) return;
    setSelectedFrameId(selectedNextFrame.id);
    seek(selectedNextFrame.timeSec);
  };

  const resetAllMemberPaths = () => {
    if (!selectedFrame || !selectedNextFrame) return;
    updateProject((previous) => ({
      ...previous,
      movementPaths: (previous.movementPaths ?? []).filter(
        (path) =>
          !(
            (path.targetType ?? "member") === "member" &&
            path.fromFrameId === selectedFrame.id &&
            path.toFrameId === selectedNextFrame.id
          ),
      ),
      movementPlans: (previous.movementPlans ?? []).filter(
        (plan) =>
          !(
            plan.targetType === "member" &&
            plan.fromFrameId === selectedFrame.id &&
            plan.toFrameId === selectedNextFrame.id
          ),
      ),
    }));
    setNotice("全メンバーの経路を直線に戻しました。", "success");
  };

  const startTransitionPreview = () => {
    setAnimationPreviewTimeSec(null);
    setAnimationPreviewTarget(null);
    setShowMovementPaths(false);
    setMode("preview");
    setNotice(
      "MVPでは移動プレビューを無効にしています。シーン開始時刻で静的に切り替わります。",
    );
  };

  function goToScene(delta: -1 | 1) {
    const sortedFrames = sortFrames(project.frames);
    const currentIndex = Math.max(
      0,
      sortedFrames.findIndex((frame) => frame.id === selectedFrameId),
    );
    const nextIndex = Math.min(
      sortedFrames.length - 1,
      Math.max(0, currentIndex + delta),
    );
    const nextFrame = sortedFrames[nextIndex];
    if (nextFrame) {
      setSelectedFrameId(nextFrame.id);
      if (!isPlaying) {
        setMode((previous) => (previous === "preview" ? "members" : previous));
      }
    }
  }

  const seekToFrame = (timeSec: number) => {
    seek(timeSec);
    setNotice(`音源位置を ${timeSec.toFixed(1)} 秒へ移動しました。`, "success");
  };

  const toggleMemberSelection = (id: string) => {
    setSelectedMemberIds((previous) =>
      previous.includes(id)
        ? previous.filter((memberId) => memberId !== id)
        : [...previous, id],
    );
  };

  const updateViewerPerspective = (nextPerspective: ViewerPerspective) => {
    setViewerPerspective(nextPerspective);
    updateProject((previous) => ({
      ...previous,
      viewerPerspective: nextPerspective,
    }));
  };

  const updateGuideSettings = (
    patch: Partial<NonNullable<Project["guideSettings"]>>,
  ) => {
    updateProject((previous) => ({
      ...previous,
      guideSettings: {
        snapGuideEnabled: previous.guideSettings?.snapGuideEnabled ?? true,
        snapToGuideEnabled: previous.guideSettings?.snapToGuideEnabled ?? false,
        ...patch,
      },
    }), "スナップガイド設定");
  };

  const updateSelectedFramePositions = (
    updater: (positions: Record<string, Position>) => Record<string, Position>,
    options: {
      label?: string;
      memberIds?: string[];
      notice?: string;
    } = {},
  ) => {
    if (!selectedFrame) {
      return;
    }
    const activeFrameId = selectedFrame.id;
    const applyChange = () => {
      updateProject((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) =>
          frame.id === activeFrameId
            ? { ...frame, positions: updater(frame.positions) }
            : frame,
        ),
      }), options.label);
      if (options.notice) {
        setNotice(options.notice, "success");
      }
    };
    const memberIds = [...new Set(options.memberIds ?? selectedMemberIds)];
    if (
      activeCloudProjectRef.current &&
      !activeCloudProjectRef.current.activeSceneLock &&
      memberIds.length > 0
    ) {
      void runCloudSceneCellPatchEditMany(
        options.label ?? "メンバー位置編集",
        memberIds.map((id) => ({ id, type: "member-position" })),
        applyChange,
      );
      return;
    }
    applyChange();
  };

  const nextGroupName = (): string => {
    let nextNumber = 1;
    while (
      (project.memberGroups ?? []).some(
        (group) => group.name === `グループ${nextNumber}`,
      )
    ) {
      nextNumber += 1;
    }
    return `グループ${nextNumber}`;
  };

  const createGroup = (
    draft: {
      name?: string;
      color?: string;
      memberIds?: string[];
      visibleInCurrentFrame?: boolean;
    } = {},
  ) => {
    const memberIds = [...new Set(draft.memberIds ?? [])];
    const activeFrameId = selectedFrame?.id ?? project.frames[0]?.id;
    const hasVisibilityIntent = typeof draft.visibleInCurrentFrame === "boolean";
    const visibleInCurrentFrame = draft.visibleInCurrentFrame ?? true;
    const group: MemberGroup = {
      id: createId("g"),
      name: draft.name?.trim() || nextGroupName(),
      memberIds,
      color:
        draft.color ??
        groupColorPalette[
          (project.memberGroups?.length ?? 0) % groupColorPalette.length
        ],
    };
    updateProject((previous) => ({
      ...previous,
      memberGroups: [
        ...(previous.memberGroups ?? []).map((item) =>
          memberIds.length > 0
            ? {
                ...item,
                memberIds: item.memberIds.filter(
                  (memberId) => !memberIds.includes(memberId),
                ),
              }
            : item,
        ),
        group,
      ],
      frames: previous.frames.map((frame) => {
        if (frame.id !== activeFrameId) {
          return frame;
        }
        const groupVisibility = {
          ...(frame.groupVisibility ?? {}),
          [group.id]: visibleInCurrentFrame,
        };
        const memberVisibility = { ...(frame.memberVisibility ?? {}) };
        if (hasVisibilityIntent) {
          memberIds.forEach((memberId) => {
            memberVisibility[memberId] = visibleInCurrentFrame;
          });
        }
        return {
          ...frame,
          groupVisibility,
          memberVisibility,
        };
      }),
    }));
    setNotice(
      memberIds.length > 0
        ? "選択メンバーからグループを作成しました。"
        : `${group.name} を作成しました。`,
      "success",
    );
  };

  const createGroupFromSelection = () => {
    if (selectedMemberIds.length === 0) {
      setNotice("グループ化するメンバーを選択してください。");
      return;
    }
    createGroup({ memberIds: selectedMemberIds });
  };

  const updateGroup = (id: string, patch: Partial<MemberGroup>) => {
    updateProject((previous) => ({
      ...previous,
      memberGroups: (previous.memberGroups ?? []).map((group) =>
        group.id === id ? { ...group, ...patch } : group,
      ),
    }), "グループ編集");
  };

  const updateMemberGroup = (memberId: string, groupId: string | null) => {
    updateProject((previous) => ({
      ...previous,
      memberGroups: (previous.memberGroups ?? []).map((group) => {
        const withoutMember = group.memberIds.filter((id) => id !== memberId);
        if (group.id === groupId) {
          return {
            ...group,
            memberIds: [...withoutMember, memberId],
          };
        }
        return {
          ...group,
          memberIds: withoutMember,
        };
      }),
    }));
    setNotice(groupId ? "所属グループを変更しました。" : "所属グループを解除しました。", "success");
  };

  const selectGroup = (group: MemberGroup) => {
    setSelectedMemberIds(group.memberIds);
    setNotice(`${group.name} を選択しました。`, "success");
  };

  const deleteGroup = (id: string) => {
    const membersOnlyLock =
      activeCloudProjectRef.current?.activeProjectLock?.lockKey === "members";
    updateProject((previous) => ({
      ...previous,
      memberGroups: (previous.memberGroups ?? []).filter((group) => group.id !== id),
      frames: membersOnlyLock
        ? previous.frames
        : previous.frames.map((frame) => {
            const { [id]: removedVisibility, ...groupVisibility } =
              frame.groupVisibility ?? {};
            void removedVisibility;
            return { ...frame, groupVisibility };
          }),
    }));
    if ((projectRef.current.memberGroups ?? []).some((item) => item.id === id)) return false;

    return true;
  };

  const createObjectGroup = (
    draft: {
      name?: string;
      color?: string;
      defaultType?: StageObject["type"];
      defaultShape?: StageObject["shape"];
    } = {},
  ) => {
    const group: ObjectGroup = {
      id: createId("og"),
      name: draft.name?.trim() || nextObjectGroupName(),
      color:
        draft.color ??
        groupColorPalette[
          (project.objectGroups?.length ?? 0) % groupColorPalette.length
        ],
      defaultType: draft.defaultType ?? "prop",
      defaultShape: draft.defaultShape ?? "rectangle",
      objectIds: [],
    };
    updateProject((previous) => ({
      ...previous,
      objectGroups: [...(previous.objectGroups ?? []), group],
    }), "道具グループ作成");
    setNotice(`${group.name} を作成しました。`, "success");
  };

  const updateObjectGroup = (id: string, patch: Partial<ObjectGroup>) => {
    updateProject((previous) => ({
      ...previous,
      objectGroups: (previous.objectGroups ?? []).map((group) =>
        group.id === id ? { ...group, ...patch } : group,
      ),
    }), "道具グループ編集");
  };

  const deleteObjectGroup = (id: string) => {
    updateProject((previous) => ({
      ...previous,
      objectGroups: (previous.objectGroups ?? []).filter(
        (group) => group.id !== id,
      ),
    }), "道具グループ削除");
    if ((projectRef.current.objectGroups ?? []).some((item) => item.id === id)) return false;
    setNotice("道具グループを削除しました。道具本体は残ります。", "success");
    return true;
  };

  const confirmAndDeleteMemberGroup = async (id: string) => {
    const group = (projectRef.current.memberGroups ?? []).find(
      (item) => item.id === id,
    );
    if (!group) {
      return false;
    }
    const hasDisplayedMember = group.memberIds.some((memberId) =>
      isMemberDisplayedInAnyFrame(memberId),
    );
    const confirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "削除する",
      message: hasDisplayedMember
        ? `「${group.name}」の所属メンバーが隊列内に表示中です。グループを削除してもメンバー本体は削除されず、未所属になります。`
        : `「${group.name}」を削除します。メンバー本体は削除されず、未所属になります。`,
      title: "メンバーグループを削除しますか？",
      tone: "danger",
    });
    if (!confirmed) {
      return false;
    }
    if (!deleteGroup(id)) return false;
    setNotice(`${group.name} を削除しました。メンバー本体は残ります。`, "success");
    return true;
  };

  const confirmAndDeleteObjectGroup = async (id: string) => {
    const group = (projectRef.current.objectGroups ?? []).find(
      (item) => item.id === id,
    );
    if (!group) {
      return false;
    }
    const hasDisplayedObject = group.objectIds.some((objectId) =>
      isObjectDisplayedInAnyFrame(objectId),
    );
    const confirmed = await requestAppConfirm({
      cancelLabel: "キャンセル",
      confirmLabel: "削除する",
      message: hasDisplayedObject
        ? `「${group.name}」の所属道具が隊列内に表示中です。グループを削除しても道具本体は削除されず、未所属になります。`
        : `「${group.name}」を削除します。道具本体は削除されず、未所属になります。`,
      title: "道具グループを削除しますか？",
      tone: "danger",
    });
    if (!confirmed) {
      return false;
    }
    if (!deleteObjectGroup(id)) return false;
    setNotice(`${group.name} を削除しました。道具本体は残ります。`, "success");
    return true;
  };

  const isMemberAssignedInFrame = (
    frame: FormationFrame,
    memberId: string,
  ) =>
    Object.values(frame.objectAssignments ?? {}).some((memberIds) =>
      memberIds.includes(memberId),
    );

  const isMemberDisplayedInFrame = (
    memberId: string,
    frame: FormationFrame,
  ) => {
    const member = project.members.find((item) => item.id === memberId);
    if (!member || member.visible === false) {
      return false;
    }
    if (!frame.positions[memberId]) {
      return false;
    }
    if (frame.memberVisibility?.[memberId] === false) {
      return false;
    }
    return !isMemberAssignedInFrame(frame, memberId);
  };

  const isObjectDisplayedInFrame = (
    objectId: string,
    frame: FormationFrame,
  ) => {
    const object = project.stageObjects.find((item) => item.id === objectId);
    if (!object || object.visible === false) {
      return false;
    }
    const state = frame.objectStates[objectId];
    return Boolean(state) && state.visible !== false;
  };

  const isMemberDisplayedInAnyFrame = (memberId: string) =>
    project.frames.some((frame) => isMemberDisplayedInFrame(memberId, frame));

  const isObjectDisplayedInAnyFrame = (objectId: string) =>
    project.frames.some((frame) => isObjectDisplayedInFrame(objectId, frame));

  const deleteRosterMember = async (memberId: string) => {
    return confirmAndDeleteMember(memberId);
  };

  const deleteRosterObject = async (objectId: string) => {
    return confirmAndDeleteObject(objectId);
  };

  const deleteRosterMemberGroup = async (groupId: string) => {
    return confirmAndDeleteMemberGroup(groupId);
  };

  const deleteRosterObjectGroup = async (groupId: string) => {
    return confirmAndDeleteObjectGroup(groupId);
  };

  const addObjectToGroup = (
    group: ObjectGroup,
    visibleInCurrentFrame = true,
  ) => {
    addStageObject(
      {
        ...defaultStageObjectDraft,
        name: nextGroupObjectName(group.name),
        color: group.color ?? defaultStageObjectDraft.color,
        type: group.defaultType ?? "prop",
        shape: group.defaultShape ?? "rectangle",
      },
      visibleInCurrentFrame,
      undefined,
      group.id,
      false,
    );
  };

  const addRosterMember = (groupId: string | null, name?: string) => {
    if (name !== undefined && !name.trim()) {
      return;
    }
    const id = createId("m");
    const membersOnlyLock =
      activeCloudProjectRef.current?.activeProjectLock?.lockKey === "members";
    updateProject((previous) => {
      const group = (previous.memberGroups ?? []).find(
        (item) => item.id === groupId,
      );
      if (groupId !== null && !group) return previous;
      const trimmedName = name?.trim() ??
        nextRosterItemName(
          previous.members, previous.memberGroups ?? [], "members", groupId,
        );
      const activeFrame =
        previous.frames.find((frame) => frame.id === selectedFrame?.id) ??
        previous.frames[0];
      const rosterPosition = getParadeVisibleCenterPosition(
        previous,
        activeFrame,
      );
      const member: Member = {
        id,
        name: trimmedName,
        color:
          group?.color ??
          ["#ef476f", "#118ab2", "#06d6a0", "#f59e0b", "#7c3aed"][
            previous.members.length % 5
          ],
        visible: true,
        zIndex: 20 + previous.members.length,
      };
      return {
        ...previous,
        members: [...previous.members, member],
        memberGroups: (previous.memberGroups ?? []).map((item) =>
          item.id === group?.id
            ? {
                ...item,
                memberIds: [...new Set([...item.memberIds, id])],
              }
            : item,
        ),
        frames: membersOnlyLock
          ? previous.frames
          : previous.frames.map((frame) => {
              const frameStage = {
                ...previous.stage,
                ...getEffectiveStageSize(previous, frame),
              };
              const basePosition = rosterPosition
                ? constrainMemberPosition(rosterPosition, frameStage)
                : {
                    x: frameStage.widthMeters / 2,
                    y: frameStage.depthMeters / 2,
                  };
              return {
                ...frame,
                positions: {
                  ...frame.positions,
                  [id]: basePosition,
                },
                memberVisibility: {
                  ...(frame.memberVisibility ?? {}),
                  [id]: false,
                },
              };
            }),
      };
    }, "名簿メンバー追加");
    const added = projectRef.current.members.find((member) => member.id === id);
    if (added) setNotice(`${added.name} を名簿に追加しました。`, "success");
  };

  const addRosterObject = (groupId: string | null, name?: string) => {
    if (name !== undefined && !name.trim()) {
      return;
    }
    const id = createId("o");
    const objectsOnlyLock =
      activeCloudProjectRef.current?.activeProjectLock?.lockKey === "objects";
    updateProject((previous) => {
      const group = (previous.objectGroups ?? []).find(
        (item) => item.id === groupId,
      );
      if (groupId !== null && !group) return previous;
      const trimmedName = name?.trim() ??
        nextRosterItemName(
          previous.stageObjects, previous.objectGroups ?? [], "objects", groupId,
        );
      const draft: StageObjectDraft = {
        ...defaultStageObjectDraft,
        name: trimmedName,
        color: group?.color ?? defaultStageObjectDraft.color,
        type: group?.defaultType ?? defaultStageObjectDraft.type,
        shape: group?.defaultShape ?? defaultStageObjectDraft.shape,
      };
      const activeFrame =
        previous.frames.find((frame) => frame.id === selectedFrame?.id) ??
        previous.frames[0];
      const rosterCenter = getParadeVisibleCenterPosition(previous, activeFrame);
      const baseStage = {
        ...previous.stage,
        ...getEffectiveStageSize(previous, activeFrame ?? previous.frames[0]),
      };
      const baseCenter = rosterCenter
        ? constrainMemberPosition(rosterCenter, baseStage)
        : {
            x: baseStage.widthMeters / 2,
            y: baseStage.depthMeters / 2,
          };
      const topLeft = constrainObjectPosition(
        {
          x: baseCenter.x - draft.widthMeters / 2,
          y: baseCenter.y - draft.heightMeters / 2,
        },
        draft.widthMeters,
        draft.heightMeters,
        baseStage,
      );
      const object: StageObject = {
        id,
        ...draft,
        defaultX: topLeft.x,
        defaultY: topLeft.y,
        defaultRotation: 0,
        visible: true,
        locked: false,
        zIndex: 10 + previous.stageObjects.length,
      };
      return {
        ...previous,
        stageObjects: [...previous.stageObjects, object],
        objectGroups: (previous.objectGroups ?? []).map((item) =>
          item.id === group?.id
            ? {
                ...item,
                objectIds: [...new Set([...item.objectIds, id])],
              }
            : item,
        ),
        frames: objectsOnlyLock
          ? previous.frames
          : previous.frames.map((frame) => {
              const frameStage = {
                ...previous.stage,
                ...getEffectiveStageSize(previous, frame),
              };
              const frameCenter = rosterCenter
                ? constrainMemberPosition(rosterCenter, frameStage)
                : {
                    x: frameStage.widthMeters / 2,
                    y: frameStage.depthMeters / 2,
                  };
              const frameTopLeft = constrainObjectPosition(
                {
                  x: frameCenter.x - draft.widthMeters / 2,
                  y: frameCenter.y - draft.heightMeters / 2,
                },
                draft.widthMeters,
                draft.heightMeters,
                frameStage,
              );
              return {
                ...frame,
                objectStates: {
                  ...frame.objectStates,
                  [id]: {
                    objectId: id,
                    x: frameTopLeft.x,
                    y: frameTopLeft.y,
                    widthMeters: draft.widthMeters,
                    heightMeters: draft.heightMeters,
                    rotation: 0,
                    visible: false,
                    zIndex: object.zIndex,
                  },
                },
              };
            }),
      };
    }, "名簿道具追加");
    const added = projectRef.current.stageObjects.find((object) => object.id === id);
    if (added) setNotice(`${added.name} を名簿に追加しました。`, "success");
  };

  const createRosterMemberGroup = () => {
    const group: MemberGroup = {
      id: createId("g"),
      name: nextGroupName(),
      memberIds: [],
      color:
        groupColorPalette[
          (project.memberGroups?.length ?? 0) % groupColorPalette.length
        ],
    };
    updateProject((previous) => ({
      ...previous,
      memberGroups: [...(previous.memberGroups ?? []), group],
    }), "名簿グループ作成");
    setNotice(`${group.name} を作成しました。`, "success");
  };

  const createRosterObjectGroup = () => {
    const group: ObjectGroup = {
      id: createId("og"),
      name: nextObjectGroupName(),
      color:
        groupColorPalette[
          (project.objectGroups?.length ?? 0) % groupColorPalette.length
        ],
      defaultType: "prop",
      defaultShape: "rectangle",
      objectIds: [],
    };
    updateProject((previous) => ({
      ...previous,
      objectGroups: [...(previous.objectGroups ?? []), group],
    }), "名簿道具グループ作成");
    setNotice(`${group.name} を作成しました。`, "success");
  };

  const updateObjectGroupMembership = (
    objectId: string,
    groupId: string | null,
  ) => {
    updateProject((previous) => ({
      ...previous,
      objectGroups: (previous.objectGroups ?? []).map((group) => {
        const withoutObject = group.objectIds.filter((id) => id !== objectId);
        if (group.id === groupId) {
          return {
            ...group,
            objectIds: [...withoutObject, objectId],
          };
        }
        return {
          ...group,
          objectIds: withoutObject,
        };
      }),
    }), "道具グループ所属変更");
    setNotice(
      groupId ? "道具の所属グループを変更しました。" : "道具の所属を解除しました。",
      "success",
    );
  };

  const nudgeSelection = (dx: number, dy: number) => {
    if (selectedMemberIds.length === 0) {
      return;
    }
    updateSelectedFramePositions((positions) => {
      const next = { ...positions };
      selectedMemberIds.forEach((id) => {
        const current = snapshot.positions[id];
        if (current) {
          next[id] = constrainMemberPosition(
            { x: current.x + dx, y: current.y + dy },
            effectiveStage,
          );
        }
      });
      return next;
    }, {
      label: "複数メンバー移動",
      memberIds: selectedMemberIds,
    });
  };

  const mirrorSelection = () => {
    if (selectedMemberIds.length === 0) {
      return;
    }
    updateSelectedFramePositions((positions) => {
      const next = { ...positions };
      selectedMemberIds.forEach((id) => {
        const current = snapshot.positions[id];
        if (current) {
          next[id] = constrainMemberPosition(
            { x: effectiveStage.widthMeters - current.x, y: current.y },
            effectiveStage,
          );
        }
      });
      return next;
    }, {
      label: "複数メンバー左右反転",
      memberIds: selectedMemberIds,
      notice: "センターラインを軸に左右反転しました。",
    });
  };

  const applyFormationTemplate = (template: FormationTemplate) => {
    if (selectedMemberIds.length < 2) {
      setNotice("隊列テンプレートは2人以上を選択して使います。");
      return;
    }
    const selectedPositions = selectedMemberIds
      .map((id) => snapshot.positions[id])
      .filter((position): position is Position => Boolean(position));
    if (selectedPositions.length === 0) {
      return;
    }
    const center = {
      x:
        selectedPositions.reduce((sum, position) => sum + position.x, 0) /
        selectedPositions.length,
      y:
        selectedPositions.reduce((sum, position) => sum + position.y, 0) /
        selectedPositions.length,
    };
    const middle = (selectedMemberIds.length - 1) / 2;
    updateSelectedFramePositions((positions) => {
      const next = { ...positions };
      selectedMemberIds.forEach((id, index) => {
        const offset = index - middle;
        let position: Position;
        if (template === "vertical") {
          position = { x: center.x, y: center.y + offset * templateSpacing };
        } else if (template === "diagonal") {
          position = {
            x: center.x + offset * templateSpacing,
            y: center.y + offset * templateSpacing,
          };
        } else if (template === "v") {
          const side = index % 2 === 0 ? -1 : 1;
          const rank = Math.ceil(index / 2);
          position = {
            x: center.x + side * rank * templateSpacing,
            y: center.y + rank * templateSpacing * 0.8,
          };
        } else {
          position = { x: center.x + offset * templateSpacing, y: center.y };
        }
        next[id] = constrainMemberPosition(position, effectiveStage);
      });
      return next;
    }, {
      label: "隊列テンプレート適用",
      memberIds: selectedMemberIds,
    });
  };

  const alignSelectedMembers = (action: AlignmentAction) => {
    const targetIds = [
      ...new Set([
        ...(selected?.type === "member" ? [selected.id] : []),
        ...selectedMemberIds,
      ]),
    ];
    if (!selectedFrame || targetIds.length === 0) {
      setNotice("整列するメンバーを選択してください。");
      return;
    }
    const targetPositions = targetIds.map(
      (id) =>
        snapshot.positions[id] ?? {
          x: effectiveStage.widthMeters / 2,
          y: effectiveStage.depthMeters / 2,
        },
    );
    if (
      (action === "distributeX" || action === "distributeY") &&
      targetIds.length < 3
    ) {
      setNotice("均等配置は3人以上を選択すると使いやすいです。");
      return;
    }
    const minX = Math.min(...targetPositions.map((position) => position.x));
    const maxX = Math.max(...targetPositions.map((position) => position.x));
    const minY = Math.min(...targetPositions.map((position) => position.y));
    const maxY = Math.max(...targetPositions.map((position) => position.y));
    const centerX =
      targetPositions.reduce((sum, position) => sum + position.x, 0) /
      targetPositions.length;
    const centerY =
      targetPositions.reduce((sum, position) => sum + position.y, 0) /
      targetPositions.length;
    const stageCenter = {
      x: effectiveStage.widthMeters / 2,
      y: effectiveStage.depthMeters / 2,
    };
    const activeFrameId = selectedFrame.id;
    const applyChange = () => {
      updateProject((previous) => ({
        ...previous,
        frames: previous.frames.map((frame) => {
          if (frame.id !== activeFrameId) {
            return frame;
          }
          const nextPositions = { ...frame.positions };
          if (action === "distributeX") {
            const sorted = [...targetIds].sort(
              (a, b) =>
                (snapshot.positions[a]?.x ?? 0) - (snapshot.positions[b]?.x ?? 0),
            );
            const step = sorted.length > 1 ? (maxX - minX) / (sorted.length - 1) : 0;
            sorted.forEach((id, index) => {
              const current = nextPositions[id] ?? stageCenter;
              nextPositions[id] = constrainMemberPosition(
                { ...current, x: roundMeters(minX + step * index) },
                effectiveStage,
              );
            });
          } else if (action === "distributeY") {
            const sorted = [...targetIds].sort(
              (a, b) =>
                (snapshot.positions[a]?.y ?? 0) - (snapshot.positions[b]?.y ?? 0),
            );
            const step = sorted.length > 1 ? (maxY - minY) / (sorted.length - 1) : 0;
            sorted.forEach((id, index) => {
              const current = nextPositions[id] ?? stageCenter;
              nextPositions[id] = constrainMemberPosition(
                { ...current, y: roundMeters(minY + step * index) },
                effectiveStage,
              );
            });
          } else {
            const delta =
              action === "stageCenter"
                ? {
                    x: stageCenter.x - centerX,
                    y: stageCenter.y - centerY,
                  }
                : null;
            targetIds.forEach((id) => {
              const current = nextPositions[id] ?? stageCenter;
              const next =
                action === "left"
                  ? { ...current, x: minX }
                  : action === "right"
                    ? { ...current, x: maxX }
                    : action === "centerX"
                      ? { ...current, x: centerX }
                      : action === "stageCenterX"
                        ? { ...current, x: stageCenter.x }
                        : action === "top"
                          ? { ...current, y: minY }
                          : action === "bottom"
                            ? { ...current, y: maxY }
                            : action === "centerY"
                              ? { ...current, y: centerY }
                              : delta
                                ? {
                                    x: current.x + delta.x,
                                    y: current.y + delta.y,
                                  }
                                : current;
              nextPositions[id] = constrainMemberPosition(
                { x: roundMeters(next.x), y: roundMeters(next.y) },
                effectiveStage,
              );
            });
          }
          return { ...frame, positions: nextPositions };
        }),
      }), "整列・均等配置");
      setNotice("選択メンバーを整列しました。", "success");
    };
    if (activeCloudProjectRef.current && !activeCloudProjectRef.current.activeSceneLock) {
      void runCloudSceneCellPatchEditMany(
        "整列・均等配置",
        targetIds.map((id) => ({ id, type: "member-position" })),
        applyChange,
      );
      return;
    }
    applyChange();
  };

  const placeSelectedObject = (action: AlignmentAction) => {
    if (!selectedFrame || selected?.type !== "object") {
      setNotice("配置する道具を選択してください。");
      return;
    }
    const object = project.stageObjects.find((item) => item.id === selected.id);
    const state = snapshot.objectStates[selected.id];
    if (!object || !state) {
      return;
    }
    const next = { ...state };
    if (action === "objectLeft") next.x = 0;
    if (action === "objectRight") {
      next.x = effectiveStage.widthMeters - state.widthMeters;
    }
    if (action === "objectCenterX") {
      next.x = (effectiveStage.widthMeters - state.widthMeters) / 2;
    }
    if (action === "objectTop") next.y = 0;
    if (action === "objectBottom") {
      next.y = effectiveStage.depthMeters - state.heightMeters;
    }
    if (action === "objectCenterY") {
      next.y = (effectiveStage.depthMeters - state.heightMeters) / 2;
    }
    if (action === "objectStageCenter") {
      next.x = (effectiveStage.widthMeters - state.widthMeters) / 2;
      next.y = (effectiveStage.depthMeters - state.heightMeters) / 2;
    }
    const constrained = constrainObjectPosition(
      { x: roundMeters(next.x), y: roundMeters(next.y) },
      state.widthMeters,
      state.heightMeters,
      effectiveStage,
    );
    updateObjectState(object.id, constrained);
    setNotice(`${object.name} を配置しました。`, "success");
  };

  async function enterStageFullscreen() {
    setIsStageFullscreen(true);
  }

  async function exitStageFullscreen() {
    try {
      if (document.fullscreenElement === stageFullscreenRef.current) {
        await document.exitFullscreen();
      }
    } catch {
      setNotice("フルスクリーン解除に失敗しました。Escキーでも解除できます。");
    } finally {
      setIsStageFullscreen(false);
    }
  }

  const handlePanelTabChange = (tab: PanelTabId) => {
    setActivePanelTab(tab);
    if (tab === "members") setMode("members");
    if (tab === "objects") setMode("objects");
    if (tab === "stage") setMode("stage");
    if (tab === "animation") setMode("preview");
    if (
      tab === "assignments" ||
      tab === "audio" ||
      tab === "timeline" ||
      tab === "notes"
    ) {
      setMode("preview");
    }
  };

  const selectedObjectName =
    selected?.type === "object"
      ? project.stageObjects.find((object) => object.id === selected.id)?.name ??
        null
      : null;
  const selectedPreviousReflectTargetName =
    selected?.type === "member"
      ? project.members.find((member) => member.id === selected.id)?.name ?? null
      : selectedObjectName;
  const canvasFrameId = displayFrame?.id ?? selectedFrame?.id ?? null;
  const canvasSnapshot = useMemo<StageSnapshot>(() => {
    if (!activeCloudProject || !canvasFrameId) {
      return snapshot;
    }
    const memberPreviewEntries = Object.values(cloudMemberPositionPreviews).filter(
      (preview) => preview.sceneId === canvasFrameId,
    );
    const objectPreviewEntries = Object.values(cloudObjectStatePreviews).filter(
      (preview) => preview.sceneId === canvasFrameId,
    );
    if (
      memberPreviewEntries.length === 0 &&
      objectPreviewEntries.length === 0
    ) {
      return snapshot;
    }
    return {
      ...snapshot,
      positions: {
        ...snapshot.positions,
        ...Object.fromEntries(
          memberPreviewEntries.map((preview) => [
            preview.memberId,
            preview.position,
          ]),
        ),
      },
      objectStates: {
        ...snapshot.objectStates,
        ...Object.fromEntries(
          objectPreviewEntries.map((preview) => [
            preview.objectId,
            preview.state,
          ]),
        ),
      },
    };
  }, [
    activeCloudProject,
    canvasFrameId,
    cloudMemberPositionPreviews,
    cloudObjectStatePreviews,
    snapshot,
  ]);
  const cloudMemberNameById = useMemo(
    () =>
      new Map(
        cloudCollaborationItems
          .filter((item) => item.type === "member" && item.userId)
          .map((item) => [
            item.userId ?? "",
            item.displayName ?? "名前未設定",
          ]),
      ),
    [cloudCollaborationItems],
  );
  useEffect(() => {
    const subscription = cloudRealtimeSubscriptionRef.current;
    if (!subscription) {
      return;
    }
    if (!activeCloudProject || !cloudSession) {
      void subscription.updatePresence(null);
      return;
    }

    const activeCellLock = activeCloudCellLocks[0] ?? null;
    const sceneId =
      activeCloudProject.activeSceneLock?.sceneId ??
      activeCellLock?.sceneId ??
      canvasFrameId;
    const sceneLabel = sceneId
      ? projectRef.current.frames.find((frame) => frame.id === sceneId)?.label ??
        null
      : null;
    const projectLock = activeCloudProject.activeProjectLock;
    const status = projectLock
      ? "project-editing"
      : activeCloudProject.activeSceneLock || activeCellLock
        ? "editing"
        : "viewing";
    const targetType = projectLock ? "project" : sceneId ? "scene" : null;
    const targetId = projectLock ? projectLock.lockKey : sceneId ?? null;

    void subscription.updatePresence({
      displayName:
        readCloudDisplayName(cloudSession.user.displayName) ?? "名前未設定",
      role: activeCloudProject.role,
      sceneId: sceneId ?? null,
      sceneLabel,
      status,
      targetId,
      targetType,
      updatedAt: new Date().toISOString(),
      userId: cloudSession.user.id,
    });
  }, [
    activeCloudProject?.activeProjectLock?.lockKey,
    activeCloudProject?.activeSceneLock?.sceneId,
    activeCloudProject?.projectId,
    activeCloudProject?.role,
    activeCloudCellLocks,
    canvasFrameId,
    cloudSession?.user.displayName,
    cloudSession?.user.id,
  ]);
  const latestRemotePresenceItems = useMemo(() => {
    const currentUserId = cloudSession?.user.id;
    const byUserId = new Map<string, CloudProjectPresence>();
    for (const item of cloudPresenceItems) {
      if (!item.userId || item.userId === currentUserId) {
        continue;
      }
      const displayName = readCloudDisplayName(item.displayName) ?? "名前未設定";
      const normalized = { ...item, displayName };
      const previous = byUserId.get(item.userId);
      if (!previous || normalized.updatedAt > previous.updatedAt) {
        byUserId.set(item.userId, normalized);
      }
    }
    return [...byUserId.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName, "ja"),
    );
  }, [cloudPresenceItems, cloudSession?.user.id]);
  const remoteViewingByFrameId = useMemo(() => {
    const next: Record<string, string[]> = {};
    for (const item of latestRemotePresenceItems) {
      if (item.status !== "viewing" || !item.sceneId) {
        continue;
      }
      next[item.sceneId] = [...(next[item.sceneId] ?? []), item.displayName];
    }
    return next;
  }, [latestRemotePresenceItems]);
  const cloudPresenceSummary = useMemo(() => {
    if (latestRemotePresenceItems.length === 0) {
      return null;
    }
    const currentSceneViewers = canvasFrameId
      ? latestRemotePresenceItems.filter(
          (item) => item.status === "viewing" && item.sceneId === canvasFrameId,
        )
      : [];
    if (currentSceneViewers.length > 0) {
      return `このシーンを閲覧中: ${formatCloudPresenceNames(
        currentSceneViewers.map((item) => item.displayName),
      )}`;
    }
    const projectEditor = latestRemotePresenceItems.find(
      (item) => item.status === "project-editing",
    );
    if (projectEditor) {
      const targetLabel =
        projectEditor.targetId && projectEditor.targetId in CLOUD_RESOURCE_LABELS
          ? CLOUD_RESOURCE_LABELS[projectEditor.targetId as CloudProjectLockKey]
          : "全体データ";
      return `${projectEditor.displayName}が${targetLabel}を操作中です。`;
    }
    const firstScenePresence = latestRemotePresenceItems.find(
      (item) => item.sceneId,
    );
    if (firstScenePresence) {
      return `${firstScenePresence.displayName}が${
        firstScenePresence.sceneLabel ?? "別シーン"
      }を${
        firstScenePresence.status === "editing" ? "編集中" : "閲覧中"
      }です。`;
    }
    return `${formatCloudPresenceNames(
      latestRemotePresenceItems.map((item) => item.displayName),
    )}がオンラインです。`;
  }, [canvasFrameId, latestRemotePresenceItems]);
  const canvasRemoteLock =
    activeCloudProject && canvasFrameId
      ? cloudActiveLocks.find(
          (lock) =>
            lock.targetType === "scene" &&
            lock.targetId === canvasFrameId &&
            lock.lockedBy !== cloudSession?.user.id,
        ) ?? null
      : null;
  const canvasRemoteLockOwner = canvasRemoteLock
    ? cloudMemberNameById.get(canvasRemoteLock.lockedBy) ?? "他の参加者"
    : null;
  const remoteEditingByFrameId = useMemo(() => {
    if (!activeCloudProject) {
      return {};
    }
    const next: Record<string, string> = {};
    for (const lock of cloudActiveLocks) {
      if (lock.lockedBy === cloudSession?.user.id) {
        continue;
      }
      if (lock.targetType === "scene") {
        next[lock.targetId] = cloudMemberNameById.get(lock.lockedBy) ?? "他の参加者";
        continue;
      }
      if (lock.targetType === "scene_cell") {
        const parsed = parseSceneCellLockTargetId(lock.targetId);
        if (parsed) {
          next[parsed.sceneId] =
            cloudMemberNameById.get(lock.lockedBy) ?? "他の参加者";
        }
      }
    }
    return next;
  }, [
    activeCloudProject,
    cloudActiveLocks,
    cloudMemberNameById,
    cloudSession?.user.id,
  ]);
  const remoteMemberPositionLocksById = useMemo(() => {
    if (!activeCloudProject || !canvasFrameId) {
      return {};
    }
    const next: Record<string, string> = {};
    for (const lock of cloudActiveLocks) {
      if (lock.targetType !== "scene_cell" || lock.lockedBy === cloudSession?.user.id) {
        continue;
      }
      const parsed = parseSceneCellLockTargetId(lock.targetId);
      if (
        parsed?.sceneId === canvasFrameId &&
        parsed.patchType === "member_position"
      ) {
        next[parsed.cellId] = cloudMemberNameById.get(lock.lockedBy) ?? "他の参加者";
      }
    }
    return next;
  }, [
    activeCloudProject,
    canvasFrameId,
    cloudActiveLocks,
    cloudMemberNameById,
    cloudSession?.user.id,
  ]);
  const remoteObjectStateLocksById = useMemo(() => {
    if (!activeCloudProject || !canvasFrameId) {
      return {};
    }
    const next: Record<string, string> = {};
    for (const lock of cloudActiveLocks) {
      if (lock.targetType !== "scene_cell" || lock.lockedBy === cloudSession?.user.id) {
        continue;
      }
      const parsed = parseSceneCellLockTargetId(lock.targetId);
      if (
        parsed?.sceneId === canvasFrameId &&
        parsed.patchType === "object_state"
      ) {
        next[parsed.cellId] = cloudMemberNameById.get(lock.lockedBy) ?? "他の参加者";
      }
    }
    return next;
  }, [
    activeCloudProject,
    canvasFrameId,
    cloudActiveLocks,
    cloudMemberNameById,
    cloudSession?.user.id,
  ]);
  const canvasRemoteProjectLock = activeCloudProject
    ? cloudActiveLocks.find((lock) => lock.targetType === "project") ?? null
    : null;
  const canvasRemoteProjectLockLabel = canvasRemoteProjectLock
    ? CLOUD_RESOURCE_LABELS[canvasRemoteProjectLock.targetId as CloudProjectLockKey] ??
      "全体データ"
    : null;
  const isCloudSceneReadOnly = Boolean(
    APP_FEATURES.collaboration &&
      activeCloudProject &&
      activeCloudProject.activeSceneLock &&
      activeCloudProject.activeSceneLock?.sceneId !== canvasFrameId,
  );
  const isCloudCanvasReadOnly = Boolean(
    APP_FEATURES.collaboration &&
      activeCloudProject &&
      (activeCloudProject.role === "viewer" ||
        activeCloudProject.activeProjectLock ||
        canvasRemoteProjectLock ||
        canvasRemoteLock ||
        (activeCloudProject.activeSceneLock &&
          activeCloudProject.activeSceneLock.sceneId !== canvasFrameId)),
  );
  const canEditCurrentScene = !activeCloudProject || !isCloudSceneReadOnly;
  const activeCloudProjectLockKey =
    activeCloudProject?.activeProjectLock?.lockKey ?? null;
  const canEditCloudResource = (resourceKey: CloudResourceKey) =>
    !activeCloudProject ||
    !APP_FEATURES.collaboration ||
    activeCloudProjectLockKey === resourceKey;
  const canEditCloudSettings = canEditCloudResource("settings");
  const canEditCloudMembers = canEditCloudResource("members");
  const canEditCloudObjects = canEditCloudResource("objects");
  const canEditCloudAudio = canEditCloudResource("audio");
  const canManageCloudSceneOrder =
    !activeCloudProject ||
    !APP_FEATURES.collaboration ||
    (activeCloudProject.role === "owner" &&
      (!activeCloudProject.activeProjectLock ||
        activeCloudProject.activeProjectLock.lockKey === "sceneOrder") &&
      !canvasRemoteProjectLockLabel);
  const canAddCloudScene = canManageCloudSceneOrder;
  const canEditProjectChrome =
    !activeCloudProject || !APP_FEATURES.collaboration;
  const cloudReadOnlyMessage = activeCloudProject
    ? !APP_FEATURES.collaboration
      ? "変更内容は端末へ自動保存され、保存ボタンで自分専用クラウドへ同期されます。"
      : activeCloudProject.activeProjectLock
      ? "全体設定の編集中です。シーンは閲覧のみです。"
      : activeCloudProject.role === "viewer"
      ? "閲覧のみの権限です。"
      : canvasRemoteProjectLockLabel
        ? `${canvasRemoteProjectLockLabel}の編集中です。シーンは閲覧のみです。`
      : canvasRemoteLockOwner
        ? `このシーンは${canvasRemoteLockOwner}が編集中です。`
      : "配置はメンバーや道具をドラッグすると自動で編集ロックを取得します。表示切替など一部の操作はシーン全体ロックを使います。"
    : undefined;
  const cloudProjectReadOnlyMessage = activeCloudProject
    ? !APP_FEATURES.collaboration
      ? undefined
      : activeCloudProject.activeProjectLock
      ? `${CLOUD_RESOURCE_LABELS[activeCloudProject.activeProjectLock.lockKey]}を編集中です。別の全体データは編集できません。`
      : canvasRemoteProjectLockLabel
        ? `${canvasRemoteProjectLockLabel}を他の参加者が編集中です。全体データとシーンは閲覧のみです。`
      : activeCloudProject.role === "owner"
        ? "全体データを編集するには、上部の対象ボタンを押してください。"
        : "全体データはownerのみ編集できます。"
    : undefined;
  const cloudSettingsReadOnlyMessage = activeCloudProject
    ? !APP_FEATURES.collaboration
      ? undefined
      : activeCloudProject.role === "owner"
      ? "全体設定を編集するには、上部の「全体設定を編集」を押してください。"
      : "全体設定の編集はownerのみ可能です。"
    : undefined;

  const canOpenRosterManager =
    !activeCloudProject ||
    !APP_FEATURES.collaboration ||
    activeCloudProject.role === "owner";
  const openRosterManager = (mode?: "members" | "objects") => {
    if (APP_FEATURES.collaboration && activeCloudProject) {
      const lockKey = activeCloudProject.activeProjectLock?.lockKey;
      if (lockKey !== "members" && lockKey !== "objects") {
        setNotice(
          activeCloudProject.role === "owner"
            ? "名簿を編集するには、上部の「メンバー名簿」または「道具マスター」を押してください。"
            : "名簿の編集はownerのみ可能です。",
        );
        return;
      }
      if (!canOpenRosterManager) {
        setNotice("名簿の編集はownerのみ可能です。");
        return;
      }
      if (mode && mode !== lockKey) {
        setNotice(
          mode === "members"
            ? "メンバーを編集するには「メンバー名簿」の編集モードにしてください。"
            : "道具を編集するには「道具マスター」の編集モードにしてください。",
        );
        return;
      }
    }
    setRosterInitialMode(mode);
    setIsRosterManagerOpen(true);
  };

  const selectVisibilityTarget = (type: "member" | "object", id: string) => {
    if (type === "member" && isMemberSelectionMode) { setSelected(null); toggleMemberSelection(id); }
    else { setSelected({ type, id }); setSelectedMemberIds([]); }
    setMode(type === "member" ? "members" : "objects");
    if (!workspaceLayout.isPortrait) return;
    const bounds = selectionScrollBounds(project, snapshot, type, id, effectiveStage, viewerPerspective, selectedFrame?.objectAssignments);
    if (bounds) stageExportRef.current?.scrollTargetIntoView?.(bounds);
  };

  const panelContent = (() => {
    if (activePanelTab === "members") {
      return (
          <MemberPanel
            key={project.id}
            portrait={workspaceLayout.isPortrait}
            visibilityMemory={visibilityMemories.members}
            onRestoreMember={(id) => setMembersFrameVisibility([id], true, true)}
            canOpenRosterManager={canOpenRosterManager}
            onOpenRosterManager={() => openRosterManager("members")}
            members={project.members}
            selected={selected}
            selectedMemberIds={selectedMemberIds}
            groups={project.memberGroups ?? []}
            currentFrame={selectedFrame}
            objectAssignmentLabelsByMemberId={objectAssignmentLabelsByMemberId}
            visibilityTab={memberVisibilityTab}
            scrollTarget={
              panelScrollTarget?.type === "member" ? panelScrollTarget : null
            }
            canEditProject={canEditCloudMembers}
            canEditScene={canEditCurrentScene}
            projectReadOnlyMessage={cloudProjectReadOnlyMessage}
            sceneReadOnlyMessage={cloudReadOnlyMessage}
            onVisibilityTabChange={setMemberVisibilityTab}
            onSelect={(id) => selectVisibilityTarget("member", id)}
            onToggleMemberSelection={toggleMemberSelection}
            onUpdate={updateMember}
            onSetMembersGlobalVisibility={updateMembersGlobalVisibility}
            onSetMemberFrameVisibility={setMembersFrameVisibility}
            onSetAllMembersFrameVisibility={setAllMembersFrameVisibility}
            onSetGroupFrameVisibility={setGroupsFrameVisibility}
            onDelete={(id) => void confirmAndDeleteMember(id)}
            onAddMember={addMember}
            onCreateGroup={createGroup}
            onUpdateGroup={updateGroup}
            onDeleteGroup={(id) => void confirmAndDeleteMemberGroup(id)}
            onAddMemberToGroup={addMemberToGroup}
            onSelectGroup={selectGroup}
            onChangeMemberGroup={updateMemberGroup}
            onClearMemberObjectAssignments={clearMemberObjectAssignments}
            onCopySelected={() => copyMemberToClipboard()}
            onPasteMember={pasteMemberFromClipboard}
            canPasteMember={clipboard?.type === "member" && canEditCurrentScene}
          >
          <div data-member-tools-panel="true">
            <GroupToolsPanel
              members={project.members}
              selectedMemberIds={selectedMemberIds}
              isSelectionMode={isMemberSelectionMode}
              spacingMeters={templateSpacing}
              canEditProject={canEditCloudMembers}
              canEditScene={canEditCurrentScene}
              projectReadOnlyMessage={cloudProjectReadOnlyMessage}
              sceneReadOnlyMessage={cloudReadOnlyMessage}
              onSpacingChange={setTemplateSpacing}
              onToggleSelectionMode={toggleMemberSelectionMode}
              onClearSelection={clearMemberSelection}
              onCreateGroupFromSelection={createGroupFromSelection}
              onNudgeSelection={nudgeSelection}
              onMirrorSelection={mirrorSelection}
              onApplyTemplate={applyFormationTemplate}
              onAlignSelection={alignSelectedMembers}
            />
          </div>
          </MemberPanel>
      );
    }

    if (activePanelTab === "objects") {
      return (
        <ObjectPanel
          key={project.id}
          portrait={workspaceLayout.isPortrait}
          visibilityMemory={visibilityMemories.objects}
          currentFrameId={selectedFrame?.id}
          canOpenRosterManager={canOpenRosterManager}
          onOpenRosterManager={() => openRosterManager("objects")}
          memberGroups={project.memberGroups ?? []}
          objects={project.stageObjects}
          objectGroups={project.objectGroups ?? []}
          objectStates={snapshot.objectStates}
          members={project.members}
          objectAssignments={selectedFrame?.objectAssignments}
          selected={selected}
          visibilityTab={objectVisibilityTab}
          scrollTarget={
            panelScrollTarget?.type === "object" ? panelScrollTarget : null
          }
          canEditProject={canEditCloudObjects}
          canEditScene={canEditCurrentScene}
          projectReadOnlyMessage={cloudProjectReadOnlyMessage}
          sceneReadOnlyMessage={cloudReadOnlyMessage}
          onVisibilityTabChange={setObjectVisibilityTab}
          onSelect={(id) => selectVisibilityTarget("object", id)}
          onUpdateObject={updateObject}
          onUpdateObjectState={updateObjectState}
          onDelete={(id) => void confirmAndDeleteObject(id)}
          onNudgeZ={nudgeObjectZ}
          onAddObject={(visibleInCurrentFrame) =>
            addStageObject(defaultStageObjectDraft, visibleInCurrentFrame)
          }
          onCreateObjectGroup={createObjectGroup}
          onUpdateObjectGroup={updateObjectGroup}
          onDeleteObjectGroup={(id) => void confirmAndDeleteObjectGroup(id)}
          onAddObjectToGroup={addObjectToGroup}
          onChangeObjectGroup={updateObjectGroupMembership}
          onSetAllObjectsFrameVisibility={setAllObjectsFrameVisibility}
          onCopySelected={() => copyObjectToClipboard()}
          onPasteObject={pasteObjectFromClipboard}
          canPasteObject={clipboard?.type === "object" && canEditCurrentScene}
          onAssignMember={assignMemberToObject}
          onRemoveAssignment={removeObjectAssignment}
          onPlaceSelectedObject={placeSelectedObject}
        />
      );
    }

    if (activePanelTab === "assignments") {
      return (
        <AssignmentPanel
          canOpenRosterManager={canOpenRosterManager}
          onOpenRosterManager={() => openRosterManager("members")}
          memberGroups={project.memberGroups ?? []}
          frames={project.frames}
          members={project.members}
          objects={project.stageObjects}
          objectGroups={project.objectGroups ?? []}
          currentFrame={selectedFrame ?? null}
          previousFrame={selectedPreviousFrame}
          objectStates={selectedFrameSnapshot.objectStates}
          previousObjectStates={selectedPreviousFrameSnapshot?.objectStates ?? {}}
          canEditScene={canEditCurrentScene}
          sceneReadOnlyMessage={cloudReadOnlyMessage}
          onAssignMember={assignMemberToObject}
          onApplyPreviousAssignments={applyPreviousAssignmentsToCurrentFrame}
          onRemoveAssignment={removeObjectAssignment}
          onSelectFrame={(id) => {
            const frame = project.frames.find((item) => item.id === id);
            if (!frame) {
              return;
            }
            setSelectedFrameId(frame.id);
            seek(frame.timeSec);
          }}
        />
      );
    }

    if (activePanelTab === "stage") {
      return (
        <StageSettingsPanel
          mode={project.mode ?? "stage"}
          stage={project.stage}
          paradeSettings={project.paradeSettings}
          useGlobalStageSize={
            project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
          }
          showMeterRulers={showMeterRulers}
          showSnapGuides={project.guideSettings?.snapGuideEnabled ?? true}
          snapToGuides={project.guideSettings?.snapToGuideEnabled ?? false}
          disabled={!canEditCloudSettings}
          disabledMessage={cloudSettingsReadOnlyMessage}
          onChange={updateStage}
          onParadeSettingsChange={updateParadeSettings}
          onUseGlobalStageSizeChange={updateUseGlobalStageSize}
          onToggleMeterRulers={() => setShowMeterRulers((previous) => !previous)}
          onToggleSnapGuides={() =>
            updateGuideSettings({
              snapGuideEnabled: !(project.guideSettings?.snapGuideEnabled ?? true),
            })
          }
          onToggleSnapToGuides={() =>
            updateGuideSettings({
              snapToGuideEnabled: !(project.guideSettings?.snapToGuideEnabled ?? false),
            })
          }
        />
      );
    }

    if (activePanelTab === "animation") {
      return (
        <Suspense fallback={<p role="status">詳細を読み込み中…</p>}>
        <DetailsPanel
          selected={selected}
          selectedMemberIds={selectedMemberIds}
          members={project.members}
          memberGroups={project.memberGroups ?? []}
          objects={project.stageObjects}
          objectGroups={project.objectGroups ?? []}
          currentFrame={selectedFrame ?? null}
          snapshot={selectedFrameSnapshot}
          stage={effectiveStage}
          projectMode={project.mode ?? "stage"}
          paradeSettings={project.paradeSettings}
          canEditProject={
            selected?.type === "member"
              ? canEditCloudMembers
              : selected?.type === "object"
                ? canEditCloudObjects
                : canEditProjectChrome
          }
          canEditScene={canEditCurrentScene}
          projectReadOnlyMessage={cloudProjectReadOnlyMessage}
          sceneReadOnlyMessage={cloudReadOnlyMessage}
          onUpdateMember={updateMember}
          onUpdateMemberGroup={updateMemberGroup}
          onMoveMember={moveMember}
          onUpdateObject={updateObject}
          onUpdateObjectState={updateObjectState}
        />
        </Suspense>
      );
    }

    if (activePanelTab === "audio") {
      return (
        <AudioPanel
          audioName={audioName}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          playbackRate={playbackRate}
          loopEnabled={loopEnabled}
          loopStart={loopStart}
          loopEnd={loopEnd}
          sharedAudioNotice={sharedAudioNotice}
          cloudAudioNotice={Boolean(activeCloudProject)}
          canEditAudio={canEditCloudAudio}
          audioReadOnlyMessage={
            activeCloudProject?.role === "owner"
              ? "音源設定を編集するには、上部の「音源設定」を押してください。"
              : "音源設定の編集はownerのみ可能です。"
          }
          onLoadAudio={loadAudio}
          onLoadAudioError={setNotice}
          onTogglePlayback={togglePlayback}
          onSeek={seek}
          onPlaybackRateChange={setPlaybackRate}
          onLoopChange={changeLoop}
        />
      );
    }

    if (activePanelTab === "timeline") {
      return (
        <Timeline
          frames={project.frames}
          selectedFrameId={displayFrame?.id ?? null}
          currentTime={currentTime}
          useGlobalStageSize={
            project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
          }
          defaultStageWidth={project.stage.widthMeters}
          defaultStageDepth={project.stage.depthMeters}
          previousFrame={selectedPreviousFrame}
          selectedTargetName={selectedPreviousReflectTargetName}
          canEditProject={canManageCloudSceneOrder}
          canEditScene={canEditCurrentScene}
          canAddFrame={canAddCloudScene}
          canSortFrames={canManageCloudSceneOrder}
          projectReadOnlyMessage={cloudProjectReadOnlyMessage}
          addFrameReadOnlyMessage={
            activeCloudProject && activeCloudProject.role !== "owner"
              ? "クラウドでシーンを追加できるのはownerのみです。"
              : cloudProjectReadOnlyMessage
          }
          sceneReadOnlyMessage={cloudReadOnlyMessage}
          onSelectFrame={(id) => {
            setSelectedFrameId(id);
            if (!isPlaying) {
              setMode((previous) => (previous === "preview" ? "members" : previous));
            }
          }}
          onAddFrame={() => addFrame()}
          onAddFrameAtCurrentTime={() => addFrame(currentTime)}
          onPreviousFrame={() => goToScene(-1)}
          onNextFrame={() => goToScene(1)}
          onSeekToFrame={seekToFrame}
          onUpdateFrame={updateFrame}
          onDeleteFrame={deleteFrame}
          onReorderFrame={reorderFrames}
          onSortFramesByTime={sortFramesByTime}
          onCopyFrame={() => copyFrameToClipboard()}
          onPasteFrame={pasteFrameFromClipboard}
          onPasteFrameIntoCurrent={() =>
            void pasteFrameIntoExisting(displayFrame?.id ?? selectedFrame?.id)
          }
          canPasteFrame={clipboard?.type === "frame"}
          sceneOrderSaveStatus={
            activeCloudProject?.role === "owner" ? cloudSceneOrderSaveStatus : null
          }
          onApplyPreviousSceneState={applyPreviousSceneStateToCurrentFrame}
        />
      );
    }

    if (activePanelTab === "notes") {
      return (
        <SceneNotesPanel
          frame={selectedFrame}
          sceneNumber={selectedSceneNumber}
          canEditScene={canEditCurrentScene}
          commitOnBlur={Boolean(activeCloudProject)}
          sceneReadOnlyMessage={cloudReadOnlyMessage}
          onUpdateFrame={updateFrame}
        />
      );
    }

    return (
      <StageSettingsPanel
        mode={project.mode ?? "stage"}
        stage={project.stage}
        paradeSettings={project.paradeSettings}
        useGlobalStageSize={
          project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
        }
        showMeterRulers={showMeterRulers}
        showSnapGuides={project.guideSettings?.snapGuideEnabled ?? true}
        snapToGuides={project.guideSettings?.snapToGuideEnabled ?? false}
        disabled={!canEditCloudSettings}
        disabledMessage={cloudSettingsReadOnlyMessage}
        onChange={updateStage}
        onParadeSettingsChange={updateParadeSettings}
        onUseGlobalStageSizeChange={updateUseGlobalStageSize}
        onToggleMeterRulers={() => setShowMeterRulers((previous) => !previous)}
        onToggleSnapGuides={() =>
          updateGuideSettings({
            snapGuideEnabled: !(project.guideSettings?.snapGuideEnabled ?? true),
          })
        }
        onToggleSnapToGuides={() =>
          updateGuideSettings({
            snapToGuideEnabled: !(project.guideSettings?.snapToGuideEnabled ?? false),
          })
        }
      />
    );
  })();

  if (appView === "library") {
    return (
      <>
        <FormationLibrary
          projects={sortStoredProjects(savedProjects)}
          notice={notice}
          cloud={{
            configured: Boolean(cloudConfig),
            error: cloudError,
            isBusy: isCloudBusy,
            personalMode: !APP_FEATURES.collaboration,
            pendingInviteToken: cloudInviteToken,
            projects: APP_FEATURES.collaboration
              ? cloudProjects
              : cloudProjects.filter((project) => project.role === "owner"),
            userDisplayName: cloudSession?.user.displayName,
            userEmail: cloudSession?.user.email,
            onAcceptInvite: acceptCloudInvite,
            onChangePassword: changeCloudPassword,
            onCopyCloudProjectToLocal: copyCloudProjectToLocal,
            onDeleteAccount: deleteCloudAccount,
            onDeleteCloudProject: deleteCloudProject,
            onHideCloudProject: hideCloudProject,
            onOpenCloudProject: openCloudProject,
            onRefresh: refreshCloudProjects,
            onRequestPasswordReset: requestCloudPasswordReset,
            onResendConfirmation: resendCloudSignupConfirmation,
            onSignIn: signInToCloud,
            onSignOut: signOutFromCloud,
            onSignUp: signUpToCloud,
            onUploadProject: uploadProjectToCloud,
          }}
          onCreate={createNewFormationProject}
          onOpenProject={(nextProject) => void openProjectInEditor(nextProject)}
          onRenameProject={renameStoredProject}
          onDuplicateProject={duplicateStoredProject}
          onExportProject={exportTairetsuProject}
          onImportProjectFile={importTairetsuProjectFile}
          onDeleteProject={deleteStoredProject}
        />
        {completedExport && <Suspense fallback={<div role="status">書き出し完了画面を準備中…</div>}><ExportCompletionDialog result={completedExport} onClose={() => setCompletedExport(null)} onCopyImage={canCopyExport ? copyImageToClipboard : undefined} /></Suspense>}
        {isCloudPasswordRecoveryOpen && (
          <Suspense fallback={<div role="status">画面を読み込み中…</div>}>
          <CloudPasswordModal
            isBusy={isCloudBusy}
            mode="recovery"
            onClose={() => setIsCloudPasswordRecoveryOpen(false)}
            onSubmit={finishCloudPasswordRecovery}
          />
          </Suspense>
        )}
      </>
    );
  }

  const notifyCloudReadOnlyEdit = () => {
    if (cloudReadOnlyMessage) {
      setNotice(cloudReadOnlyMessage);
    }
  };

  const notifyCloudCellLockedEdit = (ownerName: string) => {
    setNotice(`${ownerName}がこの対象を操作中です。別のメンバーや道具は編集できます。`);
  };
  const cloudBannerTitle = activeCloudProject
    ? !APP_FEATURES.collaboration
      ? "自分専用クラウド"
      : activeCloudProject.activeProjectLock
      ? "クラウド全体編集中"
      : activeCloudProject.activeSceneLock
        ? "クラウド編集中"
        : activeCloudProject.role === "viewer"
          ? "クラウド閲覧中"
          : "クラウド共同作業中"
    : "";

  return (
    <>
    <div
      className="app-shell"
      data-workspace-layout={workspaceLayout.isPortrait ? "portrait" : undefined}
      data-workspace-keyboard={workspaceLayout.keyboardOpen ? "open" : undefined}
      style={{ "--workspace-viewport-height": `${workspaceLayout.height}px` } as CSSProperties}
    >
      <div className="app-top-region">
      <Toolbar
        title={project.title}
        canEditProject={canEditProjectChrome}
        canEditScene={canEditCurrentScene}
        canSaveProject={
          !activeCloudProject ||
          canEditCurrentScene ||
          Boolean(activeCloudProject.activeProjectLock)
        }
        projectReadOnlyMessage={cloudProjectReadOnlyMessage}
        sceneReadOnlyMessage={cloudReadOnlyMessage}
        onTitleChange={updateTitle}
        isDirty={isDirty}
        isSaving={isSaving}
        onBackToLibrary={() => void returnToLibrary()}
        onSaveProject={() => void saveProjectManually()}
        onOpenShareExport={() => setIsShareExportOpen(true)}
        canOpenRosterManager={canOpenRosterManager}
        onOpenRosterManager={() => openRosterManager()}
      />
      {isSharedProject && (
        <div className="shared-project-banner">
          <div>
            <strong>共有データで閲覧中</strong>
            <span>編集・保存する場合は、自分の隊列一覧に追加してください。</span>
          </div>
          <div className="shared-project-banner__actions">
            <button
              className="mini-button primary"
              onClick={() => void addSharedProjectToLibrary()}
              type="button"
            >
              自分の一覧に追加
            </button>
            <button
              className="mini-button"
              onClick={() => void returnToLibrary()}
              type="button"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
      {activeCloudProject && (
        <div className="shared-project-banner cloud-project-banner">
          <div>
            <strong>
              {cloudBannerTitle}
            </strong>
            <span>
              {!APP_FEATURES.collaboration
                ? isDirty
                  ? "端末に未同期の変更があります。保存するとクラウドへ同期します。"
                  : "自分専用クラウドと同期済みです。"
                : activeCloudProject.role === "viewer"
                ? "閲覧のみの権限です。"
                : activeCloudProject.activeProjectLock
                  ? `編集中: ${
                      CLOUD_RESOURCE_LABELS[activeCloudProject.activeProjectLock.lockKey]
                    }`
                  : activeCloudProject.activeSceneLock
                  ? `編集中: ${
                      project.frames.find(
                        (frame) =>
                          frame.id === activeCloudProject.activeSceneLock?.sceneId,
                      )?.label ?? "選択シーン"
                    }`
                  : selectedFrame
                    ? canvasRemoteLockOwner
                      ? `現在: ${selectedFrame.label}。${canvasRemoteLockOwner}が編集中です。`
                      : `現在: ${selectedFrame.label}。編集操作を始める前にロックを取得します。`
                    : "編集するシーンを選択してください。"}
            </span>
            {cloudPendingUpdates.length > 0 && (
              <span className="cloud-project-banner__update">
                更新があります:{" "}
                {cloudPendingUpdates.map((update) => update.label).join("、")}
              </span>
            )}
            {APP_FEATURES.collaboration && cloudPresenceSummary && (
              <span className="cloud-project-banner__presence">
                {cloudPresenceSummary}
              </span>
            )}
            {APP_FEATURES.collaboration && (
              <span className="cloud-project-banner__presence">
                クラウド共同編集では元に戻す/やり直しは使えません。
              </span>
            )}
          </div>
          <div className="shared-project-banner__actions">
            {APP_FEATURES.collaboration && (
              <button
                className="mini-button"
                onClick={() => setIsCloudHelpOpen(true)}
                type="button"
              >
                <CircleHelp size={14} />
                共同作業の使い方
              </button>
            )}
            {cloudPendingUpdates.length > 0 && (
              <button
                className="mini-button primary"
                disabled={isCloudBusy || isDirty}
                onClick={() => void reloadActiveCloudProject()}
                type="button"
              >
                更新を再読み込み
              </button>
            )}
            {APP_FEATURES.collaboration && activeCloudProject.role === "owner" && (
              <button
                className="mini-button"
                disabled={isCloudBusy}
                onClick={() => {
                  setIsCloudShareOpen(true);
                  void refreshCloudShareData();
                }}
                type="button"
              >
                共有管理
              </button>
            )}
            {!APP_FEATURES.collaboration ? (
              <button
                className="mini-button primary"
                disabled={isSaving || isCloudBusy}
                onClick={() => void saveProjectManually()}
                type="button"
              >
                {isSaving ? "同期中" : "クラウドへ同期"}
              </button>
            ) : activeCloudProject.role !== "viewer" &&
              (activeCloudProject.activeProjectLock &&
              activeCloudProject.activeProjectLock.lockKey !== "import" ? (
                <>
                  <button
                    className="mini-button primary"
                    disabled={isSaving || isCloudBusy}
                    onClick={() =>
                      void saveCloudProjectResource(
                        projectRef.current,
                        (activeCloudProject.activeProjectLock?.lockKey ??
                          "settings") as CloudResourceKey,
                      )
                    }
                    type="button"
                  >
                    クラウド保存
                  </button>
                  <button
                    className="mini-button"
                    disabled={isCloudBusy}
                    onClick={() => void releaseActiveCloudProjectLock()}
                    type="button"
                  >
                    編集終了
                  </button>
                </>
              ) : activeCloudProject.activeSceneLock ? (
                <>
                  <button
                    className="mini-button primary"
                    disabled={isSaving || isCloudBusy}
                    onClick={() =>
                      void saveCloudCurrentScene(
                        projectRef.current,
                        activeCloudProject.activeSceneLock?.sceneId ?? null,
                      )
                    }
                    type="button"
                  >
                    クラウド保存
                  </button>
                  <button
                    className="mini-button"
                    disabled={isCloudBusy}
                    onClick={() => void releaseActiveCloudSceneLock()}
                    type="button"
                  >
                    編集終了
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="mini-button"
                    disabled={isCloudBusy || !selectedFrame}
                    onClick={() => void beginCloudSceneEdit()}
                    title="表示切替やメモなど、セル単位ロック未対応の操作に使います。通常のメンバー/道具移動はドラッグで自動ロックします。"
                    type="button"
                  >
                    シーン全体ロック
                  </button>
                  {activeCloudProject.role === "owner" && (
                    <>
                      {CLOUD_OWNER_RESOURCE_KEYS.map((resourceKey) => (
                        <button
                          className="mini-button"
                          disabled={isCloudBusy}
                          key={resourceKey}
                          onClick={() =>
                            void beginCloudProjectResourceEdit(resourceKey)
                          }
                          type="button"
                        >
                          {CLOUD_RESOURCE_LABELS[resourceKey]}
                        </button>
                      ))}
                      <button
                        className="mini-button danger"
                        disabled={isCloudBusy}
                        onClick={() => cloudImportInputRef.current?.click()}
                        type="button"
                      >
                        クラウド上書き
                      </button>
                    </>
                  )}
                </>
              ))}
          </div>
        </div>
      )}
      <audio ref={audioRef} className="persistent-audio" />
      <input
        ref={cloudImportInputRef}
        accept=".json,.zip,.tairetsu,application/json,application/zip,application/octet-stream"
        className="sr-only"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            void importCloudProjectFile(file);
          }
        }}
      />
      </div>

      <div className={isPanelOpen ? "workspace" : "workspace is-editor-collapsed"}>
        <PanelTabs
          portrait={workspaceLayout.isPortrait}
          keyboardOpen={workspaceLayout.keyboardOpen}
          activeTab={activePanelTab}
          isOpen={isPanelOpen}
          onChange={handlePanelTabChange}
          onToggleOpen={() => setIsPanelOpen((previous) => !previous)}
        >
          {panelContent}
        </PanelTabs>

        <div
          className={
            isSceneThumbnailRailCollapsed
              ? "center-column has-thumbnail-rail is-thumbnail-collapsed"
              : "center-column has-thumbnail-rail"
          }
        >
          <div className={`stage-workspace stage-workspace--${project.mode === "parade" ? "parade" : "stage"}`}>
            <SceneThumbnailRail
              project={project}
              selectedFrameId={displayFrame?.id ?? null}
              collapsed={isSceneThumbnailRailCollapsed}
              remoteEditingByFrameId={remoteEditingByFrameId}
              remoteViewingByFrameId={remoteViewingByFrameId}
              onToggleCollapsed={() =>
                setIsSceneThumbnailRailCollapsed((previous) => !previous)
              }
              onSelectFrame={(frame) => {
                setSelectedFrameId(frame.id);
                seek(frame.timeSec);
              }}
              onFrameContextMenu={handleSceneThumbnailContextMenu}
            />
            <div
              ref={stageFullscreenRef}
              className={
                isStageFullscreen
                  ? "stage-fullscreen-host is-stage-fullscreen"
                  : "stage-fullscreen-host"
              }
            >
              {project.mode === "parade" ? (
                <ParadeCanvas
                  ref={stageExportRef}
                  isPlaying={isPlaying || animationPreviewTimeSec !== null}
                  project={projectForStage}
                  snapshot={canvasSnapshot}
                  selected={selected}
                  selectedFrameId={displayFrame?.id ?? null}
                  selectedFrameLabel={getFrameLabel(displayFrame)}
                  selectedMemberIds={selectedMemberIds}
                  isMemberSelectionMode={isMemberSelectionMode}
                  focusMemberId={undefined}
                  focusMode={false}
                  isReadOnly={isCloudCanvasReadOnly}
                  readOnlyMessage={cloudReadOnlyMessage}
                  deferMemberDragCommit={Boolean(
                    activeCloudProject && APP_FEATURES.collaboration,
                  )}
                  deferObjectDragCommit={Boolean(
                    activeCloudProject && APP_FEATURES.collaboration,
                  )}
                  remoteMemberLocks={remoteMemberPositionLocksById}
                  remoteObjectLocks={remoteObjectStateLocksById}
                  onSelect={selectStageElement}
                  onStagePointerPositionChange={handleStagePointerPositionChange}
                  onMoveMember={moveMember}
                  onUpdateObjectState={moveObject}
                  canUndo={
                    (!activeCloudProject || !APP_FEATURES.collaboration) &&
                    historyCounts.undo > 0
                  }
                  canRedo={
                    (!activeCloudProject || !APP_FEATURES.collaboration) &&
                    historyCounts.redo > 0
                  }
                  onUndo={undoProject}
                  onRedo={redoProject}
                  onBeginProjectEdit={beginProjectHistoryBatch}
                  onEndProjectEdit={endProjectHistoryBatch}
                  onFrameViewStateChange={updateFrameViewState}
                  onReflectPreviousFrame={reflectPreviousParadeFrame}
                  isFullscreen={isStageFullscreen}
                  onToggleFullscreen={() => {
                    if (isStageFullscreen) {
                      void exitStageFullscreen();
                      return;
                    }
                    void enterStageFullscreen();
                  }}
                  onCaptureStageImage={captureStageImage}
                  onContextMenuRequest={handleStageContextMenu}
                  onReadOnlyEditAttempt={notifyCloudReadOnlyEdit}
                  onLockedElementEditAttempt={notifyCloudCellLockedEdit}
                />
              ) : (
                <StageCanvas
                  ref={stageExportRef}
                  viewStates={stageViewStates}
                  compact={workspaceLayout.isPortrait}
                  project={projectForStage}
                  snapshot={canvasSnapshot}
                  selected={selected}
                  selectedFrameLabel={getFrameLabel(displayFrame)}
                  selectedFrameTime={getFrameTime(displayFrame)}
                  mode={mode}
                  isPlaying={isPlaying}
                  isFullscreen={isStageFullscreen}
                  currentTime={currentTime}
                  audioDuration={duration}
                  audioName={audioName}
                  selectedFrameId={displayFrame?.id ?? null}
                  viewerPerspective={viewerPerspective}
                  showMovementPaths={false}
                  showMeterRulers={showMeterRulers}
                  movementPathMode={movementPathMode}
                  selectedMemberIds={selectedMemberIds}
                  isMemberSelectionMode={isMemberSelectionMode}
                  focusMemberId={undefined}
                  focusMode={false}
                  isReadOnly={isCloudCanvasReadOnly}
                  readOnlyMessage={cloudReadOnlyMessage}
                  deferMemberDragCommit={Boolean(
                    activeCloudProject && APP_FEATURES.collaboration,
                  )}
                  deferObjectDragCommit={Boolean(
                    activeCloudProject && APP_FEATURES.collaboration,
                  )}
                  remoteMemberLocks={remoteMemberPositionLocksById}
                  remoteObjectLocks={remoteObjectStateLocksById}
                  onSelect={selectStageElement}
                  onStagePointerPositionChange={handleStagePointerPositionChange}
                  onMoveMember={moveMember}
                  onUpdateObjectState={moveObject}
                  canUndo={
                    (!activeCloudProject || !APP_FEATURES.collaboration) &&
                    historyCounts.undo > 0
                  }
                  canRedo={
                    (!activeCloudProject || !APP_FEATURES.collaboration) &&
                    historyCounts.redo > 0
                  }
                  onUndo={undoProject}
                  onRedo={redoProject}
                  onBeginProjectEdit={beginProjectHistoryBatch}
                  onEndProjectEdit={endProjectHistoryBatch}
                  onTogglePlayback={togglePlayback}
                  onSaveFrame={saveCurrentFormation}
                  onTogglePerspective={() =>
                    updateViewerPerspective(
                      viewerPerspective === "audience" ? "performer" : "audience",
                    )
                  }
                  onToggleFullscreen={() => {
                    if (isStageFullscreen) {
                      void exitStageFullscreen();
                      return;
                    }
                    void enterStageFullscreen();
                  }}
                  onCaptureStageImage={captureStageImage}
                  onSeekAudio={seek}
                  onContextMenuRequest={handleStageContextMenu}
                  onReadOnlyEditAttempt={notifyCloudReadOnlyEdit}
                  onLockedElementEditAttempt={notifyCloudCellLockedEdit}
                />
              )}
              <ExportImportPanel key={project.mode} notice={notification} warnings={warnings} onDismissNotice={dismissNotice} />
            </div>
          </div>
        </div>
      </div>
      {sceneContextMenu &&
        (() => {
          const frame = project.frames.find(
            (item) => item.id === sceneContextMenu.frameId,
          );
          if (!frame) {
            return null;
          }
          return (
            <div
              className="stage-context-menu scene-context-menu"
              ref={sceneContextMenuRef}
              style={{
                left:
                  sceneContextMenuPosition?.left ??
                  sceneContextMenu.clientX,
                top:
                  sceneContextMenuPosition?.top ??
                  sceneContextMenu.clientY,
              }}
              onPointerDown={(event) => event.stopPropagation()}
              role="menu"
            >
              <strong>{frame.label}</strong>
              <button
                onClick={() =>
                  runSceneContextMenuAction(() =>
                    copyFrameToClipboard(frame.id),
                  )
                }
                type="button"
              >
                コピー
              </button>
              <button
                disabled={clipboard?.type !== "frame"}
                onClick={() =>
                  runSceneContextMenuAction(() =>
                    pasteFrameIntoExisting(frame.id),
                  )
                }
                type="button"
              >
                貼り付け（上書き）
              </button>
            </div>
          );
        })()}
      {contextMenu && (
        <div
          className="stage-context-menu"
          ref={contextMenuRef}
          style={{
            left: contextMenuPosition?.left ?? contextMenu.clientX,
            top: contextMenuPosition?.top ?? contextMenu.clientY,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          {contextMenu.target.type === "member" && (
            <>
              <strong>
                {project.members.find(
                  (member) =>
                    member.id ===
                    (contextMenu.target as { type: "member"; id: string }).id,
                )
                  ?.name ?? "メンバー"}
              </strong>
              <button
                onClick={() =>
                  runContextMenuAction(() =>
                    copyMemberToClipboard(
                      contextMenu.target.type === "member"
                        ? contextMenu.target.id
                        : undefined,
                    ),
                  )
                }
                type="button"
              >
                コピー
              </button>
              <button onClick={() => runContextMenuAction(hideContextTarget)} type="button">
                隊列外へ
              </button>
              <button
                onClick={() => {
                  if (contextMenu.target.type === "member") {
                    openMemberColorEditor(contextMenu.target.id);
                  }
                }}
                type="button"
              >
                色を変える
              </button>
              <button
                className="danger"
                onClick={() =>
                  runContextMenuAction(() => {
                    if (contextMenu.target.type === "member") {
                      void confirmAndDeleteMember(contextMenu.target.id);
                    }
                  })
                }
                type="button"
              >
                削除
              </button>
            </>
          )}
          {contextMenu.target.type === "object" && (
            <>
              <strong>
                {project.stageObjects.find(
                  (object) =>
                    object.id ===
                    (contextMenu.target as { type: "object"; id: string }).id,
                )?.name ?? "道具"}
              </strong>
              <button
                onClick={() =>
                  runContextMenuAction(() =>
                    copyObjectToClipboard(
                      contextMenu.target.type === "object"
                        ? contextMenu.target.id
                        : undefined,
                    ),
                  )
                }
                type="button"
              >
                コピー
              </button>
              <button onClick={() => runContextMenuAction(hideContextTarget)} type="button">
                {project.mode === "parade" ? "隊列から外す" : "ステージから外す"}
              </button>
              <button
                onClick={() =>
                  runContextMenuAction(() => {
                    if (contextMenu.target.type === "object") {
                      nudgeObjectZ(contextMenu.target.id, 10);
                    }
                  })
                }
                type="button"
              >
                前面へ
              </button>
              <button
                onClick={() =>
                  runContextMenuAction(() => {
                    if (contextMenu.target.type === "object") {
                      nudgeObjectZ(contextMenu.target.id, -10);
                    }
                  })
                }
                type="button"
              >
                背面へ
              </button>
              <button
                className="danger"
                onClick={() =>
                  runContextMenuAction(() => {
                    if (contextMenu.target.type === "object") {
                      void confirmAndDeleteObject(contextMenu.target.id);
                    }
                  })
                }
                type="button"
              >
                削除
              </button>
            </>
          )}
          {contextMenu.target.type === "stage" && (
            <>
              <strong>{project.mode === "parade" ? "パレード" : "ステージ"}</strong>
              <button
                onClick={() => runContextMenuAction(pasteClipboard)}
                disabled={!clipboard}
                type="button"
              >
                貼り付け
              </button>
              <button
                onClick={() =>
                  runContextMenuAction(() =>
                    addMember({ position: contextMenu.stagePosition }),
                  )
                }
                type="button"
              >
                メンバー追加
              </button>
              <button
                onClick={() =>
                  runContextMenuAction(() =>
                    addObjectAtContextPosition(defaultStageObjectDraft),
                  )
                }
                type="button"
              >
                道具追加
              </button>
              <button
                onClick={() =>
                  runContextMenuAction(() => addObjectAtContextPosition(curtainDraft))
                }
                type="button"
              >
                幕追加
              </button>
              <button
                onClick={() =>
                  runContextMenuAction(() => addObjectAtContextPosition(markDraft))
                }
                type="button"
              >
                マーク追加
              </button>
            </>
          )}
        </div>
      )}
      {memberColorEditor &&
        (() => {
          const member = project.members.find(
            (item) => item.id === memberColorEditor.memberId,
          );
          if (!member) {
            return null;
          }
          const memberColorOptions = MEMBER_COLOR_PRESETS.some(
            (preset) =>
              preset.value.toLowerCase() === memberColorEditor.color.toLowerCase(),
          )
            ? MEMBER_COLOR_PRESETS
            : [
                { label: "現在の色", value: memberColorEditor.color },
                ...MEMBER_COLOR_PRESETS,
              ];
          return (
            <div
              className="stage-context-menu member-color-popover"
              style={{
                left:
                  memberColorEditorPosition?.left ?? memberColorEditor.clientX,
                top: memberColorEditorPosition?.top ?? memberColorEditor.clientY,
              }}
              ref={memberColorEditorRef}
              onPointerDown={(event) => event.stopPropagation()}
              role="dialog"
              aria-label={`${member.name} の色を変える`}
            >
              <strong>色を変える</strong>
              <div className="member-color-popover__target">{member.name}</div>
              <div className="member-color-popover__section">
                <span className="member-color-popover__label">色</span>
                <div className="member-color-presets">
                  {memberColorOptions.map((preset) => (
                    <button
                      aria-label={preset.label}
                      className={
                        memberColorEditor.color === preset.value
                          ? "member-color-swatch is-selected"
                          : "member-color-swatch"
                      }
                      key={preset.value}
                      onClick={() =>
                        setMemberColorEditor((previous) =>
                          previous
                            ? { ...previous, color: preset.value }
                            : previous,
                        )
                      }
                      style={{ backgroundColor: preset.value }}
                      title={preset.label}
                      type="button"
                    />
                  ))}
                </div>
              </div>
              <fieldset className="member-color-popover__section">
                <legend>適用範囲</legend>
                <label className="inline-radio">
                  <input
                    checked={memberColorEditor.scope === "scene"}
                    name="member-color-scope"
                    onChange={() =>
                      setMemberColorEditor((previous) =>
                        previous ? { ...previous, scope: "scene" } : previous,
                      )
                    }
                    type="radio"
                  />
                  このシーンだけ
                </label>
                <label className="inline-radio">
                  <input
                    checked={memberColorEditor.scope === "following"}
                    name="member-color-scope"
                    onChange={() =>
                      setMemberColorEditor((previous) =>
                        previous
                          ? { ...previous, scope: "following" }
                          : previous,
                      )
                    }
                    type="radio"
                  />
                  このシーン以降も
                </label>
              </fieldset>
              <div className="member-color-popover__actions">
                <button
                  className="mini-button primary"
                  onClick={() =>
                    applyMemberColorOverride(
                      memberColorEditor.memberId,
                      memberColorEditor.color,
                      memberColorEditor.scope,
                    )
                  }
                  type="button"
                >
                  適用
                </button>
                <button
                  className="mini-button"
                  onClick={() =>
                    clearMemberColorOverride(
                      memberColorEditor.memberId,
                      memberColorEditor.scope,
                    )
                  }
                  type="button"
                >
                  色変更を解除
                </button>
              </div>
            </div>
          );
        })()}
    </div>
    {completedExport && <Suspense fallback={<div role="status">書き出し完了画面を準備中…</div>}><ExportCompletionDialog result={completedExport} onClose={() => setCompletedExport(null)} onCopyImage={canCopyExport ? copyImageToClipboard : undefined} /></Suspense>}
    {isShareExportOpen && <Suspense fallback={<div role="status">共有画面を読み込み中…</div>}><ShareExportModal
      isOpen={isShareExportOpen}
      projectTitle={project.title}
      currentSceneLabel={displayFrame?.label ?? selectedFrame?.label ?? "現在シーン"}
      hasAudio={Boolean(project.audio?.id)}
      onClose={() => setIsShareExportOpen(false)}
      onExport={handleShareExport}
      onExportZip={handleShareExportZip}
      getMobileExportSource={() => structuredClone({
        project, projectTitle: project.title, members: project.members, memberGroups: project.memberGroups ?? [],
        objects: project.stageObjects, objectGroups: project.objectGroups ?? [], frames: project.frames,
        currentFrame: selectedFrame ?? null, objectStates: selectedFrame?.objectStates ?? {},
      })}
    /></Suspense>}
    {APP_FEATURES.collaboration && activeCloudProject?.role === "owner" && isCloudShareOpen && (
      <Suspense fallback={<div role="status">共有画面を読み込み中…</div>}>
      <CloudShareModal
        contacts={cloudContacts}
        currentUserId={cloudSession?.user.id}
        items={cloudCollaborationItems}
        isBusy={isCloudBusy}
        onAddContactByEmail={addCloudContactByEmail}
        onAddContactToProject={addCloudContactToProject}
        onAddMemberToContacts={addCloudMemberToContacts}
        onClose={() => setIsCloudShareOpen(false)}
        onCreateInvite={createCloudProjectInvite}
        onRefresh={refreshCloudShareData}
        onRemoveMember={removeCloudProjectMember}
        onRevokeInvite={revokeCloudProjectInvite}
        onUpdateRole={updateCloudProjectMemberRole}
        projectTitle={project.title}
      />
      </Suspense>
    )}
    {APP_FEATURES.collaboration && isCloudHelpOpen && (
      <Suspense fallback={<div role="status">使い方を読み込み中…</div>}>
      <CloudCollaborationHelpModal onClose={() => setIsCloudHelpOpen(false)} />
      </Suspense>
    )}
    {exportProgress && (
      <div className="export-progress-backdrop" role="presentation">
        <section
          className="export-progress-card"
          role="status"
          aria-live="polite"
          aria-label={exportProgress.title}
        >
          <div className="export-progress-card__bar" />
          <h2>{exportProgress.title}</h2>
          {exportProgress.detail && <p>{exportProgress.detail}</p>}
        </section>
      </div>
    )}
    {isSearchDialogOpen && (
      <div
        className="app-confirm-backdrop"
        onPointerDown={() => setIsSearchDialogOpen(false)}
        role="presentation"
      >
        <form
          className="app-search-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="検索"
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            const keyword = searchQuery.trim();
            setIsSearchDialogOpen(false);
            executeProjectSearch(keyword);
          }}
        >
          <h2>検索</h2>
          <label>
            メンバー・道具・シーン名
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="検索する名前を入力"
            />
          </label>
          <div className="app-confirm-dialog__actions">
            <button
              className="secondary"
              onClick={() => setIsSearchDialogOpen(false)}
              type="button"
            >
              キャンセル
            </button>
            <button className="primary" type="submit">
              検索
            </button>
          </div>
        </form>
      </div>
    )}
    {appConfirm && (
      <div
        className="app-confirm-backdrop"
        onPointerDown={() => closeAppConfirm(false)}
        role="presentation"
      >
        <section
          className={
            appConfirm.tone === "danger"
              ? "app-confirm-dialog app-confirm-dialog--danger"
              : "app-confirm-dialog"
          }
          role="dialog"
          aria-modal="true"
          aria-label={appConfirm.title}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <h2>{appConfirm.title}</h2>
          <p>{appConfirm.message}</p>
          <div className="app-confirm-dialog__actions">
            <button
              className="secondary"
              onClick={() => closeAppConfirm(false)}
              type="button"
            >
              {appConfirm.cancelLabel ?? "キャンセル"}
            </button>
            <button
              className={
                appConfirm.tone === "danger" ? "danger" : "primary"
              }
              onClick={() => closeAppConfirm(true)}
              type="button"
            >
              {appConfirm.confirmLabel ?? "続行"}
            </button>
          </div>
        </section>
      </div>
    )}
    {isRosterManagerOpen && <Suspense fallback={<div className="roster-loading" role="status">名簿を読み込み中…</div>}>
    <RosterManagementModal
      canUndo={(!activeCloudProject || !APP_FEATURES.collaboration) && historyCounts.undo > 0}
      onUndo={undoProject}
      frames={project.frames}
      currentFrame={selectedFrame ?? null}
      objectStates={selectedFrameSnapshot.objectStates}
      previousFrame={selectedPreviousFrame}
      previousObjectStates={selectedPreviousFrameSnapshot?.objectStates ?? {}}
      canEditAssignments={canEditCurrentScene && (!activeCloudProject || !APP_FEATURES.collaboration)}
      readOnlyMessage={activeCloudProject && APP_FEATURES.collaboration
        ? "共同編集中の割当は隊列表の「割当」タブで行ってください。"
        : cloudReadOnlyMessage ?? "このシーンは閲覧のみです。"}
      onAssignMember={(objectId, memberId) => {
        if (!canEditCurrentScene || (activeCloudProjectRef.current && APP_FEATURES.collaboration)) return false;
        return assignMemberToObject(objectId, memberId);
      }}
      onRemoveAssignment={(objectId, memberId, restoreMember) => {
        if (!canEditCurrentScene || (activeCloudProjectRef.current && APP_FEATURES.collaboration)) return false;
        return removeObjectAssignment(objectId, memberId, restoreMember);
      }}
      onApplyPreviousAssignments={() => {
        if (!canEditCurrentScene || (activeCloudProjectRef.current && APP_FEATURES.collaboration)) return false;
        return applyPreviousAssignmentsToCurrentFrame();
      }}
      onSelectFrame={(id) => {
        const frame = project.frames.find((item) => item.id === id);
        if (!frame) return;
        setSelectedFrameId(frame.id);
        seek(frame.timeSec);
      }}
      projectTitle={project.title}
      onNotice={setNotice}
      initialMode={rosterInitialMode}
      isOpen={
        isRosterManagerOpen &&
        (!activeCloudProject ||
          !APP_FEATURES.collaboration ||
          activeCloudProject.activeProjectLock?.lockKey === "members" ||
          activeCloudProject.activeProjectLock?.lockKey === "objects")
      }
      allowedModes={
        activeCloudProject && APP_FEATURES.collaboration
          ? activeCloudProject.activeProjectLock?.lockKey === "members"
            ? ["members"]
            : activeCloudProject.activeProjectLock?.lockKey === "objects"
              ? ["objects"]
              : []
          : undefined
      }
      members={project.members}
      memberGroups={project.memberGroups ?? []}
      objects={project.stageObjects}
      objectGroups={project.objectGroups ?? []}
      onClose={() => setIsRosterManagerOpen(false)}
      onRenameMember={(memberId, name) => updateMember(memberId, { name })}
      onRenameObject={(objectId, name) => updateObject(objectId, { name })}
      onAddMember={addRosterMember}
      onAddObject={addRosterObject}
      onQuickAddMember={(groupId) => addRosterMember(groupId)}
      onQuickAddObject={(groupId) => addRosterObject(groupId)}
      onCreateMemberGroup={createRosterMemberGroup}
      onCreateObjectGroup={createRosterObjectGroup}
      onRenameMemberGroup={(groupId, name) => updateGroup(groupId, { name })}
      onRenameObjectGroup={(groupId, name) =>
        updateObjectGroup(groupId, { name })
      }
      onDeleteMember={deleteRosterMember}
      onDeleteObject={deleteRosterObject}
      onDeleteMemberGroup={deleteRosterMemberGroup}
      onDeleteObjectGroup={deleteRosterObjectGroup}
      onUpdateMemberGroupColor={(groupId, color) =>
        updateGroup(groupId, { color })
      }
      onUpdateObjectGroupColor={(groupId, color) =>
        updateObjectGroup(groupId, { color })
      }
    />
    </Suspense>}
    {isPrintPreviewMounted && (
      <PrintPreview
        project={project}
        scope={printScope}
        selectedFrameId={displayFrame?.id ?? selectedFrame?.id ?? null}
        options={printOptions ?? undefined}
        rootRef={printExportRef}
        variant={printVariant}
      />
    )}
    </>
  );
}

export default App;
