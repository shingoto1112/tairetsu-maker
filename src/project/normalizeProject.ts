import type { Project, StageConfig, AnimationSettings, MovementPath } from "../types";
import { createSampleProject } from "../sampleProject";
import { createId } from "../utils/ids";
import {
  createProjectId,
  positiveNumber,
  createDefaultParadeSettings,
  groupColorPalette,
} from "./defaults";

const APP_NAME = "隊列メーカー";

/** Inputs for deterministic normalization; no React, storage or network access. */
export type NormalizationContext = {
  defaultStage: StageConfig;
  now: () => string;
  createId: (prefix: string) => string;
  createProjectId: () => string;
};

/** Preserve the original clock/ID behavior for all existing callers (including Array.map). */
export const normalizeProject = (project: Project): Project => {
  const sample = createSampleProject();
  return normalizeProjectWithContext(project, {
    defaultStage: sample.stage,
    now: () => new Date().toISOString(),
    createId,
    createProjectId,
  });
};

export const normalizeProjectWithContext = (project: Project, context: NormalizationContext): Project => {
  const sample = { stage: context.defaultStage };
  const legacyProject = project as Partial<Project> & {
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
  const rawStage = legacyProject.stage ?? sample.stage;
  const inputMembers = Array.isArray(legacyProject.members)
    ? legacyProject.members
    : [];
  const inputStageObjects = Array.isArray(legacyProject.stageObjects)
    ? legacyProject.stageObjects
    : [];
  const inputFrames = Array.isArray(legacyProject.frames)
    ? legacyProject.frames
    : [];
  const inputMemberGroups = Array.isArray(legacyProject.memberGroups)
    ? legacyProject.memberGroups
    : [];
  const inputObjectGroups = Array.isArray(legacyProject.objectGroups)
    ? legacyProject.objectGroups
    : [];
  const inputMovementPaths = Array.isArray(legacyProject.movementPaths)
    ? legacyProject.movementPaths
    : [];
  const inputMovementPlans = Array.isArray(legacyProject.movementPlans)
    ? legacyProject.movementPlans
    : [];
  const legacyStage = rawStage as StageConfig & {
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
  const now = context.now();
  const mode = legacyProject.mode === "parade" ? "parade" : "stage";
  let stage: StageConfig = {
    ...sample.stage,
    ...rawStage,
    widthMeters: positiveNumber(
      rawStage.widthMeters ??
        legacyStage.stageWidthM ??
        legacyStage.widthM ??
        legacyProject.stageWidthM ??
        legacyProject.widthM,
      sample.stage.widthMeters,
      1,
    ),
    depthMeters: positiveNumber(
      rawStage.depthMeters ??
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
      rawStage.gridSizeMeters ??
        legacyStage.gridIntervalM ??
        legacyProject.gridIntervalM,
      sample.stage.gridSizeMeters,
      0.1,
    ),
    frontDirection:
      rawStage.frontDirection ?? rawStage.audienceSide ?? "bottom",
    originMode: rawStage.originMode ?? "center",
    showCenterMarker: rawStage.showCenterMarker ?? true,
    showCenterLine: rawStage.showCenterLine ?? true,
    memberDiameterMeters: Math.min(
      1,
      positiveNumber(
        rawStage.memberDiameterMeters ??
          legacyStage.memberCircleDiameterM ??
          legacyProject.memberCircleDiameterM,
        0.5,
        0.2,
      ),
    ),
    horizontalGuideMode:
      rawStage.horizontalGuideMode === "centerSplit"
        ? "centerSplit"
      : rawStage.horizontalGuideMode === "meters"
          ? "meters"
          : legacyStage.horizontalDisplayMode === "centerSplit" ||
              legacyProject.horizontalDisplayMode === "centerSplit"
            ? "centerSplit"
            : legacyStage.centerSplitBandEnabled || legacyStage.coneGuideEnabled
            ? "centerSplit"
            : "meters",
  };
  const paradeSettings =
    mode === "parade"
      ? createDefaultParadeSettings({
          ...(legacyProject.paradeSettings ?? {}),
          width:
            legacyProject.paradeSettings?.width ??
            rawStage.widthMeters ??
            legacyStage.stageWidthM ??
            legacyStage.widthM ??
            legacyProject.stageWidthM ??
            legacyProject.widthM,
          totalDistance:
            legacyProject.paradeSettings?.totalDistance ??
            rawStage.depthMeters ??
            legacyStage.stageHeightM ??
            legacyStage.heightM ??
            legacyStage.depthM ??
            legacyProject.stageHeightM ??
            legacyProject.heightM ??
            legacyProject.stageDepthM ??
            legacyProject.depthM,
          cellSizeMeters:
            legacyProject.paradeSettings?.cellSizeMeters ??
            rawStage.gridSizeMeters ??
            legacyStage.gridIntervalM ??
            legacyProject.gridIntervalM,
        })
      : undefined;
  if (paradeSettings) {
    stage = {
      ...stage,
      widthMeters: paradeSettings.width,
      depthMeters: paradeSettings.totalDistance,
      gridSizeMeters: paradeSettings.cellSizeMeters,
      gridIntervalM: paradeSettings.cellSizeMeters,
    };
  }

  const stageObjects = inputStageObjects.map((object, index) => ({
    ...object,
    visible: object.visible ?? true,
    locked: object.locked ?? false,
    zIndex: object.zIndex ?? 10 + index,
    widthMeters: positiveNumber(object.widthMeters, 1, 0.1),
    heightMeters: positiveNumber(object.heightMeters, 1, 0.1),
  }));

  const frames = (
    inputFrames.length > 0
      ? inputFrames
      : [
          {
            id: context.createId("f"),
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
              inputMembers.some((member) => member.id === memberId),
            )
            .map(([memberId, visible]) => [memberId, visible !== false]),
        )
      : undefined,
    groupVisibility: frame.groupVisibility
      ? Object.fromEntries(
          Object.entries(frame.groupVisibility)
            .filter(([groupId]) =>
              inputMemberGroups.some((group) => group.id === groupId),
            )
            .map(([groupId, visible]) => [groupId, visible !== false]),
        )
      : undefined,
    objectAssignments: frame.objectAssignments
      ? Object.fromEntries(
          Object.entries(frame.objectAssignments)
            .filter(([objectId]) =>
              inputStageObjects.some((object) => object.id === objectId),
            )
            .map(([objectId, memberIds]) => [
              objectId,
              [...new Set(memberIds)].filter((memberId) =>
                inputMembers.some((member) => member.id === memberId),
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
                inputMembers.some((member) => member.id === memberId) &&
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
    sceneViewState:
      mode === "parade" && frame.sceneViewState
        ? {
            scrollTop: frame.sceneViewState?.scrollTop ?? 0,
            scrollLeft: frame.sceneViewState?.scrollLeft ?? 0,
            zoom: positiveNumber(frame.sceneViewState?.zoom, 1, 0.2),
            viewportHeight: frame.sceneViewState?.viewportHeight,
            viewportWidth: frame.sceneViewState?.viewportWidth,
          }
        : frame.sceneViewState,
    stageWidthMeters:
      frame.stageWidthMeters === undefined
        ? undefined
        : positiveNumber(frame.stageWidthMeters, stage.widthMeters, 1),
    stageDepthMeters:
      frame.stageDepthMeters === undefined
        ? undefined
        : positiveNumber(frame.stageDepthMeters, stage.depthMeters, 1),
  }));

  const movementPaths = inputMovementPaths
    .map((path) => {
      const targetId = path.targetId ?? path.memberId;
      if (!targetId) {
        return null;
      }
      const nextPath: MovementPath = {
        ...path,
        id: path.id ?? context.createId("path"),
        targetType: path.targetType ?? "member",
        targetId,
        pathType:
          path.pathType ?? (path.type === "quadratic" ? "curve" : "straight"),
      };
      return nextPath;
    })
    .filter((path): path is MovementPath => Boolean(path));

  const movementPlans = inputMovementPlans
    .filter((plan) => {
      const targetExists =
        plan.targetType === "member"
          ? inputMembers.some((member) => member.id === plan.targetId)
          : inputStageObjects.some((object) => object.id === plan.targetId);
      return (
        targetExists &&
        frames.some((frame) => frame.id === plan.fromFrameId) &&
        frames.some((frame) => frame.id === plan.toFrameId)
      );
    })
    .map((plan) => ({
      ...plan,
      id: plan.id ?? context.createId("plan"),
      enabled: plan.enabled ?? true,
      pathType: plan.pathType ?? "straight",
    }));

  const animationSettings: AnimationSettings = {
    membersEnabled: legacyProject.animationSettings?.membersEnabled ?? true,
    objectsEnabled: legacyProject.animationSettings?.objectsEnabled ?? true,
    curtainsEnabled: legacyProject.animationSettings?.curtainsEnabled ?? true,
  };

  const guideSettings = {
    snapGuideEnabled: legacyProject.guideSettings?.snapGuideEnabled ?? true,
    snapToGuideEnabled: legacyProject.guideSettings?.snapToGuideEnabled ?? false,
  };

  const memberIds = new Set(inputMembers.map((member) => member.id));
  const groupedMemberIds = new Set<string>();
  const memberGroups = inputMemberGroups.map((group, index) => {
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
  const objectGroups = inputObjectGroups.map((group, index) => {
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

  const normalizedMembers = inputMembers.map((member, index) => ({
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
    id: project.id ?? context.createProjectId(),
    version: project.version ?? 1,
    title: project.title || APP_NAME,
    mode,
    paradeSettings,
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
