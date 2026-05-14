import type { FormationFrame, Project } from "../types";
import {
  CLOUD_SCHEMA_VERSION,
  type CloudAudioResourceData,
  type CloudLockTarget,
  type CloudMembersResourceData,
  type CloudObjectsResourceData,
  type CloudProjectDraft,
  type CloudProjectParts,
  type CloudProjectResourceData,
  type CloudProjectResourceDraft,
  type CloudResourceKey,
  type CloudSceneData,
  type CloudSceneDraft,
  type CloudSceneOrderResourceData,
  type CloudSettingsResourceData,
} from "./types";

const RESOURCE_KEYS: CloudResourceKey[] = [
  "members",
  "objects",
  "settings",
  "audio",
  "sceneOrder",
];

const cloneJson = <T>(value: T): T =>
  value === undefined
    ? value
    : (JSON.parse(JSON.stringify(value)) as T);

const createResourceDraft = <TKey extends CloudResourceKey>(
  resourceKey: TKey,
  data: CloudProjectResourceData[TKey],
  version = 1,
): CloudProjectResourceDraft<TKey> => ({
  data: cloneJson(data),
  resourceKey,
  schemaVersion: CLOUD_SCHEMA_VERSION,
  version,
});

export const createSceneLockTarget = (sceneId: string): CloudLockTarget => ({
  targetId: sceneId,
  targetType: "scene",
});

export const createProjectLockTarget = (
  targetId: Extract<CloudLockTarget, { targetType: "project" }>["targetId"],
): CloudLockTarget => ({
  targetId,
  targetType: "project",
});

export const getCloudTargetLabel = (target: CloudLockTarget): string =>
  target.targetType === "scene"
    ? `scene:${target.targetId}`
    : `project:${target.targetId}`;

export const extractCloudSceneData = (
  frame: FormationFrame,
): CloudSceneData => ({
  groupVisibility: cloneJson(frame.groupVisibility),
  memberAppearanceOverrides: cloneJson(frame.memberAppearanceOverrides),
  memberVisibility: cloneJson(frame.memberVisibility),
  notes: frame.notes,
  objectAssignments: cloneJson(frame.objectAssignments),
  objectStates: cloneJson(frame.objectStates),
  positions: cloneJson(frame.positions),
  sceneViewState: cloneJson(frame.sceneViewState),
  stageDepthMeters: frame.stageDepthMeters,
  stageWidthMeters: frame.stageWidthMeters,
});

export const createCloudProjectDraft = (
  project: Project,
  options: {
    resourceVersion?: number;
    sceneVersion?: number;
  } = {},
): CloudProjectDraft => {
  const mode = project.mode ?? "stage";
  const resourceVersion = options.resourceVersion ?? 1;
  const sceneVersion = options.sceneVersion ?? 1;

  const members: CloudMembersResourceData = {
    memberGroups: cloneJson(project.memberGroups),
    members: cloneJson(project.members),
  };
  const objects: CloudObjectsResourceData = {
    objectGroups: cloneJson(project.objectGroups),
    stageObjects: cloneJson(project.stageObjects),
  };
  const settings: CloudSettingsResourceData = {
    animationSettings: cloneJson(project.animationSettings),
    focusMemberId: project.focusMemberId,
    guideSettings: cloneJson(project.guideSettings),
    mode,
    paradeSettings: cloneJson(project.paradeSettings),
    stage: cloneJson(project.stage),
    useGlobalStageSize: project.useGlobalStageSize,
    useGlobalStageWidth: project.useGlobalStageWidth,
    viewerPerspective: project.viewerPerspective,
  };
  const audio: CloudAudioResourceData = {
    audio: cloneJson(project.audio ?? null),
  };
  const sceneOrder: CloudSceneOrderResourceData = {
    frames: project.frames.map((frame) => ({
      id: frame.id,
      label: frame.label,
      section: frame.section,
      timeSec: frame.timeSec,
    })),
    movementPaths: cloneJson(project.movementPaths),
    movementPlans: cloneJson(project.movementPlans),
  };

  return {
    project: {
      legacyProjectId: project.id,
      mode,
      schemaVersion: CLOUD_SCHEMA_VERSION,
      title: project.title,
    },
    resources: [
      createResourceDraft("members", members, resourceVersion),
      createResourceDraft("objects", objects, resourceVersion),
      createResourceDraft("settings", settings, resourceVersion),
      createResourceDraft("audio", audio, resourceVersion),
      createResourceDraft("sceneOrder", sceneOrder, resourceVersion),
    ],
    scenes: project.frames.map(
      (frame): CloudSceneDraft => ({
        data: extractCloudSceneData(frame),
        sceneId: frame.id,
        schemaVersion: CLOUD_SCHEMA_VERSION,
        version: sceneVersion,
      }),
    ),
  };
};

