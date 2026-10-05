import type { Project } from "../types";
import { isValidStorageId } from "../repositories/ids";

export class LegacyImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
type Obj = Record<string, unknown>;
type Rule = (v: unknown, path: string) => void;
const fail = (path: string, message: string): never => { throw new LegacyImportError("INCOMPLETE", `${path}: ${message}`); };
export const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const scalar = (check: (v: unknown) => boolean, label: string): Rule => (v, p) => { if (!check(v)) fail(p, label); };
const str = scalar(v => typeof v === "string", "文字列が必要です");
const id = scalar(v => isValidStorageId(v) && !["__proto__", "constructor", "prototype"].includes(v), "IDが不正です");
const num = scalar(v => typeof v === "number" && Number.isFinite(v), "有限数が必要です");
const bool = scalar(v => typeof v === "boolean", "真偽値が必要です");
const choice = (...values: string[]) => scalar(v => typeof v === "string" && values.includes(v), "未対応の値です");
const shape = (required: Record<string, Rule>, optional: Record<string, Rule> = {}): Rule => (v, p) => {
  if (!object(v)) fail(p, "オブジェクトが必要です");
  const o = v as Obj;
  for (const [k, rule] of Object.entries(required)) rule(o[k], `${p}.${k}`);
  for (const k of Object.keys(o)) {
    const rule = Object.prototype.hasOwnProperty.call(required, k) ? required[k]
      : Object.prototype.hasOwnProperty.call(optional, k) ? optional[k] : undefined;
    if (!rule) fail(`${p}.${k}`, "未対応の項目です");
    if (rule && !Object.prototype.hasOwnProperty.call(required, k)) rule(o[k], `${p}.${k}`);
  }
};
const array = (rule: Rule): Rule => (v, p) => { if (!Array.isArray(v)) fail(p, "配列が必要です"); (v as unknown[]).forEach((x, i) => rule(x, `${p}[${i}]`)); };
const map = (rule: Rule): Rule => (v, p) => {
  if (!object(v)) fail(p, "マップが必要です");
  for (const [k, x] of Object.entries(v as Obj)) { id(k, `${p}のキー`); rule(x, `${p}.${k}`); }
};
const nullable = (rule: Rule): Rule => (v, p) => { if (v !== null) rule(v, p); };
const fields = (names: string[], rule: Rule) => Object.fromEntries(names.map(k => [k, rule]));
const point = shape({ x: num, y: num });
const objType = choice("prop", "setPiece", "chair", "table", "panel", "curtain", "mark", "area", "custom");
const objShape = choice("rectangle", "circle", "line", "curtain", "custom");
const pathType = choice("straight", "curve", "orthogonal-hv", "orthogonal-vh", "hold", "enter", "exit");
const stage = shape({ ...fields(["widthMeters", "depthMeters", "gridSizeMeters"], num),
  ...fields(["showGrid", "showCenterLine", "showStageLabels"], bool), audienceSide: choice("bottom", "top") }, {
  ...fields(["memberDiameterMeters", "gridIntervalM", "memberCircleDiameterM"], num),
  ...fields(["showCenterMarker", "fixedForAllScenes"], bool), frontDirection: choice("bottom", "top", "left", "right"),
  originMode: choice("topLeft", "center", "audienceCenter"), ...fields(["horizontalGuideMode", "horizontalDisplayMode"], choice("meters", "centerSplit")),
});
const audio = nullable(shape({ id, name: str, type: str, size: num }, { duration: num }));
const settingsFields = {
  mode: choice("stage", "parade"), paradeSettings: shape({ ...fields(["totalDistance", "width", "cellSizeMeters"], num),
    direction: choice("up"), rulerPosition: choice("both", "left", "right", "none"), ...fields(["emphasizeEvery5m", "emphasizeEvery10m"], bool) },
  { backwardDistanceMeters: num, horizontalMeasureMode: choice("centerSplit", "normalMeter") }),
  ...fields(["useGlobalStageSize", "useGlobalStageWidth"], bool), viewerPerspective: choice("audience", "performer"), focusMemberId: id,
  animationSettings: shape(fields(["membersEnabled", "objectsEnabled", "curtainsEnabled"], bool)),
  guideSettings: shape(fields(["snapGuideEnabled", "snapToGuideEnabled"], bool)),
};
const member = shape({ id, name: str, color: str }, { visible: bool, zIndex: num });
const stageObject = shape({ id, type: objType, name: str, color: str, shape: objShape,
  ...fields(["widthMeters", "heightMeters", "defaultX", "defaultY", "defaultRotation", "zIndex"], num), visible: bool, locked: bool });
const state = shape({ objectId: id, ...fields(["x", "y", "widthMeters", "heightMeters", "rotation", "zIndex"], num), visible: bool });
const sceneFields = { ...fields(["section", "notes"], str), ...fields(["stageWidthMeters", "stageDepthMeters"], num),
  memberVisibility: map(bool), groupVisibility: map(bool), memberAppearanceOverrides: map(shape({}, { color: str })), objectAssignments: map(array(id)),
  sceneViewState: shape({ scrollTop: num, scrollLeft: num, zoom: num }, fields(["viewportHeight", "viewportWidth"], num)) };
