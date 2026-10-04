import * as Y from "yjs";
import { isSharedLocalAlias } from "./identity";
import type { Project } from "../types";
import { ENTITY_ROOTS, getModel, type EntityRoot, type EntityRecord } from "./model";
import { checkJson, clone, same, entityFields, settingsFields, initializeEntity, listField, orderKey, moveSlot, order, deleted, type Data } from "./projectModel";

export type EditTarget = { entityType: string; entityId: string; field: string };
export type OrderReference = { map: Y.Map<unknown>; key: string };
export type PlannedWrite = { target: EditTarget; read: () => unknown; write: () => void; orderReference?: OrderReference };
const tuple = (value: string) => JSON.parse(value) as string[];
export function textSplice(before: string, after: string): { index: number; remove: number; insert: string } {
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  // UTF-16 boundaries must not split a surrogate pair.
  if (prefix && /[\uD800-\uDBFF]/.test(before[prefix - 1])) prefix--;
  if (suffix && /[\uDC00-\uDFFF]/.test(before[before.length - suffix])) suffix--;
  return { index: prefix, remove: before.length - prefix - suffix, insert: after.slice(prefix, after.length - suffix) };
}
/** Runs at the synchronous edit entry, never in a React effect. Only changed
 * branches are visited; scalar/geometry commands never replace entity maps. */
