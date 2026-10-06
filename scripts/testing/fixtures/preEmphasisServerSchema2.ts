// Immutable validator snapshot from d7c9933, for rollout compatibility tests.
import * as Y from "yjs";
// @ts-ignore Deno uses explicit TS extensions; no runtime browser dependencies.
import { atoms, fieldNames, sceneMaps, settingAtoms } from "./preEmphasisProjectSchema.ts";
type Data = Record<string, unknown>;
const roots = ["members", "stageObjects", "scenes", "memberGroups", "objectGroups", "movementPlans", "movementPaths"];
const allRoots = ["metadata", "settings", ...roots, "orders", "tombstones"];
function fail(): never { throw new Error("INVALID_UPDATE"); }
const id = (value: unknown): value is string => typeof value === "string" && !!value && new TextEncoder().encode(value).length <= 255 &&
  !/[\\/:\u0000-\u001f\u007f-\u009f]/.test(value) && !value.includes("..") && !["__proto__", "constructor", "prototype"].includes(value);
const obj = (value: unknown): value is Data => !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
function tuple(value: string, length: number): string[] {
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { return fail(); }
  if (!Array.isArray(parsed) || parsed.length !== length || !parsed.every(id) || JSON.stringify(parsed) !== value) fail();
  return parsed as string[];
}
const enums: Record<string, string[]> = {
  mode: ["stage", "parade"], type: ["prop", "setPiece", "chair", "table", "panel", "curtain", "mark", "area", "custom"],
  shape: ["rectangle", "circle", "line", "curtain", "custom"], targetType: ["member", "object"],
  pathType: ["straight", "curve", "orthogonal-hv", "orthogonal-vh", "hold", "enter", "exit"],
  audienceSide: ["top", "bottom"], frontDirection: ["top", "bottom", "left", "right"], originMode: ["topLeft", "center", "audienceCenter"],
  horizontalGuideMode: ["meters", "centerSplit"], horizontalDisplayMode: ["meters", "centerSplit"],
  horizontalMeasureMode: ["centerSplit", "normalMeter"], direction: ["up"], rulerPosition: ["both", "left", "right", "none"],
};
const bools = new Set(["visible", "locked", "enabled", "showGrid", "showCenterLine", "showStageLabels", "showCenterMarker", "fixedForAllScenes", "useGlobalStageSize", "useGlobalStageWidth", "emphasizeEvery5m", "emphasizeEvery10m", "membersEnabled", "objectsEnabled", "curtainsEnabled", "snapGuideEnabled", "snapToGuideEnabled"]);
const strings = new Set(["name", "title", "color", "label", "section", "note", "createdAt"]);
function scalar(key: string, value: unknown): void {
  key = key.split(".").pop()!;
  if (key === "defaultType") key = "type";
  if (key === "defaultShape") key = "shape";
  if (bools.has(key)) { if (typeof value !== "boolean") fail(); }
  else if (["fromFrameId", "toFrameId", "targetId", "memberId"].includes(key)) { if (!id(value)) fail(); }
  else if (enums[key]) { if (!enums[key].includes(value as string)) fail(); }
  else if (strings.has(key)) { if (typeof value !== "string" || value.length > 65536) fail(); }
  else if (!number(value)) fail();
}
function position(value: unknown): void {
  if (!obj(value) || Object.keys(value).sort().join() !== "x,y" || !number(value.x) || !number(value.y)) fail();
}
function atom(kind: string, field: string, value: unknown): void {
  const keys = (atoms as Record<string, Record<string, string[]> | undefined>)[kind]?.[field];
  if (!keys || !obj(value) || !Object.keys(value).length || Object.keys(value).some(k => !keys.includes(k))) fail();
  for (const [key, v] of Object.entries(value as Data)) {
    if (key === "controlPoint") position(v);
    else if (key === "waypoints") { if (!Array.isArray(v) || v.length > 4096) fail(); (v as unknown[]).forEach(position); }
    else if (kind === "movementPaths" && key === "type") { if (!["straight", "quadratic"].includes(v as string)) fail(); }
    else scalar(key, v);
  }
  if (field === "geometry" && Object.keys(value as Data).length !== keys!.length) fail();
}
function typePath(doc: Y.Doc, type: Y.AbstractType<unknown>): string[] {
  const path: string[] = []; let current: Y.AbstractType<unknown> = type;
  for (let depth = 0; depth < 8; depth++) {
    if (!current._item) {
      const root = [...doc.share].find(([, value]) => value === current)?.[0];
      if (!root) return fail(); return [root, ...path];
    }
    if (!current._item.parentSub || !(current._item.parent instanceof Y.AbstractType)) fail();
    path.unshift(current._item.parentSub!); current = current._item.parent as Y.AbstractType<unknown>;
  }
  return fail();
}
function content(doc: Y.Doc, parent: Y.AbstractType<unknown>, key: string | null, value: unknown,
  paths: Map<Y.AbstractType<unknown>, string[]>): void {
  let path = paths.get(parent);
  if (!path) { path = typePath(doc, parent); paths.set(parent, path); }
  const [root, entity, field] = path;
  if (parent instanceof Y.Text) { if (root !== "scenes" || field !== "notes" || key !== null || typeof value !== "string") fail(); return; }
  if (parent instanceof Y.Array) {
    if (root !== "orders" || field !== "slots" || key !== null || !obj(value) || Object.keys(value).sort().join() !== "elementId,slotId" || !id(value.elementId) || !id(value.slotId)) fail(); return;
  }
  if (!(parent instanceof Y.Map) || key === null) fail();
  if (path.length === 1) {
    if (roots.includes(root)) { if (!id(key) || !(value instanceof Y.Map)) fail(); return; }
    if (root === "metadata") {
      if (key === "schemaVersion") { if (value !== 2) fail(); }
      else if (key === "projectId") { if (!id(value) || value !== doc.getMap("metadata").get(key)) fail(); }
      else if (key === "version") { if (!Number.isSafeInteger(value) || (value as number) < 1) fail(); }
      else if (key === "createdAt") scalar(key, value); else fail(); return;
    }
    if (root === "settings") {
      if (key.startsWith("has.")) {
        if (!["memberGroups", "objectGroups", "movementPlans", "movementPaths", "paradeSettings", "animationSettings", "guideSettings"].includes(key.slice(4)) || typeof value !== "boolean") fail(); return;
      }
      if (key === "song") {
        if (value === null) return;
        if (!obj(value) || !["name", "type", "size"].every(k => k in value) || Object.keys(value).some(k => !["name", "type", "size", "duration"].includes(k)) || typeof value.name !== "string" || typeof value.type !== "string" || !number(value.size) || value.duration !== undefined && !number(value.duration)) fail(); return;
      }
      if (!settingAtoms[key] || !obj(value) || !Object.keys(value).length || Object.keys(value).some(k => !settingAtoms[key].includes(k))) fail();
      for (const [k, v] of Object.entries(value as Data)) scalar(k, v); return;
    }
    if (root === "orders") {
      const parts = JSON.parse(key!) as unknown;
      if (!Array.isArray(parts) || !parts.every(id) || JSON.stringify(parts) !== key || !(value instanceof Y.Map)) fail();
      if (parts.length === 1 && roots.includes(parts[0])) return;
      if (parts.length === 3 && (parts[0] === "assignments" || parts[0] === "memberGroups" && parts[2] === "memberIds" || parts[0] === "objectGroups" && parts[2] === "objectIds")) return;
      fail();
    }
    if (root === "tombstones") { const parts = tuple(key!, 3); if (!roots.includes(parts[0]) || typeof value !== "boolean") fail(); return; }
    return fail();
  }
  if (root === "orders") {
    if (path.length === 2) { if (!(key === "slots" && value instanceof Y.Array || key === "active" && value instanceof Y.Map)) fail(); }
    else if (path.length === 3 && field === "active") { if (!id(key) || !id(value)) fail(); }
    else fail(); return;
  }
  if (!roots.includes(root) || !id(entity)) fail();
  if (path.length === 2) {
    if (root === "scenes") {
      if (key === "notes") { if (!(value instanceof Y.Text)) fail(); return; }
      if (sceneMaps.includes(key as never)) { if (!(value instanceof Y.Map)) fail(); return; }
      if (key.startsWith("has.") && ["notes", ...sceneMaps].includes(key.slice(4) as never)) { if (typeof value !== "boolean") fail(); return; }
      if (key.startsWith("[")) { const parts = tuple(key, 2); if (parts[0] !== "assignment" || typeof value !== "boolean") fail(); return; }
    }
    if (root === "memberGroups" && key === "memberIds" || root === "objectGroups" && key === "objectIds") { if (!(value instanceof Y.Map)) fail(); return; }
    if ((fieldNames as Record<string, string[]>)[root].includes(key)) scalar(key, value);
    else atom(root, key, value); return;
  }
  if (path.length !== 3) fail();
  if (root === "scenes") {
    if (field === "positions") { if (!id(key)) fail(); position(value); }
    else if (["memberVisibility", "groupVisibility"].includes(field)) { if (!id(key) || typeof value !== "boolean") fail(); }
    else if (field === "memberAppearanceOverrides") { if (!id(key) || !obj(value) || Object.keys(value).some(k => k !== "color") || value.color !== undefined && typeof value.color !== "string") fail(); }
    else if (field === "objectAssignments") { tuple(key, 2); if (typeof value !== "boolean") fail(); }
    else if (field === "objectStates") {
      const [, f] = tuple(key, 2); if (f === "geometry") atom("objectState", f, value); else if (["visible", "zIndex"].includes(f)) scalar(f, value); else fail();
    } else fail(); return;
  }
  if (root === "memberGroups" && field === "memberIds" || root === "objectGroups" && field === "objectIds") { if (!id(key) || typeof value !== "boolean") fail(); return; }
  fail();
}
/** Includes hidden/deleted history (gc:false), not just the visible projection. */
export function assertFullState(doc: Y.Doc): void {
  // Parent topology is immutable while this synchronous check runs. A positions
  // map often owns thousands of Items; validate its root path once per check.
  const paths = new Map<Y.AbstractType<unknown>, string[]>();
  if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error("MISSING_DEPENDENCIES");
  if ([...doc.share.keys()].some(root => !allRoots.includes(root))) fail();
  // Materialize decoded root maps before inspecting Item parent types.
  allRoots.forEach(root => doc.getMap(root));
  const metadata = doc.getMap("metadata");
  if (metadata.get("schemaVersion") !== 2 || !id(metadata.get("projectId")) || !Number.isSafeInteger(metadata.get("version"))) throw new Error("UNSUPPORTED_SCHEMA");
  if (doc.getMap("members").size > 500 || doc.getMap("scenes").size > 200) throw new Error("QUOTA_EXCEEDED");
  for (const root of roots) if (doc.getMap(root).size > 4096) throw new Error("QUOTA_EXCEEDED");
  const required: Record<string, string[]> = {
    members: ["name", "color"], stageObjects: [...fieldNames.stageObjects, "geometry"], scenes: ["label", "timeSec"],
    memberGroups: ["name", "memberIds"], objectGroups: ["name", "objectIds"],
    movementPlans: ["fromFrameId", "toFrameId", "targetType", "targetId"], movementPaths: ["fromFrameId", "toFrameId"],
  };
  if (!doc.getMap("settings").has("title")) fail();
  for (const root of roots) for (const record of doc.getMap(root).values()) {
    if (!(record instanceof Y.Map) || required[root].some(field => !record.has(field))) fail();
    const relation = root === "memberGroups" ? "memberIds" : root === "objectGroups" ? "objectIds" : undefined;
    if (relation && !(record.get(relation) instanceof Y.Map)) fail();
  }
  // A malformed replacement container must not reach projection and throw.
  for (const record of doc.getMap("orders").values()) {
    if (!(record instanceof Y.Map) || !(record.get("slots") instanceof Y.Array) || !(record.get("active") instanceof Y.Map)) fail();
    const slots = (record.get("slots") as Y.Array<{ elementId: string; slotId: string }>).toArray();
    const indexes = new Map(slots.map(slot => [slot.slotId, slot.elementId]));
    if (indexes.size !== slots.length) fail();
    for (const [elementId, slotId] of record.get("active") as Y.Map<string>) if (indexes.get(slotId) !== elementId) fail();
  }
  let positions = 0;
  for (const record of doc.getMap("scenes").values()) {
    if (!(record instanceof Y.Map) || !(record.get("notes") instanceof Y.Text) || sceneMaps.some(key => !(record.get(key) instanceof Y.Map))) fail();
    positions += (record.get("positions") as Y.Map<unknown>).size;
    if (positions > 100000 || (record.get("notes") as Y.Text).length > 65536) throw new Error("QUOTA_EXCEEDED");
  }
  for (const list of doc.store.clients.values()) for (const struct of list) {
    if (!(struct instanceof Y.Item) || struct.content instanceof Y.ContentDeleted) continue;
    if (!(struct.parent instanceof Y.AbstractType)) fail();
    for (const value of struct.content.getContent() as unknown[]) content(doc, struct.parent as Y.AbstractType<unknown>, struct.parentSub, value, paths);
  }
}