const getResource = <TKey extends CloudResourceKey>(
  parts: CloudProjectParts,
  resourceKey: TKey,
): CloudProjectResourceDraft<TKey> | undefined =>
  parts.resources[resourceKey] as CloudProjectResourceDraft<TKey> | undefined;

const requireResource = <TKey extends CloudResourceKey>(
  parts: CloudProjectParts,
  resourceKey: TKey,
): CloudProjectResourceDraft<TKey> => {
  const resource = getResource(parts, resourceKey);
  if (!resource) {
    throw new Error(`クラウドプロジェクトの ${resourceKey} データがありません。`);
  }
  return resource;
};

const createFrameFromCloudScene = (
  item: CloudSceneOrderResourceData["frames"][number],
  scene?: CloudSceneDraft,
): FormationFrame => {
  const data = scene?.data;
  return {
    id: item.id,
    label: item.label,
    section: item.section,
    timeSec: item.timeSec,
    groupVisibility: cloneJson(data?.groupVisibility),
    memberAppearanceOverrides: cloneJson(data?.memberAppearanceOverrides),
    memberVisibility: cloneJson(data?.memberVisibility),
    notes: data?.notes,
    objectAssignments: cloneJson(data?.objectAssignments),
    objectStates: cloneJson(data?.objectStates ?? {}),
    positions: cloneJson(data?.positions ?? {}),
    sceneViewState: cloneJson(data?.sceneViewState),
    stageDepthMeters: data?.stageDepthMeters,
    stageWidthMeters: data?.stageWidthMeters,
  };
};

export const buildProjectFromCloudParts = (
  parts: CloudProjectParts,
): Project => {
  const members = getResource(parts, "members")?.data ?? {
    members: [],
  };
  const objects = getResource(parts, "objects")?.data ?? {
    stageObjects: [],
  };
  const audio = getResource(parts, "audio")?.data ?? {
    audio: null,
  };
  const settings = requireResource(parts, "settings").data;
  const sceneOrder = requireResource(parts, "sceneOrder").data;
  const sceneById = new Map(parts.scenes.map((scene) => [scene.sceneId, scene]));
  const orderedIds = new Set(sceneOrder.frames.map((frame) => frame.id));
  const orderedFrames = sceneOrder.frames.map((item) =>
    createFrameFromCloudScene(item, sceneById.get(item.id)),
  );
  const extraFrames = parts.scenes
    .filter((scene) => !orderedIds.has(scene.sceneId))
    .map((scene, index) =>
      createFrameFromCloudScene(
        {
          id: scene.sceneId,
          label: scene.sceneId,
          timeSec: orderedFrames.length + index,
        },
        scene,
      ),
    );

  return {
    id: parts.id,
    animationSettings: cloneJson(settings.animationSettings),
    audio: cloneJson(audio.audio),
    createdAt: parts.createdAt,
    focusMemberId: settings.focusMemberId,
    frames: [...orderedFrames, ...extraFrames],
    guideSettings: cloneJson(settings.guideSettings),
    lastOpenedAt: parts.lastOpenedAt,
    memberGroups: cloneJson(members.memberGroups),
    members: cloneJson(members.members),
    mode: settings.mode ?? parts.project.mode,
    movementPaths: cloneJson(sceneOrder.movementPaths),
    movementPlans: cloneJson(sceneOrder.movementPlans),
    objectGroups: cloneJson(objects.objectGroups),
    paradeSettings: cloneJson(settings.paradeSettings),
    stage: cloneJson(settings.stage),
    stageObjects: cloneJson(objects.stageObjects),
    title: parts.project.title,
    updatedAt: parts.updatedAt ?? new Date().toISOString(),
    useGlobalStageSize: settings.useGlobalStageSize,
    useGlobalStageWidth: settings.useGlobalStageWidth,
    version: 1,
    viewerPerspective: settings.viewerPerspective,
  };
};

export const getResourceDraft = <TKey extends CloudResourceKey>(
  draft: CloudProjectDraft,
  resourceKey: TKey,
): CloudProjectResourceDraft<TKey> => {
  const resource = draft.resources.find(
    (item) => item.resourceKey === resourceKey,
  );
  if (!resource) {
    throw new Error(`クラウド変換結果に ${resourceKey} がありません。`);
  }
  return resource as CloudProjectResourceDraft<TKey>;
};

export const extractCloudProjectResourceData = <TKey extends CloudResourceKey>(
  project: Project,
  resourceKey: TKey,
): CloudProjectResourceData[TKey] =>
  getResourceDraft(createCloudProjectDraft(project), resourceKey).data;

export const CLOUD_RESOURCE_KEYS = [...RESOURCE_KEYS] as const;
