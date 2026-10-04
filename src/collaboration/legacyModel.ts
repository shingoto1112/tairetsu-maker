import * as Y from "yjs";
// @ts-ignore Deno source import.
import type { Position, Project } from "../types.ts";

export const SCHEMA_VERSION = 1;
export const REMOTE_ORIGIN = Symbol("collaboration remote");
const INITIALIZATION_ORIGIN = Symbol("collaboration initialization");

type SceneRecord = Y.Map<Y.Map<Position>>;
export type SharedModel = {
  metadata: Y.Map<unknown>;
  members: Y.Map<Y.Map<unknown>>;
  scenes: Y.Map<SceneRecord>;
};

/** Internal model access; creating empty root types does not initialize a document. */
export function getModel(doc: Y.Doc): SharedModel {
  return {
    metadata: doc.getMap("metadata"),
    members: doc.getMap("members"),
    scenes: doc.getMap("scenes"),
  };
}

export function assertPosition(value: unknown): asserts value is Position {
  if (!value || typeof value !== "object" ||
      !Number.isFinite((value as Position).x) || !Number.isFinite((value as Position).y)) {
    throw new Error("Invalid collaboration position");
  }
}

function assertIds(ids: string[]): void {
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    throw new Error("Collaboration requires unique nonempty entity IDs");
  }
}

export function getSupportedModel(doc: Y.Doc): SharedModel {
  const model = getModel(doc);
  if (model.metadata.get("schemaVersion") !== SCHEMA_VERSION ||
      typeof model.metadata.get("projectId") !== "string" || !model.metadata.get("projectId")) {
    throw new Error("Uninitialized or unsupported collaboration document");
  }
  return model;
}

export function assertDocument(doc: Y.Doc): SharedModel {
  const model = getSupportedModel(doc);
  for (const member of model.members.values()) {
    if (!(member instanceof Y.Map)) throw new Error("Invalid member record");
  }
  for (const scene of model.scenes.values()) {
    if (!(scene instanceof Y.Map) || !(scene.get("positions") instanceof Y.Map)) {
      throw new Error("Invalid scene record");
    }
    for (const [id, position] of scene.get("positions")!) {
      if (!model.members.has(id)) throw new Error("Unknown position member");
      assertPosition(position);
    }
  }
  return model;
}

/** Creator only, with an already normalized Project. Persist/register its state once.
 * Never call this for a joining participant, even with an identical Project JSON. */
export function createSharedDocument(project: Project): Y.Doc {
  if (!project.id) throw new Error("Normalize Project before sharing: missing project ID");
  assertIds(project.members.map(member => member.id));
  assertIds(project.frames.map(frame => frame.id));
  const memberIds = new Set(project.members.map(member => member.id));
  // Validate everything BEFORE opening a transaction: Yjs transactions do not roll back.
  for (const frame of project.frames) {
    for (const [id, position] of Object.entries(frame.positions)) {
      if (!memberIds.has(id)) throw new Error("Unknown position member");
      assertPosition(position);
    }
  }
  const doc = new Y.Doc();
  const model = getModel(doc);
  doc.transact(() => {
    model.metadata.set("schemaVersion", SCHEMA_VERSION);
    model.metadata.set("projectId", project.id!);
    for (const member of project.members) model.members.set(member.id, new Y.Map());
    for (const frame of project.frames) {
      const scene: SceneRecord = new Y.Map();
      const positions = new Y.Map<Position>();
      model.scenes.set(frame.id, scene);
      scene.set("positions", positions);
      for (const [id, position] of Object.entries(frame.positions)) {
        positions.set(id, { x: position.x, y: position.y });
      }
    }
  }, INITIALIZATION_ORIGIN);
  return doc;
}

/** Participants hydrate the creator's CRDT identity, never regenerate it from JSON. */
export function joinSharedDocument(initialState: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, initialState, REMOTE_ORIGIN);
    assertDocument(doc);
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

export function readPosition(doc: Y.Doc, sceneId: string, memberId: string): Position | undefined {
  const value = getModel(doc).scenes.get(sceneId)?.get("positions")?.get(memberId);
  return value ? { x: value.x, y: value.y } : undefined;
}
