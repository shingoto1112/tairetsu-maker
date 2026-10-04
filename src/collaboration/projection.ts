import * as Y from "yjs";
// @ts-ignore Deno source import.
import type { Project } from "../types.ts";
// @ts-ignore Deno source import.
import { getSupportedModel, ENTITY_ROOTS, type EntityRoot, type EntityRecord } from "./model.ts";
// @ts-ignore Deno source import.
import { expandFields, orderedIds, orderKey, listField, sceneMaps, clone, fieldNames, atoms, settingAtoms, type Data } from "./projectModel.ts";
// @ts-ignore Deno source import.
import { isSharedLocalAlias } from "./identity.ts";

/** Pure read: orphaned references and inactive slots never trigger repair writes. */
export function projectSharedDocument(doc: Y.Doc, base: Project, sharedDocumentId?: string | null): Project {
  const model = getSupportedModel(doc);
  // A join gets a fresh local record, while the creator's CRDT identities stay
  // unchanged. Only an explicit, document-bound local alias is accepted.
  const alias = isSharedLocalAlias(base.id, sharedDocumentId);
  if (model.metadata.get("projectId") !== base.id && !(alias && model.metadata.get("schemaVersion") === 2))
    throw new Error("Project base does not match collaboration document");
  if (model.metadata.get("schemaVersion") === 1) {
    if (model.members.size !== base.members.length || model.scenes.size !== base.frames.length ||
        new Set(base.frames.map(f => f.id)).size !== base.frames.length ||
        base.members.some(m => !model.members.has(m.id)) || base.frames.some(f => !model.scenes.has(f.id)))
      throw new Error("Project base does not match collaboration document");
    return { ...base, frames: base.frames.map(frame => ({ ...frame, positions:
      Object.fromEntries([...model.scenes.get(frame.id)!.get("positions")!].map(([id, p]) => [id, { ...p }])) })) };
  }
  const dead = new Set<string>();
  for (const [key, enabled] of model.tombstones) {
    if (enabled) { const [root, id] = JSON.parse(key) as string[]; dead.add(orderKey(root, id)); }
  }
  const ids = Object.fromEntries(ENTITY_ROOTS.map(root => [root, orderedIds(doc, orderKey(root))
    .filter(id => model[root].has(id) && !dead.has(orderKey(root, id)))])) as Record<EntityRoot, string[]>;
  const live = Object.fromEntries(ENTITY_ROOTS.map(root => [root, new Set(ids[root])])) as Record<EntityRoot, Set<string>>;
  // Unknown legacy extensions remain in the local projection, never become
  // writable arbitrary payload in the shared schema. All declared fields below
  // are rebuilt from the document, so base cannot overwrite remote edits.
  const result: Data = { ...clone(base), id: base.id, version: model.metadata.get("version"), updatedAt: base.updatedAt };
  for (const field of ["mode", "title", "paradeSettings", "animationSettings", "guideSettings", "useGlobalStageSize", "useGlobalStageWidth", "createdAt", ...ENTITY_ROOTS.map(listField)]) delete result[field];
  const knownStage = new Set(Object.values(settingAtoms).flat().filter(p => p.startsWith("stage.")).map(p => p.slice(6)));
  result.stage = Object.fromEntries(Object.entries(base.stage).filter(([key]) => !knownStage.has(key)));
  if (model.metadata.has("createdAt")) result.createdAt = model.metadata.get("createdAt");
  for (const [key, value] of model.settings) {
    if (key.startsWith("has.") && value) result[key.slice(4)] ??= key.endsWith("Groups") || key.endsWith("Plans") || key.endsWith("Paths") ? [] : {};
    else if (key !== "song") for (const [path, v] of Object.entries(value as Data)) {
      const [first, second] = path.split(".");
      if (second) ((result[first] ??= {}) as Data)[second] = clone(v);
      else result[first] = clone(v);
    }
  }
  // Local audio identity stays local. Shared song descriptors are read separately.
  for (const key of ["audio", "focusMemberId", "viewerPerspective", "lastOpenedAt"] as const)
    if (base[key] !== undefined) result[key] = clone(base[key]);
  const localScenes = new Map(base.frames.map(f => [f.id, f]));
  for (const root of ENTITY_ROOTS) {
    if (["memberGroups", "objectGroups", "movementPlans", "movementPaths"].includes(root) && !result[root] && !ids[root].length) continue;
    result[listField(root)] = ids[root].map(id => {
      const record = (model[root] as unknown as Y.Map<EntityRecord>).get(id)!;
      const fields: Data = {};
      for (const [key, value] of record) if (!(value instanceof Y.AbstractType) && !key.startsWith("has.") && !key.startsWith("["))
        fields[key] = clone(value);
      const known = new Set(["id", ...fieldNames[root], ...Object.values(atoms[root] ?? {}).flat(),
        ...(root === "scenes" ? ["notes", "sceneViewState", ...sceneMaps] : []),
        ...(root === "memberGroups" ? ["memberIds"] : root === "objectGroups" ? ["objectIds"] : [])]);
      const localItem = ((base[listField(root)] ?? []) as { id?: string }[]).find(item => item.id === id);
      const extras = Object.fromEntries(Object.entries(localItem ?? {}).filter(([key]) => !known.has(key)));
      const item: Data = { ...clone(extras), id, ...expandFields(root, fields) };
      if (root === "scenes") {
        delete item.notes;
        if (record.get("has.notes") || (record.get("notes") as Y.Text).length) item.notes = (record.get("notes") as Y.Text).toString();
        const localView = localScenes.get(id)?.sceneViewState;
        if (localView !== undefined) item.sceneViewState = clone(localView);
        for (const key of sceneMaps) {
          const map = record.get(key) as Y.Map<unknown>, values: Data = {};
          if (key === "objectStates") {
            for (const [entry, value] of map) {
              const [objectId, field] = JSON.parse(entry) as string[];
              if (live.stageObjects.has(objectId)) ((values[objectId] ??= { objectId }) as Data)[field] = clone(value);
            }
            for (const [objectId, state] of Object.entries(values)) values[objectId] = expandFields("objectState", state as Data);
          } else if (key === "objectAssignments") {
            for (const objectId of ids.stageObjects) {
              const members = orderedIds(doc, orderKey("assignments", id, objectId)).filter(member =>
                live.members.has(member) && map.get(orderKey(objectId, member)) === true);
              if (members.length || record.has(orderKey("assignment", objectId))) values[objectId] = members;
            }
          } else {
            const targets = key === "groupVisibility" ? live.memberGroups : live.members;
            for (const [target, value] of map) if (targets.has(target)) values[target] = clone(value);
          }
          if (record.get(`has.${key}`) || key === "positions" || key === "objectStates" || Object.keys(values).length) item[key] = values;
        }
      }
      if (root === "memberGroups" || root === "objectGroups") {
        const key = root === "memberGroups" ? "memberIds" : "objectIds", members = record.get(key) as Y.Map<boolean>;
        const targets = root === "memberGroups" ? live.members : live.stageObjects;
        item[key] = orderedIds(doc, orderKey(root, id, key)).filter(target => targets.has(target) && members.get(target));
      }
      return item;
    }).filter(item => {
      if (root !== "movementPlans" && root !== "movementPaths") return true;
      const target = item.targetId ?? item.memberId, targetRoot = item.targetType === "object" ? live.stageObjects : live.members;
      return live.scenes.has(item.fromFrameId as string) && live.scenes.has(item.toFrameId as string) && targetRoot.has(target as string);
    });
  }
  return result as Project;
}