const movementFields = { pathType, controlPoint: point, visible: bool };
const groupFields = { color: str };
const membersFields = { members: array(member) };
const membersOptional = { memberGroups: array(shape({ id, name: str, memberIds: array(id) }, groupFields)) };
const objectsFields = { stageObjects: array(stageObject) };
const objectsOptional = { objectGroups: array(shape({ id, name: str, objectIds: array(id) }, { ...groupFields, defaultType: objType, defaultShape: objShape })) };
const movementOptional = {
  movementPaths: array(shape({ fromFrameId: id, toFrameId: id }, { id, targetType: choice("member", "object"), targetId: id, memberId: id,
    ...movementFields, type: choice("straight", "quadratic") })),
  movementPlans: array(shape({ id, fromFrameId: id, toFrameId: id, targetType: choice("member", "object"), targetId: id },
    { ...movementFields, enabled: bool, startSec: num, endSec: num, waypoints: array(point), note: str })),
};
const frameOrder = shape({ id, label: str, timeSec: num }, { section: str });
const scene = shape({ positions: map(point), objectStates: map(state) }, Object.fromEntries(Object.entries(sceneFields).filter(([k]) => k !== "section")));
const unique = (items: { id?: string }[], p: string) => {
  const seen = new Set<string>();
  for (const item of items) if (item.id !== undefined) { if (seen.has(item.id)) fail(p, `IDが重複しています (${item.id})`); seen.add(item.id); }
  return seen;
};
const ref = (value: string, ids: Set<string>, p: string) => { if (!ids.has(value)) fail(p, `参照先がありません (${value})`); };
type ReferenceFields = Pick<Project, "members" | "stageObjects" | "memberGroups" | "objectGroups" | "focusMemberId" | "movementPaths" | "movementPlans">;
type SceneReferences = Pick<Project["frames"][number], "positions" | "objectStates" | "memberVisibility" | "memberAppearanceOverrides" | "groupVisibility" | "objectAssignments">;
/** Strict reference check; never repairs or removes a dangling reference. */
function checkReferenceParts(p: ReferenceFields, scenes: Set<string>, rows: { id: string; data: SceneReferences }[]) {
  const members = unique(p.members, "members"), objects = unique(p.stageObjects, "stageObjects");
  const groups = unique(p.memberGroups ?? [], "memberGroups"); unique(p.objectGroups ?? [], "objectGroups");
  unique(p.movementPlans ?? [], "movementPlans"); unique(p.movementPaths ?? [], "movementPaths");
  for (const g of p.memberGroups ?? []) { if (new Set(g.memberIds).size !== g.memberIds.length) fail("memberGroups", "参照が重複しています"); g.memberIds.forEach(x => ref(x, members, "memberGroups")); }
  for (const g of p.objectGroups ?? []) { if (new Set(g.objectIds).size !== g.objectIds.length) fail("objectGroups", "参照が重複しています"); g.objectIds.forEach(x => ref(x, objects, "objectGroups")); }
  if (p.focusMemberId) ref(p.focusMemberId, members, "focusMemberId");
  for (const { id: sceneId, data: f } of rows) {
    for (const key of ["positions", "memberVisibility", "memberAppearanceOverrides"] as const) Object.keys(f[key] ?? {}).forEach(x => ref(x, members, `${sceneId}.${key}`));
    Object.keys(f.groupVisibility ?? {}).forEach(x => ref(x, groups, `${sceneId}.groupVisibility`));
    for (const [key, value] of Object.entries(f.objectStates)) { ref(key, objects, `${sceneId}.objectStates`); if (value.objectId !== key) fail(sceneId, "道具IDとキーが一致しません"); }
    for (const [key, values] of Object.entries(f.objectAssignments ?? {})) {
      ref(key, objects, `${sceneId}.objectAssignments`);
      if (new Set(values).size !== values.length) fail(sceneId, "割当が重複しています"); values.forEach(x => ref(x, members, `${sceneId}.objectAssignments`));
    }
  }
  for (const m of [...p.movementPaths ?? [], ...p.movementPlans ?? []]) {
    ref(m.fromFrameId, scenes, "movement.fromFrameId"); ref(m.toFrameId, scenes, "movement.toFrameId");
    const target = m.targetId ?? ("memberId" in m ? m.memberId : undefined);
    if (!target) fail("movement", "対象IDがありません");
    ref(target!, m.targetType === "object" ? objects : members, "movement.targetId");
    if ("memberId" in m && m.memberId) ref(m.memberId, members, "movement.memberId");
  }
}
export function checkReferences(p: Project) {
  checkReferenceParts(p, unique(p.frames, "frames"), p.frames.map(f => ({ id: f.id, data: f })));
}
export function validateIndependentProject(value: unknown): Project {
  shape({ version: num, title: str, updatedAt: str, stage, ...membersFields, ...objectsFields,
    frames: array(shape({ id, label: str, timeSec: num, positions: map(point), objectStates: map(state) }, sceneFields)) },
  { id, ...fields(["createdAt", "lastOpenedAt"], str), audio, ...settingsFields, ...membersOptional, ...objectsOptional, ...movementOptional })(value, "隊列表");
  const p = value as Project; checkReferences(p); return p;
}
export type LegacySnapshot = { contractVersion: 1; project: { id: string; title: string; mode: "stage" | "parade"; schema_version: number;
  legacy_project_id: string | null; created_at: string; updated_at: string }; resources: { resource_key: string; data: Obj; version: number; schema_version: number }[];
  scenes: { scene_id: string; data: Obj; version: number; schema_version: number }[] };
