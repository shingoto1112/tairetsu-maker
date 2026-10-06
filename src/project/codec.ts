import type { Project } from "../types";
import { assertStorageId, isValidStorageId } from "../repositories/ids";
import {
  assertRevision, RepositoryError,
  type PersonalSyncState, type ProjectSummary, type RepositoryResult, type Revision, type CollaborationData,
} from "../repositories/types";
import { normalizeProject, normalizeProjectWithContext, type NormalizationContext } from "./normalizeProject";

type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const string = (v: unknown) => typeof v === "string";
const boolean = (v: unknown) => typeof v === "boolean";
const oneOf = (...values: string[]) => (v: unknown) => typeof v === "string" && values.includes(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");
const position = (v: unknown) => object(v) && finite(v.x) && finite(v.y);
const fields = (v: JsonObject, names: string[], check: (v: unknown) => boolean) =>
  names.every(name => v[name] === undefined || check(v[name]));
const map = (v: unknown, check: (v: unknown) => boolean) =>
  v == null || (object(v) && Object.values(v).every(check));
const array = (v: unknown, check: (v: JsonObject) => boolean) =>
  v === undefined || (Array.isArray(v) && v.every(x => object(x) && check(x)));

/** Structural validation is separate from legacy defaulting. Missing optional
 * legacy fields are accepted, malformed nested data is CORRUPT. Unknown JSON
 * fields are neither removed nor interpreted. Project.version is NOT a storage
 * schema discriminator; adapters must classify unsupported envelopes separately.
 */
export const validateProjectStructure = (value: unknown): RepositoryResult<Project> => {
  if (!object(value)) return { ok: false, error: new RepositoryError("CORRUPT") };
  const p = value;
  if ((p.id !== undefined && !isValidStorageId(p.id)) ||
      (object(p.audio) && !isValidStorageId(p.audio.id))) {
    return { ok: false, error: new RepositoryError("INVALID_ID") };
  }
  const valid = ["title", "stage", "members", "stageObjects", "frames"].some(k => k in p) &&
    fields(p, ["title", "createdAt", "updatedAt", "lastOpenedAt"], v => typeof v === "string") &&
    fields(p, ["version"], finite) &&
    fields(p, ["mode"], oneOf("stage", "parade")) &&
    fields(p, ["viewerPerspective"], oneOf("audience", "performer")) &&
    fields(p, ["focusMemberId"], string) &&
    fields(p, ["useGlobalStageSize", "useGlobalStageWidth", "fixedForAllScenes"], boolean) &&
    fields(p, ["stageWidthM", "stageHeightM", "stageDepthM", "widthM", "heightM", "depthM", "gridIntervalM", "memberCircleDiameterM"], finite) &&
    (p.stage == null || (object(p.stage) &&
      fields(p.stage, ["widthMeters", "depthMeters", "gridSizeMeters", "memberDiameterMeters",
        "stageWidthM", "stageHeightM", "widthM", "heightM", "depthM", "gridIntervalM", "memberCircleDiameterM"], finite) &&
      fields(p.stage, ["emphasizeHorizontalNumbers", "emphasizeHorizontalEvery5", "emphasizeHorizontalEvery10", "emphasizeVerticalNumbers", "emphasizeVerticalEvery5m", "emphasizeVerticalEvery10m", "showGrid", "showCenterLine", "showStageLabels", "showCenterMarker", "fixedForAllScenes", "centerSplitBandEnabled", "coneGuideEnabled"], boolean) &&
      fields(p.stage, ["audienceSide"], oneOf("bottom", "top")) &&
      fields(p.stage, ["frontDirection"], oneOf("bottom", "top", "left", "right")) &&
      fields(p.stage, ["originMode"], oneOf("topLeft", "center", "audienceCenter")) &&
      fields(p.stage, ["horizontalGuideMode", "horizontalDisplayMode"], oneOf("meters", "centerSplit")))) &&
    (p.paradeSettings == null || (object(p.paradeSettings) &&
      fields(p.paradeSettings, ["totalDistance", "width", "cellSizeMeters", "backwardDistanceMeters"], finite) &&
      fields(p.paradeSettings, ["emphasizeHorizontalNumbers", "emphasizeHorizontalEvery5", "emphasizeHorizontalEvery10", "emphasizeVerticalNumbers", "emphasizeEvery5m", "emphasizeEvery10m"], boolean) &&
      fields(p.paradeSettings, ["direction"], oneOf("up")) &&
      fields(p.paradeSettings, ["rulerPosition"], oneOf("both", "left", "right", "none")) &&
      fields(p.paradeSettings, ["horizontalMeasureMode"], string))) &&
    (p.audio == null || (object(p.audio) && typeof p.audio.name === "string" &&
      typeof p.audio.type === "string" && finite(p.audio.size) && fields(p.audio, ["duration"], finite))) &&
    array(p.members, m => typeof m.id === "string" && typeof m.name === "string" && typeof m.color === "string" &&
      fields(m, ["visible"], boolean) && fields(m, ["zIndex"], finite)) &&
    array(p.stageObjects, o => typeof o.id === "string" && typeof o.name === "string" &&
      oneOf("prop", "setPiece", "chair", "table", "panel", "curtain", "mark", "area", "custom")(o.type) &&
      oneOf("rectangle", "circle", "line", "curtain", "custom")(o.shape) && typeof o.color === "string" &&
      fields(o, ["visible", "locked"], boolean) &&
      fields(o, ["widthMeters", "heightMeters", "defaultX", "defaultY", "defaultRotation", "zIndex"], finite)) &&
    array(p.frames, f => typeof f.id === "string" && typeof f.label === "string" && finite(f.timeSec) &&
      fields(f, ["section", "notes"], string) &&
      map(f.positions, position) &&
      map(f.objectStates, s => object(s) && typeof s.objectId === "string" &&
        ["x", "y", "widthMeters", "heightMeters", "rotation", "zIndex"].every(k => finite(s[k])) && typeof s.visible === "boolean") &&
      map(f.memberVisibility, v => typeof v === "boolean") && map(f.groupVisibility, v => typeof v === "boolean") &&
      map(f.objectAssignments, strings) &&
      map(f.memberAppearanceOverrides, v => object(v) && fields(v, ["color"], x => typeof x === "string")) &&
      fields(f, ["stageWidthMeters", "stageDepthMeters"], finite) &&
      (f.sceneViewState == null || (object(f.sceneViewState) &&
        fields(f.sceneViewState, ["scrollTop", "scrollLeft", "zoom", "viewportHeight", "viewportWidth"], finite)))) &&
    array(p.memberGroups, g => typeof g.id === "string" && strings(g.memberIds) && fields(g, ["name", "color"], string)) &&
    array(p.objectGroups, g => typeof g.id === "string" && strings(g.objectIds) && fields(g, ["name", "color", "defaultType", "defaultShape"], string)) &&
    array(p.movementPaths, path => fields(path, ["id", "targetId", "memberId", "targetType", "fromFrameId", "toFrameId", "pathType", "type"], v => typeof v === "string") &&
      fields(path, ["visible"], boolean) && (path.controlPoint === undefined || position(path.controlPoint))) &&
    array(p.movementPlans, plan => typeof plan.targetId === "string" && typeof plan.targetType === "string" &&
      typeof plan.fromFrameId === "string" && typeof plan.toFrameId === "string" &&
      fields(plan, ["id", "pathType", "note"], string) && fields(plan, ["enabled"], boolean) &&
      fields(plan, ["startSec", "endSec"], finite) && (plan.controlPoint === undefined || position(plan.controlPoint)) &&
      (plan.waypoints === undefined || (Array.isArray(plan.waypoints) && plan.waypoints.every(position)))) &&
    (p.animationSettings == null || (object(p.animationSettings) &&
      fields(p.animationSettings, ["membersEnabled", "objectsEnabled", "curtainsEnabled"], boolean))) &&
    (p.guideSettings == null || (object(p.guideSettings) &&
      fields(p.guideSettings, ["snapGuideEnabled", "snapToGuideEnabled"], boolean)));
  return valid ? { ok: true, value: value as unknown as Project } : { ok: false, error: new RepositoryError("CORRUPT") };
};

/** New repository entry point; deliberately not connected to existing storage
 * or ZIP import yet. Migration must inject stable IDs from its ledger later.
 */
export const decodeProjectJson = (json: string, context?: NormalizationContext): RepositoryResult<Project> => {
  try {
    const checked = validateProjectStructure(JSON.parse(json));
    if (!checked.ok) return checked;
    const project = context ? normalizeProjectWithContext(checked.value, context) : normalizeProject(checked.value);
    assertStorageId(project.id);
    return { ok: true, value: project };
  } catch (error) {
    return { ok: false, error: error instanceof RepositoryError ? error : new RepositoryError("CORRUPT") };
  }
};

/** No pretty-printing, envelope or field pruning; audio remains metadata only. */
export const serializeProject = (project: Project): RepositoryResult<string> => {
  try {
    const checked = validateProjectStructure(project);
    if (!checked.ok) return checked;
    if (!object(project.stage) || !Array.isArray(project.members) || !Array.isArray(project.stageObjects) ||
        !Array.isArray(project.frames) || typeof project.title !== "string" ||
        !finite(project.version) || typeof project.updatedAt !== "string") {
      return { ok: false, error: new RepositoryError("CORRUPT") };
    }
    assertStorageId(project.id);
    return { ok: true, value: JSON.stringify(project) };
  } catch (error) {
    return { ok: false, error: error instanceof RepositoryError ? error : new RepositoryError("CORRUPT") };
  }
};

export type ProjectSummaryFields = Omit<ProjectSummary, "repositoryRevision" | "syncStatus">;
export const projectSummaryFields = (project: Project): ProjectSummaryFields => ({
  id: assertStorageId(project.id),
  title: project.title,
  mode: project.mode === "parade" ? "parade" : "stage",
  createdAt: project.createdAt ?? project.updatedAt,
  updatedAt: project.updatedAt,
  ...(project.lastOpenedAt === undefined ? {} : { lastOpenedAt: project.lastOpenedAt }),
  memberCount: project.members.length,
  sceneCount: project.frames.length,
  ...(project.audio ? { audioId: assertStorageId(project.audio.id) } : {}),
});

export const createProjectSummary = (
  project: Project, repositoryRevision: Revision, sync: PersonalSyncState | null = null, collaboration?: CollaborationData | null,
): ProjectSummary => ({
  ...projectSummaryFields(project),
  repositoryRevision: assertRevision(repositoryRevision),
  syncStatus: sync === null ? "local" : sync.status === "auth-required" ? "error" : sync.status,
  ...(collaboration?.sharedDocumentId ? { sharing: { documentId: collaboration.sharedDocumentId,
    ...(collaboration.transportBinding ?? {}) } } : {}),
});
