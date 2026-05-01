import {
  AnimationSettings,
  FormationFrame,
  MovementPath,
  MovementPlan,
  MovementPathType,
  MovementTargetType,
  ObjectState,
  Position,
  Project,
  StageObject,
  StageSnapshot,
} from "../types";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const quadraticPoint = (
  start: Position,
  control: Position,
  end: Position,
  t: number,
): Position => {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
};

export const sortFrames = (frames: FormationFrame[]): FormationFrame[] =>
  [...frames].sort((a, b) => a.timeSec - b.timeSec);

const SCENE_TIME_EPSILON = 0.0001;

export const getActiveFrameAtTime = (
  frames: FormationFrame[],
  timeSec: number,
): FormationFrame | undefined => {
  const sortedFrames = sortFrames(frames);
  if (sortedFrames.length === 0) {
    return undefined;
  }
  let activeFrame = sortedFrames[0];
  for (const frame of sortedFrames) {
    if (frame.timeSec <= timeSec + SCENE_TIME_EPSILON) {
      activeFrame = frame;
      continue;
    }
    break;
  }
  return activeFrame;
};

export const createDefaultObjectState = (object: StageObject): ObjectState => ({
  objectId: object.id,
  x: object.defaultX,
  y: object.defaultY,
  widthMeters: object.widthMeters,
  heightMeters: object.heightMeters,
  rotation: object.defaultRotation,
  visible: object.visible,
  zIndex: object.zIndex,
});

const fallbackMemberPosition = (project: Project, index: number): Position => ({
  x:
    project.stage.widthMeters / 2 +
    (index - (project.members.length - 1) / 2) * 0.8,
  y: project.stage.depthMeters / 2,
});

const resolvePositionAtFrameIndex = (
  project: Project,
  sortedFrames: FormationFrame[],
  frameIndex: number,
  memberId: string,
): Position => {
  for (let i = frameIndex; i >= 0; i -= 1) {
    const position = sortedFrames[i]?.positions[memberId];
    if (position) return position;
  }
  const memberIndex = project.members.findIndex((member) => member.id === memberId);
  return fallbackMemberPosition(project, Math.max(memberIndex, 0));
};

const resolveObjectAtFrameIndex = (
  object: StageObject,
  sortedFrames: FormationFrame[],
  frameIndex: number,
): ObjectState => {
  for (let i = frameIndex; i >= 0; i -= 1) {
    const state = sortedFrames[i]?.objectStates[object.id];
    if (state) return state;
  }
  return createDefaultObjectState(object);
};

const resolveMemberVisibilityAtFrameIndex = (
  sortedFrames: FormationFrame[],
  frameIndex: number,
  memberId: string,
): boolean => {
  const frame = sortedFrames[frameIndex];
  const isAssignedToObject = Object.values(frame?.objectAssignments ?? {}).some(
    (memberIds) => memberIds.includes(memberId),
  );
  return frame?.memberVisibility?.[memberId] !== false && !isAssignedToObject;
};

export const findMovementPath = (
  paths: MovementPath[] | undefined,
  targetType: MovementTargetType,
  targetId: string,
  fromFrameId: string,
  toFrameId: string,
): MovementPath | undefined =>
  paths?.find(
    (path) =>
      (path.targetType ?? "member") === targetType &&
      (path.targetId ?? path.memberId) === targetId &&
      path.fromFrameId === fromFrameId &&
      path.toFrameId === toFrameId &&
      path.visible !== false,
  );

export const getMovementPathType = (
  path: MovementPath | MovementPlan | undefined,
): MovementPathType =>
  path?.pathType ??
  (path && "type" in path && path.type === "quadratic"
    ? "curve"
    : "straight");

export const getAnimationSettings = (
  project: Project,
): AnimationSettings => ({
  membersEnabled: project.animationSettings?.membersEnabled ?? true,
  objectsEnabled: project.animationSettings?.objectsEnabled ?? true,
  curtainsEnabled: project.animationSettings?.curtainsEnabled ?? true,
});

