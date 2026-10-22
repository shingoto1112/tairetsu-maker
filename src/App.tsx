import { getEffectiveStageSize } from "./utils/effectiveStageSize";
import { getKeyboardNudgeDelta } from "./utils/keyboardNudge";
import { moveMembersRelative } from "./utils/memberRelativeMove";
import { nextSceneLabel } from "./project/nextSceneLabel";
import { alignedObjectPosition, constrainObjectMovePatch } from "./utils/objectMovement";
import { rotatedObjectBounds } from "./utils/formationExportLayout";
import { isObjectOutsideStage } from "./utils/objectGeometry";
import { CameraExportDialog } from "./components/CameraExportDialog";
import { paradeDistanceError } from "./project/paradeLimits";
import { autoSaveDelay } from "./utils/autoSaveSchedule";
import { copyAnnotationLines } from "./utils/annotationLines";
import { validAnnotationLines, validProjectLineCount } from "./project/annotationLines";
import { horizontalGridOriginMeters, snapHorizontalPositionInBounds } from "./utils/horizontalGrid";
import { snapPastedMemberPosition, snapPastedObjectPosition } from "./utils/placementGrid";
import { useSharedSession } from "./hooks/useSharedSession";
import { useModalFocus } from "./hooks/useModalFocus";
import { useHelpPage } from "./components/HelpPageLoader";
import { cloudAuthIdentity, subscribeCloudAuth, getValidCloudAuthSession, waitCloudAuthPersistence } from "./cloud/session";
import { useAppShellScrollGuard } from "./hooks/useAppShellScrollGuard";
import { scrollWithinContainer } from "./utils/scrollWithinContainer";
import type { AudioSelection } from "./platform/audioStorage";
import { normalizeProject } from "./project/normalizeProject";
import { prepareIndependentProjectCopy, sharingContentKey } from "./project/independentCopy";
import type { SharingOperation } from "./collaboration/uiTypes";
import { createEmptyFormationProject } from "./project/createEmptyFormationProject";
import { validateProjectStructure } from "./project/codec";
import { copyRosterToNewProject } from "./project/rosterCopy";
import { setMembersFrameVisibility as applyMembersFrameVisibility } from "./project/memberVisibility";
import { MEMBER_PLACEMENT_OVERLAP_NOTICE, placeNewMembers } from "./utils/memberPlacement";
import { validateParadeA4Export } from "./utils/paradeA4Limits";
import { applyObjectAppearance, objectDraftForGroup, changeObjectMembership, type ObjectAppearancePatch } from "./project/objectAppearance";
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
  useSyncExternalStore,
} from "react";
import { createVisibilityMemory } from "./utils/sceneVisibility";
import { selectionScrollBounds } from "./utils/selectionScrollBounds";
import { useWorkspaceLayout } from "./hooks/useWorkspaceLayout";
import { useNotice, type NoticeKind } from "./hooks/useNotice";
import { useCollaborationUi } from "./hooks/useCollaborationUi";
import { useCollaborationLibrary } from "./hooks/useCollaborationLibrary";
import { libraryAccountButton, toCloudLibraryCards } from "./collaboration/libraryCards";
import { ProjectCardPreview, type ProjectCardPreviewSource } from "./components/ProjectCardPreview";
import { useAudioWaveform } from "./hooks/useAudioWaveform";
const CollaborationSurface = lazy(() => import("./components/CollaborationSurface"));
const LegacyRescuePanel = lazy(() => import("./components/LegacyRescuePanel"));
const CollaborationBadge = lazy(() => import("./components/CollaborationSurface").then(module => ({ default: module.CollaborationBadge })));
const CollaborationStatus = lazy(() => import("./components/CollaborationSurface").then(module => ({ default: module.CollaborationStatus })));
const RemoteInteractionLayer = lazy(() => import('./components/RemoteInteractionLayer'));
const PresenceIcons = lazy(() => import('./components/RemoteInteractionLayer').then(module => ({ default: module.PresenceIcons })));
const ScenePresence = lazy(() => import('./components/RemoteInteractionLayer').then(module => ({ default: module.ScenePresence })));
import { App as CapacitorApp } from "@capacitor/app";

const AssignmentPanel = lazy(() => import("./components/AssignmentPanel").then(module => ({ default: module.AssignmentPanel })));
const AudioPanel = lazy(() => import("./components/AudioPanel").then(module => ({ default: module.AudioPanel })));

const CloudPasswordModal = lazy(() => import("./components/CloudPasswordModal").then(module => ({ default: module.CloudPasswordModal })));

import { SelectedPositionCard } from "./components/SelectedPositionCard";
import { ExportImportPanel } from "./components/ExportImportPanel";
import { FormationLibrary, type NewFormationInput } from "./components/FormationLibrary";
import { GroupToolsPanel } from "./components/GroupToolsPanel";
import { MemberPanel } from "./components/MemberPanel";
const ObjectPanel = lazy(() => import("./components/ObjectPanel").then(module => ({ default: module.ObjectPanel })));
import { PanelTabId, PanelTabs } from "./components/PanelTabs";
import { getPrintOrientation, PrintPreview } from "./components/PrintPreview";
import { nextNumberedName } from "./utils/numberedName";
import { nextRosterItemName } from "./utils/rosterColumns";
import { confirmAssignmentUpdate } from "./utils/assignmentUpdate";
import { isModalOpen } from "./utils/modal";
import { formatExportTimestamp, withFileExtension } from "./utils/exportFileName";
const ExportCompletionDialog = lazy(() => import("./components/ExportCompletionPanel").then((module) => ({ default: module.ExportCompletionDialog })));
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
const StageSettingsPanel = lazy(() => import("./components/StageSettingsPanel").then(module => ({ default: module.StageSettingsPanel })));
const Timeline = lazy(() => import("./components/Timeline").then(module => ({ default: module.Timeline })));
import { Toolbar } from "./components/Toolbar";
import { createCloudAuthClient, getCloudAuthErrorMessage, type CloudAuthSession } from "./cloud/auth";
import { getAppFeatureFlags } from "./platform/runtime";
import { getCloudConfig } from "./cloud/config";
import { hydrateCloudAuthSessionFromNativeStorage, readCloudAuthSession, saveCloudAuthSession } from "./cloud/session";

import { AnimationSettings, AlignmentAction, AudioMeta, EditingMode, FormationTemplate, FormationFrame, Member, MemberCreateInput, MemberGroup, MovementPathMode, MovementPlan, MovementPathType, MovementTargetType, ObjectGroup, ObjectState, ParadeSettings, Position, Project, SceneElementEditTarget, SceneViewState, Selection, StageObject, StageObjectDraft, StageContextMenuRequest, StageSnapshot, ViewerPerspective } from "./types";
import {
  constrainMemberPosition,
  constrainObjectPosition,
  getObjectCenter,
  objectTopLeftFromCenter,
  roundMeters,
} from "./utils/coordinates";
import {
  elementToPngBlob,
} from "./utils/exportImage";
import type { CompletedExport } from "./utils/mobileExportTypes";
import {
  loadAudioBlobFromIndexedDb,
  resolveAudioPlaybackURL,
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
  resolveMovementPlan,
  sortFrames,
} from "./utils/interpolation";
import { copyParadeGroupState } from "./utils/paradeGroupReflection";
import { getMemberDisplayColor } from "./utils/memberAppearance";
import {
  getSafeParadeBackwardDistance,
  getSafeParadeCanvasDistance,
  PARADE_MAX_ZOOM,
} from "./utils/parade";
import { readProjectFromHash } from "./utils/share";
import { compareRevisions, incrementRevision, RepositoryError, REPOSITORY_ERROR_MESSAGES, type CommitRequest, type ProjectRepository, type ProjectRecord, type ProjectSummary } from "./repositories/types";
import { SaveCoordinator, repositoryError, canLeaveWithoutSaving, type SaveState } from "./storage/saveCoordinator";
import type { MaintenanceRepository } from "./storage/maintenanceTypes";
import { protectAudioEditor } from "./storage/maintenanceLock";
const StorageTools = lazy(() => import("./components/StorageTools").then(module => ({ default: module.StorageTools })));
const StorageRecoveryScreen = lazy(() => import("./components/StorageTools").then(module => ({ default: module.StorageRecoveryScreen })));
import { getRequiredProject, listAllSummaries, prepareAppRepository, readOpenedProject } from "./storage/appRepository";
import type { SharedProjectEditor } from "./collaboration/editorSession";
import {
  createTairetsuArchive,
  createTairetsuFileName,
  readTairetsuArchive,
} from "./utils/tairetsuFile";

