import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AssignmentPanel } from "./components/AssignmentPanel";
import { AudioPanel } from "./components/AudioPanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { ExportImportPanel } from "./components/ExportImportPanel";
import { FormationLibrary, type NewFormationInput } from "./components/FormationLibrary";
import { GroupToolsPanel } from "./components/GroupToolsPanel";
import { MemberPanel } from "./components/MemberPanel";
import { ObjectPanel } from "./components/ObjectPanel";
import { PanelTabId, PanelTabs } from "./components/PanelTabs";
import { PrintPreview } from "./components/PrintPreview";
import { SceneNotesPanel } from "./components/SceneNotesPanel";
import { SceneThumbnailRail } from "./components/SceneThumbnailRail";
import {
  ShareExportModal,
  ShareExportOptions,
  ShareExportRequest,
} from "./components/ShareExportModal";
import { StageCanvas } from "./components/StageCanvas";
import { StageSettingsPanel } from "./components/StageSettingsPanel";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import { createSampleProject } from "./sampleProject";
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
  Position,
  Project,
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
  downloadBlob,
  elementToJpegDataUrl,
  elementToPngBlob,
  exportElementAsPng,
} from "./utils/exportImage";
import { saveGeneratedBlob, UserFileSaveStatus } from "./utils/fileSave";
import { jpegDataUrlsToPdfBlob } from "./utils/pdfExport";
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
import { readProjectFromHash } from "./utils/share";
import {
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
  | { type: "object"; id: string; token: number };

type HistoryEntry = {
  project: Project;
  label?: string;
};

const HISTORY_LIMIT = 50;
const HISTORY_COALESCE_MS = 1200;
const FLOATING_MENU_MARGIN_PX = 10;
const APP_NAME = "隊列メーカー";
const MEMBER_COLOR_PRESETS = [
  { label: "黄色", value: "#facc15" },
  { label: "赤", value: "#ef4444" },
  { label: "青", value: "#3b82f6" },
  { label: "紫", value: "#a855f7" },
  { label: "緑", value: "#22c55e" },
  { label: "オレンジ", value: "#f97316" },
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

const groupColorPalette = [
  "#0f766e",
  "#2563eb",
  "#c2410c",
  "#7c3aed",
  "#db2777",
  "#16a34a",
];

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

type NavigatorWithFileShare = Navigator & {
  canShare?: (data: ShareData) => boolean;
};

const sanitizeExportFileName = (value: string): string =>
  (value.trim() || APP_NAME)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");

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

const withFileExtension = (fileName: string, extension: string): string => {
  const safeName = sanitizeExportFileName(fileName);
  return safeName.toLowerCase().endsWith(`.${extension}`)
    ? safeName
    : `${safeName}.${extension}`;
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

const createProjectId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return createId("project");
};

const positiveNumber = (
  value: number | undefined,
  fallback: number,
  min: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, value)
    : Math.max(min, fallback);

const normalizeProject = (project: Project): Project => {
  const sample = createSampleProject();
  const legacyStage = project.stage as StageConfig & {
    centerSplitBandEnabled?: boolean;
    coneGuideEnabled?: boolean;
    stageWidthM?: number;
    stageHeightM?: number;
    widthM?: number;
    heightM?: number;
    depthM?: number;
    fixedForAllScenes?: boolean;
    gridIntervalM?: number;
    horizontalDisplayMode?: StageConfig["horizontalGuideMode"];
    memberCircleDiameterM?: number;
  };
  const legacyProject = project as Project & {
    stageWidthM?: number;
    stageHeightM?: number;
    stageDepthM?: number;
    widthM?: number;
    heightM?: number;
    depthM?: number;
    fixedForAllScenes?: boolean;
    gridIntervalM?: number;
    horizontalDisplayMode?: StageConfig["horizontalGuideMode"];
    memberCircleDiameterM?: number;
  };
  const now = new Date().toISOString();
  const stage: StageConfig = {
    ...sample.stage,
    ...project.stage,
    widthMeters: positiveNumber(
      project.stage.widthMeters ??
        legacyStage.stageWidthM ??
        legacyStage.widthM ??
        legacyProject.stageWidthM ??
        legacyProject.widthM,
      sample.stage.widthMeters,
      1,
    ),
    depthMeters: positiveNumber(
      project.stage.depthMeters ??
        legacyStage.stageHeightM ??
        legacyStage.heightM ??
        legacyStage.depthM ??
        legacyProject.stageHeightM ??
        legacyProject.heightM ??
        legacyProject.stageDepthM ??
        legacyProject.depthM,
      sample.stage.depthMeters,
      1,
    ),
    gridSizeMeters: positiveNumber(
      project.stage.gridSizeMeters ??
        legacyStage.gridIntervalM ??
        legacyProject.gridIntervalM,
      sample.stage.gridSizeMeters,
      0.1,
    ),
    frontDirection:
      project.stage.frontDirection ?? project.stage.audienceSide ?? "bottom",
    originMode: project.stage.originMode ?? "center",
    showCenterMarker: project.stage.showCenterMarker ?? true,
    showCenterLine: project.stage.showCenterLine ?? true,
    memberDiameterMeters: Math.min(
      1,
      positiveNumber(
        project.stage.memberDiameterMeters ??
          legacyStage.memberCircleDiameterM ??
          legacyProject.memberCircleDiameterM,
        0.5,
        0.2,
      ),
    ),
    horizontalGuideMode:
      project.stage.horizontalGuideMode === "centerSplit"
        ? "centerSplit"
      : project.stage.horizontalGuideMode === "meters"
          ? "meters"
          : legacyStage.horizontalDisplayMode === "centerSplit" ||
              legacyProject.horizontalDisplayMode === "centerSplit"
            ? "centerSplit"
            : legacyStage.centerSplitBandEnabled || legacyStage.coneGuideEnabled
            ? "centerSplit"
            : "meters",
  };

  const stageObjects = project.stageObjects.map((object, index) => ({
    ...object,
    visible: object.visible ?? true,
    locked: object.locked ?? false,
    zIndex: object.zIndex ?? 10 + index,
    widthMeters: positiveNumber(object.widthMeters, 1, 0.1),
    heightMeters: positiveNumber(object.heightMeters, 1, 0.1),
  }));

  const frames = (
    project.frames.length > 0
      ? project.frames
      : [
          {
            id: createId("f"),
            label: "Start",
            timeSec: 0,
            positions: {},
            objectStates: {},
          },
        ]
  ).map((frame) => ({
    ...frame,
    memberVisibility: frame.memberVisibility
      ? Object.fromEntries(
          Object.entries(frame.memberVisibility)
            .filter(([memberId]) =>
              project.members.some((member) => member.id === memberId),
            )
            .map(([memberId, visible]) => [memberId, visible !== false]),
        )
      : undefined,
    groupVisibility: frame.groupVisibility
      ? Object.fromEntries(
          Object.entries(frame.groupVisibility)
            .filter(([groupId]) =>
              (project.memberGroups ?? []).some((group) => group.id === groupId),
            )
            .map(([groupId, visible]) => [groupId, visible !== false]),
        )
      : undefined,
    objectAssignments: frame.objectAssignments
      ? Object.fromEntries(
          Object.entries(frame.objectAssignments)
            .filter(([objectId]) =>
              project.stageObjects.some((object) => object.id === objectId),
            )
            .map(([objectId, memberIds]) => [
              objectId,
              [...new Set(memberIds)].filter((memberId) =>
                project.members.some((member) => member.id === memberId),
              ),
            ])
            .filter(([, memberIds]) => memberIds.length > 0),
        )
      : undefined,
    memberAppearanceOverrides: frame.memberAppearanceOverrides
      ? Object.fromEntries(
          Object.entries(frame.memberAppearanceOverrides)
            .filter(
              ([memberId, override]) =>
                project.members.some((member) => member.id === memberId) &&
                typeof override?.color === "string" &&
                override.color.trim().length > 0,
            )
            .map(([memberId, override]) => [
              memberId,
              { color: override.color },
            ]),
        )
      : undefined,
    positions: frame.positions ?? {},
    objectStates: frame.objectStates ?? {},
    stageWidthMeters:
      frame.stageWidthMeters === undefined
        ? undefined
        : positiveNumber(frame.stageWidthMeters, stage.widthMeters, 1),
    stageDepthMeters:
      frame.stageDepthMeters === undefined
        ? undefined
        : positiveNumber(frame.stageDepthMeters, stage.depthMeters, 1),
  }));

  const movementPaths = (project.movementPaths ?? [])
    .map((path) => {
      const targetId = path.targetId ?? path.memberId;
      if (!targetId) {
        return null;
      }
      const nextPath: MovementPath = {
        ...path,
        id: path.id ?? createId("path"),
        targetType: path.targetType ?? "member",
        targetId,
        pathType:
          path.pathType ?? (path.type === "quadratic" ? "curve" : "straight"),
      };
      return nextPath;
    })
    .filter((path): path is MovementPath => Boolean(path));

  const movementPlans = (project.movementPlans ?? [])
    .filter((plan) => {
      const targetExists =
        plan.targetType === "member"
          ? project.members.some((member) => member.id === plan.targetId)
          : project.stageObjects.some((object) => object.id === plan.targetId);
      return (
        targetExists &&
        frames.some((frame) => frame.id === plan.fromFrameId) &&
        frames.some((frame) => frame.id === plan.toFrameId)
      );
    })
    .map((plan) => ({
      ...plan,
      id: plan.id ?? createId("plan"),
      enabled: plan.enabled ?? true,
      pathType: plan.pathType ?? "straight",
    }));

  const animationSettings: AnimationSettings = {
    membersEnabled: project.animationSettings?.membersEnabled ?? true,
    objectsEnabled: project.animationSettings?.objectsEnabled ?? true,
    curtainsEnabled: project.animationSettings?.curtainsEnabled ?? true,
  };

  const guideSettings = {
    snapGuideEnabled: project.guideSettings?.snapGuideEnabled ?? true,
    snapToGuideEnabled: project.guideSettings?.snapToGuideEnabled ?? false,
  };

  const memberIds = new Set(project.members.map((member) => member.id));
  const groupedMemberIds = new Set<string>();
  const memberGroups = (project.memberGroups ?? []).map((group, index) => {
    const safeMemberIds = [...new Set(group.memberIds)].filter((id) => {
      if (!memberIds.has(id) || groupedMemberIds.has(id)) {
        return false;
      }
      groupedMemberIds.add(id);
      return true;
    });
    return {
      ...group,
      name: group.name || `グループ${index + 1}`,
      color: group.color ?? groupColorPalette[index % groupColorPalette.length],
      memberIds: safeMemberIds,
    };
  });

  const objectIds = new Set(stageObjects.map((object) => object.id));
  const groupedObjectIds = new Set<string>();
  const objectGroups = (project.objectGroups ?? []).map((group, index) => {
    const safeObjectIds = [...new Set(group.objectIds)].filter((id) => {
      if (!objectIds.has(id) || groupedObjectIds.has(id)) {
        return false;
      }
      groupedObjectIds.add(id);
      return true;
    });
    return {
      ...group,
      name: group.name || `道具グループ${index + 1}`,
      color: group.color ?? groupColorPalette[index % groupColorPalette.length],
      defaultType: group.defaultType ?? "prop",
      defaultShape: group.defaultShape ?? "rectangle",
      objectIds: safeObjectIds,
    };
  });

  const normalizedMembers = project.members.map((member, index) => ({
    ...member,
    visible: member.visible ?? true,
    zIndex: member.zIndex ?? 20 + index,
  }));
  const focusMemberId = normalizedMembers.some(
    (member) => member.id === project.focusMemberId,
  )
    ? project.focusMemberId
    : undefined;

  return {
    ...project,
    id: project.id ?? createProjectId(),
    version: project.version ?? 1,
    title: project.title || APP_NAME,
    createdAt: project.createdAt ?? project.updatedAt ?? now,
    lastOpenedAt: project.lastOpenedAt,
    audio: project.audio ?? null,
    stage,
    members: normalizedMembers,
    stageObjects,
    frames,
    useGlobalStageSize:
      project.useGlobalStageSize ??
      project.useGlobalStageWidth ??
      legacyStage.fixedForAllScenes ??
      legacyProject.fixedForAllScenes ??
      true,
    useGlobalStageWidth:
      project.useGlobalStageWidth ??
      project.useGlobalStageSize ??
      legacyStage.fixedForAllScenes ??
      legacyProject.fixedForAllScenes ??
      true,
    memberGroups,
    objectGroups,
    movementPaths,
    movementPlans,
    animationSettings,
    guideSettings,
    focusMemberId,
    viewerPerspective: project.viewerPerspective ?? "audience",
    updatedAt: project.updatedAt || now,
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
  >,
  audio: AudioMeta | null,
): Project => {
  const now = new Date().toISOString();
  const widthMeters = Math.max(1, settings.widthMeters);
  const depthMeters = Math.max(1, settings.heightMeters);
  const gridSizeMeters = Math.max(0.05, settings.gridSizeMeters);
  const memberDiameterMeters = Math.min(
    1,
    Math.max(0.1, settings.memberDiameterMeters),
  );
  return {
    id: createProjectId(),
    version: 1,
    title,
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

function App() {
  const initial = useMemo(readInitialProject, []);
  const [project, setProject] = useState<Project>(initial.project);
  const [savedProjects, setSavedProjects] = useState<Project[]>(initial.projects);
  const [appView, setAppView] = useState<"library" | "editor">(
    initial.shared ? "editor" : "library",
  );
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
  const [printScope, setPrintScope] = useState<"all" | "current">("all");
  const [printOptions, setPrintOptions] = useState<ShareExportOptions | null>(
    null,
  );
  const [isSceneThumbnailRailCollapsed, setIsSceneThumbnailRailCollapsed] =
    useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
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
  const [movementPathMode, setMovementPathMode] =
    useState<MovementPathMode>("all");
  const [focusMode, setFocusMode] = useState(false);
  const [templateSpacing, setTemplateSpacing] = useState(1.5);
  const [animationPreviewTimeSec, setAnimationPreviewTimeSec] =
    useState<number | null>(null);
  const [animationPreviewTarget, setAnimationPreviewTarget] =
    useState<AnimationPreviewTarget | null>(null);
  const [previewUseActualDuration, setPreviewUseActualDuration] =
    useState(false);
  const [transitionPreviewSpeed, setTransitionPreviewSpeed] = useState(1);
  const [notice, setNotice] = useState<string | null>(initial.error);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sharedAudioNotice, setSharedAudioNotice] = useState(initial.shared);
  const [isPlaying, setIsPlaying] = useState(false);
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
  const lastHistoryPushRef = useRef<{ label?: string; time: number } | null>(
    null,
  );
  const lastStagePointerPositionRef = useRef<Position | null>(null);
  const projectRef = useRef(project);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const restoredAudioKeyRef = useRef<string | null>(null);
  const stageExportRef = useRef<HTMLDivElement | null>(null);
  const printExportRef = useRef<HTMLDivElement | null>(null);
  const stageFullscreenRef = useRef<HTMLDivElement | null>(null);
  const animationPreviewRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const sceneContextMenuRef = useRef<HTMLDivElement | null>(null);
  const memberColorEditorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.title =
      appView === "editor" && project.title
        ? `${project.title} - ${APP_NAME}`
        : APP_NAME;
  }, [appView, project.title]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

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
        return;
      }
      const blob = await loadAudioBlobFromIndexedDb(meta.id);
      if (!blob) {
        setAudioSource(null, meta.name);
        setSharedAudioNotice(true);
        setNotice("保存済み音源が見つかりませんでした。必要なら音源を読み込み直してください。");
        return;
      }
      const url = URL.createObjectURL(blob);
      setAudioSource(url, meta.name);
      setSharedAudioNotice(false);
    },
    [setAudioSource],
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

  const updateProject = useCallback(
    (recipe: (previous: Project) => Project, label?: string) => {
      const previous = projectRef.current;
      const nextProject = recipe(previous);
      if (nextProject === previous) {
        return;
      }
      if (!historyBatchRef.current) {
        const lastHistoryPush = lastHistoryPushRef.current;
        const shouldCoalesce =
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
    [pushUndoSnapshot, refreshHistoryCounts],
  );

  const replaceProjectWithHistory = useCallback(
    (nextProject: Project, label?: string) => {
      pushUndoSnapshot(projectRef.current, label);
      projectRef.current = nextProject;
      setProject(nextProject);
      setIsDirty(true);
      refreshHistoryCounts();
    },
    [pushUndoSnapshot, refreshHistoryCounts],
  );

  const beginProjectHistoryBatch = useCallback(
    (label?: string) => {
      if (historyBatchRef.current) {
        return;
      }
      historyBatchRef.current = { label };
      pushUndoSnapshot(projectRef.current, label);
      refreshHistoryCounts();
    },
    [pushUndoSnapshot, refreshHistoryCounts],
  );

  const endProjectHistoryBatch = useCallback(() => {
    historyBatchRef.current = null;
  }, []);

  const undoProject = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) {
      return;
    }
    redoStackRef.current = [
      ...redoStackRef.current,
      { project: cloneProject(projectRef.current), label: entry.label },
    ].slice(-HISTORY_LIMIT);
    historyBatchRef.current = null;
    lastHistoryPushRef.current = null;
    const nextProject = cloneProject(entry.project);
    projectRef.current = nextProject;
    setProject(nextProject);
    setIsDirty(true);
    refreshHistoryCounts();
    setNotice(entry.label ? `${entry.label}を元に戻しました。` : "元に戻しました。");
  }, [refreshHistoryCounts]);

  const redoProject = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) {
      return;
    }
    undoStackRef.current = [
      ...undoStackRef.current,
      { project: cloneProject(projectRef.current), label: entry.label },
    ].slice(-HISTORY_LIMIT);
    historyBatchRef.current = null;
    lastHistoryPushRef.current = null;
    const nextProject = cloneProject(entry.project);
    projectRef.current = nextProject;
    setProject(nextProject);
    setIsDirty(true);
    refreshHistoryCounts();
    setNotice(entry.label ? `${entry.label}をやり直しました。` : "やり直しました。");
  }, [refreshHistoryCounts]);

  useEffect(() => {
    if (appView !== "editor" || isSharedProject) {
      return;
    }
    try {
      saveProjectToStorage(project);
      setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
      setIsDirty(false);
    } catch {
      setIsDirty(true);
      setNotice("自動保存に失敗しました。保存ボタンで再度保存してください。");
    }
  }, [appView, isSharedProject, project]);

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
      if (event.key === "Escape") {
        void exitStageFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStageFullscreen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) {
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
    if (isPlaying || mode === "preview") {
      return interpolateProjectAtTime(project, currentTime);
    }
    return getSnapshotForFrame(project, selectedFrame?.id ?? null);
  }, [
    currentTime,
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

  const requestPanelScroll = (type: "member" | "object", id: string) => {
    setPanelScrollTarget((previous) => ({
      type,
      id,
      token: (previous?.token ?? 0) + 1,
    }));
  };

  const selectStageElement = (selection: Selection) => {
    setSelected(selection);
    if (!selection) {
      setSelectedMemberIds([]);
      return;
    }

    if (activePanelTab === "animation") {
      setIsPanelOpen(true);
      setSelectedMemberIds([]);
      setMode("preview");
      return;
    }

    setIsPanelOpen(true);
    if (selection.type === "member") {
      const member = project.members.find((item) => item.id === selection.id);
      const visible =
        (member?.visible ?? true) &&
        (snapshot.memberVisibility[selection.id] ?? true);
      setActivePanelTab("members");
      setMode("members");
      setSelectedMemberIds([]);
      setMemberVisibilityTab(visible ? "visible" : "hidden");
      requestPanelScroll("member", selection.id);
      return;
    }

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
    Object.entries(assignments).forEach(([objectId, memberIds]) => {
      const object = project.stageObjects.find((item) => item.id === objectId);
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
  }, [project.stageObjects, selectedFrame]);

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
    const safeName = groupName.trim() || "グループ";
    let nextNumber = 1;
    while (
      project.members.some((member) => member.name === `${safeName}${nextNumber}`)
    ) {
      nextNumber += 1;
    }
    return `${safeName}${nextNumber}`;
  };

  const nextUngroupedMemberName = (): string => {
    let nextNumber = 1;
    while (
      project.members.some((member) => member.name === `メンバー${nextNumber}`)
    ) {
      nextNumber += 1;
    }
    return `メンバー${nextNumber}`;
  };

  const nextGroupObjectName = (groupName: string): string => {
    const safeName = groupName.trim() || "道具";
    let nextNumber = 1;
    while (
      project.stageObjects.some(
        (object) => object.name === `${safeName}${nextNumber}`,
      )
    ) {
      nextNumber += 1;
    }
    return `${safeName}${nextNumber}`;
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

    updateProject((previous) => ({
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
        const basePosition = requestedPosition
          ? constrainMemberPosition(requestedPosition, frameStage)
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
    }));
    setSelected({ type: "member", id });
    setMode("members");
    setActivePanelTab("members");
    setMemberVisibilityTab(visibleInCurrentFrame ? "visible" : "hidden");
    setIsPanelOpen(true);
    requestPanelScroll("member", id);
    setNotice(
      group
        ? `${group.name} に ${member.name} を追加しました。`
        : "メンバーを追加しました。",
    );
  };

  const addMemberToGroup = (
    group: MemberGroup,
    visibleInCurrentFrame = true,
  ) => {
    addMember({ groupId: group.id, visibleInCurrentFrame });
  };

  const addStageObject = (
    draft: StageObjectDraft = defaultStageObjectDraft,
    visibleInCurrentFrame = true,
    position?: Position,
    objectGroupId?: string,
    shouldScrollToNewObject = true,
  ) => {
    const id = createId("o");
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
    const center = constrainMemberPosition(
      position ?? {
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
      frames: previous.frames.map((frame) => ({
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

  const setMembersFrameVisibility = (ids: string[], visible: boolean) => {
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
          positions,
        };
      }),
    }));
    setNotice(
      visible
        ? `${targetIds.length}人をステージへ戻しました。`
        : `${targetIds.length}人をこのシーンで隊列外にしました。`,
    );
  };

  const setAllMembersFrameVisibility = (visible: boolean) => {
    if (!selectedFrame) {
      setNotice("表示状態を変更するシーンがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;
    updateProject((previous) => ({
      ...previous,
      members: visible
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
    setNotice(
      visible
        ? "すべてのメンバーを表示し、道具割当を解除しました。"
        : "すべてのメンバーをこのシーンで非表示にしました。",
    );
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

  const updateMemberAssignmentsInCurrentFrame = (
    updater: (
      frame: FormationFrame,
      frameStage: Project["stage"],
    ) => Pick<FormationFrame, "objectAssignments" | "memberVisibility" | "positions">,
    notice: string,
  ) => {
    if (!selectedFrame) {
      setNotice("割当を変更するシーンがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;
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
        return {
          ...frame,
          ...updater(frame, frameStage),
        };
      }),
    }));
    setNotice(notice);
  };

  const applyPreviousAssignmentsToCurrentFrame = () => {
    if (!selectedFrame) {
      setNotice("割当を反映するシーンがありません。");
      return;
    }
    if (!selectedPreviousFrame || !selectedPreviousFrameSnapshot) {
      setNotice("反映できる直前シーンがありません。");
      return;
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
      return;
    }

    const assignedMemberIds = new Set(
      transferableEntries.flatMap((entry) => entry.memberIds),
    );

    updateMemberAssignmentsInCurrentFrame(
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
      return;
    }
    updateMemberAssignmentsInCurrentFrame(
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
    updateMemberAssignmentsInCurrentFrame(
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
    if (selected?.type === "member" && selected.id === id) {
      setSelected(null);
    }
    setSelectedMemberIds((previous) =>
      previous.filter((memberId) => memberId !== id),
    );
    if (project.focusMemberId === id) {
      setFocusMode(false);
      setMovementPathMode("all");
    }
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
    if (!selectedFrame) {
      return;
    }

    updateProject((previous) => {
      const object = previous.stageObjects.find((item) => item.id === id);
      if (!object) {
        return previous;
      }
      const activeFrameId = selectedFrame.id;
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
    if (selected?.type === "object" && selected.id === id) {
      setSelected(null);
    }
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

  const setAllObjectsFrameVisibility = (visible: boolean) => {
    if (!selectedFrame) {
      setNotice("表示状態を変更するシーンがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;
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
    setNotice(
      visible
        ? "すべての道具をこのシーンで表示しました。"
        : "すべての道具をこのシーンで非表示にしました。",
    );
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
    if (!selectedFrame) {
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
    const objectState = snapshot.objectStates[id];
    if (!objectState) {
      updateObjectState(id, patch);
      return;
    }
    const nextPatch =
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
  };

  function nudgeSelectionByKeyboard(event: KeyboardEvent): boolean {
    const delta = getKeyboardNudgeDelta(
      event,
      viewerPerspective,
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
    });

    return true;
  }

  const saveCurrentFormation = () => {
    if (!selectedFrame) {
      setNotice("保存先のフレームがありません。");
      return;
    }
    const activeFrameId = selectedFrame.id;
    const currentSnapshot = snapshot;
    // 現在表示されている隊形を、選択中フレームのProjectデータとして固定する。
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
    setNotice(`「${selectedFrame.label}」に現在の隊形を保存しました。`);
  };

  const saveProjectManually = async (
    options: { showNotice?: boolean } = { showNotice: true },
  ): Promise<boolean> => {
    if (isSharedProject) {
      setNotice("共有データで開いた隊列表は、自分の一覧に追加してから保存できます。");
      return false;
    }
    if (isSaving) {
      return false;
    }
    setIsSaving(true);
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
        setNotice("隊列表を保存しました。");
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

  const addFrame = (timeSec?: number) => {
    const sortedFrames = sortFrames(project.frames);
    const lastFrame = sortedFrames[sortedFrames.length - 1];
    const fallbackTime = (lastFrame?.timeSec ?? 0) + 8;
    const frameTime = Math.max(0, timeSec ?? (currentTime > 0 ? currentTime : fallbackTime));
    const id = createId("f");
    const frame: FormationFrame = {
      id,
      label: `Scene ${project.frames.length + 1}`,
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
      positions: snapshot.positions,
      objectStates: snapshot.objectStates,
    };
    updateProject((previous) => ({
      ...previous,
      frames: [...previous.frames, frame],
    }));
    setSelectedFrameId(id);
    setNotice("フレームを追加しました。");
  };

  const updateFrame = (id: string, patch: Partial<FormationFrame>) => {
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((frame) =>
        frame.id === id ? { ...frame, ...patch } : frame,
      ),
    }), "シーン編集");
  };

  const deleteFrame = (id: string) => {
    if (project.frames.length <= 1) {
      setNotice("フレームは最低1個必要です。");
      return;
    }
    const remaining = project.frames.filter((frame) => frame.id !== id);
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.filter((frame) => frame.id !== id),
    }));
    if (selectedFrameId === id) {
      setSelectedFrameId(remaining[0]?.id ?? null);
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
    setNotice(`${member.name} をコピーしました。`);
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
    setNotice(`${member.name} を新しいメンバーとして追加しました。`);
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
    setNotice(`${object.name} をコピーしました。`);
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
      setNotice(`${existingObject.name} をこのシーンのステージ上に表示しました。`);
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
    setNotice(`${object.name} を新しい道具として追加しました。`);
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
    setNotice(`「${frame.label}」をコピーしました。`);
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
    setNotice(`「${frame.label}」を貼り付けました。`);
  };

  const pasteFrameIntoExisting = (targetFrameId?: string) => {
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
    setNotice(`「${targetFrame.label}」へシーン内容を貼り付けました。`);
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

  const runContextMenuAction = (action: () => void) => {
    action();
    setContextMenu(null);
  };

  const runSceneContextMenuAction = (action: () => void) => {
    action();
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
      pasteFrameIntoExisting(selectedFrame?.id);
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
    setNotice(`${visibleMemberIds.length}人を選択しました。`);
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
      setNotice("選択中の道具をこのシーンで非表示にしました。");
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
      setNotice("選択を解除しました。");
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

  const runProjectSearch = () => {
    const query = window.prompt("検索する名前を入力してください。");
    const keyword = query?.trim().toLowerCase();
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
      setNotice(`「${member.name}」を見つけました。`);
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
      setNotice(`「${object.name}」を見つけました。`);
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
      setNotice(`「${frame.label}」を見つけました。`);
      return;
    }

    setNotice(`「${query}」は見つかりませんでした。`);
  };

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
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
      setNotice("音源を読み込みました。次回から再選択なしで再生できます。");
    } catch {
      setNotice("音源を読み込みました。音源本体の保存には失敗したため、次回は読み込み直してください。");
    }
  };

  const openProjectInEditor = async (
    rawProject: Project,
    message = "隊列表を開きました。",
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
    refreshHistoryCounts();
    projectRef.current = nextProject;
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
    setAppView("editor");
    setIsDirty(false);
    saveProjectToStorage(nextProject);
    setSavedProjects(loadProjectsFromStorage().map(normalizeProject));
    restoredAudioKeyRef.current = `${nextProject.id ?? "project"}:${nextProject.audio?.id ?? "no-audio"}`;
    await restoreAudioForProject(nextProject);
    setNotice(message);
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
    setNotice("隊列表名を変更しました。");
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
    setNotice("隊列表を複製しました。");
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
    setNotice("隊列表を削除しました。");
  };

  const exportTairetsuProject = async (
    source: Project,
    includeAudio: boolean,
  ) => {
    const projectToExport = normalizeProject(source);
    let audioMissing = false;
    let exportedWithAudio = false;
    try {
      const status = await saveGeneratedBlob({
        fallbackFileName: createTairetsuFileName(projectToExport),
        generateBlob: async () => {
          let audioBlob: Blob | null = null;
          if (includeAudio && projectToExport.audio?.id) {
            audioBlob = await loadAudioBlobFromIndexedDb(projectToExport.audio.id);
            audioMissing = !audioBlob;
          }
          exportedWithAudio = Boolean(audioBlob);
          return createTairetsuArchive(projectToExport, {
            audioBlob,
          });
        },
        pickerTypes: [
          {
            accept: {
              "application/zip": [".zip", ".tairetsu"],
            },
            description: "隊列メーカー共有ZIP",
          },
        ],
      });
      if (status === "cancelled") {
        setNotice("書き出しをキャンセルしました。");
        return;
      }
      if (audioMissing) {
        setNotice("音源が見つからなかったため、音源なしで隊列表を書き出しました。");
        return;
      }
      setNotice(
        exportedWithAudio
          ? "音源を含めて隊列表を書き出しました。"
          : "隊列表を音源なしで書き出しました。",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `隊列表を書き出せませんでした: ${error.message}`
          : "隊列表を書き出せませんでした。",
      );
    }
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
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "隊列表ファイルを読み込めませんでした。",
      );
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

  const exportPng = async () => {
    if (!stageExportRef.current) {
      return;
    }
    try {
      await exportElementAsPng(stageExportRef.current, `${project.title || "隊列メーカー"}.png`);
      setNotice("PNGを書き出しました。");
    } catch {
      setNotice("PNG書き出しに失敗しました。");
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
  ): Promise<HTMLDivElement> => {
    setPrintScope(scope);
    setPrintOptions(options);
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
  };

  const getSaveStatusNotice = (
    status: UserFileSaveStatus,
    fileType: "PDF" | "画像",
  ): string => {
    if (status === "saved") {
      return `${fileType}を保存しました。`;
    }
    if (status === "downloaded") {
      return `このブラウザでは保存先選択に対応していないため、通常のダウンロードとして${fileType}を保存しました。`;
    }
    return "保存をキャンセルしました。";
  };

  const generatePrintImageBlob = async (
    scope: "all" | "current",
    options: ShareExportOptions,
  ): Promise<Blob> => {
    const element = await preparePrintExportElement(scope, options);
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
  ): Promise<Blob> => {
    const element = await preparePrintExportElement(scope, options);
    try {
      const pages = Array.from(
        element.querySelectorAll<HTMLElement>(".print-page"),
      );
      if (pages.length === 0) {
        throw new Error("PDF用ページが見つかりません。");
      }
      const pageDataUrls: string[] = [];
      for (const page of pages) {
        pageDataUrls.push(await elementToJpegDataUrl(page));
      }
      return await jpegDataUrlsToPdfBlob(pageDataUrls, title);
    } finally {
      cleanupPrintExportElement();
    }
  };

  const printProject = (scope: "all" | "current" = "all") => {
    setPrintScope(scope);
    setNotice(
      scope === "current"
        ? "現在のシーンを印刷画面でPDF保存できます。"
        : "全シーンの印刷用プレビューを開きます。ブラウザの印刷画面でPDF保存できます。",
    );
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  const shareFileOrDownload = async (
    blob: Blob,
    filename: string,
    title: string,
  ) => {
    const file = new File([blob], filename, {
      type: blob.type || "application/octet-stream",
    });
    const shareData: ShareData = {
      files: [file],
      text: "隊列メーカーから書き出しました。",
      title,
    };
    const nav = navigator as NavigatorWithFileShare;
    if (navigator.share && (!nav.canShare || nav.canShare(shareData))) {
      try {
        await navigator.share(shareData);
        setNotice("共有シートを開きました。");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setNotice("共有をキャンセルしました。");
          return;
        }
      }
    }
    downloadBlob(blob, filename);
    setNotice(
      "この環境では共有シートを使用できないため、ファイルをダウンロードしました。",
    );
  };

  const handleShareExport = async (request: ShareExportRequest) => {
    const filenameBase =
      request.fileName ||
      (request.scope === "current"
        ? `${project.title || "隊列メーカー"}_${selectedFrame?.label ?? "現在シーン"}`
        : project.title || "隊列メーカー");

    if (request.format === "image") {
      try {
        const status = await saveGeneratedBlob({
          fallbackFileName: withFileExtension(filenameBase, "png"),
          generateBlob: () => generatePrintImageBlob(request.scope, request.options),
          pickerTypes: [
            {
              accept: { "image/png": [".png"] },
              description: "PNG画像",
            },
          ],
        });
        setNotice(getSaveStatusNotice(status, "画像"));
      } catch (error) {
        setNotice(
          error instanceof Error
            ? `画像書き出しに失敗しました: ${error.message}`
            : "画像書き出しに失敗しました。",
        );
      }
      return;
    }

    try {
      const status = await saveGeneratedBlob({
        fallbackFileName: withFileExtension(filenameBase, "pdf"),
        generateBlob: () =>
          generatePrintPdfBlob(request.scope, request.options, filenameBase),
        pickerTypes: [
          {
            accept: { "application/pdf": [".pdf"] },
            description: "PDFファイル",
          },
        ],
      });
      setNotice(getSaveStatusNotice(status, "PDF"));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `PDF書き出しに失敗しました: ${error.message}`
          : "PDF書き出しに失敗しました。",
      );
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
    setNotice("現在位置を次シーンの到着位置にしました。");
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
    setNotice("全メンバーの経路を直線に戻しました。");
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
    setNotice(`音源位置を ${timeSec.toFixed(1)} 秒へ移動しました。`);
  };

  const toggleMemberSelection = (id: string) => {
    setSelectedMemberIds((previous) =>
      previous.includes(id)
        ? previous.filter((memberId) => memberId !== id)
        : [...previous, id],
    );
  };

  const setFocusMember = (id?: string) => {
    updateProject((previous) => ({
      ...previous,
      focusMemberId: id,
    }));
    if (!id) {
      setFocusMode(false);
      setMovementPathMode("all");
      setNotice("自分用確認のメンバー選択を解除しました。");
      return;
    }
    setFocusMode(true);
    setMovementPathMode("focus");
    setNotice("注目メンバーを設定しました。");
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
  ) => {
    if (!selectedFrame) {
      return;
    }
    const activeFrameId = selectedFrame.id;
    updateProject((previous) => ({
      ...previous,
      frames: previous.frames.map((frame) =>
        frame.id === activeFrameId
          ? { ...frame, positions: updater(frame.positions) }
          : frame,
      ),
    }));
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
    setNotice(groupId ? "所属グループを変更しました。" : "所属グループを解除しました。");
  };

  const selectGroup = (group: MemberGroup) => {
    setSelectedMemberIds(group.memberIds);
    setNotice(`${group.name} を選択しました。`);
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
    setNotice(`${group.name} を作成しました。`);
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
    setNotice("道具グループを削除しました。道具本体は残ります。");
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
    });
    setNotice("センターラインを軸に左右反転しました。");
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
    setNotice("選択メンバーを整列しました。");
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
    setNotice(`${object.name} を配置しました。`);
  };

  async function enterStageFullscreen() {
    setIsStageFullscreen(true);
    const container = stageFullscreenRef.current;
    try {
      if (container?.requestFullscreen) {
        await container.requestFullscreen();
      }
    } catch {
      setNotice("ブラウザのフルスクリーンAPIが使えないため、画面内拡大で表示します。");
    }
  }

  async function exitStageFullscreen() {
    try {
      if (document.fullscreenElement) {
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

  const panelContent = (() => {
    if (activePanelTab === "members") {
      return (
        <>
          <MemberPanel
            members={project.members}
            selected={selected}
            selectedMemberIds={selectedMemberIds}
            focusMemberId={project.focusMemberId}
            focusMode={focusMode}
            groups={project.memberGroups ?? []}
            frames={project.frames}
            stageObjects={project.stageObjects}
            currentFrame={selectedFrame}
            objectAssignmentLabelsByMemberId={objectAssignmentLabelsByMemberId}
            visibilityTab={memberVisibilityTab}
            scrollTarget={
              panelScrollTarget?.type === "member" ? panelScrollTarget : null
            }
            onVisibilityTabChange={setMemberVisibilityTab}
            onSelect={(id) => {
              setSelected({ type: "member", id });
              setMode("members");
            }}
            onToggleMemberSelection={toggleMemberSelection}
            onUpdate={updateMember}
            onSetMembersGlobalVisibility={updateMembersGlobalVisibility}
            onSetMemberFrameVisibility={setMembersFrameVisibility}
            onSetAllMembersFrameVisibility={setAllMembersFrameVisibility}
            onSetGroupFrameVisibility={setGroupsFrameVisibility}
            onDelete={deleteMember}
            onAddMember={addMember}
            onCreateGroup={createGroup}
            onUpdateGroup={updateGroup}
            onDeleteGroup={deleteGroup}
            onAddMemberToGroup={addMemberToGroup}
            onSelectGroup={selectGroup}
            onChangeMemberGroup={updateMemberGroup}
            onClearMemberObjectAssignments={clearMemberObjectAssignments}
            onCopySelected={() => copyMemberToClipboard()}
            onPasteMember={pasteMemberFromClipboard}
            canPasteMember={clipboard?.type === "member"}
            onSetFocusMember={setFocusMember}
            onToggleFocusMode={() => setFocusMode((previous) => !previous)}
            onSelectFrame={(id) => setSelectedFrameId(id)}
          />
          <GroupToolsPanel
            members={project.members}
            selectedMemberIds={selectedMemberIds}
            spacingMeters={templateSpacing}
            onSpacingChange={setTemplateSpacing}
            onCreateGroupFromSelection={createGroupFromSelection}
            onNudgeSelection={nudgeSelection}
            onMirrorSelection={mirrorSelection}
            onApplyTemplate={applyFormationTemplate}
            onAlignSelection={alignSelectedMembers}
          />
        </>
      );
    }

    if (activePanelTab === "objects") {
      return (
        <ObjectPanel
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
          onVisibilityTabChange={setObjectVisibilityTab}
          onSelect={(id) => {
            setSelected({ type: "object", id });
            setMode("objects");
          }}
          onUpdateObject={updateObject}
          onUpdateObjectState={updateObjectState}
          onDelete={deleteObject}
          onNudgeZ={nudgeObjectZ}
          onAddObject={(visibleInCurrentFrame) =>
            addStageObject(defaultStageObjectDraft, visibleInCurrentFrame)
          }
          onAddCurtain={(visibleInCurrentFrame) =>
            addStageObject(curtainDraft, visibleInCurrentFrame)
          }
          onAddMark={(visibleInCurrentFrame) =>
            addStageObject(markDraft, visibleInCurrentFrame)
          }
          onCreateObjectGroup={createObjectGroup}
          onUpdateObjectGroup={updateObjectGroup}
          onDeleteObjectGroup={deleteObjectGroup}
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
          frames={project.frames}
          members={project.members}
          objects={project.stageObjects}
          objectGroups={project.objectGroups ?? []}
          currentFrame={selectedFrame ?? null}
          previousFrame={selectedPreviousFrame}
          objectStates={selectedFrameSnapshot.objectStates}
          previousObjectStates={selectedPreviousFrameSnapshot?.objectStates ?? {}}
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
          stage={project.stage}
          useGlobalStageSize={
            project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
          }
          onChange={updateStage}
          onUseGlobalStageSizeChange={updateUseGlobalStageSize}
        />
      );
    }

    if (activePanelTab === "animation") {
      return (
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
          onUpdateMember={updateMember}
          onUpdateMemberGroup={updateMemberGroup}
          onMoveMember={moveMember}
          onUpdateObject={updateObject}
          onUpdateObjectState={updateObjectState}
        />
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
          onLoadAudio={loadAudio}
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
          onCopyFrame={() => copyFrameToClipboard()}
          onPasteFrame={pasteFrameFromClipboard}
          canPasteFrame={clipboard?.type === "frame"}
          onApplyPreviousSceneState={applyPreviousSceneStateToCurrentFrame}
        />
      );
    }

    if (activePanelTab === "notes") {
      return (
        <SceneNotesPanel
          frame={selectedFrame}
          sceneNumber={selectedSceneNumber}
          onUpdateFrame={updateFrame}
        />
      );
    }

    return (
      <StageSettingsPanel
        stage={project.stage}
        useGlobalStageSize={
          project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true
        }
        onChange={updateStage}
        onUseGlobalStageSizeChange={updateUseGlobalStageSize}
      />
    );
  })();

  if (appView === "library") {
    return (
      <FormationLibrary
        projects={sortStoredProjects(savedProjects)}
        notice={notice}
        onCreate={createNewFormationProject}
        onOpenProject={(nextProject) => void openProjectInEditor(nextProject)}
        onRenameProject={renameStoredProject}
        onDuplicateProject={duplicateStoredProject}
        onExportProject={exportTairetsuProject}
        onImportProjectFile={importTairetsuProjectFile}
        onDeleteProject={deleteStoredProject}
      />
    );
  }

  return (
    <>
    <div className="app-shell">
      <div className="app-top-region">
      <Toolbar
        title={project.title}
        showGrid={project.stage.showGrid}
        showCenterLine={project.stage.showCenterLine ?? true}
        showCenterMarker={project.stage.showCenterMarker ?? true}
        showMeterRulers={showMeterRulers}
        focusMode={focusMode}
        showSnapGuides={project.guideSettings?.snapGuideEnabled ?? true}
        snapToGuides={project.guideSettings?.snapToGuideEnabled ?? false}
        onTitleChange={updateTitle}
        isDirty={isDirty}
        isSaving={isSaving}
        onBackToLibrary={() => void returnToLibrary()}
        onSaveProject={() => void saveProjectManually()}
        onOpenShareExport={() => setIsShareExportOpen(true)}
        onToggleGrid={() => updateStage({ showGrid: !project.stage.showGrid })}
        onToggleCenterLine={() =>
          updateStage({
            showCenterLine: !(project.stage.showCenterLine ?? true),
          })
        }
        onToggleCenterMarker={() =>
          updateStage({
            showCenterMarker: !(project.stage.showCenterMarker ?? true),
          })
        }
        onToggleMeterRulers={() =>
          setShowMeterRulers((previous) => !previous)
        }
        onToggleFocusMode={() => setFocusMode((previous) => !previous)}
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
        onClearSelection={() => {
          setSelected(null);
          setSelectedMemberIds([]);
        }}
        onCreateGroup={createGroupFromSelection}
        onMirrorSelection={mirrorSelection}
        onOpenMemberTools={() => {
          setActivePanelTab("members");
          setIsPanelOpen(true);
        }}
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
      <audio ref={audioRef} className="persistent-audio" />
      </div>

      <div className="workspace">
        <PanelTabs
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
          <ExportImportPanel
            notices={notice ? [notice] : []}
            warnings={warnings}
          />
          <div className="stage-workspace">
            <SceneThumbnailRail
              project={project}
              selectedFrameId={displayFrame?.id ?? null}
              collapsed={isSceneThumbnailRailCollapsed}
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
              <StageCanvas
                ref={stageExportRef}
                project={projectForStage}
                snapshot={snapshot}
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
                focusMemberId={project.focusMemberId}
                focusMode={focusMode}
                onSelect={selectStageElement}
                onStagePointerPositionChange={handleStagePointerPositionChange}
                onMoveMember={moveMember}
                onUpdateObjectState={moveObject}
                canUndo={historyCounts.undo > 0}
                canRedo={historyCounts.redo > 0}
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
                onSeekAudio={seek}
                onContextMenuRequest={handleStageContextMenu}
              />
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
                onClick={() =>
                  runContextMenuAction(() => {
                    if (contextMenu.target.type === "member") {
                      setFocusMember(contextMenu.target.id);
                    }
                  })
                }
                type="button"
              >
                自分用確認に設定
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
                      deleteMember(contextMenu.target.id);
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
                ステージから外す
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
                      deleteObject(contextMenu.target.id);
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
              <strong>ステージ</strong>
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
                  {MEMBER_COLOR_PRESETS.map((preset) => (
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
                  <label className="member-color-picker">
                    その他
                    <input
                      type="color"
                      value={memberColorEditor.color}
                      onChange={(event) =>
                        setMemberColorEditor((previous) =>
                          previous
                            ? { ...previous, color: event.target.value }
                            : previous,
                        )
                      }
                    />
                  </label>
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
    <ShareExportModal
      isOpen={isShareExportOpen}
      projectTitle={project.title}
      currentSceneLabel={displayFrame?.label ?? selectedFrame?.label ?? "現在シーン"}
      onClose={() => setIsShareExportOpen(false)}
      onExport={handleShareExport}
    />
    <PrintPreview
      project={project}
      scope={printScope}
      selectedFrameId={displayFrame?.id ?? selectedFrame?.id ?? null}
      options={printOptions ?? undefined}
      rootRef={printExportRef}
    />
    </>
  );
}

export default App;
