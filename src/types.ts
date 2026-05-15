export type Member = {
  id: string;
  name: string;
  color: string;
  visible?: boolean;
  zIndex?: number;
};

export type Position = {
  x: number;
  y: number;
};

export type FrontDirection = "bottom" | "top" | "left" | "right";

export type OriginMode = "topLeft" | "center" | "audienceCenter";

export type ViewerPerspective = "audience" | "performer";

export type MovementPathMode = "all" | "selected" | "focus";

export type FormationTemplate = "horizontal" | "vertical" | "diagonal" | "v";

export type AlignmentAction =
  | "left"
  | "right"
  | "centerX"
  | "top"
  | "bottom"
  | "centerY"
  | "distributeX"
  | "distributeY"
  | "stageCenterX"
  | "stageCenter"
  | "objectLeft"
  | "objectRight"
  | "objectCenterX"
  | "objectTop"
  | "objectBottom"
  | "objectCenterY"
  | "objectStageCenter";

export type MovementTargetType = "member" | "object";

export type MovementPathType =
  | "straight"
  | "curve"
  | "orthogonal-hv"
  | "orthogonal-vh"
  | "hold"
  | "enter"
  | "exit";

export type AnimationSettings = {
  membersEnabled: boolean;
  objectsEnabled: boolean;
  curtainsEnabled: boolean;
};

export type GuideSettings = {
  snapGuideEnabled: boolean;
  snapToGuideEnabled: boolean;
};

export type AudioMeta = {
  id: string;
  name: string;
  type: string;
  size: number;
  duration?: number;
};

export type HorizontalGuideMode = "meters" | "centerSplit";

export type FormationMode = "stage" | "parade";

export type ParadeDirection = "up";

export type ParadeRulerPosition = "both" | "left" | "right" | "none";

export type ParadeHorizontalMeasureMode = "centerSplit" | "normalMeter";

export type ParadeSettings = {
  totalDistance: number;
  backwardDistanceMeters?: number;
  width: number;
  cellSizeMeters: number;
  direction: ParadeDirection;
  rulerPosition: ParadeRulerPosition;
  horizontalMeasureMode?: ParadeHorizontalMeasureMode;
  emphasizeEvery5m: boolean;
  emphasizeEvery10m: boolean;
};

export type SceneViewState = {
  scrollTop: number;
  scrollLeft: number;
  zoom: number;
  viewportHeight?: number;
  viewportWidth?: number;
};

export type StageConfig = {
  widthMeters: number;
  depthMeters: number;
  gridSizeMeters: number;
  showGrid: boolean;
  showCenterLine: boolean;
  audienceSide: "bottom" | "top";
  showStageLabels: boolean;
  frontDirection?: FrontDirection;
  originMode?: OriginMode;
  showCenterMarker?: boolean;
  memberDiameterMeters?: number;
  horizontalGuideMode?: HorizontalGuideMode;
  fixedForAllScenes?: boolean;
  gridIntervalM?: number;
  horizontalDisplayMode?: HorizontalGuideMode;
  memberCircleDiameterM?: number;
};

export type StageObjectType =
  | "prop"
  | "setPiece"
  | "chair"
  | "table"
  | "panel"
  | "curtain"
  | "mark"
  | "area"
  | "custom";

export type StageObjectShape =
  | "rectangle"
  | "circle"
  | "line"
  | "curtain"
  | "custom";

export type StageObject = {
  id: string;
  type: StageObjectType;
  name: string;
  color: string;
  shape: StageObjectShape;
  widthMeters: number;
  heightMeters: number;
  defaultX: number;
  defaultY: number;
  defaultRotation: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
};

export type ObjectState = {
  objectId: string;
  x: number;
  y: number;
  widthMeters: number;
  heightMeters: number;
  rotation: number;
  visible: boolean;
  zIndex: number;
};

export type SceneElementEditTarget =
  | {
      id: string;
      type: "member-position";
    }
  | {
      id: string;
      type: "member-visibility";
    }
  | {
      id: string;
      type: "object-state";
    }
  | {
      id: string;
      type: "object-visibility";
    }
  | {
      id: string;
      type: "object-assignment";
    }
  | {
      id: "_";
      type: "notes";
    };

export type MemberAppearanceOverride = {
  color?: string;
};

export type FormationFrame = {
  id: string;
  label: string;
  timeSec: number;
  section?: string;
  notes?: string;
  stageWidthMeters?: number;
  stageDepthMeters?: number;
  memberVisibility?: Record<string, boolean>;
  groupVisibility?: Record<string, boolean>;
  objectAssignments?: Record<string, string[]>;
  memberAppearanceOverrides?: Record<string, MemberAppearanceOverride>;
  sceneViewState?: SceneViewState;
  positions: Record<string, Position>;
  objectStates: Record<string, ObjectState>;
};

export type MovementPath = {
  id?: string;
  targetType?: MovementTargetType;
  targetId?: string;
  memberId?: string;
  fromFrameId: string;
  toFrameId: string;
  pathType?: MovementPathType;
  type?: "straight" | "quadratic";
  controlPoint?: Position;
  visible?: boolean;
};

export type MovementPlan = {
  id: string;
  fromFrameId: string;
  toFrameId: string;
  targetType: MovementTargetType;
  targetId: string;
  enabled?: boolean;
  startSec?: number;
  endSec?: number;
  pathType?: MovementPathType;
  controlPoint?: Position;
  waypoints?: Position[];
  note?: string;
};

export type MemberGroup = {
  id: string;
  name: string;
  memberIds: string[];
  color?: string;
};

export type ObjectGroup = {
  id: string;
  name: string;
  objectIds: string[];
  color?: string;
  defaultType?: StageObjectType;
  defaultShape?: StageObjectShape;
};

export type MemberCreateInput = {
  name?: string;
  groupId?: string;
  color?: string;
  visibleInCurrentFrame?: boolean;
  position?: Position;
  shouldScrollToNewMember?: boolean;
};

export type Project = {
  id?: string;
  version: number;
  title: string;
  mode?: FormationMode;
  paradeSettings?: ParadeSettings;
  createdAt?: string;
  lastOpenedAt?: string;
  audio?: AudioMeta | null;
  stage: StageConfig;
  members: Member[];
  stageObjects: StageObject[];
  frames: FormationFrame[];
  useGlobalStageSize?: boolean;
  useGlobalStageWidth?: boolean;
  memberGroups?: MemberGroup[];
  objectGroups?: ObjectGroup[];
  movementPaths?: MovementPath[];
  movementPlans?: MovementPlan[];
  animationSettings?: AnimationSettings;
  guideSettings?: GuideSettings;
  focusMemberId?: string;
  viewerPerspective?: ViewerPerspective;
  updatedAt: string;
};

export type EditingMode = "members" | "objects" | "stage" | "preview" | "animation";

export type Selection =
  | { type: "member"; id: string }
  | { type: "object"; id: string }
  | null;

export type StageSnapshot = {
  memberVisibility: Record<string, boolean>;
  memberAppearanceOverrides: Record<string, MemberAppearanceOverride>;
  positions: Record<string, Position>;
  objectStates: Record<string, ObjectState>;
};

export type StageObjectDraft = Pick<
  StageObject,
  "type" | "shape" | "name" | "color" | "widthMeters" | "heightMeters"
>;

export type StageContextMenuTarget =
  | { type: "stage" }
  | { type: "member"; id: string }
  | { type: "object"; id: string };

export type StageContextMenuRequest = {
  clientX: number;
  clientY: number;
  stagePosition: Position;
  target: StageContextMenuTarget;
};