export function planRecipe(doc: Y.Doc, before: Project, after: Project, sharedDocumentId?: string | null): PlannedWrite[] {
  if (before.id !== after.id || (after.id !== getModel(doc).metadata.get("projectId") && !isSharedLocalAlias(after.id, sharedDocumentId))) throw new Error("Shared project identity cannot change");
  const model = getModel(doc), result: PlannedWrite[] = [];
  const removed = Object.fromEntries(ENTITY_ROOTS.map(root => {
    const old = (before[listField(root)] ?? []) as { id: string }[], next = (after[listField(root)] ?? []) as { id: string }[];
    const ids = new Set(next.map(item => item.id));
    return [root, new Set(old.filter(item => !ids.has(item.id)).map(item => item.id))];
  })) as Record<EntityRoot, Set<string>>;
  const set = (map: Y.Map<unknown>, key: string, a: unknown, b: unknown, target: EditTarget) => {
    if (same(a, b)) return;
    checkJson(b);
    const value = clone(b);
    result.push({ target, read: () => clone(map.get(key)), write: () => value === undefined ? map.delete(key) : map.set(key, value) });
  };
  // A small closed setting vocabulary; positions/frames are never compared here.
  const aSettings = settingsFields(before), bSettings = settingsFields(after);
  for (const key of new Set([...Object.keys(aSettings), ...Object.keys(bSettings)]))
    set(model.settings, key, aSettings[key], bSettings[key], { entityType: "settings", entityId: "project", field: key });

  const reorder = (key: string, a: string[], b: string[], target: EditTarget) => {
    if (same(a, b)) return;
    if (new Set(b).size !== b.length || b.some(id => !id)) throw new Error("Invalid collaboration order");
    // Keep a longest common subsequence: moving one item does not move every
    // displaced neighbour or overwrite their concurrent active-slot registers.
    const indexes = new Map(a.map((id, i) => [id, i]));
    const tails: number[] = [], tailIds: string[] = [], links = new Map<string, string | undefined>();
    for (const id of b) {
      const index = indexes.get(id); if (index === undefined) continue;
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (tails[mid] < index) lo = mid + 1; else hi = mid; }
      links.set(id, lo ? tailIds[lo - 1] : undefined); tails[lo] = index; tailIds[lo] = id;
    }
    const keep = new Set<string>(); let id: string | undefined = tailIds[tailIds.length - 1];
    while (id !== undefined) { keep.add(id); id = links.get(id); }
    for (let i = b.length - 1; i >= 0; i--) if (!keep.has(b[i])) {
      const moved = b[i], next = b[i + 1];
      result.push({ target: { ...target, field: `order.${moved}` },
        orderReference: order(doc, key) ? { map: order(doc, key)!.get("active") as Y.Map<unknown>, key: moved } : undefined,
        read: () => (order(doc, key)?.get("active") as Y.Map<string> | undefined)?.get(moved),
        write: () => moveSlot(doc, key, moved, next) });
    }
  };
  const relations = (map: Y.Map<unknown>, key: string, a: string[], b: string[], target: EditTarget) => {
    const old = new Set(a), next = new Set(b);
    for (const id of new Set([...old, ...next])) {
      const deleting = target.entityType === "memberGroups" ? removed.members : removed.stageObjects;
      if (old.has(id) && !next.has(id) && deleting.has(id)) continue;
      set(map, id, old.has(id) ? true : undefined, next.has(id) ? true : undefined, { ...target, field: `${target.field}.${id}` });
    }
    reorder(key, a, b, target);
  };
  for (const root of ENTITY_ROOTS) {
    const field = listField(root);
    if (before[field] === after[field]) continue;
    const a = (before[field] ?? []) as (Data & { id: string })[], b = (after[field] ?? []) as (Data & { id: string })[];
    const old = new Map(a.map(item => [item.id, item]));
    if (b.some(item => !item.id) || new Set(b.map(item => item.id)).size !== b.length) throw new Error("New shared entities require stable unique IDs");
    const next = new Map(b.map(item => [item.id, item]));
    for (const item of a) if (!next.has(item.id)) {
      if ((root === "movementPlans" || root === "movementPaths") && (removed.scenes.has(item.fromFrameId as string) || removed.scenes.has(item.toFrameId as string) ||
        (item.targetType === "object" ? removed.stageObjects : removed.members).has((item.targetId ?? item.memberId) as string))) continue;
      const key = orderKey(root, item.id, crypto.randomUUID());
      result.push({ target: { entityType: root, entityId: item.id, field: "existence" }, read: () => !deleted(doc, root, item.id), write: () => model.tombstones.set(key, true) });
    }
    for (const item of b) {
      const previous = old.get(item.id), target = { entityType: root, entityId: item.id, field: "existence" };
      if (item === previous) continue;
      if (!previous) {
        if (model[root].has(item.id)) throw new Error("Use explicit restore for tombstoned entity");
        checkJson(item);
        const fixed = clone(item);
        result.push({ target, read: () => model[root].has(item.id) && !deleted(doc, root, item.id), write: () => {
          initializeEntity(doc, root, fixed);
          // Pre-create orders whose first concurrent use must share one identity.
          if (root === "scenes") for (const object of model.stageObjects.keys()) {
            order(doc, orderKey("assignments", item.id, object), true);
            const members = (fixed.objectAssignments as Record<string, string[]> | undefined)?.[object] ?? [];
            members.forEach(member => moveSlot(doc, orderKey("assignments", item.id, object), member));
          }
          if (root === "stageObjects") for (const scene of model.scenes.keys()) order(doc, orderKey("assignments", scene, item.id), true);
          if (root === "memberGroups" || root === "objectGroups") order(doc, orderKey(root, item.id, root === "memberGroups" ? "memberIds" : "objectIds"), true);
        } });
        continue;
      }
      const record = (model[root] as unknown as Y.Map<EntityRecord>).get(item.id);
      if (!record || deleted(doc, root, item.id)) continue; // Remote deletion never resurrected by stale edits.
      const aFields = entityFields(root, previous), bFields = entityFields(root, item);
      for (const key of new Set([...Object.keys(aFields), ...Object.keys(bFields)])) set(record, key, aFields[key], bFields[key], { ...target, field: key });
      if (root === "memberGroups" || root === "objectGroups") {
        const key = root === "memberGroups" ? "memberIds" : "objectIds";
        if (previous[key] !== item[key]) relations(record.get(key) as Y.Map<unknown>, orderKey(root, item.id, key), previous[key] as string[], item[key] as string[], { ...target, field: key });
      }
      if (root !== "scenes") continue;
      if (previous.notes !== item.notes) {
        const text = record.get("notes") as Y.Text;
        const splice = textSplice(previous.notes as string ?? "", item.notes as string ?? "");
        checkJson(item.notes);
        result.push({ target: { ...target, field: "notes" }, read: () => text.toString(), write: () => {
          if (splice.remove) text.delete(splice.index, splice.remove);
          if (splice.insert) text.insert(splice.index, splice.insert);
          if (item.notes !== undefined && !record.get("has.notes")) record.set("has.notes", true);
          else if (item.notes === undefined) record.delete("has.notes");
        } });
      }
      for (const key of ["positions", "memberVisibility", "groupVisibility", "memberAppearanceOverrides", "objectStates", "objectAssignments"] as const) {
        if (previous[key] === item[key]) continue;
        const aMap = previous[key] as Data ?? {}, bMap = item[key] as Data ?? {}, map = record.get(key) as Y.Map<unknown>;
        if ((previous[key] === undefined) !== (item[key] === undefined)) set(record, `has.${key}`, record.get(`has.${key}`), item[key] === undefined ? undefined : true, { ...target, field: `has.${key}` });
        for (const id of new Set([...Object.keys(aMap), ...Object.keys(bMap)])) {
          if (aMap[id] === bMap[id]) continue;
          const deleting = key === "objectStates" || key === "objectAssignments" ? removed.stageObjects : key === "groupVisibility" ? removed.memberGroups : removed.members;
          if (deleting.has(id)) continue;
          const itemTarget = { ...target, field: `${key}.${id}` };
          if (key === "objectStates") {
            const aState = entityFields("objectState", aMap[id] as Data ?? {}), bState = entityFields("objectState", bMap[id] as Data ?? {});
            for (const f of new Set([...Object.keys(aState), ...Object.keys(bState)])) set(map, orderKey(id, f), aState[f], bState[f], { ...itemTarget, field: `${itemTarget.field}.${f}` });
          } else if (key === "objectAssignments") {
            set(record, orderKey("assignment", id), aMap[id] === undefined ? undefined : true, bMap[id] === undefined ? undefined : true, { ...itemTarget, field: `${itemTarget.field}.presence` });
            const oldIds = aMap[id] as string[] ?? [], newIds = bMap[id] as string[] ?? [];
            const oldSet = new Set(oldIds), newSet = new Set(newIds);
            for (const member of new Set([...oldSet, ...newSet])) {
              if (oldSet.has(member) && !newSet.has(member) && removed.members.has(member)) continue;
              set(map, orderKey(id, member), oldSet.has(member) ? true : undefined, newSet.has(member) ? true : undefined, { ...itemTarget, field: `${itemTarget.field}.${member}` });
            }
            reorder(orderKey("assignments", item.id, id), oldIds, newIds, itemTarget);
          } else set(map, id, aMap[id], bMap[id], itemTarget);
        }
      }
    }
    reorder(orderKey(root), a.map(item => item.id), b.map(item => item.id), { entityType: root, entityId: "list", field: "order" });
  }
  return result;
}
/** Explicit restore clears only deletion events the caller has observed. */
export function planRestore(doc: Y.Doc, root: EntityRoot, id: string): PlannedWrite[] {
  const model = getModel(doc);
  if (!model[root].has(id)) throw new Error("Unknown restore target");
  return [...model.tombstones].filter(([key, value]) => { const parts = tuple(key); return value && parts[0] === root && parts[1] === id; })
    .map(([key]) => ({ target: { entityType: root, entityId: id, field: "existence" }, read: () => !deleted(doc, root, id), write: () => model.tombstones.set(key, false) }));
}
