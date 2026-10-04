import * as Y from "yjs";
import type { Project } from "../types";
import { ENTITY_ROOTS, getModel, SCHEMA_VERSION, type EntityRoot, type EntityRecord } from "./model";
import { assertFullState } from "./serverSchema2";

export { fieldNames, atoms, sceneMaps, settingAtoms } from "./projectSchema";
import { fieldNames, atoms, sceneMaps, settingAtoms } from "./projectSchema";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Data = Record<string, unknown>;
export const clone = <T>(v: T): T => v === undefined ? v : JSON.parse(JSON.stringify(v)) as T;
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  const left = a as Data, right = b as Data;
  const keys = Object.keys(left).filter(k => left[k] !== undefined), other = Object.keys(right).filter(k => right[k] !== undefined);
  return keys.length === other.length && keys.every(k => Object.prototype.hasOwnProperty.call(right, k) && same(left[k], right[k]));
};
export const localFields = ["audio", "focusMemberId", "viewerPerspective", "lastOpenedAt", "updatedAt"] as const;
export const listField = (root: EntityRoot): keyof Project => root === "scenes" ? "frames" : root;
export const orderKey = (...parts: string[]) => JSON.stringify(parts);
export type Slot = { elementId: string; slotId: string };
export function order(doc: Y.Doc, key: string, create = false): Y.Map<unknown> | undefined {
  const orders = getModel(doc).orders;
  let value = orders.get(key);
  if (!value && create) {
    value = new Y.Map(); orders.set(key, value);
    value.set("slots", new Y.Array<Slot>()); value.set("active", new Y.Map<string>());
  }
  return value;
}
export function orderedIds(doc: Y.Doc, key: string): string[] {
  const value = order(doc, key);
  if (!value) return [];
  const active = value.get("active") as Y.Map<string>, seen = new Set<string>();
  return (value.get("slots") as Y.Array<Slot>).toArray().filter(slot => {
    if (active.get(slot.elementId) !== slot.slotId || seen.has(slot.elementId)) return false;
    seen.add(slot.elementId); return true;
  }).map(slot => slot.elementId);
}
/** Old slots remain for Undo and disconnected peers. A single active slot wins. */
export function moveSlot(doc: Y.Doc, key: string, id: string, beforeId?: string): void {
  const value = order(doc, key, true)!;
  const slots = value.get("slots") as Y.Array<Slot>, active = value.get("active") as Y.Map<string>;
  const beforeSlot = beforeId && active.get(beforeId);
  const index = beforeSlot ? slots.toArray().findIndex(slot => slot.slotId === beforeSlot) : -1;
  const slotId = crypto.randomUUID();
  slots.insert(index < 0 ? slots.length : index, [{ elementId: id, slotId }]); active.set(id, slotId);
}
export function deleted(doc: Y.Doc, root: EntityRoot, id: string): boolean {
  for (const [key, enabled] of getModel(doc).tombstones) {
    const parts = JSON.parse(key) as string[];
    if (enabled && parts[0] === root && parts[1] === id) return true;
  }
  return false;
}
export function entityFields(root: EntityRoot | "objectState", input: Data): Data {
  const result: Data = {};
  for (const key of root === "objectState" ? ["visible", "zIndex"] : fieldNames[root])
    if (input[key] !== undefined) result[key] = input[key];
  for (const [key, fields] of Object.entries(atoms[root] ?? {})) {
    const values = Object.fromEntries(fields.filter(f => input[f] !== undefined).map(f => [f, input[f]]));
    if (Object.keys(values).length) result[key] = values;
  }
  return result;
}
export function expandFields(root: EntityRoot | "objectState", input: Data): Data {
  const result = { ...input };
  for (const key of Object.keys(atoms[root] ?? {})) {
    if (result[key]) Object.assign(result, result[key]);
    delete result[key];
  }
  return result;
}