export const isAnimationEnabledForTarget = (
  project: Project,
  targetType: MovementTargetType,
  targetId: string,
): boolean => {
  const settings = getAnimationSettings(project);
  if (targetType === "member") {
    return settings.membersEnabled;
  }
  const object = project.stageObjects.find((item) => item.id === targetId);
  return object?.type === "curtain"
    ? settings.curtainsEnabled
    : settings.objectsEnabled;
};

export const findMovementPlan = (
  plans: MovementPlan[] | undefined,
  targetType: MovementTargetType,
  targetId: string,
  fromFrameId: string,
  toFrameId: string,
): MovementPlan | undefined =>
  plans?.find(
    (plan) =>
      plan.targetType === targetType &&
      plan.targetId === targetId &&
      plan.fromFrameId === fromFrameId &&
      plan.toFrameId === toFrameId,
  );

export const resolveMovementPlan = (
  project: Project,
  targetType: MovementTargetType,
  targetId: string,
  fromFrame: FormationFrame,
  toFrame: FormationFrame,
): MovementPlan | undefined => {
  return findMovementPlan(
    project.movementPlans,
    targetType,
    targetId,
    fromFrame.id,
    toFrame.id,
  );
};

export const getPlanTiming = (
  plan: MovementPlan | undefined,
  fromFrame: FormationFrame,
  toFrame: FormationFrame,
): { startSec: number; endSec: number } => {
  const startSec = plan?.startSec ?? fromFrame.timeSec;
  const endSec = plan?.endSec ?? toFrame.timeSec;
  return { startSec, endSec };
};

const progressForPlan = (
  plan: MovementPlan | undefined,
  fromFrame: FormationFrame,
  toFrame: FormationFrame,
  timeSec: number,
): number => {
  const { startSec, endSec } = getPlanTiming(plan, fromFrame, toFrame);
  const span = endSec - startSec;
  return span > 0 ? clamp01((timeSec - startSec) / span) : 0;
};

const interpolatePositionByPath = (
  start: Position,
  end: Position,
  path: MovementPath | MovementPlan | undefined,
  t: number,
): Position => {
  const pathType = getMovementPathType(path);
  if (pathType === "hold") {
    return start;
  }
  if (pathType === "curve" && path?.controlPoint) {
    return quadraticPoint(start, path.controlPoint, end, t);
  }
  if (pathType === "orthogonal-hv") {
    return t < 0.5
      ? { x: lerp(start.x, end.x, t * 2), y: start.y }
      : { x: end.x, y: lerp(start.y, end.y, (t - 0.5) * 2) };
  }
  if (pathType === "orthogonal-vh") {
    return t < 0.5
      ? { x: start.x, y: lerp(start.y, end.y, t * 2) }
      : { x: lerp(start.x, end.x, (t - 0.5) * 2), y: end.y };
  }
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
  };
};

export const getSnapshotForFrame = (
  project: Project,
  frameId: string | null,
): StageSnapshot => {
  const sortedFrames = sortFrames(project.frames);
  const frameIndex = Math.max(
    0,
    sortedFrames.findIndex((frame) => frame.id === frameId),
  );

  return {
    memberVisibility: Object.fromEntries(
      project.members.map((member) => [
        member.id,
        resolveMemberVisibilityAtFrameIndex(sortedFrames, frameIndex, member.id),
      ]),
    ),
    memberAppearanceOverrides:
      sortedFrames[frameIndex]?.memberAppearanceOverrides ?? {},
    positions: Object.fromEntries(
      project.members.map((member) => [
        member.id,
        resolvePositionAtFrameIndex(project, sortedFrames, frameIndex, member.id),
      ]),
    ),
    objectStates: Object.fromEntries(
      project.stageObjects.map((object) => [
        object.id,
        resolveObjectAtFrameIndex(object, sortedFrames, frameIndex),
      ]),
    ),
  };
};

export const interpolateProjectAtTime = (
  project: Project,
  timeSec: number,
): StageSnapshot => {
  const activeFrame = getActiveFrameAtTime(project.frames, timeSec);
  if (!activeFrame) {
    return {
      memberAppearanceOverrides: {},
      memberVisibility: {},
      objectStates: {},
      positions: {},
    };
  }
  // MVPでは再生中もMovementPlanを反映せず、timeSecで決まる現在シーンの
  // 静的な隊列表だけを表示する。
  return getSnapshotForFrame(project, activeFrame.id);
};