type InitialLoad = {
  project: Project;
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
  annotationLines: copyAnnotationLines(frame.annotationLines),
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
    annotationLines: clonedSource.annotationLines,
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
  shape: "rectangle",
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
  projects: Pick<ProjectSummary, "title">[],
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
    ...project.paradeSettings,
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

const readInitialProject = (): InitialLoad => {
  // In-memory view scaffold only; no sample or legacy reads/writes before bootstrap.
  return {
    project: createEmptyFormationProject("", { formationMode: "stage", widthMeters: 12, heightMeters: 8,
      useGlobalStageSize: true, gridSizeMeters: 0.25, horizontalGuideMode: "meters", memberDiameterMeters: 0.5 }, null),
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
    widthMeters: Math.max(0.01, patch.widthMeters ?? current.widthMeters),
    heightMeters: Math.max(0.01, patch.heightMeters ?? current.heightMeters),
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

function App() {
  const { openHelpPage, helpPage } = useHelpPage();
  useAppShellScrollGuard();
  const sharedSession = useSharedSession();
  const collaborationUi = useCollaborationUi();
  const workspaceLayout = useWorkspaceLayout();
  const initial = useMemo(readInitialProject, []);
  const [project, setProjectState] = useState<Project>(initial.project);
  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageCorrupt, setStorageCorrupt] = useState(false);
  const [storageRetry, setStorageRetry] = useState(0);
  const [damagedProjectId, setDamagedProjectId] = useState<string | null>(null);
  const [storageStatus, setStorageStatus] = useState<string | null>("隊列表を準備しています…");
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [localSaveState, setLocalSaveState] = useState<SaveState | null>(null);
  const repositoryRef = useRef<ProjectRepository | null>(null);
  const storagePreparationRef = useRef<Promise<boolean> | null>(null);
  const audioEditorProtectionRef = useRef<Promise<() => void> | null>(null);
  const saveCoordinatorRef = useRef<SaveCoordinator | null>(null);
  const editorLoadGenerationRef = useRef(0);
  const cloudSavePendingRef = useRef(false);
  const sharingPreparationRef = useRef<string | null>(null);
  const [cloudSaveBusy, setCloudSaveBusy] = useState(false);
  const [positionFocusRequest, setPositionFocusRequest] = useState(0);
  const libraryLoadGenerationRef = useRef(0);
  const [appView, setAppView] = useState<"library" | "editor">(
    initial.shared ? "editor" : "library",
  );
  useEffect(() => {
    if (appView === "library") {
      const protection = audioEditorProtectionRef.current; audioEditorProtectionRef.current = null;
      void protection?.then(release => release());
    }
  }, [appView]);
  useEffect(() => () => { void audioEditorProtectionRef.current?.then(release => release()); audioEditorProtectionRef.current = null; }, []);
  // Home header and cloud-only cards follow the lazy collaboration service (same dynamic boundary as CollaborationSurface).
  const collaborationLibrary = useCollaborationLibrary(collaborationUi, APP_FEATURES.collaborationV2 && storageReady && appView === "library");
  const [storageMenuRequest, setStorageMenuRequest] = useState(0);
  const [legacyMenuRequest, setLegacyMenuRequest] = useState(0);
  // One stable source per repository so every home card shares the read queue and the small preview cache.
  const projectPreviewSource = useMemo<ProjectCardPreviewSource | null>(() => {
    const repository = storageReady ? repositoryRef.current : null;
    return repository ? { get: (id: string) => repository.get(id), concurrency: APP_FEATURES.nativeFileShare ? 1 : 2 } : null;
  }, [storageReady]);
  // View-only stage navigation never enters Project or cloud scene writes.
  const stageViewMemoryRef = useRef({ projectId: project.id, appView, views: new Map<string, SceneViewState>() });
  if (stageViewMemoryRef.current.projectId !== project.id || stageViewMemoryRef.current.appView !== appView) {
    stageViewMemoryRef.current = { projectId: project.id, appView, views: new Map() };
  }
  const stageViewStates = stageViewMemoryRef.current.views;
  const cloudConfig = useMemo(() => {
    if (!APP_FEATURES.collaborationV2) return null;
    if (import.meta.env.DEV) {
      const mock = (window as Window & { __sharedSessionMock?: { url: string; anonKey: string } }).__sharedSessionMock;
      if (mock && new URL(mock.url).hostname === "127.0.0.1" && new URL(mock.url).protocol === "http:") return mock;
    }
    return getCloudConfig();
  }, []);
  const [authRestoring, setAuthRestoring] = useState(cloudAuthIdentity().status === "restoring");
  useEffect(() => subscribeCloudAuth(() => {
    setAuthRestoring(cloudAuthIdentity().status === "restoring");
    const session = readCloudAuthSession(); cloudSessionRef.current = session; setCloudSession(session);
  }), []);
  const [cloudSession, setCloudSession] = useState<CloudAuthSession | null>(
    () => readCloudAuthSession(),
  );

  const [isCloudBusy, setIsCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [isCloudPasswordRecoveryOpen, setIsCloudPasswordRecoveryOpen] =
    useState(false);

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
  const [isCameraExportOpen, setIsCameraExportOpen] = useState(false);
  const [completedExport, setCompletedExport] = useState<CompletedExport | null>(null);
  const [canCopyExport, setCanCopyExport] = useState(false);
  const exportGenerationPending = useRef(false);
  const a4PdfAbortController = useRef<AbortController | null>(null);
  const [isRosterManagerOpen, setIsRosterManagerOpen] = useState(false);
  const [rosterInitialMode, setRosterInitialMode] = useState<
    "members" | "objects" | undefined
  >();
  const [appConfirm, setAppConfirm] = useState<AppConfirmOptions | null>(null);
  const [exportProgress, setExportProgress] =
    useState<ExportProgressState | null>(null);

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
  const audioScrubContext = useRef({ audioUrl, activePanelTab, generation: 0 });
  if (audioScrubContext.current.audioUrl !== audioUrl || audioScrubContext.current.activePanelTab !== activePanelTab) {
    audioScrubContext.current = { audioUrl, activePanelTab, generation: audioScrubContext.current.generation + 1 };
  }
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
  useEffect(() => {
    if (appView !== "library") return;
    setIsMemberSelectionMode(false);
    setSelectedMemberIds((previous) => previous.length ? [] : previous);
    setSelected(null);
    setContextMenu(null);
    setContextMenuPosition(null);
    setSceneContextMenu(null);
    setSceneContextMenuPosition(null);
    setMemberColorEditor(null);
    setMemberColorEditorPosition(null);
  }, [appView]);

  const undoStackRef = useRef<HistoryEntry[]>([]);
  const sharedEditorRef = useRef<SharedProjectEditor | null>(null);
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

  const appConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const appConfirmDialogRef = useRef<HTMLElement>(null);
  const handleAppConfirmTab = useModalFocus(appConfirmDialogRef, Boolean(appConfirm));

  const stageFullscreenRef = useRef<HTMLDivElement | null>(null);
  const animationPreviewRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const sceneContextMenuRef = useRef<HTMLDivElement | null>(null);
  const memberColorEditorRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const firstUnsavedEditAtRef = useRef<number | null>(null);
  const pendingAutoSaveProjectRef = useRef<Project | null>(null);

  const cloudSessionRef = useRef<CloudAuthSession | null>(cloudSession);

  const isDirtyRef = useRef(isDirty);
  const selectedFrameIdRef = useRef<string | null>(selectedFrameId);
  // Async legacy save/import callbacks must never install a captured snapshot
  // over a shared editor. Only its freshly published projections are accepted.
  const setProject = useCallback((next: Project) => {
    const editor = sharedEditorRef.current;
    if (editor && !editor.acceptsProjection(next)) {
      const projection = editor.project; projectRef.current = projection; setProjectState(projection); return;
    }
    setProjectState(next);
  }, []);

  useEffect(() => {
    document.title =
      appView === "editor" && project.title
        ? `${project.title} - ${APP_NAME}`
        : APP_NAME;
  }, [appView, project.title]);

  const refreshLocalLibrary = useCallback(async () => {
    const repository = repositoryRef.current;
    if (!repository) return;
    const generation = ++libraryLoadGenerationRef.current;
    const summaries = await listAllSummaries(repository);
    if (generation === libraryLoadGenerationRef.current) setSavedProjects(summaries);
  }, []);

  const markLocalEdit = useCallback((next: Project) => {
    if (sharedEditorRef.current) { sharedEditorRef.current.setLocal(next); return; }
    saveCoordinatorRef.current?.edit(next);
  }, []);

  const updateLibrarySummary = (summary: ProjectSummary) => {
    ++libraryLoadGenerationRef.current;
    setSavedProjects(previous => previous.some(s => s.id === summary.id)
      ? previous.map(s => s.id === summary.id && compareRevisions(summary.repositoryRevision, s.repositoryRevision) >= 0 ? summary : s)
      : [...previous, summary]);
  };
  const observeSave = (state: SaveState | null) => {
    setLocalSaveState(state);
    if (state) { isDirtyRef.current = state.dirty; setIsDirty(state.dirty); setIsSaving(state.saving); }
    else setIsSaving(false);
  };
  const createLocalCoordinator = (repository: ProjectRepository) => {
    const coordinator = new SaveCoordinator(repository, state => {
      if (saveCoordinatorRef.current === coordinator) observeSave(state);
    }, updateLibrarySummary);
    return coordinator;
  };
  const closeSharedSession = async (background = true) => {
    if (!sharedSession.active) return true;
    if (!await sharedSession.close(background)) return false;
    sharedEditorRef.current = null;
    setAppView("library");
    if (repositoryRef.current) saveCoordinatorRef.current = createLocalCoordinator(repositoryRef.current);
    return true;
  };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const target = window as Window & { __sharedSession?: unknown };
    target.__sharedSession = sharedSession;
    return () => { delete target.__sharedSession; };
  }, [sharedSession]);

  useEffect(() => {
    let cancelled = false;
    let repository: ProjectRepository | null = null;
    const preparation = (async () => {
      try {
        const prepared = await prepareAppRepository(progress => {
          if (!cancelled && progress.total) setStorageStatus(`隊列表を新しい保存方式へ移行しています（${progress.completed}／${progress.total}件）`);
        });
        repository = prepared.repository;
        if (cancelled) { if ("close" in repository) (repository as ProjectRepository & { close(): void }).close(); return false; }
        repositoryRef.current = repository;
        const failures = prepared.result.failures.map(f => f.code === "INTERRUPTED" ? "移行を中断しました。次回起動時に再開します。" : REPOSITORY_ERROR_MESSAGES[f.code]);
        if (failures.length) setStorageWarning([...new Set(failures)].join(" "));
        if (!prepared.result.canContinue) { setStorageCorrupt(prepared.result.failures.some(f => f.code === "CORRUPT")); setStorageStatus(null); return false; }
        saveCoordinatorRef.current = createLocalCoordinator(repository);
        await refreshLocalLibrary();
        if (cancelled) return false;
        setStorageReady(true); setStorageStatus(null);
        return true;
      } catch (error) { if (!cancelled) { setStorageCorrupt(repositoryError(error).code === "CORRUPT"); setStorageWarning(repositoryError(error).message); setStorageStatus(null); } return false; }
    })();
    storagePreparationRef.current = preparation;
    void preparation.then(async ready => {
      if (ready && !cancelled) {
        try {
          const shared = readProjectFromHash();
          if (shared) {
            await openProjectInEditor(normalizeProject(shared), undefined, { persistLocal: false });
            if (!cancelled) { setIsSharedProject(true); setSharedAudioNotice(true); }
          }
        } catch (error) { setNotice(error instanceof Error ? error.message : "共有データを読み込めませんでした。"); }
      }
    });
    return () => {
      cancelled = true; ++editorLoadGenerationRef.current;
      const closingShared = sharedSession.shutdown(); sharedEditorRef.current = null;
      const close = () => { if (repository && "close" in repository) (repository as ProjectRepository & { close(): void }).close(); };
      void closingShared.then(() => saveCoordinatorRef.current?.flush()).finally(close)
        .catch(() => console.warn("終了時の保存処理を完了できませんでした。"));
    };
  }, [refreshLocalLibrary, storageRetry]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    cloudSessionRef.current = cloudSession;
  }, [cloudSession]);

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
        if (previous?.startsWith("blob:") && previous !== url) {
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
      if (sharedSession.active?.attached && !sharedSession.active.audioMatches(meta)) {
        setAudioSource(null, meta?.name ?? null); setSharedAudioNotice(true);
        setNotice("この隊列表の曲がこの端末の曲と一致しません。音源タブで選び直してください。"); return false;
      }
      if (!meta?.id) {
        setAudioSource(null, null);
        setSharedAudioNotice(false);
        return true;
      }
      // Storage distinguishes absence from failure. Keep the existing recovery
      // notice at this UI boundary until the audio error UI is redesigned.
      const generation = editorLoadGenerationRef.current;
      const url = await resolveAudioPlaybackURL(meta).catch(() => null);
      if (generation !== editorLoadGenerationRef.current || projectRef.current.id !== targetProject.id || projectRef.current.audio?.id !== meta.id) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        return false;
      }
      if (sharedSession.active?.attached && !sharedSession.active.audioMatches(meta)) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        setAudioSource(null, meta.name); setSharedAudioNotice(true); return false;
      }
      if (!url) {
        setAudioSource(null, meta.name);
        setSharedAudioNotice(true);
        setNotice("保存済み音源が見つかりませんでした。必要なら音源を読み込み直してください。");
        return false;
      }
      setAudioSource(url, meta.name);
      setSharedAudioNotice(false);
      return true;
    },
    [setAudioSource, setNotice],
  );

  const refreshHistoryCounts = useCallback(() => {
    if (sharedEditorRef.current) {
      setHistoryCounts({ undo: sharedEditorRef.current.commands.canUndo ? 1 : 0, redo: sharedEditorRef.current.commands.canRedo ? 1 : 0 });
      return;
    }
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

  const updateProject = useCallback(
    (
      recipe: (previous: Project) => Project,
      label?: string,
      options: { coalesceHistory?: boolean; checkSharedUpdateSize?: boolean } = {},
    ) => {
      if (sharedEditorRef.current) {
        sharedEditorRef.current.edit(previous => {
          const next = recipe(previous);
          if (!validProjectLineCount(next.frames) || next.frames.some(f => !validAnnotationLines(f.annotationLines))) { setNotice("線は1シーン100本、隊列表全体5,000本までです。"); return previous; }
          return next;
        }, false, options.checkSharedUpdateSize);
        refreshHistoryCounts(); return;
      }
      const previous = projectRef.current;
      const nextProject = recipe(previous);
      if (!validProjectLineCount(nextProject.frames) || nextProject.frames.some(f => !validAnnotationLines(f.annotationLines))) { setNotice("線は1シーン100本、隊列表全体5,000本までです。"); return; }
      if (nextProject === previous) {
        return;
      }

      if (
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
      markLocalEdit(withUpdatedAt);
      setIsDirty(true);
      refreshHistoryCounts();
    },
    [markLocalEdit, pushUndoSnapshot, refreshHistoryCounts],
  );

  const replaceProjectWithHistory = useCallback(
    (nextProject: Project, label?: string) => {
      if (sharedEditorRef.current) { sharedEditorRef.current.replace(); }

      pushUndoSnapshot(projectRef.current, label);
      projectRef.current = nextProject;
      setProject(nextProject);
      markLocalEdit(nextProject);
      setIsDirty(true);
      refreshHistoryCounts();
    },
    [markLocalEdit, pushUndoSnapshot, refreshHistoryCounts],
  );

  const undoProject = useCallback(() => {
    if (sharedEditorRef.current) { sharedSession.active?.historyResult(sharedEditorRef.current.undo()); refreshHistoryCounts(); return; }
    const entry = undoStackRef.current[undoStackRef.current.length - 1];
    if (!entry) {
      return;
    }
    const nextProject = cloneProject(entry.project);

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
    setViewerPerspective(nextProject.viewerPerspective ?? "audience");
    markLocalEdit(nextProject);
    setIsDirty(true);
    refreshHistoryCounts();
    setNotice(entry.label ? `${entry.label}を元に戻しました。` : "元に戻しました。", "success");
  }, [markLocalEdit, refreshHistoryCounts]);

  const redoProject = useCallback(() => {
    if (sharedEditorRef.current) { sharedSession.active?.historyResult(sharedEditorRef.current.redo()); refreshHistoryCounts(); return; }
    const entry = redoStackRef.current[redoStackRef.current.length - 1];
    if (!entry) {
      return;
    }
    const nextProject = cloneProject(entry.project);

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
    setViewerPerspective(nextProject.viewerPerspective ?? "audience");
    markLocalEdit(nextProject);
    setIsDirty(true);
    refreshHistoryCounts();
    setNotice(entry.label ? `${entry.label}をやり直しました。` : "やり直しました。", "success");
  }, [markLocalEdit, refreshHistoryCounts]);

  const clearPendingAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    pendingAutoSaveProjectRef.current = null;
    firstUnsavedEditAtRef.current = null;
  }, []);
  useEffect(() => clearPendingAutoSave, [clearPendingAutoSave]);

  const flushPendingAutoSave = useCallback(async () => {
    clearPendingAutoSave();
    // The lifecycle owns this record until its reply is settled. New edits stay
    // in the live editor and are applied to its resulting session, never overwritten.
    if (sharingPreparationRef.current === saveCoordinatorRef.current?.state?.id) return !saveCoordinatorRef.current?.state?.dirty;
    try {
      if (sharedSession.active) return await sharedSession.active.flush();
      sharedEditorRef.current?.end();
      if (sharedEditorRef.current && !sharedEditorRef.current.stagePending()) return false;
      return await (saveCoordinatorRef.current?.flush() ?? Promise.resolve(true));
    } catch { setNotice("編集内容を保存できませんでした。画面の内容を確認し、保存を再試行してください。"); return false; }
  }, [clearPendingAutoSave]);

  const runTimedAutoSave = useCallback(async () => {
    autoSaveTimerRef.current = null;
    // A queued callback may race pointer-down. Keep dirty/scheduling state until pointer-up.
    if (isProjectEditBatchActiveRef.current) return;
    if (sharingPreparationRef.current === saveCoordinatorRef.current?.state?.id) return;
    pendingAutoSaveProjectRef.current = null;
    firstUnsavedEditAtRef.current = null;
    try {
      if (sharedEditorRef.current && !sharedEditorRef.current.stagePending()) return;
      // Ordinary false results already appear in the existing storage error banner.
      await saveCoordinatorRef.current?.flush();
    } catch { setNotice("自動保存に失敗しました。保存を再試行してください。"); }
  }, []);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (isProjectEditBatchActiveRef.current) return;
    firstUnsavedEditAtRef.current ??= Date.now();
    autoSaveTimerRef.current = window.setTimeout(() => void runTimedAutoSave(),
      autoSaveDelay(firstUnsavedEditAtRef.current, Date.now()));
  }, [runTimedAutoSave]);

  useEffect(() => {
    if (appView !== "editor" || isSharedProject) {
      clearPendingAutoSave();
      return;
    }
    if (!saveCoordinatorRef.current?.state?.dirty && !isProjectEditBatchActiveRef.current) return;
    pendingAutoSaveProjectRef.current = project;
    scheduleAutoSave();
  }, [appView, clearPendingAutoSave, scheduleAutoSave, isSharedProject, project]);

  useEffect(() => {
    const handlePageHide = () => {
      void flushPendingAutoSave().catch(() => setNotice("終了前の保存に失敗しました。保存を再試行してください。"));

    };
    let disposed = false;
    let removeAppStateListener: (() => Promise<void>) | null = null;
    if (APP_FEATURES.nativeFileShare) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) {
          handlePageHide();
        } else sharedSession.active?.provider?.wake();
      }).then((listener) => {
        if (disposed) {
          void listener.remove().catch(() => {});
          return;
        }
        removeAppStateListener = () => listener.remove();
      }).catch(() => setNotice("アプリの状態監視を開始できませんでした。編集後は保存ボタンで保存してください。"));
    }
    const handleVisibility = () => { if (document.visibilityState === "hidden") handlePageHide(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    return () => {
      disposed = true;
      if (removeAppStateListener) {
        void removeAppStateListener().catch(() => {});
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
    };
  }, [flushPendingAutoSave]);

  const beginProjectHistoryBatch = useCallback(
    (
      label?: string,
      target?: SceneElementEditTarget | SceneElementEditTarget[],
    ): boolean | Promise<boolean> => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (sharedEditorRef.current) {
        sharedEditorRef.current.begin(selectedFrameIdRef.current ?? undefined, target ? Array.isArray(target) ? target : [target] : []);
        isProjectEditBatchActiveRef.current = true; return true;
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
    if (sharedEditorRef.current) {
      isProjectEditBatchActiveRef.current = false; sharedEditorRef.current.end();
      refreshHistoryCounts(); return;
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
    scheduleAutoSave();
  }, [appView, scheduleAutoSave, isSharedProject, refreshHistoryCounts]);

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
      if (audioUrl?.startsWith("blob:")) {
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

  const displayFrames = useMemo(() => sortFrames(project.frames), [project.frames]);

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
    const index = displayFrames.findIndex((frame) => frame.id === selectedFrame?.id);
    return index >= 0 ? index + 1 : 0;
  }, [displayFrames, selectedFrame?.id]);

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

  // Keep pointer coordinates raw; each paste target chooses its own lattice once.
  const getPasteStagePosition = (stage: Project["stage"] = effectiveStage) =>
    lastStagePointerPositionRef.current ?? {
      x: stage.widthMeters / 2,
      y: stage.depthMeters / 2,
    };

  const handleStagePointerPositionChange = useCallback((position: Position) => {
    lastStagePointerPositionRef.current = position;
  }, []);

  const snapshot = useMemo<StageSnapshot>(() => {
    return getSnapshotForFrame(project, displayFrame?.id ?? null);
  }, [displayFrame?.id, project]);

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
                  zoom: Math.min(PARADE_MAX_ZOOM, Math.max(0.2, viewState.zoom)),
                  viewportWidth: viewState.viewportWidth,
                  viewportHeight: viewState.viewportHeight,
                },
              }
            : frame,
        ),
      };
      projectRef.current = nextProject;
      setProject(nextProject);

      markLocalEdit(nextProject);
      setIsDirty(true);
    },
    [markLocalEdit],
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
        const reflectedGroupState = !isMoveOperation && groupMemberIds
          ? copyParadeGroupState(sourceFrame, targetFrame, groupMemberIds)
          : undefined;
        const positionEntries = new Map<string, Position>(
          Object.entries(reflectedGroupState?.positions ?? sourceFrame.positions),
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
                  ...reflectedGroupState,
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
        scrollWithinContainer(element, { behavior: "smooth", block: "center" });
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
    setPositionFocusRequest(0);
    if (!selection) {
      setSelected(selection);
      setSelectedMemberIds([]);
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
    setSelectedMemberIds([]);
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
      return state && isObjectOutsideStage(state, effectiveStage);
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

    let placementOverlaps = false;
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
        frames: previous.frames.map((frame) => {
              const frameStage = {
                ...previous.stage,
                ...getEffectiveStageSize(previous, frame),
              };
              const basePosition = previous.mode === "parade" && requestedPosition
                ? snapPastedMemberPosition(requestedPosition, frameStage, createDefaultParadeSettings({
                    ...previous.paradeSettings,
                    width: frameStage.widthMeters,
                    totalDistance: previous.paradeSettings?.totalDistance ?? previous.stage.depthMeters,
                    cellSizeMeters: previous.paradeSettings?.cellSizeMeters ?? frameStage.gridSizeMeters,
                  }))
                : constrainMemberPosition(requestedPosition ?? paradeDefaultPosition ?? {
                x: frameStage.widthMeters / 2, y: frameStage.depthMeters / 2,
              }, frameStage);
              if (!(previous.mode === "parade" && requestedPosition)) basePosition.x = snapHorizontalPositionInBounds(basePosition.x,
                previous.mode === "parade" ? previous.paradeSettings?.cellSizeMeters ?? frameStage.gridSizeMeters
                  : frameStage.showGrid ? frameStage.gridSizeMeters : NaN,
                horizontalGridOriginMeters(frameStage.widthMeters, previous.mode === "parade"
                  ? previous.paradeSettings?.horizontalMeasureMode : frameStage.horizontalGuideMode), 0, frameStage.widthMeters);
              if (!requestedPosition) {
                const placement = placeNewMembers(previous, frame, 1, paradeDefaultPosition ?? undefined, viewerPerspective);
                Object.assign(basePosition, placement.positions[0]);
                placementOverlaps ||= placement.overlapCount > 0;
              }
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
      placementOverlaps ? MEMBER_PLACEMENT_OVERLAP_NOTICE : group
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

  const sharedObjectEditingActive = useSyncExternalStore(sharedSession.store.subscribe,
    () => sharedSession.store.getSnapshot().sharing === "active");
  const canEditObjectMaster = () => appView === "editor" && !canvasPlaybackRef.current &&
    (!sharedSession.active?.attached || sharedSession.store.getSnapshot().sharing === "active");
  const canEditRosterObjects = (!sharedSession.active?.attached || sharedObjectEditingActive) && appView === "editor" && !isPlaying && animationPreviewTimeSec === null;
  const objectEditingAllowedRef = useRef(canEditObjectMaster);
  objectEditingAllowedRef.current = canEditObjectMaster;
  const objectReadOnlyMessage = "閲覧のみ、または再生中のため道具を編集できません。";

  const commitObjectAppearance = (id: string, patch: ObjectAppearancePatch): string | null => {
    if (!objectEditingAllowedRef.current()) return objectReadOnlyMessage;
    const live = sharedEditorRef.current?.project ?? projectRef.current;
    if (!live.stageObjects.some(object => object.id === id)) return "この道具は削除されたため、編集できません。";
    try {
      updateProject(previous => objectEditingAllowedRef.current() ? applyObjectAppearance(previous, id, patch) : previous,
        "道具の形と大きさ", { coalesceHistory: false, checkSharedUpdateSize: true });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "形と大きさを確定できませんでした。";
      setNotice(message); return message;
    }
  };

  const addStageObject = (
    draft: StageObjectDraft = defaultStageObjectDraft,
    visibleInCurrentFrame = true,
    position?: Position,
    objectGroupId?: string,
    shouldScrollToNewObject = true,
  ): string | undefined => {
    if (!objectEditingAllowedRef.current()) return undefined;
    const id = createId("o");
    const activeFrameId = selectedFrameIdRef.current;
    updateProject(previous => {
      if (!objectEditingAllowedRef.current()) return previous;
      const group = previous.objectGroups?.find(item => item.id === objectGroupId);
      if (objectGroupId && !group) return previous;
      const effectiveDraft = group ? objectDraftForGroup(previous, group, {
        ...draft, name: nextRosterItemName(previous.stageObjects, previous.objectGroups ?? [], "objects", group.id),
        color: group.color ?? draft.color, type: group.defaultType ?? draft.type,
      }) : draft;
      const activeFrame = previous.frames.find(frame => frame.id === activeFrameId) ?? previous.frames[0];
      const activeStage = { ...previous.stage, ...getEffectiveStageSize(previous, activeFrame) };
      const requestedCenter = position ?? getParadeVisibleCenterPosition(previous, activeFrame) ?? {
        x: activeStage.widthMeters / 2, y: activeStage.depthMeters / 2,
      };
      const center = constrainMemberPosition(requestedCenter, activeStage);
      // Only explicit context-menu placement lost snapping when the canvas began returning raw points.
      // Default viewport-center additions retain their historical unsnapped placement.
      const topLeft = previous.mode === "parade" && position
        ? snapPastedObjectPosition(position, { ...effectiveDraft, rotation: 0 },
            activeStage, createDefaultParadeSettings({
              ...previous.paradeSettings,
              width: activeStage.widthMeters,
              totalDistance: previous.paradeSettings?.totalDistance ?? previous.stage.depthMeters,
              cellSizeMeters: previous.paradeSettings?.cellSizeMeters ?? activeStage.gridSizeMeters,
            }))
        : constrainObjectPosition({
        x: center.x - effectiveDraft.widthMeters / 2, y: center.y - effectiveDraft.heightMeters / 2,
      }, { ...effectiveDraft, rotation: 0 }, activeStage);
      const object: StageObject = { id, ...effectiveDraft, defaultX: topLeft.x, defaultY: topLeft.y,
        defaultRotation: 0, visible: true, locked: false, zIndex: 10 + previous.stageObjects.length };
      const state = createDefaultObjectState(object);
      return { ...previous, stageObjects: [...previous.stageObjects, object],
        objectGroups: previous.objectGroups?.map(item => item.id === group?.id ? {
          ...item, objectIds: [...new Set([...item.objectIds, id])],
        } : item),
        frames: previous.frames.map(frame => {
          const stage = { ...previous.stage, ...getEffectiveStageSize(previous, frame) };
          const xy = constrainObjectPosition(topLeft, state, stage);
          return { ...frame, objectStates: { ...frame.objectStates, [id]: {
            ...state, ...xy, visible: frame.id === activeFrame?.id ? visibleInCurrentFrame : false,
          } } };
        }),
      };
    }, "道具追加", { coalesceHistory: false });
    const added = (sharedEditorRef.current?.project ?? projectRef.current).stageObjects.find(object => object.id === id);
    if (!added) return undefined;
    setSelected({ type: "object", id }); setSelectedMemberIds([]); setMode("objects"); setActivePanelTab("objects");
    setObjectVisibilityTab(visibleInCurrentFrame ? "visible" : "hidden"); setIsPanelOpen(true);
    if (shouldScrollToNewObject) requestPanelScroll("object", id);
    setNotice(added.name + "を追加しました。", "success");
    return id;
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

    applyChange();
  };

  const setAllMembersFrameVisibility = (visible: boolean) => {
    if (!selectedFrame) {
      setNotice("表示状態を変更するシーンがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;

    let notice = "";
    updateProject(previous => {
      const result = applyMembersFrameVisibility(previous, activeFrameId, visible, viewerPerspective);
      notice = result.notice;
      return result.project;
    });
    setNotice(notice, "success");
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
  ): Promise<boolean> => {
    if (!selectedFrame) {
      setNotice("割当を変更するシーンがありません。");
      return false;
    }
    const activeFrameId = selectedFrame.id;

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
        () => { setNotice(notice, "success"); },
      );
    };

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
    );
  };

  const deleteMember = (id: string) => {

    updateProject((previous) => ({
      ...previous,
      members: previous.members.filter((member) => member.id !== id),
      memberGroups: (previous.memberGroups ?? []).map((group) => ({
        ...group,
        memberIds: group.memberIds.filter((memberId) => memberId !== id),
      })),
      focusMemberId:
        previous.focusMemberId === id ? undefined : previous.focusMemberId,
      frames: previous.frames.map((frame) => {
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
    if (!objectEditingAllowedRef.current()) return;
    if (patch.shape !== undefined) {
      commitObjectAppearance(id, { shape: patch.shape === "circle" ? "circle" : "rectangle" });
      return;
    }
    updateProject((previous) => ({
      ...previous,
      stageObjects: previous.stageObjects.map((object) =>
        object.id === id
          ? {
              ...object,
              ...patch,
              ...(patch.widthMeters !== undefined ? { widthMeters: Math.max(.1, patch.widthMeters) } : {}),
              ...(patch.heightMeters !== undefined ? { heightMeters: Math.max(.1, patch.heightMeters) } : {}),
            }
          : object,
      ),
    }), "道具編集");
  };

  const updateObjectState = (id: string, patch: Partial<ObjectState>) => {
    if (!selectedFrame || canvasPlaybackRef.current) {
      return;
    }
    if (Object.values(patch).some(value => typeof value === "number" && !Number.isFinite(value))) return;
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

    applyChange();
  };

  const deleteObject = (id: string) => {

    updateProject((previous) => ({
      ...previous,
      stageObjects: previous.stageObjects.filter((object) => object.id !== id),
      objectGroups: (previous.objectGroups ?? []).map((group) => ({
        ...group,
        objectIds: group.objectIds.filter((objectId) => objectId !== id),
      })),
      frames: previous.frames.map((frame) => {
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
    const error = paradeDistanceError(patch);
    if (error) { setNotice(error); return; }
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
              widthMeters: Math.max(0.01, source.widthMeters),
              heightMeters: Math.max(0.01, source.heightMeters),
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

  };

  const moveObject = (id: string, patch: Partial<ObjectState>) => {
    if (canvasPlaybackRef.current) return;
    const objectState = snapshot.objectStates[id];
    if (!objectState) {
      updateObjectState(id, patch);
      return;
    }
    if (Object.values(patch).some(value => typeof value === "number" && !Number.isFinite(value))) return;
    const nextPatch = constrainObjectMovePatch(objectState, patch, effectiveStage);
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

  const nudgeMembers = (
    memberIds: string[],
    requested: Position,
    label: string,
    keyboard = false,
  ) => {
    if (!selectedFrame) return;
    const activeFrameId = selectedFrame.id;
    let blocked = false;
    let scrollBounds: CanvasScrollBounds | null = null;
    updateProject(previous => {
      const frame = previous.frames.find(item => item.id === activeFrameId);
      if (!frame) return previous;
      const stage = { ...previous.stage, ...getEffectiveStageSize(previous, frame) };
      const ids = memberIds.filter(id => previous.members.some(member => member.id === id));
      // Preserve each entry's existing missing-position fallback, resolved from the live recipe.
      const source = { ...frame.positions };
      const inherited = !keyboard && ids.some(id => !source[id])
        ? getSnapshotForFrame(previous, activeFrameId).positions : null;
      for (const id of ids) {
        source[id] ??= inherited?.[id] ?? { x: stage.widthMeters / 2, y: stage.depthMeters / 2 };
      }
      const result = moveMembersRelative(source, ids, requested, stage);
      blocked = result.blocked.x || result.blocked.y;
      if (result.delta.x === 0 && result.delta.y === 0) return previous;
      if (keyboard) {
        const diameter = previous.stage.memberDiameterMeters ?? 0.5;
        scrollBounds = unionCanvasBounds(ids.flatMap(id => {
          const position = result.positions[id];
          return position ? [{
            x: position.x - diameter / 2,
            y: position.y - diameter / 2,
            widthMeters: diameter,
            heightMeters: diameter,
          }] : [];
        }));
      }
      return {
        ...previous,
        frames: previous.frames.map(item => item.id === activeFrameId
          ? { ...item, positions: result.positions } : item),
      };
    }, label);
    // useNotice replaces its single notice; repeated blocked moves cannot stack notifications.
    if (blocked) setNotice("隊形がステージより大きいため、この向きには動かせません。");
    scrollKeyboardTargetIntoView(scrollBounds);
  };

  const getKeyboardMoveBounds = (
    objectId: string | null,
    delta: Position,
  ): CanvasScrollBounds | null => {
    const boundsList: CanvasScrollBounds[] = [];
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
          current,
          effectiveStage,
        );
        const b = rotatedObjectBounds({ ...current, ...position });
        boundsList.push({ x: b.left, y: b.top, widthMeters: b.right - b.left, heightMeters: b.bottom - b.top });
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

    if (memberIds.length > 0) {
      nudgeMembers(memberIds, delta, "キーボード移動", true);
      return true;
    }

    const activeFrameId = selectedFrame.id;
    const scrollBounds = getKeyboardMoveBounds(objectId, delta);
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
                  current,
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
              objectStates: nextObjectStates,
            };
          }),
        };
      }, "キーボード移動");
      scrollKeyboardTargetIntoView(scrollBounds);
    };

    applyKeyboardMove();

    return true;
  }

  const saveProjectManually = async (
    options: { showNotice?: boolean } = { showNotice: true },
  ): Promise<boolean> => {
    if (isSharedProject) {
      setNotice("共有データで開いた隊列表は、自分の一覧に追加してから保存できます。");
      return false;
    }

    const saved = await flushPendingAutoSave();
    if (saved && (options.showNotice ?? true)) setNotice("隊列表を保存しました。", "success");
    return saved;
  };

  const updateAnnotationLine = (id: string, line: import("./types").AnnotationLine | null) => {
    const frameId = displayFrame?.id; if (!frameId || isPlaying) return;
    updateProject(previous => ({ ...previous, frames: previous.frames.map(f => {
      if (f.id !== frameId) return f;
      const annotationLines = { ...f.annotationLines };
      if (line) annotationLines[id] = line; else delete annotationLines[id];
      return { ...f, annotationLines };
    }) }), "線の編集", { coalesceHistory: false });
  };

  const createFrameDraft = (sourceProject: Project, timeSec?: number): FormationFrame => {
    const sortedFrames = sortFrames(sourceProject.frames);
    const lastFrame = sortedFrames[sortedFrames.length - 1];
    const fallbackTime = (lastFrame?.timeSec ?? 0) + 8;
    const frameTime = Math.max(0, timeSec ?? (currentTime > 0 ? currentTime : fallbackTime));
    const id = createId("f");
    return {
      id,
      label: nextSceneLabel(sourceProject.frames),
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
      annotationLines: copyAnnotationLines(displayFrame?.annotationLines),
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

  const addFrame = (timeSec?: number) => {

    const frame = createFrameDraft(projectRef.current, timeSec);
    if (!validProjectLineCount([...projectRef.current.frames, frame])) { setNotice("隊列表全体の線は5,000本までです。線を減らしてからシーンを追加してください。"); return; }
    updateProject((previous) => ({
      ...previous,
      frames: [...previous.frames, frame],
    }));
    setSelectedFrameId(frame.id);
    setNotice("シーンを追加しました。", "success");
  };

  // 音源タブ waveform: read the loaded song's own URL (a blob: URL on the web, a converted
  // file URL in the iPad app, so no base64), only while the tab is open. The hook caps size/length.
  const waveformUrl = appView === "editor" && activePanelTab === "audio" ? audioUrl : null;
  const loadWaveformInput = useCallback(async () => {
    if (!waveformUrl) throw new Error("音源がありません。");
    // Native file URLs need Range to avoid status-0 media responses; blob: URLs are read whole.
    const response = await fetch(waveformUrl, waveformUrl.startsWith("blob:") ? undefined : { headers: { Range: "bytes=0-" } });
    if (!response.ok && response.status !== 0) throw new Error("音源を読み込めません。");
    return response.arrayBuffer();
  }, [waveformUrl]);
  const waveform = useAudioWaveform({
    key: waveformUrl, load: loadWaveformInput, enabled: !!waveformUrl,
    sizeHint: project.audio?.size, durationHint: duration > 0 ? duration : undefined,
  });
  const waveformNote = {
    idle: undefined, ready: undefined,
    loading: "波形を作成しています…",
    "too-large": "曲が長い（ファイルが大きい）ため、波形は表示していません。区切りはそのまま使えます。",
    unsupported: "この環境では波形を表示できません。区切りはそのまま使えます。",
    error: "波形を表示できませんでした。区切りはそのまま使えます。",
  }[waveform.status];

  // 音源タブ: read the playhead at the moment of the press, not the last rendered frame.
  const playheadTime = () => {
    const time = audioRef.current?.currentTime;
    return typeof time === "number" && Number.isFinite(time) ? time : currentTime;
  };
  // One drag (or one "今の位置に") is one undo step; the stored order is never re-sorted.
  const retimeScene = (id: string, timeSec: number) => {
    const next = Math.max(0, Math.round(timeSec * 10) / 10);
    const frame = projectRef.current.frames.find((item) => item.id === id);
    if (!frame || Math.abs(frame.timeSec - next) < 0.05) return;
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((item) => item.id === id ? { ...item, timeSec: next } : item),
    }), "シーンの時刻", { coalesceHistory: false });
  };
  const selectSceneAndSeek = (id: string) => {
    const frame = projectRef.current.frames.find((item) => item.id === id);
    if (!frame) return;
    setSelectedFrameId(id);
    moveAudioPosition(frame.timeSec);
  };

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

    applyChange();
  };

  const canEditSceneTime = () => !sharedSession.active?.attached || sharedSession.store.getSnapshot().sharing === "active";
  // Scene details choose integer seconds without the waveform's rounding/tolerance.
  const updateFrameTime = (id: string, timeSec: number) => {
    if (!canEditSceneTime() || activePanelTab !== "timeline" || displayFrame?.id !== id ||
        !Number.isFinite(timeSec) || timeSec < 0) return;
    updateProject(previous => {
      const frame = previous.frames.find(item => item.id === id);
      if (!frame || frame.timeSec === timeSec || !canEditSceneTime()) return previous;
      return { ...previous, frames: previous.frames.map(item => item.id === id ? { ...item, timeSec } : item) };
    }, "シーンの時刻", { coalesceHistory: false });
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
    const pastePosition = snapPastedMemberPosition(getPasteStagePosition(), effectiveStage,
      project.mode === "parade" ? project.paradeSettings : undefined);
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
      snapPastedObjectPosition(intendedPasteCenter, sourceActiveState, effectiveStage,
        project.mode === "parade" ? project.paradeSettings : undefined),
      sourceActiveState,
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
      setSelectedMemberIds([]);
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
          sourceState,
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
    setSelectedMemberIds([]);
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
    if (!validProjectLineCount([...projectRef.current.frames, frame])) { setNotice("隊列表全体の線は5,000本までです。線を減らしてからシーンを複製してください。"); return; }
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
    moveAudioPosition(frame.timeSec);
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

  const openSelectedPosition = () => {
    const tab = selected?.type === "object" ? "objects" : "members";
    setIsPanelOpen(true); setActivePanelTab(tab); setMode(tab);
    setPositionFocusRequest(value => value + 1);
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
        openSelectedPosition();
      }
    };

    window.addEventListener("keydown", handleAppShortcuts);
    return () =>
      window.removeEventListener("keydown", handleAppShortcuts);
  });

  // The picker callback keeps the render's generation while native copying is pending.
  const audioSelectionGeneration = editorLoadGenerationRef.current;
  const sharedAudioSelectionKey = JSON.stringify(sharedSession.active?.song ? [sharedSession.active.song.name, sharedSession.active.song.type, sharedSession.active.song.size, sharedSession.active.song.duration ?? null] : null);
  const loadSharedAudio = async (file: AudioSelection, changeSong = false) => {
    const controller = sharedSession.active;
    if (!controller?.attached || audioSelectionGeneration !== editorLoadGenerationRef.current) return;
    try {
      const audio = file instanceof File ? await saveAudioFileToIndexedDb(file) : file;
      if (controller !== sharedSession.active || audioSelectionGeneration !== editorLoadGenerationRef.current) return;
      if (changeSong) controller.changeSong(audio); else controller.bindAudio(audio, sharedAudioSelectionKey);
      restoredAudioKeyRef.current = "";
      await restoreAudioForProject(controller.editor.project);
      setNotice(changeSong ? "共通曲を変更しました。全員に反映されます。" : "この端末の曲を対応付けました。他の人の共通曲は変わりません。", "success");
    } catch (error) { setNotice(error instanceof Error ? error.message : "この端末の音源を保存できませんでした。もう一度選んでください。"); }
  };
  const loadAudio = async (file: AudioSelection) => {
    const generation = audioSelectionGeneration;
    if (generation !== editorLoadGenerationRef.current) return;
    if (sharedSession.active?.attached) { await loadSharedAudio(file); return; }
    const nextUrl = file instanceof File ? URL.createObjectURL(file) : await resolveAudioPlaybackURL(file);
    if (generation !== editorLoadGenerationRef.current) {
      if (nextUrl?.startsWith("blob:")) URL.revokeObjectURL(nextUrl);
      return;
    }
    setAudioSource(nextUrl, file.name);
    setSharedAudioNotice(false);

    try {
      const audio = await saveAudioFileToIndexedDb(file);
      if (generation !== editorLoadGenerationRef.current) return;
      updateProject(
        (previous) => ({
          ...previous,
          audio,
        }),
        "音源読み込み",
      );
      restoredAudioKeyRef.current = `${projectRef.current.id ?? "project"}:${audio.id}`;
      setNotice(
        "音源を読み込みました。次回から再選択なしで再生できます。",
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

      persistLocal?: boolean;
      noticeKind?: NoticeKind;
      record?: ProjectRecord;
      loadGeneration?: number;
    } = {},
  ) => {
    // Reject malformed input before persistence or any editor-state changes.
    const checked = validateProjectStructure(rawProject);
    if (!checked.ok) { setNotice("隊列表データが壊れている可能性があります。"); return false; }
    // External file events can arrive before startup maintenance/migration ends.
    if (!await storagePreparationRef.current) return false;
    await (audioEditorProtectionRef.current ??= protectAudioEditor());
    const generation = options.loadGeneration ?? ++editorLoadGenerationRef.current;
    if (!await flushPendingAutoSave() || generation !== editorLoadGenerationRef.current) return false;
    let record = options.record;
    let creation: CommitRequest | undefined;
    let creationError: RepositoryError | undefined;
    try {
      if (options.persistLocal !== false && !record) {
        const repository = repositoryRef.current;
        if (!repository) throw new RepositoryError("BUSY");
        creation = { project: rawProject, localRevision: "1", expectedRepositoryRevision: null, operationId: createProjectId() };
        const receipt = await repository.commit(creation);
        record = { project: rawProject, repositoryRevision: receipt.repositoryRevision, localRevision: receipt.localRevision, sync: null };
      }
    } catch (error) {
      if (!creation) { setNotice(repositoryError(error).message); return false; }
      creationError = repositoryError(error);
      if (creationError.code === "CORRUPT" || creationError.code === "INVALID_ID") {
        setNotice("隊列表データが壊れている可能性があります。"); return false;
      }
    }
    if (generation !== editorLoadGenerationRef.current) return false;
    const now = new Date().toISOString();
    let nextProject = normalizeProject({
      ...rawProject,
      lastOpenedAt: now,
    });
    if (!await closeSharedSession() || generation !== editorLoadGenerationRef.current) return false;
    if (record) {
      if (record.collaboration) {

        let installed = false;
        const controller = await sharedSession.open(repositoryRef.current!, { ...record, project: nextProject }, {
          enabled: APP_FEATURES.collaborationV2, config: cloudConfig, platform: APP_FEATURES.nativeFileShare ? "ipad" : "web",
          mock: import.meta.env.DEV && !!(window as Window & { __sharedSessionMock?: unknown }).__sharedSessionMock,
          current: () => installed ? sharedSession.active?.localId === record.project.id && sharedSession.active?.editor === sharedEditorRef.current
            : generation === editorLoadGenerationRef.current,
          publish: projection => {
            projectRef.current = projection; setProject(projection);
            const commands = sharedEditorRef.current?.commands;
            if (commands) setHistoryCounts({ undo: commands.canUndo ? 1 : 0, redo: commands.canRedo ? 1 : 0 });
            if (sharedSession.active?.attached && !sharedSession.active.audioMatches(projection.audio)) {
              restoredAudioKeyRef.current = "";
              setAudioSource(null, projection.audio?.name ?? null); setSharedAudioNotice(true);
              setNotice("この隊列表の曲がこの端末の曲と一致しません。音源タブで選び直してください。");
            }
          },
          saved: observeSave, committed: updateLibrarySummary,
          failed: error => setNotice(error instanceof Error ? error.message : "共同編集の端末保存に失敗しました。"),
        });
        if (!controller || generation !== editorLoadGenerationRef.current) return false;
        saveCoordinatorRef.current = controller.coordinator; sharedEditorRef.current = controller.editor;
        installed = true;
        nextProject = controller.editor.project; controller.start();
      } else saveCoordinatorRef.current?.activate({ ...record, project: nextProject });
    }
    undoStackRef.current = [];
    redoStackRef.current = [];
    historyBatchRef.current = null;
    lastHistoryPushRef.current = null;
    clearPendingAutoSave();
    refreshHistoryCounts();
    projectRef.current = nextProject;

    selectedFrameIdRef.current = nextProject.frames[0]?.id ?? null;

    setProject(nextProject);
    setSelectedFrameId(nextProject.frames[0]?.id ?? null);
    setSelected(null);
    setSelectedMemberIds([]);
    setIsMemberSelectionMode(false);
    setMode("members");
    setActivePanelTab("members");
    setViewerPerspective(nextProject.viewerPerspective ?? "audience");
    setPositionFocusRequest(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsSharedProject(false);

    setAppView("editor");
    setIsDirty(false);
    if (record) {
      void refreshLocalLibrary().catch(error => setNotice(repositoryError(error).message));
    } else if (creation && creationError) {
      saveCoordinatorRef.current?.activateUnsaved(creation, creationError);
      saveCoordinatorRef.current?.edit(nextProject);
    } else { saveCoordinatorRef.current?.deactivate(); setLocalSaveState(null); }

    restoredAudioKeyRef.current = `${nextProject.id ?? "project"}:${nextProject.audio?.id ?? "no-audio"}`;
    const audioRestored = await restoreAudioForProject(nextProject);
    if (audioRestored && !creationError && generation === editorLoadGenerationRef.current) {
      setNotice(message ?? "隊列表を開きました。", options.noticeKind ?? (message === undefined ? "success" : "persistent"));
    }
    return true;
  };

  const loadRosterSource = useCallback(async (id: string): Promise<Project> => {
    if (!await storagePreparationRef.current || !repositoryRef.current) throw new RepositoryError("BUSY");
    // Device-only snapshot. Do not open a shared session or fetch the cloud document.
    return (await getRequiredProject(repositoryRef.current, id)).project;
  }, []);

  const createNewFormationProject = async (input: NewFormationInput) => {
    const empty = createEmptyFormationProject(input.title, input, null);
    const copied = input.rosterCopy ? copyRosterToNewProject(empty, input.rosterCopy.source, input.rosterCopy, createId) : null;
    const prepared = copied?.project ?? empty;
    let audio: AudioMeta | null = null;
    let audioNotice: string | null = null;
    if (input.audioFile) {
      try {
        audio = await saveAudioFileToIndexedDb(input.audioFile);
      } catch {
        audioNotice = "音源保存に失敗したため、音源なしで作成しました。";
      }
    }
    const nextProject = normalizeProject({ ...prepared, audio });
    return await openProjectInEditor(
      nextProject,
      [audioNotice, copied?.overlapCount ? MEMBER_PLACEMENT_OVERLAP_NOTICE : null].filter(Boolean).join(" ") || "新しい隊列表を作成しました。",
      { noticeKind: audioNotice || copied?.overlapCount ? "persistent" : "success" },
    );
  };

  const returnToLibrary = async () => {
    try {
      if (!await flushPendingAutoSave()) return;
      if (!await closeSharedSession()) return;
      ++editorLoadGenerationRef.current;
      if (isSharedProject) {
        setIsSharedProject(false);
        await refreshLocalLibrary();
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

      if (isDirty) {
        const saved = await saveProjectManually({ showNotice: false });
        if (!saved) {
          return;
        }
      } else {
        await refreshLocalLibrary();
      }
      setAppView("library");
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    } catch (error) { setNotice(repositoryError(error).message); }
  };

  const leaveWithoutSaving = async () => {
    const coordinator = saveCoordinatorRef.current;
    if (!coordinator || !canLeaveWithoutSaving(coordinator.state)) return;
    if (!window.confirm("未保存の編集が失われます。先に「編集中のデータを ZIP で書き出す」で退避することをおすすめします。保存せずに一覧へ戻りますか？")) return;
    clearPendingAutoSave(); coordinator.discard(); ++editorLoadGenerationRef.current;
    await sharedSession.shutdown(); sharedEditorRef.current = null;
    if (repositoryRef.current) saveCoordinatorRef.current = createLocalCoordinator(repositoryRef.current);
    setIsDirty(false); isDirtyRef.current = false; setIsPlaying(false); audioRef.current?.pause(); setAppView("library");
    void refreshLocalLibrary().catch(error => setNotice(repositoryError(error).message));
  };

  const localAction = async (action: (repository: ProjectRepository) => Promise<void>) => {
    try {
      if (!await storagePreparationRef.current || !repositoryRef.current) throw new RepositoryError("BUSY");
      await action(repositoryRef.current);
    } catch (error) {
      setNotice(repositoryError(error).message);
      if (repositoryError(error).code === "CONFLICT") void refreshLocalLibrary().catch(() => {});
    }
  };

  const openStoredProject = async (id: string, loadGeneration = ++editorLoadGenerationRef.current): Promise<boolean> => {
    const generation = loadGeneration;
    if (generation !== editorLoadGenerationRef.current) return false;
    await (audioEditorProtectionRef.current ??= protectAudioEditor());
    if (!await flushPendingAutoSave() || generation !== editorLoadGenerationRef.current) return false;
    if (!await closeSharedSession() || generation !== editorLoadGenerationRef.current) return false;
    await sharedSession.settle(id);
    let opened = false;
    await localAction(async repository => {
      let record: ProjectRecord;
      try { record = await readOpenedProject(repository, id); }
      catch (error) {
        if (repositoryError(error).code === "CORRUPT") setDamagedProjectId(id);
        const protection = audioEditorProtectionRef.current; audioEditorProtectionRef.current = null; void protection?.then(release => release());
        throw error;
      }
      if (generation !== editorLoadGenerationRef.current) return;
      opened = await openProjectInEditor(record.project, undefined, { record, loadGeneration: generation });
    });
    return opened && generation === editorLoadGenerationRef.current && projectRef.current.id === id;
  };

  const createSharingOperation = (requestedId?: string): SharingOperation => {
    const localId = requestedId ?? projectRef.current.id ?? "";
    const generation = editorLoadGenerationRef.current;
    const fromEditor = appView === "editor" && projectRef.current.id === localId;
    const snapshot = fromEditor ? cloneProject(projectRef.current) : null;
    const summaryRevision = savedProjects.find(item => item.id === localId)?.repositoryRevision;
    const current = () => generation === editorLoadGenerationRef.current && (appView !== "editor" || projectRef.current.id === localId);
    return {
      localId, current,
      prepare: async () => {
        if (!current() || !localId) throw new Error("開く対象が変わりました。もう一度操作してください。");
        if (!await storagePreparationRef.current || !repositoryRef.current) throw new RepositoryError("BUSY");
        if (fromEditor) {
          if (!await flushPendingAutoSave()) throw new Error("この端末に保存できませんでした。編集内容は画面に残っています。");
          if (!current() || sharingContentKey(projectRef.current) !== sharingContentKey(snapshot!)) throw new Error("編集中の内容が変わりました。もう一度操作してください。");
        }
        const record = await getRequiredProject(repositoryRef.current, localId);
        if (!current() || (snapshot ? sharingContentKey(record.project) !== sharingContentKey(snapshot) : record.repositoryRevision !== summaryRevision))
          throw new Error("隊列表の内容または開く対象が変わりました。もう一度操作してください。");
        if (fromEditor) sharingPreparationRef.current = localId;
        return record;
      },
      settle: async (success, attempted) => {
        try {
          if (!attempted || !current()) return;
          const record = await getRequiredProject(repositoryRef.current!, localId);
          if (!current()) return;
          if (!fromEditor) {
            if (success && !await openProjectInEditor(record.project, undefined, { record, loadGeneration: generation }))
              throw new Error("クラウドへの保存とコピー保存は完了しました。ホームから隊列表を開いてください。");
            return;
          }
          if (!record.collaboration) return;
          // Attach in place, keeping the selected scene, panel, viewport and any
          // edits made while awaiting the reply. Only the original ID is opened.
          if (!await sharedSession.shutdown()) throw new Error("編集内容は画面に残っています。保存を再試行してください。");
          sharedEditorRef.current = null;
          let installed = false;
          const controller = await sharedSession.open(repositoryRef.current!, record, {
            enabled: APP_FEATURES.collaborationV2, config: cloudConfig, platform: APP_FEATURES.nativeFileShare ? "ipad" : "web",
            mock: import.meta.env.DEV && !!(window as Window & { __sharedSessionMock?: unknown }).__sharedSessionMock,
            current: () => installed ? sharedSession.active?.localId === localId && sharedSession.active.editor === sharedEditorRef.current : current(),
            publish: projection => { if (installed) { projectRef.current = projection; setProject(projection); refreshHistoryCounts(); } },
            saved: observeSave, committed: updateLibrarySummary,
            failed: error => setNotice(error instanceof Error ? error.message : "共同編集の端末保存に失敗しました。"),
          });
          if (!controller || !current()) return;
          const draft = cloneProject(projectRef.current);
          saveCoordinatorRef.current = controller.coordinator; sharedEditorRef.current = controller.editor; installed = true;
          if (sharingContentKey(draft) !== sharingContentKey(snapshot!))
            controller.editor.applySharingDraft(normalizeProject(snapshot!), normalizeProject(draft));
          else { const projection = controller.editor.project; projectRef.current = projection; setProjectState(projection); }
          if (success) { undoStackRef.current = []; redoStackRef.current = []; historyBatchRef.current = null; lastHistoryPushRef.current = null; }
          refreshHistoryCounts(); controller.start();
        } finally {
          if (sharingPreparationRef.current === localId) sharingPreparationRef.current = null;
          if (current() && saveCoordinatorRef.current?.state?.dirty) scheduleAutoSave();
          await refreshLocalLibrary().catch(() => {});
        }
      },
    };
  };

  const saveStoredProjectToCloud = async (id: string) => {
    if (cloudSavePendingRef.current) return;
    cloudSavePendingRef.current = true;
    setCloudSaveBusy(true);
    const operation = createSharingOperation(id);
    try {
      const ui = await collaborationUi.get();
      if (ui.getSnapshot().busy) {
        setNotice("クラウドの操作中です。完了後にもう一度「クラウドに保存」を押してください。");
        return;
      }
      await ui.saveLocalToCloud(id, operation);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "クラウド保存を準備できませんでした。もう一度操作してください。");
    } finally {
      cloudSavePendingRef.current = false;
      setCloudSaveBusy(false);
    }
  };

  const renameStoredProject = async (id: string, title: string) => localAction(async repository => {
    const summary = savedProjects.find(s => s.id === id);
    if (!summary) throw new RepositoryError("NOT_FOUND");
    const record = await getRequiredProject(repository, id);
    if (record.collaboration) {
      setNotice("共有の隊列表名は、隊列表を開いてから変更してください。"); return;
    } else {
      await repository.rename({ id, title, updatedAt: new Date().toISOString(), localRevision: incrementRevision(record.localRevision),
        expectedRepositoryRevision: summary.repositoryRevision, operationId: createProjectId() });
    }
    await refreshLocalLibrary(); setNotice("隊列表名を変更しました。", "success");
  });

  const duplicateStoredProject = async (id: string) => localAction(async repository => {
    const { project: source } = await getRequiredProject(repository, id);
    await repository.commit(prepareIndependentProjectCopy(source, source.title + " のコピー"));
    await refreshLocalLibrary(); setNotice("隊列表を複製しました。", "success");
  });

  const deleteStoredProject = async (id: string) => localAction(async repository => {
    const summary = savedProjects.find(s => s.id === id);
    if (!summary) throw new RepositoryError("NOT_FOUND");
    await repository.remove({ id, expectedRepositoryRevision: summary.repositoryRevision, operationId: createProjectId() });
    // Audio references can be shared by copies. Collection is deferred to step 10.
    await refreshLocalLibrary(); setNotice("隊列表を削除しました。", "success");
  });

  const withStoredProject = async (id: string, action: (project: Project) => Promise<void>) => localAction(async repository => {
    await action((await getRequiredProject(repository, id)).project);
  });

  const exportTairetsuProject = async (source: Project, includeAudio: boolean) => {
    if (exportGenerationPending.current) return;
    exportGenerationPending.current = true;
    const projectToExport = normalizeProject(source);
    try {
      if (sharedSession.active?.attached && !sharedSession.active.audioMatches(projectToExport.audio)) projectToExport.audio = null;
      const audioBlob = includeAudio && projectToExport.audio?.id
        ? await loadAudioBlobFromIndexedDb(projectToExport.audio.id, projectToExport.audio).catch(() => null) : null;
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
        title: createUniqueProjectTitle(imported.project.title ?? "", savedProjects),
        updatedAt: now,
      });
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

  const importTairetsuProjectFiles = async (files: File[]) => {
    if (!await storagePreparationRef.current || !repositoryRef.current) return;
    try {
      const { importBackupFiles } = await import("./storage/bulkBackup");
      const report = await importBackupFiles(repositoryRef.current, files, { confirmManifest: async (manifest, missing) =>
        window.confirm(`バックアップの${manifest.exportedCount}件を、新しい隊列表として読み込みます。未選択 ${missing}件、書き出し時の失敗 ${manifest.failedCount}件。続けますか？`) });
      if (report.cancelled) { setNotice("バックアップの読み込みを取り消しました。"); return; }
      await refreshLocalLibrary();
      setNotice(`読み込み完了：成功 ${report.imported}件、失敗 ${report.failed}件、未選択 ${report.missing}件。${report.errors[0] ?? ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "バックアップを読み込めませんでした。"); }
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
    const opened = await openProjectInEditor(nextProject, "共有隊列表を自分の一覧に追加しました。");
    if (opened && window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const saveConflictAsCopy = async () => {
    const source = projectRef.current;
    await localAction(async repository => {
      const now = new Date().toISOString();
      const copy = normalizeProject({ ...cloneProject(source), id: createProjectId(), title: createUniqueProjectTitle(source.title + " のコピー", savedProjects), createdAt: now, updatedAt: now, lastOpenedAt: now });
      const receipt = await repository.commit({ project: copy, localRevision: "1", expectedRepositoryRevision: null, operationId: createProjectId() });
      if (projectRef.current !== source) { await refreshLocalLibrary(); setNotice("複製は保存しました。保存中に追加した編集は元の画面に残っています。"); return; }
      saveCoordinatorRef.current?.discard();
      await openProjectInEditor(copy, "編集内容を別の隊列表として保存しました。", { record: { project: copy, repositoryRevision: receipt.repositoryRevision, localRevision: receipt.localRevision, sync: null } });
    });
  };

  const reloadConflictingProject = async () => {
    const id = projectRef.current.id!;
    if (!await requestAppConfirm({ title: "隊列表を読み込み直す", message: "画面の未保存の編集を破棄して、端末に保存された最新版を読み込みます。", confirmLabel: "読み込み直す", cancelLabel: "キャンセル" })) return;
    await localAction(async repository => {
      const source = projectRef.current;
      const record = await readOpenedProject(repository, id);
      if (projectRef.current !== source) { setNotice("読み込み中に編集が追加されたため、画面の編集を保持しました。"); return; }
      saveCoordinatorRef.current?.discard();
      await openProjectInEditor(record.project, "保存された隊列表を読み込み直しました。", { record });
    });
  };

  const getCloudErrorMessage = (error: unknown): string =>
    getCloudAuthErrorMessage(error);

  const getActiveCloudSession = async (
    sessionOverride?: CloudAuthSession | null,
  ): Promise<CloudAuthSession | null> => {
    if (!cloudConfig) {
      return null;
    }
    if (sessionOverride && readCloudAuthSession()?.user.id !== sessionOverride.user.id) return null;
    const session = await getValidCloudAuthSession(cloudConfig);
    cloudSessionRef.current = session; setCloudSession(session); return session;
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

  useEffect(() => {
    if (!cloudConfig) {
      return undefined;
    }
    let disposed = false;
    let removeNativeListener: (() => Promise<void>) | undefined;

    const activateSession = async (session: CloudAuthSession) => {
      if (disposed) return;
      saveCloudAuthSession(session);
      const expectedEpoch = cloudAuthIdentity().epoch;
      const activeSession = await getValidCloudAuthSession(cloudConfig);
      if (disposed || !activeSession) return;
      await waitCloudAuthPersistence();
      if (disposed || cloudAuthIdentity().epoch !== expectedEpoch) return;
      cloudSessionRef.current = activeSession;
      setCloudSession(activeSession);
      setCloudError(null);
    };

    const restoreSession = async () => {
      try {
        const session = await hydrateCloudAuthSessionFromNativeStorage();
        if (session && readCloudAuthSession()?.accessToken === session.accessToken) {
          await activateSession(session);
          if (session.authFlow === "recovery" && !disposed) {
            setAppView("library");
            setIsCloudPasswordRecoveryOpen(true);
            setNotice("新しいパスワードを設定してください。");
          }
        }
      } catch (error) {
        if (!disposed) {
          console.warn("iPadのログイン情報を復元できませんでした。");
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
        const expectedEpoch = cloudAuthIdentity().epoch;
        const session = await createCloudAuthClient(
          cloudConfig,
        ).createSessionFromRedirectUrl(url);
        if (disposed || cloudAuthIdentity().epoch !== expectedEpoch) return;
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
        void handleAuthUrl(url).catch(() => setCloudError("受信したログイン情報を確認できませんでした。再度ログインしてください。"));
      }).then((handle) => {
        if (disposed) {
          void handle.remove().catch(() => {});
        } else {
          removeNativeListener = () => handle.remove();
        }
      }).catch(() => setCloudError("ログイン通知を開始できませんでした。アプリを再起動してください。"));
      void CapacitorApp.getLaunchUrl().then((launch) => {
        if (launch?.url) {
          void handleAuthUrl(launch.url).catch(() => setCloudError("受信したログイン情報を確認できませんでした。再度ログインしてください。"));
        }
      }).catch(() => setCloudError("起動時のログイン情報を確認できませんでした。再度ログインしてください。"));
    } else {
      void handleAuthUrl(window.location.href).catch(() => setCloudError("ログイン情報を確認できませんでした。再度ログインしてください。"));
    }

    return () => {
      disposed = true;
      if (removeNativeListener) {
        void removeNativeListener().catch(() => {});
      }
    };
  }, [cloudConfig]);

  const togglePlayback = async () => {
    if (sharedSession.active?.attached && !sharedSession.active.audioMatches(projectRef.current.audio)) {
      setAudioSource(null, audioName); setSharedAudioNotice(true);
      setNotice("この隊列表の曲がこの端末の曲と一致しません。音源タブで選び直してください。"); return;
    }
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

  const moveAudioPosition = (time: number) => {
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
    return nextTime;
  };

  // Only time-originated actions resolve a scene from the clamped playhead.
  const seek = (time: number) => {
    const nextTime = moveAudioPosition(time);
    const activeFrame = getActiveFrameAtTime(projectRef.current.frames, nextTime);
    if (activeFrame) {
      setSelectedFrameId(activeFrame.id);
    }
  };

  // Local transport only: never update project/history/collaboration when scrubbing.
  const pauseForAudioScrub = () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl || audio.src !== audioUrl) return false;
    audioScrubContext.current.generation += 1;
    const resume = !audio.paused;
    audio.pause();
    setIsPlaying(false);
    return resume;
  };
  const resumeAfterAudioScrub = async () => {
    const audio = audioRef.current;
    const generation = audioScrubContext.current.generation;
    if (!audio || !audioUrl || audio.src !== audioUrl || audioScrubContext.current.activePanelTab !== "audio") return;
    if (sharedSession.active?.attached && !sharedSession.active.audioMatches(projectRef.current.audio)) return;
    try {
      await audio.play();
      if (audioScrubContext.current.generation !== generation || audioRef.current !== audio) {
        if (audio.src === audioUrl && (audioScrubContext.current.audioUrl !== audioUrl || audioScrubContext.current.activePanelTab !== "audio")) audio.pause();
        return;
      }
      setIsPlaying(true);
    } catch {
      if (audioScrubContext.current.generation === generation) setNotice("再生を再開できませんでした。再生ボタンを押してください。");
    }
  };

  const waitForPaint = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

  const printExportFrameIds = (scope: "all" | "current") =>
    (scope === "current" ? project.frames.filter(f => f.id === selectedFrame?.id) : project.frames).map(f => f.id);

  const preparePrintExportElement = async (
    scope: "all" | "current",
    options: ShareExportOptions,
    variant: "document" | "stage-only" = "document",
  ): Promise<HTMLDivElement> => {
    // Resolve and check the selected scenes before mounting any print DOM/SVG.
    validateParadeA4Export(project, printExportFrameIds(scope), options);
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
    setPrintOptions(null);
    setIsPrintPreviewMounted(false);
  };

  const generatePrintImages = async (scope: "all" | "current", options: ShareExportOptions, base: string) => {
    const element = await preparePrintExportElement(scope, options, "document");
    try {
      const { generateA4Images } = await import("./utils/a4ImageExport");
      return await generateA4Images(element, getPrintOrientation(project), base,
        { project, frameIds: printExportFrameIds(scope), options },
        detail => setExportProgress({ title: "画像を作成中", detail }));
    } finally { cleanupPrintExportElement(); }
  };

  const generatePrintPdfBlob = async (
    scope: "all" | "current",
    options: ShareExportOptions,
    title: string,
    signal: AbortSignal,
  ): Promise<{ blob: Blob; preview: Blob; pageCount: number }> => {
    const element = await preparePrintExportElement(scope, options, "document");
    try {
      const { generateA4Pdf } = await import("./utils/a4PdfExport");
      const frameIds = printExportFrameIds(scope);
      return await generateA4Pdf({ element, project, frameIds, options, title, signal,
        onProgress: detail => setExportProgress({ title: "PDFを作成中", detail }) });
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

  const generateStageScreenshotBlob = async (perspective: ViewerPerspective): Promise<Blob> => {
    const captureOptions = {
      backgroundColor: "#ffffff",
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
    };

    const element = await preparePrintExportElement(
      "current",
      { ...stageScreenshotOptions, viewerPerspective: perspective },
      "stage-only",
    );
    try {
      return await elementToPngBlob(element, captureOptions);
    } finally {
      cleanupPrintExportElement();
    }
  };

  const captureStageImage = async (format: "image" | "pdf", perspective: ViewerPerspective) => {
    setIsCameraExportOpen(false);
    if (exportGenerationPending.current) return;
    exportGenerationPending.current = true;
    const frameLabel = displayFrame?.label ?? selectedFrame?.label ?? "現在シーン";
    const filename = withFileExtension(
      `${APP_NAME}_${frameLabel}_${formatExportTimestamp()}`, format === "image" ? "png" : "pdf",
    );
    setExportProgress({ title: format === "image" ? "ステージ画像を作成中" : "ステージPDFを作成中", detail: frameLabel });
    try {
      const blob = await generateStageScreenshotBlob(perspective);
      if (!blob.size) throw new Error("画像を作成できませんでした。");
      const output = format === "pdf" ? await (await import("./utils/pdfExport")).cameraImageToPdfBlob(blob, frameLabel) : blob;
      setCanCopyExport(format === "image");
      setCompletedExport({ files: [new File([output], filename, { type: format === "image" ? "image/png" : "application/pdf" })], preview: blob,
        targetLabel: format === "image" ? "ステージ画像" : "ステージPDF", scopeLabel: frameLabel, pageCount: 1 });
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
    const pdfController = image ? null : new AbortController();
    a4PdfAbortController.current = pdfController;
    const fileName = withFileExtension(filenameBase, image ? "png" : "pdf");
    setExportProgress({ title: image ? "画像を作成中" : "PDFを作成中", detail: fileName });
    try {
      const generated = image
        ? await generatePrintImages(request.scope, request.options, filenameBase)
        : await generatePrintPdfBlob(request.scope, request.options, filenameBase, pdfController!.signal).then(result => ({ ...result, files: [new File([result.blob], fileName, { type: "application/pdf" })] }));
      if (pdfController?.signal.aborted) return;
      if (!generated.files.length || generated.files.some(file => !file.size)) throw new Error("ファイルを作成できませんでした。");
      setCanCopyExport(false);
      setCompletedExport({ files: generated.files,
        preview: generated.preview, pageCount: generated.pageCount, targetLabel: "隊列表（A4）",
        scopeLabel: request.scope === "current" ? selectedFrame?.label ?? "現在シーン" : "全シーン" });
    } catch (error) {
      if (pdfController?.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      setNotice(error instanceof Error ? `書き出しに失敗しました: ${error.message}` : "書き出しに失敗しました。");
    } finally { a4PdfAbortController.current = null; exportGenerationPending.current = false; setExportProgress(null); }
  };

  const handleShareExportZip = async (includeAudio: boolean) => {
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
        sharedEditorRef.current?.begin();
        selectedMemberIds.forEach((memberId) => {
          const controlPoint =
            pathType === "curve"
              ? controlPointForPreset("member", memberId, "right")
              : undefined;
          upsertMovementPath("member", memberId, pathType, controlPoint);
        });
        sharedEditorRef.current?.end();
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
        sharedEditorRef.current?.begin();
        selectedMemberIds.forEach((memberId) => {
          upsertMovementPath(
            "member",
            memberId,
            "curve",
            controlPointForPreset("member", memberId, side),
          );
        });
        sharedEditorRef.current?.end();
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
          current,
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
    moveAudioPosition(selectedFrame.timeSec);
  };

  const jumpToDestinationFrame = () => {
    if (!selectedNextFrame) return;
    setSelectedFrameId(selectedNextFrame.id);
    moveAudioPosition(selectedNextFrame.timeSec);
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

    updateProject((previous) => ({
      ...previous,
      memberGroups: (previous.memberGroups ?? []).filter((group) => group.id !== id),
      frames: previous.frames.map((frame) => {
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
    return addStageObject(
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
        frames: previous.frames.map((frame) => {
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
              basePosition.x = snapHorizontalPositionInBounds(basePosition.x,
                previous.mode === "parade" ? previous.paradeSettings?.cellSizeMeters ?? frameStage.gridSizeMeters
                  : frameStage.showGrid ? frameStage.gridSizeMeters : NaN,
                horizontalGridOriginMeters(frameStage.widthMeters, previous.mode === "parade"
                  ? previous.paradeSettings?.horizontalMeasureMode : frameStage.horizontalGuideMode), 0, frameStage.widthMeters);
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
    if (!objectEditingAllowedRef.current()) return undefined;
    if (name !== undefined && !name.trim()) {
      return;
    }
    const id = createId("o");

    updateProject((previous) => {
      if (!objectEditingAllowedRef.current()) return previous;
      const group = (previous.objectGroups ?? []).find(
        (item) => item.id === groupId,
      );
      if (groupId !== null && !group) return previous;
      const trimmedName = name?.trim() ??
        nextRosterItemName(
          previous.stageObjects, previous.objectGroups ?? [], "objects", groupId,
        );
      const baseDraft: StageObjectDraft = {
        ...defaultStageObjectDraft,
        name: trimmedName,
        color: group?.color ?? defaultStageObjectDraft.color,
        type: group?.defaultType ?? defaultStageObjectDraft.type,
        shape: group?.defaultShape ?? defaultStageObjectDraft.shape,
      };
      const draft = group ? objectDraftForGroup(previous, group, baseDraft) : baseDraft;
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
        { ...draft, rotation: 0 },
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
        frames: previous.frames.map((frame) => {
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
                { ...draft, rotation: 0 },
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
    }, "名簿道具追加", { coalesceHistory: false });
    const added = (sharedEditorRef.current?.project ?? projectRef.current).stageObjects.find((object) => object.id === id);
    if (added) setNotice(`${added.name} を名簿に追加しました。`, "success");
    return added?.id;
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

  const updateObjectGroupMembership = async (objectId: string, groupId: string | null) => {
    const generation = editorLoadGenerationRef.current;
    const editor = sharedEditorRef.current;
    const projectId = projectRef.current.id;
    const current = () => generation === editorLoadGenerationRef.current && editor === sharedEditorRef.current &&
      projectId === projectRef.current.id && objectEditingAllowedRef.current();
    while (current()) {
      const live = editor?.project ?? projectRef.current;
      const object = live.stageObjects.find(item => item.id === objectId);
      const destination = live.objectGroups?.find(group => group.id === groupId);
      if (!object || groupId !== null && !destination) return;
      if (changeObjectMembership(live, objectId, groupId) === live) return;
      let copyColor = false;
      if (destination?.color && destination.color !== object.color) {
        copyColor = await requestAppConfirm({ title: "道具の色を変更しますか？", confirmLabel: "はい", cancelLabel: "いいえ",
          message: "道具の色も「" + destination.name + "」グループの色にしますか？\n閉じても所属は変更し、色はそのままです。" });
        if (!current()) return;
        const latest = editor?.project ?? projectRef.current;
        const latestObject = latest.stageObjects.find(item => item.id === objectId);
        const latestGroup = latest.objectGroups?.find(group => group.id === groupId);
        if (!latestObject || !latestGroup) return;
        if (latestObject.color !== object.color || latestGroup.color !== destination.color || latestGroup.name !== destination.name) continue;
      }
      try {
        updateProject(previous => current() ? changeObjectMembership(previous, objectId, groupId, copyColor) : previous,
          "道具グループ所属変更", { coalesceHistory: false, checkSharedUpdateSize: true });
      } catch (error) { setNotice(error instanceof Error ? error.message : "所属を変更できませんでした。"); return; }
      setNotice(groupId ? "道具の所属グループを変更しました。" : "道具の所属を解除しました。", "success");
      return;
    }
  };

  const nudgeSelection = (dx: number, dy: number) => {
    if (selectedMemberIds.length === 0) return;
    nudgeMembers(selectedMemberIds, { x: dx, y: dy }, "複数メンバー移動");
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
    const constrained = alignedObjectPosition(state, action, effectiveStage);
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
    setPositionFocusRequest(0);
    setActivePanelTab(tab);
    if (tab === "members") setMode("members");
    if (tab === "objects") setMode("objects");
    if (tab === "stage") setMode("stage");
    if (
      tab === "assignments" ||
      tab === "audio" ||
      tab === "timeline"
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
  const ephemeral = APP_FEATURES.collaborationV2 ? sharedSession.active?.ephemeral ?? null : null;
  useEffect(() => {
    ephemeral?.view(canvasFrameId, selectedMemberIds.length ? selectedMemberIds.map(id => ['member', id]) : selected ? [[selected.type, selected.id]] : []);
  }, [ephemeral, canvasFrameId, selected, selectedMemberIds]);
  const remoteLayer = ephemeral ? <Suspense fallback={null}><RemoteInteractionLayer session={ephemeral} project={project} sceneId={canvasFrameId} perspective={viewerPerspective} /></Suspense> : undefined;
  const canvasSnapshot = snapshot;

  // Both roster entrances share the existing access condition.
  const canOpenRosterManager = true;
  const openRosterManager = (mode?: "members" | "objects") => {
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

  const selectedPositionCard = <SelectedPositionCard
    selected={selected} selectedMemberIds={selectedMemberIds}
    members={project.members} memberGroups={project.memberGroups ?? []} objects={project.stageObjects}
    currentFrame={selectedFrame ?? null} snapshot={selectedFrameSnapshot} stage={effectiveStage}
    projectMode={project.mode ?? "stage"} paradeSettings={project.paradeSettings}
    canEditScene={!isPlaying && animationPreviewTimeSec === null}
    sceneReadOnlyMessage="再生中は位置を編集できません。"
    focusRequest={positionFocusRequest} onMoveMember={moveMember} onUpdateObjectState={updateObjectState}
  />;

  const panelContent = (() => {
    if (activePanelTab === "members") {
      return (
          <MemberPanel
            selectedPositionSlot={selected?.type !== "object" ? selectedPositionCard : undefined}
            key={project.id}
            portrait={workspaceLayout.isPortrait}
            visibilityMemory={visibilityMemories.members}
            onRestoreMember={(id) => setMembersFrameVisibility([id], true, true)}
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
            canEditProject={true}
            canEditScene={true}

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
            canPasteMember={clipboard?.type === "member"}
          >
          <div data-member-tools-panel="true">
            <GroupToolsPanel
              members={project.members}
              selectedMemberIds={selectedMemberIds}
              isSelectionMode={isMemberSelectionMode}
              spacingMeters={templateSpacing}
              canEditProject={true}
              canEditScene={true}

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
          selectedPositionSlot={selected?.type !== "member" && !selectedMemberIds.length ? selectedPositionCard : undefined}
          key={project.id}
          portrait={workspaceLayout.isPortrait}
          visibilityMemory={visibilityMemories.objects}
          currentFrameId={selectedFrame?.id}
          memberVisibility={selectedFrameSnapshot.memberVisibility}
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
          canEditProject={canEditRosterObjects}
          projectReadOnlyMessage={objectReadOnlyMessage}
          canEditScene={true}

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
          canPasteObject={clipboard?.type === "object"}
          onAssignMember={assignMemberToObject}
          onRemoveAssignment={removeObjectAssignment}
          onPlaceSelectedObject={placeSelectedObject}
        />
      );
    }

    if (activePanelTab === "assignments") {
      return (
        <AssignmentPanel
          memberGroups={project.memberGroups ?? []}
          frames={displayFrames}
          members={project.members}
          objects={project.stageObjects}
          objectGroups={project.objectGroups ?? []}
          currentFrame={selectedFrame ?? null}
          previousFrame={selectedPreviousFrame}
          objectStates={selectedFrameSnapshot.objectStates}
          previousObjectStates={selectedPreviousFrameSnapshot?.objectStates ?? {}}
          memberVisibility={selectedFrameSnapshot.memberVisibility}
          canEditScene={true}

          onAssignMember={assignMemberToObject}
          onApplyPreviousAssignments={applyPreviousAssignmentsToCurrentFrame}
          onRemoveAssignment={removeObjectAssignment}
          onSelectFrame={(id) => {
            const frame = project.frames.find((item) => item.id === id);
            if (!frame) {
              return;
            }
            setSelectedFrameId(frame.id);
            moveAudioPosition(frame.timeSec);
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
          disabled={false}

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

    if (activePanelTab === "audio") {
      return (
        <AudioPanel
          key={`${project.id}:${audioUrl}`}
          audioKey={audioUrl}
          audioName={audioName}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          playbackRate={playbackRate}
          loopEnabled={loopEnabled}
          loopStart={loopStart}
          loopEnd={loopEnd}
          sharedAudioNotice={sharedAudioNotice}

          canEditAudio={true}
          onLoadAudio={loadAudio}
          sharedSong={sharedSession.active?.attached ? sharedSession.active.song ?? null : undefined}
          deviceAudioCandidates={sharedSession.active?.audioCandidates}
          audioReady={sharedSession.active?.attached ? !!audioUrl && sharedSession.active.audioMatches(project.audio) : true}
          onChangeSharedSong={sharedSession.active?.attached ? file => loadSharedAudio(file, true) : undefined}
          onChooseDeviceAudio={audio => { void loadSharedAudio(audio); }}
          onLoadAudioError={setNotice}
          onTogglePlayback={togglePlayback}
          onSeek={seek}
          onPlaybackRateChange={setPlaybackRate}
          onLoopChange={changeLoop}
          frames={displayFrames}
          selectedFrameId={selectedFrame?.id ?? null}
          waveform={waveform.data}
          waveformNote={audioUrl ? waveformNote : undefined}
          onSelectScene={selectSceneAndSeek}
          onPausePlayback={pauseForAudioScrub}
          onResumePlayback={() => { void resumeAfterAudioScrub(); }}
          onRetimeScene={retimeScene}
          onAddSceneAtPlayhead={() => addFrame(playheadTime())}
          onAlignSceneToPlayhead={(id) => retimeScene(id, playheadTime())}
        />
      );
    }

    if (activePanelTab === "timeline") {
      return (
        <Timeline
          audioDuration={duration > 0 && Number.isFinite(duration) ? duration : project.audio?.duration}
          canEditTime={canEditSceneTime}
          subscribeTimePermission={sharedSession.store.subscribe}
          onUpdateFrameTime={updateFrameTime}
          frames={displayFrames}
          selectedFrameId={displayFrame?.id ?? null}
          currentTime={currentTime}
          useGlobalStageSize={
            project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
          }
          defaultStageWidth={project.stage.widthMeters}
          defaultStageDepth={project.stage.depthMeters}
          previousFrame={selectedPreviousFrame}
          selectedTargetName={selectedPreviousReflectTargetName}
          canEditProject={true}
          canEditScene={true}
          canAddFrame={true}

          onSelectFrame={(id) => {
            setSelectedFrameId(id);
            if (!isPlaying) {
              setMode((previous) => (previous === "preview" ? "members" : previous));
            }
          }}
          onAddFrame={() => addFrame()}
          onAddFrameAtCurrentTime={() => addFrame(playheadTime())}
          onPreviousFrame={() => goToScene(-1)}
          onNextFrame={() => goToScene(1)}
          onSeekToFrame={seekToFrame}
          onUpdateFrame={updateFrame}
          getSharedNotes={(frameId) => sharedEditorRef.current?.notes(frameId)}
          onDeleteFrame={deleteFrame}
          onCopyFrame={() => copyFrameToClipboard()}
          onPasteFrame={pasteFrameFromClipboard}
          onPasteFrameIntoCurrent={() =>
            void pasteFrameIntoExisting(displayFrame?.id ?? selectedFrame?.id)
          }
          canPasteFrame={clipboard?.type === "frame"}

          onApplyPreviousSceneState={applyPreviousSceneStateToCurrentFrame}
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
        disabled={false}

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

  collaborationUi.options = {
    config: cloudConfig, platform: APP_FEATURES.nativeFileShare ? "ipad" : "web",
    mock: import.meta.env.DEV && !!(window as Window & { __sharedSessionMock?: unknown }).__sharedSessionMock,
    repository: () => repositoryRef.current, active: () => sharedSession.active, store: sharedSession.store, summaries: () => savedProjects,
    sharingOperation: createSharingOperation,
    open: async (record, rescued) => {
      if (rescued) {
        if (!sharedSession.releaseRescued(rescued.localId, rescued.projection)) { await refreshLocalLibrary(); return false; }
        sharedEditorRef.current = null;
        saveCoordinatorRef.current = createLocalCoordinator(repositoryRef.current!);
      }
      await sharedSession.settle(record.project.id!);
      const latest = await repositoryRef.current!.get(record.project.id!);
      if (!latest) return false;
      return openProjectInEditor(latest.project, "隊列表を開きました。", { record: latest });
    },
    transform: async (action, expected) => {
      const id = projectRef.current.id;
      const current = () => projectRef.current.id === id && (!expected || expected.localId === id && expected.current());
      // An explicitly opened target has already established the editor view.
      // The library render's closure may still be in use here.
      if (!id || (expected ? !current() : appView !== "editor")) throw new Error("隊列表を開いてから操作してください。");
      if (!await flushPendingAutoSave()) throw new Error("この端末に保存できませんでした。編集内容は画面に残っています。");
      if (!current()) throw new Error("開いている隊列表が変わりました。");
      if (!await closeSharedSession(false)) throw new Error("この端末に保存できませんでした。編集内容は画面に残っています。");
      if (!current()) throw new Error("開いている隊列表が変わりました。");
      try {
        const record = await action(id);
        const saved = await repositoryRef.current!.get(record.project.id!);
        if (current() && saved) {
          if (!await openProjectInEditor(saved.project, undefined, { record: saved })) {
            throw new Error("クラウド保存は完了しましたが、編集画面を開き直せませんでした。ホームから隊列表を開いてください。");
          }
        }
        await refreshLocalLibrary();
      } catch (error) {
        const source = await repositoryRef.current!.get(id);
        if (current() && source) await openProjectInEditor(source.project, undefined, { record: source });
        await refreshLocalLibrary();
        throw error;
      }
    },
    localRemoved: async () => {
      clearPendingAutoSave(); saveCoordinatorRef.current?.discard(); saveCoordinatorRef.current?.deactivate();
      setAppView("library"); await refreshLocalLibrary();
    },
  };

  if (storageCorrupt && !storageReady) return <Suspense fallback={<div role="status">復旧画面を準備中…</div>}><StorageRecoveryScreen
    repository={repositoryRef.current as MaintenanceRepository | null} onRestored={() => { setStorageCorrupt(false); setStorageWarning(null); setStorageStatus("隊列表を準備しています…"); setStorageRetry(value => value + 1); }} /></Suspense>;

  if (!storageReady || appView === "library") {
    const libraryService = collaborationLibrary.service;
    const libraryUi = collaborationLibrary.ui;
    const collaborationOnHome = APP_FEATURES.collaborationV2 && storageReady;
    const hasStorageTools = storageReady && !!repositoryRef.current && "readMaintenance" in repositoryRef.current;
    return (
      <>
        <FormationLibrary
          account={collaborationOnHome ? { ...libraryAccountButton(libraryUi?.auth, collaborationLibrary.failed),
            onClick: () => { void collaborationUi.get().then(service => service.account()); } } : undefined}
          onOpenStorageManager={hasStorageTools ? () => setStorageMenuRequest(request => request + 1) : undefined}
          onOpenLegacyImport={APP_FEATURES.collaborationV2 && storageReady && repositoryRef.current ? () => setLegacyMenuRequest(request => request + 1) : undefined}
          cloudProjects={libraryUi ? toCloudLibraryCards(libraryUi.documents, savedProjects, libraryUi.auth) : []}
          onOpenCloudProject={libraryService ? documentId => { void libraryService.run(() => libraryService.openExisting(documentId)); } : undefined}
          onRefreshCloud={libraryService && libraryUi?.auth.status === "signed-in" ? () => { void libraryService.run(() => libraryService.refresh()); } : undefined}
          onLoadMoreCloud={libraryService && libraryUi?.cursor ? () => { void libraryService.run(() => libraryService.refresh(true)); } : undefined}
          cloudBusy={!!libraryUi?.busy}
          renderProjectPreview={projectPreviewSource ? summary => <ProjectCardPreview summary={summary} source={projectPreviewSource} /> : undefined}
          onOpenHelp={openHelpPage}
          projects={savedProjects}
          notice={storageStatus ?? storageWarning ?? notice}
          disabled={!storageReady}
          collaborationSlot={APP_FEATURES.collaborationV2 && storageReady ? <Suspense fallback={<p role="status">共同編集を準備中…</p>}><CollaborationSurface bridge={collaborationUi} view="library" />
            {repositoryRef.current && <LegacyRescuePanel repository={repositoryRef.current as import("./legacyImport/importer").ImportRepository} config={cloudConfig} onChanged={refreshLocalLibrary}
              openRequest={legacyMenuRequest} hideEntry />}</Suspense> : undefined}
          renderProjectBadge={APP_FEATURES.collaborationV2 ? summary => summary.sharing ? <Suspense fallback="クラウド"><CollaborationBadge bridge={collaborationUi} summary={summary} /></Suspense> : "ローカル" : undefined}
          onJoinInvitation={APP_FEATURES.collaborationV2 ? () => { void collaborationUi.get().then(ui => ui.invitation("")); } : undefined}
          onSaveToCloud={APP_FEATURES.collaborationV2 ? saveStoredProjectToCloud : undefined}
          cloudSaveBusy={cloudSaveBusy}
          storageTools={storageReady && repositoryRef.current && "readMaintenance" in repositoryRef.current ? <Suspense fallback={null}><StorageTools
            repository={repositoryRef.current as MaintenanceRepository} onChanged={refreshLocalLibrary} damagedId={damagedProjectId} onDismissDamaged={() => setDamagedProjectId(null)}
            menuRequest={storageMenuRequest} hideMenuButton /></Suspense> : null}

          onCreate={createNewFormationProject}
          onLoadRosterSource={loadRosterSource}
          onOpenProject={openStoredProject}
          onRenameProject={renameStoredProject}
          onDuplicateProject={duplicateStoredProject}
          onExportProject={(id, includeAudio) => withStoredProject(id, p => exportTairetsuProject(p, includeAudio))}
          onImportProjectFile={importTairetsuProjectFile}
          onImportProjectFiles={importTairetsuProjectFiles}
          onDeleteProject={deleteStoredProject}
        />
        {helpPage}
        {isCameraExportOpen && <CameraExportDialog stage={project.stage} viewerPerspective={viewerPerspective} isParade={project.mode === "parade"} onClose={() => setIsCameraExportOpen(false)} onExport={(format, perspective) => void captureStageImage(format, perspective)} />}
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

  return (
    <>
    <div
      className="app-shell"
      data-workspace-layout={workspaceLayout.isPortrait ? "portrait" : undefined}
      data-workspace-keyboard={workspaceLayout.keyboardOpen ? "open" : undefined}
      style={workspaceLayout.height === undefined ? undefined : { "--workspace-viewport-height": `${workspaceLayout.height}px` } as CSSProperties}
    >
      <div className="app-top-region">
      <Toolbar
        onOpenHelp={openHelpPage}
        title={project.title}
        canEditProject={true}
        canEditScene={true}
        canSaveProject={true}

        onTitleChange={updateTitle}
        isDirty={isDirty}
        isSaving={isSaving}
        localSaveOnly={APP_FEATURES.collaborationV2 && !!sharedSession.active?.attached}
        collaborationStatus={APP_FEATURES.collaborationV2 && sharedSession.active?.attached ? <Suspense fallback={null}><CollaborationStatus bridge={collaborationUi} localId={project.id!} />{ephemeral && <PresenceIcons session={ephemeral} />}</Suspense> : undefined}
        onBackToLibrary={() => void returnToLibrary()}
        onSaveProject={() => void saveProjectManually()}
        onOpenShareExport={() => setIsShareExportOpen(true)}
        canOpenRosterManager={canOpenRosterManager}
        onOpenRosterManager={() => openRosterManager()}
      />
      {APP_FEATURES.collaborationV2 && <Suspense fallback={null}><CollaborationSurface bridge={collaborationUi} view="editor" localId={project.id} attached={!!sharedSession.active?.attached} /></Suspense>}
      {localSaveState?.error && (
        <div className="shared-project-banner" role="alert" aria-label="端末保存エラー">
          <span>{localSaveState.error.message}</span>
          <div className="shared-project-banner__actions">
            <button className="mini-button" onClick={() => void exportTairetsuProject(projectRef.current, true)}>編集中のデータを ZIP で書き出す</button>
            {localSaveState.error.code === "CONFLICT" ? <>
              <button className="mini-button" onClick={() => void saveConflictAsCopy()}>別の隊列表として保存</button>
              <button className="mini-button" onClick={() => void reloadConflictingProject()}>読み込み直す</button>
            </> : <button className="mini-button" onClick={() => void saveProjectManually()}>保存を再試行</button>}
            {canLeaveWithoutSaving(localSaveState) && <button className="mini-button" onClick={() => void leaveWithoutSaving()}>保存せずに一覧へ戻る</button>}
          </div>
        </div>
      )}
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

      <audio ref={audioRef} className="persistent-audio" preload="metadata" />

      </div>

      <div className={isPanelOpen ? "workspace" : "workspace is-editor-collapsed"}>
        <PanelTabs
          portrait={workspaceLayout.isPortrait}
          keyboardOpen={workspaceLayout.keyboardOpen}
          activeTab={activePanelTab}
          canOpenRosterManager={canOpenRosterManager}
          onOpenRosterManager={() => openRosterManager(activePanelTab === "objects" ? "objects" : "members")}
          isOpen={isPanelOpen}
          onChange={handlePanelTabChange}
          onToggleOpen={() => setIsPanelOpen((previous) => !previous)}
        >
          <Suspense fallback={<p role="status">パネルを読み込み中…</p>}>{panelContent}</Suspense>
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
              presenceForScene={ephemeral ? sceneId => <Suspense fallback={null}><ScenePresence session={ephemeral} sceneId={sceneId} /></Suspense> : undefined}
              project={project}
              viewerPerspective={viewerPerspective}
              selectedFrameId={displayFrame?.id ?? null}
              collapsed={isSceneThumbnailRailCollapsed}

              onToggleCollapsed={() =>
                setIsSceneThumbnailRailCollapsed((previous) => !previous)
              }
              onSelectFrame={(frame) => {
                setSelectedFrameId(frame.id);
                moveAudioPosition(frame.timeSec);
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
                  ephemeral={ephemeral}
                  remoteLayer={remoteLayer}
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
                  isReadOnly={false}
                  readOnlyMessage={undefined}
                  deferMemberDragCommit={Boolean(
                    sharedEditorRef.current,
                  )}
                  deferObjectDragCommit={Boolean(
                    sharedEditorRef.current,
                  )}

                  onSelect={selectStageElement}
                  onStagePointerPositionChange={handleStagePointerPositionChange}
                  onAnnotationLineChange={updateAnnotationLine}
                  onMoveMember={moveMember}
                  onUpdateObjectState={moveObject}
                  canUndo={
                    historyCounts.undo > 0
                  }
                  canRedo={
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
                  onCaptureStageImage={() => setIsCameraExportOpen(true)}
                  onContextMenuRequest={handleStageContextMenu}

                />
              ) : (
                <StageCanvas
                  ephemeral={ephemeral}
                  remoteLayer={remoteLayer}
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
                  isReadOnly={false}
                  readOnlyMessage={undefined}
                  deferMemberDragCommit={Boolean(
                    sharedEditorRef.current,
                  )}
                  deferObjectDragCommit={Boolean(
                    sharedEditorRef.current,
                  )}

                  onSelect={selectStageElement}
                  onStagePointerPositionChange={handleStagePointerPositionChange}
                  onAnnotationLineChange={updateAnnotationLine}
                  onMoveMember={moveMember}
                  onUpdateObjectState={moveObject}
                  canUndo={
                    historyCounts.undo > 0
                  }
                  canRedo={
                    historyCounts.redo > 0
                  }
                  onUndo={undoProject}
                  onRedo={redoProject}
                  onBeginProjectEdit={beginProjectHistoryBatch}
                  onEndProjectEdit={endProjectHistoryBatch}
                  onTogglePlayback={togglePlayback}
                  onSaveProject={() => saveProjectManually()}
                  isSaving={isSaving}
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
                  onCaptureStageImage={() => setIsCameraExportOpen(true)}
                  onSeekAudio={seek}
                  onContextMenuRequest={handleStageContextMenu}

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
              {!clipboard && (
                <div className="stage-context-menu__paste-hint">
                  {/* Break at the arrow so 「コピー」 is never split mid-word. */}
                  メンバーや道具を長押し→<br />「コピー」すると使えます
                </div>
              )}
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
    {isCameraExportOpen && <CameraExportDialog stage={project.stage} viewerPerspective={viewerPerspective} isParade={project.mode === "parade"} onClose={() => setIsCameraExportOpen(false)} onExport={(format, perspective) => void captureStageImage(format, perspective)} />}
        {completedExport && <Suspense fallback={<div role="status">書き出し完了画面を準備中…</div>}><ExportCompletionDialog result={completedExport} onClose={() => setCompletedExport(null)} onCopyImage={canCopyExport ? copyImageToClipboard : undefined} /></Suspense>}
    {helpPage}
    {isShareExportOpen && <Suspense fallback={<div role="status">共有画面を読み込み中…</div>}><ShareExportModal
      isOpen={isShareExportOpen}
      stage={project.stage}
      viewerPerspective={viewerPerspective}
      projectTitle={project.title}
      currentSceneLabel={displayFrame?.label ?? selectedFrame?.label ?? "現在シーン"}
      hasAudio={Boolean(project.audio?.id)}
      isParade={project.mode === "parade"}
      onClose={() => setIsShareExportOpen(false)}
      onOpenCollaboration={APP_FEATURES.collaborationV2 ? () => { setIsShareExportOpen(false); void collaborationUi.get().then(ui => ui.manageLocal(projectRef.current.id!)); } : undefined}
      onExport={handleShareExport}
      onExportZip={handleShareExportZip}
      getMobileExportSource={() => structuredClone({
        project, projectTitle: project.title, members: project.members, memberGroups: project.memberGroups ?? [],
        objects: project.stageObjects, objectGroups: project.objectGroups ?? [], frames: displayFrames,
        currentFrame: selectedFrame ?? null, objectStates: selectedFrame?.objectStates ?? {},
      })}
    /></Suspense>}

    {exportProgress && (
      <div className="export-progress-backdrop" role="presentation">
        <section
          className="export-progress-card"
          role={a4PdfAbortController.current ? "dialog" : "status"}
          aria-modal={a4PdfAbortController.current ? true : undefined}
          aria-live="polite"
          aria-label={exportProgress.title}
          onKeyDown={event => {
            if (!a4PdfAbortController.current) return;
            event.stopPropagation();
            if (event.key === "Escape") { event.preventDefault(); a4PdfAbortController.current.abort(); }
            if (event.key === "Tab") {
              event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
            }
          }}
        >
          <div className="export-progress-card__bar" />
          <h2>{exportProgress.title}</h2>
          {exportProgress.detail && <p>{exportProgress.detail}</p>}
          {a4PdfAbortController.current && <button type="button" className="mini-button export-progress-card__cancel" autoFocus
            onClick={() => a4PdfAbortController.current?.abort()}>取消</button>}
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
          ref={appConfirmDialogRef}
          onKeyDown={handleAppConfirmTab}
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
      canUndo={historyCounts.undo > 0}
      onUndo={undoProject}
      frames={displayFrames}
      currentFrame={selectedFrame ?? null}
      objectStates={selectedFrameSnapshot.objectStates}
      previousFrame={selectedPreviousFrame}
      previousObjectStates={selectedPreviousFrameSnapshot?.objectStates ?? {}}
      memberVisibility={selectedFrameSnapshot.memberVisibility}
      viewerPerspective={viewerPerspective}
      project={project}
      canEditAssignments={(true)}
      canEditObjects={canEditRosterObjects}
      objectReadOnlyMessage={objectReadOnlyMessage}
      onCommitObjectAppearance={commitObjectAppearance}
      isAppConfirmOpen={Boolean(appConfirm)}
      readOnlyMessage={"このシーンは閲覧のみです。"}
      onAssignMember={(objectId, memberId) => {

        return assignMemberToObject(objectId, memberId);
      }}
      onRemoveAssignment={(objectId, memberId, restoreMember) => {

        return removeObjectAssignment(objectId, memberId, restoreMember);
      }}
      onApplyPreviousAssignments={() => {

        return applyPreviousAssignmentsToCurrentFrame();
      }}
      onSelectFrame={(id) => {
        const frame = project.frames.find((item) => item.id === id);
        if (!frame) return;
        setSelectedFrameId(frame.id);
        moveAudioPosition(frame.timeSec);
      }}
      projectTitle={project.title}
      onNotice={setNotice}
      initialMode={rosterInitialMode}
      isOpen={
        isRosterManagerOpen
      }
      allowedModes={
        undefined
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
        // "stage-only" is the stage camera button; give it about 10% blank margin (user decision 2026-10-06).
        stageOnlyMarginRatio={printVariant === "stage-only" ? 0.1 : undefined}
      />
    )}
    </>
  );
}

export default App;
