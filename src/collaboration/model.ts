import * as Y from "yjs";
import type { Position, Project } from "../types";
import { assertDocument as assertLegacy } from "./legacyModel";
import { initializeProject, validateModel } from "./projectModel";

export const SCHEMA_VERSION = 2;
export const REMOTE_ORIGIN = Symbol("collaboration remote");
export const ENTITY_ROOTS = ["members", "stageObjects", "scenes", "memberGroups", "objectGroups", "movementPlans", "movementPaths"] as const;
export type EntityRoot = typeof ENTITY_ROOTS[number];
export type EntityRecord = Y.Map<unknown>;
// Preserve the typed positions accessor used by the first five rounds.
export type SceneRecord = Y.Map<Y.Map<Position>>;
export type SharedModel = {
  metadata: Y.Map<unknown>; settings: Y.Map<unknown>;
  members: Y.Map<EntityRecord>; scenes: Y.Map<SceneRecord>;
  stageObjects: Y.Map<EntityRecord>; memberGroups: Y.Map<EntityRecord>; objectGroups: Y.Map<EntityRecord>;
  movementPlans: Y.Map<EntityRecord>; movementPaths: Y.Map<EntityRecord>;
  orders: Y.Map<Y.Map<unknown>>; tombstones: Y.Map<boolean>;
};
export function getModel(doc: Y.Doc): SharedModel {
  return Object.fromEntries(["metadata", "settings", ...ENTITY_ROOTS, "orders", "tombstones"]
    .map(root => [root, doc.getMap(root)])) as SharedModel;
}
export function assertPosition(value: unknown): asserts value is Position {
  if (!value || typeof value !== "object" || !Number.isFinite((value as Position).x) ||
      !Number.isFinite((value as Position).y) || Object.keys(value).sort().join() !== "x,y") throw new Error("Invalid collaboration position");
}
export function getSupportedModel(doc: Y.Doc): SharedModel {
  const model = getModel(doc), schema = model.metadata.get("schemaVersion");
  if (![1, SCHEMA_VERSION].includes(schema as number) || typeof model.metadata.get("projectId") !== "string" || !model.metadata.get("projectId"))
    throw new Error("Uninitialized or unsupported collaboration document");
  return model;
}
export function assertDocument(doc: Y.Doc): SharedModel {
  const model = getSupportedModel(doc);
  if (model.metadata.get("schemaVersion") === 1) assertLegacy(doc);
  else validateModel(doc);
  return model;
}
/** Only the creator converts JSON. Joining devices hydrate the creator's identities. */
export function createSharedDocument(project: Project): Y.Doc {
  if (!project.id) throw new Error("Normalize Project before sharing: missing project ID");
  const doc = new Y.Doc();
  try { initializeProject(doc, project); assertDocument(doc); return doc; }
  catch (error) { doc.destroy(); throw error; }
}
export function joinSharedDocument(initialState: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, initialState, REMOTE_ORIGIN); assertDocument(doc); return doc; }
  catch (error) { doc.destroy(); throw error; }
}
export function readPosition(doc: Y.Doc, sceneId: string, memberId: string): Position | undefined {
  const value = getModel(doc).scenes.get(sceneId)?.get("positions")?.get(memberId);
  return value ? { x: value.x, y: value.y } : undefined;
}
