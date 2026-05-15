import type {
  AnimationSettings,
  AudioMeta,
  FormationFrame,
  FormationMode,
  GuideSettings,
  Member,
  MemberAppearanceOverride,
  MemberGroup,
  MovementPath,
  MovementPlan,
  ObjectGroup,
  ObjectState,
  ParadeSettings,
  Position,
  Project,
  SceneViewState,
  StageConfig,
  StageObject,
  ViewerPerspective,
} from "../types";

export const CLOUD_SCHEMA_VERSION = 1;

export type CloudPermissionRole = "owner" | "editor" | "viewer";

export type CloudLockTargetType = "scene" | "project" | "scene_cell";

export type CloudResourceKey =
  | "members"
  | "objects"
  | "settings"
  | "audio"
  | "sceneOrder";

export type CloudProjectLockKey = CloudResourceKey | "import";

export type CloudLockTarget =
  | {
      targetId: string;
      targetType: "scene";
    }
  | {
      targetId: CloudProjectLockKey;
      targetType: "project";
    }
  | {
      targetId: string;
      targetType: "scene_cell";
    };

export type CloudProjectRecordDraft = {
  legacyProjectId?: string;
  mode: FormationMode;
  schemaVersion: number;
  title: string;
};

export type CloudProjectResourceData = {
  audio: CloudAudioResourceData;
  members: CloudMembersResourceData;
  objects: CloudObjectsResourceData;
  sceneOrder: CloudSceneOrderResourceData;
  settings: CloudSettingsResourceData;
};

export type CloudProjectResourceDraft<
  TKey extends CloudResourceKey = CloudResourceKey,
> = {
  data: CloudProjectResourceData[TKey];
  resourceKey: TKey;
  schemaVersion: number;
  version: number;
};

export type CloudMembersResourceData = {
  memberGroups?: MemberGroup[];
  members: Member[];
};

export type CloudObjectsResourceData = {
  objectGroups?: ObjectGroup[];
  stageObjects: StageObject[];
};

export type CloudSettingsResourceData = {
  animationSettings?: AnimationSettings;
  focusMemberId?: string;
  guideSettings?: GuideSettings;
  mode?: FormationMode;
  paradeSettings?: ParadeSettings;
  stage: StageConfig;
  useGlobalStageSize?: boolean;
  useGlobalStageWidth?: boolean;
  viewerPerspective?: ViewerPerspective;
};

export type CloudAudioResourceData = {
  audio: AudioMeta | null;
};

export type CloudSceneOrderItem = Pick<
  FormationFrame,
  "id" | "label" | "section" | "timeSec"
>;

export type CloudSceneOrderResourceData = {
  frames: CloudSceneOrderItem[];
  movementPaths?: MovementPath[];
  movementPlans?: MovementPlan[];
};

export type CloudSceneData = {
  groupVisibility?: Record<string, boolean>;
  memberAppearanceOverrides?: Record<string, MemberAppearanceOverride>;
  memberVisibility?: Record<string, boolean>;
  notes?: string;
  objectAssignments?: Record<string, string[]>;
  objectStates: Record<string, ObjectState>;
  positions: Record<string, Position>;
  sceneViewState?: SceneViewState;
  stageDepthMeters?: number;
  stageWidthMeters?: number;
};

export type CloudSceneDraft = {
  data: CloudSceneData;
  sceneId: string;
  schemaVersion: number;
  version: number;
};

export type CloudProjectDraft = {
  project: CloudProjectRecordDraft;
  resources: CloudProjectResourceDraft[];
  scenes: CloudSceneDraft[];
};

export type CloudProjectParts = {
  createdAt?: string;
  id?: string;
  lastOpenedAt?: string;
  project: CloudProjectRecordDraft;
  resources: Partial<{
    [TKey in CloudResourceKey]: CloudProjectResourceDraft<TKey>;
  }>;
  scenes: CloudSceneDraft[];
  updatedAt?: string;
};

export type LocalProjectCloudMeta = {
  cloudProjectId?: string;
  cloudRole?: CloudPermissionRole;
  cloudSyncedAt?: string;
  source: "cloud" | "local";
};

export type CloudEditableSceneField = keyof CloudSceneData;

export type CloudSaveTarget =
  | {
      baseVersion: number;
      data: CloudSceneData;
      lockToken: string;
      target: Extract<CloudLockTarget, { targetType: "scene" }>;
    }
  | {
      baseVersion: number;
      data: CloudProjectResourceData[CloudResourceKey];
      lockToken: string;
      target: Extract<CloudLockTarget, { targetType: "project" }>;
    };

export type CloudSaveConflict = {
  currentVersion: number;
  message: string;
  target: CloudLockTarget;
};

export type CloudProjectLike = Pick<
  Project,
  | "animationSettings"
  | "audio"
  | "focusMemberId"
  | "frames"
  | "guideSettings"
  | "id"
  | "lastOpenedAt"
  | "memberGroups"
  | "members"
  | "mode"
  | "movementPaths"
  | "movementPlans"
  | "objectGroups"
  | "paradeSettings"
  | "stage"
  | "stageObjects"
  | "title"
  | "updatedAt"
  | "useGlobalStageSize"
  | "useGlobalStageWidth"
  | "version"
  | "viewerPerspective"
>;