// Related aliases and stage/parade dimensions are one value, unrelated settings
// are independent registers. Paths are a closed whitelist, also used by Edge.
export function settingsFields(project: Project): Data {
  const result: Data = {};
  for (const [atom, paths] of Object.entries(settingAtoms)) {
    const values: Data = {};
    for (const path of paths) {
      const [first, second] = path.split(".");
      const parent = project as unknown as Data;
      const value = second ? (parent[first] as Data | undefined)?.[second] : parent[first];
      if (value !== undefined) values[path] = value;
    }
    if (Object.keys(values).length) result[atom] = values;
  }
  // Empty optional collections/settings and null audio remain distinguishable.
  for (const key of ["memberGroups", "objectGroups", "movementPlans", "movementPaths", "paradeSettings", "animationSettings", "guideSettings"])
    if ((project as unknown as Data)[key] !== undefined) result[`has.${key}`] = true;
  if (project.audio !== undefined) {
    const { id: _localId, ...descriptor } = project.audio ?? { id: "" };
    result.song = project.audio === null ? null : descriptor;
  }
  return result;
}
export function initializeEntity(doc: Y.Doc, root: EntityRoot, input: Data & { id: string }): EntityRecord {
  const model = getModel(doc), record = new Y.Map<unknown>();
  (model[root] as Y.Map<EntityRecord>).set(input.id, record);
  for (const [key, value] of Object.entries(entityFields(root, input))) record.set(key, clone(value));
  if (root === "scenes") {
    record.set("notes", new Y.Text(typeof input.notes === "string" ? input.notes : ""));
    if (input.notes !== undefined) record.set("has.notes", true);
    for (const key of sceneMaps) {
      const map = new Y.Map<unknown>(); record.set(key, map);
      if (input[key] !== undefined) record.set(`has.${key}`, true);
      if (key === "objectStates") {
        for (const [id, state] of Object.entries(input[key] as Data ?? {}))
          for (const [field, value] of Object.entries(entityFields("objectState", state as Data))) map.set(orderKey(id, field), clone(value));
      } else if (key === "objectAssignments") {
        for (const [id, members] of Object.entries(input[key] as Data ?? {})) {
          record.set(orderKey("assignment", id), true);
          for (const member of members as string[]) map.set(orderKey(id, member), true);
        }
      } else for (const [id, value] of Object.entries(input[key] as Data ?? {})) map.set(id, clone(value));
    }
  }
  if (root === "memberGroups" || root === "objectGroups") {
    const key = root === "memberGroups" ? "memberIds" : "objectIds";
    record.set(key, new Y.Map<boolean>((input[key] as string[]).map(id => [id, true])));
    for (const id of input[key] as string[]) moveSlot(doc, orderKey(root, input.id, key), id);
  }
  return record;
}
export function initializeProject(doc: Y.Doc, project: Project): void {
  // JSON and reference validation happen before transact; Yjs does not roll back.
  assertProjectInput(project);
  const model = getModel(doc);
  doc.transact(() => {
    model.metadata.set("schemaVersion", SCHEMA_VERSION); model.metadata.set("projectId", project.id!);
    model.metadata.set("version", project.version);
    if (project.createdAt !== undefined) model.metadata.set("createdAt", project.createdAt);
    for (const [key, value] of Object.entries(settingsFields(project))) model.settings.set(key, clone(value));
    for (const root of ENTITY_ROOTS) {
      order(doc, orderKey(root), true);
      for (const raw of (project[listField(root)] ?? []) as (Data & { id?: string })[]) {
        const input = { ...raw, id: raw.id ?? crypto.randomUUID() };
        initializeEntity(doc, root, input); moveSlot(doc, orderKey(root), input.id);
      }
    }
    for (const scene of project.frames) for (const object of project.stageObjects) {
      order(doc, orderKey("assignments", scene.id, object.id), true);
      for (const member of scene.objectAssignments?.[object.id] ?? []) moveSlot(doc, orderKey("assignments", scene.id, object.id), member);
    }
    for (const group of project.memberGroups ?? []) order(doc, orderKey("memberGroups", group.id, "memberIds"), true);
    for (const group of project.objectGroups ?? []) order(doc, orderKey("objectGroups", group.id, "objectIds"), true);
  }, Symbol("collaboration initialization"));
}
export function assertProjectInput(project: Project): void {
  for (const root of ENTITY_ROOTS) {
    const ids = ((project[listField(root)] ?? []) as { id?: string }[]).map(item => item.id).filter(id => id !== undefined);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error("Collaboration requires unique nonempty entity IDs");
  }
  const members = new Set(project.members.map(m => m.id));
  for (const scene of project.frames) for (const [id, p] of Object.entries(scene.positions)) {
    if (!members.has(id)) throw new Error("Unknown position member");
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("Invalid collaboration position");
  }
  checkJson(project);
}
/** Bounded plain JSON only; never clone nonfinite numbers into null silently. */
export function checkJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("Invalid collaboration value depth");
  if (value === undefined || value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && value.length <= 65536) return;
  if (Array.isArray(value)) { if (value.length > 100000) throw new Error("Invalid collaboration array"); value.forEach(v => checkJson(v, depth + 1)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, v] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid collaboration key");
      checkJson(v, depth + 1);
    }
    return;
  }
  throw new Error("Invalid collaboration value");
}
export function validateModel(doc: Y.Doc): void {
  assertFullState(doc);
  const model = getModel(doc);
  if (model.metadata.get("schemaVersion") !== SCHEMA_VERSION || typeof model.metadata.get("projectId") !== "string") throw new Error("unsupported collaboration document");
  for (const root of ENTITY_ROOTS) for (const record of model[root].values()) {
    if (!(record instanceof Y.Map)) throw new Error("Invalid collaboration entity");
    if (root === "scenes") {
      const scene = record as unknown as EntityRecord;
      if (!(scene.get("notes") instanceof Y.Text) || sceneMaps.some(key => !(scene.get(key) instanceof Y.Map))) throw new Error("Invalid collaboration scene");
    }
  }
}