const date = scalar(v => typeof v === "string" && Number.isFinite(Date.parse(v)), "日時が不正です");
export const uuid = scalar(v => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v), "UUIDが不正です");
const revision = scalar(v => Number.isSafeInteger(v) && (v as number) >= 1, "旧revisionが不正です");
const schema = (v: unknown) => { if (v !== 1) throw new LegacyImportError("UNSUPPORTED_SCHEMA", "未対応の旧schemaです"); };
export function validateSnapshot(value: unknown, expectedId: string): LegacySnapshot {
  shape({ contractVersion: scalar(v => v === 1, "未対応のexport契約です"), project: shape({ id: uuid, title: str, mode: choice("stage", "parade"),
    schema_version: schema, legacy_project_id: nullable(str), created_at: date, updated_at: date }),
    resources: array(shape({ resource_key: str, data: scalar(object, "resource本文が不正です"), version: revision, schema_version: schema })),
    scenes: array(shape({ scene_id: id, data: scalar(object, "scene本文が不正です"), version: revision, schema_version: schema })) })(value, "export");
  const s = value as LegacySnapshot;
  if (s.project.id !== expectedId) fail("export", "要求した文書IDと一致しません");
  const rules: Record<string, Rule> = { members: shape(membersFields, membersOptional), objects: shape(objectsFields, objectsOptional),
    settings: shape({ stage }, settingsFields), audio: shape({ audio }), sceneOrder: shape({ frames: array(frameOrder) }, movementOptional) };
  const resources = new Map<string, Obj>();
  for (const r of s.resources) { if (!Object.prototype.hasOwnProperty.call(rules, r.resource_key) || resources.has(r.resource_key)) fail("resources", "不明または重複したresourceです");
    rules[r.resource_key](r.data, r.resource_key); resources.set(r.resource_key, r.data); }
  if (resources.size !== 5) fail("resources", "5種類のresourceが揃っていません");
  const order = resources.get("sceneOrder")!.frames as Project["frames"];
  const ids = unique(order, "sceneOrder"), seen = new Set<string>();
  for (const row of s.scenes) { if (seen.has(row.scene_id)) fail("scenes", "scene IDが重複しています");
    if (!ids.has(row.scene_id)) fail("scenes", "sceneOrderにない余剰sceneです"); seen.add(row.scene_id); scene(row.data, row.scene_id); }
  if (seen.size !== ids.size) fail("scenes", "sceneOrderが参照するsceneが欠けています");
  const settings = resources.get("settings")!;
  if (settings.mode !== undefined && settings.mode !== s.project.mode) fail("settings.mode", "文書のmodeと一致しません");
  // Check raw resource/scene references before snapshotProject is ever called.
  // These are validated domain fields and raw scene data, not rebuilt frames.
  const memberData = resources.get("members")! as Pick<Project, "members" | "memberGroups">;
  const objectData = resources.get("objects")! as Pick<Project, "stageObjects" | "objectGroups">;
  const movementData = resources.get("sceneOrder")! as Pick<Project, "movementPaths" | "movementPlans">;
  checkReferenceParts({ ...memberData, ...objectData, ...movementData, focusMemberId: settings.focusMemberId as string | undefined }, ids,
    s.scenes.map(row => ({ id: row.scene_id, data: row.data as SceneReferences })));
  return s;
}
export function snapshotProject(s: LegacySnapshot, targetId: string): Project {
  const r = Object.fromEntries(s.resources.map(row => [row.resource_key, row.data]));
  const scenes = new Map(s.scenes.map(row => [row.scene_id, row.data]));
  return { ...r.settings, ...r.members, ...r.objects, ...r.audio, ...r.sceneOrder,
    id: targetId, version: 1, title: s.project.title, mode: s.project.mode, createdAt: s.project.created_at, updatedAt: s.project.updated_at,
    frames: (r.sceneOrder.frames as Project["frames"]).map(f => ({ ...f, ...scenes.get(f.id)! })) } as Project;
}
