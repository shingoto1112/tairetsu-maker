import * as Y from 'yjs';
// @ts-ignore Deno source import.
import { ENTITY_ROOTS, getModel, type EntityRoot } from './model.ts';
// @ts-ignore Deno source import.
import { clone, same, deleted, orderedIds, orderKey, moveSlot, type Data } from './projectModel.ts';
// @ts-ignore Deno source import.
import { planRestore, textSplice, type PlannedWrite } from './recipeCommands.ts';
// @ts-ignore Deno source import.
import { projectSharedDocument } from './projection.ts';
// @ts-ignore Deno source import.
import type { Project } from '../types.ts';
// @ts-ignore Deno source import.
import { projectCheckpointContent, type CheckpointDTO } from './checkpoint.ts';
// @ts-ignore Deno source import.
import { sceneMaps } from './projectSchema.ts';

/** A device-free effective projection. Historical slots/deletion event IDs are
 * deliberately not compared: restore creates new edits, never rewinds clocks.
 * Schema 1 lacks the full Project; its closed logical roots remain comparable. */
export function effectiveSharedContent(doc: Y.Doc): Data {
  const schema = doc.getMap('metadata').get('schemaVersion');
  if (schema === 1) return { metadata: doc.getMap('metadata').toJSON(), members: doc.getMap('members').toJSON(), scenes: doc.getMap('scenes').toJSON() };
  const base = { id: doc.getMap('metadata').get('projectId'), updatedAt: '', stage: {}, frames: [] } as unknown as Project;
  const { id: _id, updatedAt: _at, ...project } = projectSharedDocument(doc, base);
  const settings = doc.getMap('settings');
  return { project, hasSong: settings.has('song'), song: settings.get('song') ?? null };
}

/** Preserve existing Y.Map/Y.Text identities, including tombstoned records.
 * Use observed-event restoration, then update the retained values directly.
 * planRecipe compares visible Projects and cannot supply these hidden values. */
export function planSharedRestore(doc: Y.Doc, target: Y.Doc): PlannedWrite[] {
  return planSharedRestoreContent(doc, projectCheckpointContent(target, target.getMap('metadata').get('schemaVersion') as 1 | 2));
}
/** Validated logical content, no second live Y.Doc. Server writes stream inside
 * one transaction; the discarded working Doc needs no rollback on rejection. */
export function planSharedRestoreContent(doc: Y.Doc, target: Pick<CheckpointDTO, 'content' | 'song'>, apply = false): PlannedWrite[] {
  const roots = target.content.roots as Record<string, Data>;
  if (!same(doc.getMap('metadata').toJSON(), roots.metadata)) throw new Error('RESTORE_TOPOLOGY_MISMATCH');
  const writes: PlannedWrite[] = [];
  const emit = (w: PlannedWrite) => { if (apply) w.write(); else writes.push(w); };
  const write = (run: () => void, root: string, id: string, field: string) => emit({ target: { entityType: root, entityId: id, field }, read: () => undefined, write: run });
  const synchronize = (current: Y.Map<unknown>, desired: Data, root: string, id: string, nested = false) => {
    for (const key of new Set([...(current.doc ? current.keys() : []), ...Object.keys(desired)])) {
      const a = current.doc ? current.get(key) : undefined, b = desired[key];
      const container = !nested && (root === 'scenes' && (sceneMaps as readonly string[]).includes(key) ||
        root === 'memberGroups' && key === 'memberIds' || root === 'objectGroups' && key === 'objectIds');
      if (container && b !== undefined) {
        if (a instanceof Y.Map) synchronize(a, b as Data, root, id, true);
        else {
          // Only newly generated entities need containers; existing ones keep theirs.
          const map = new Y.Map<unknown>();
          write(() => current.set(key, map), root, id, key); synchronize(map, b as Data, root, id, true);
        }
      } else if (!nested && root === 'scenes' && key === 'notes' && b !== undefined) {
        const text = a instanceof Y.Text ? a : new Y.Text();
        if (!(a instanceof Y.Text)) write(() => current.set(key, text), root, id, key);
        const splice = textSplice(a instanceof Y.Text ? a.toString() : '', b as string);
        if (splice.remove || splice.insert) write(() => { if (splice.remove) text.delete(splice.index, splice.remove); if (splice.insert) text.insert(splice.index, splice.insert); }, root, id, key);
      } else if (!same(a, b)) {
        const value = clone(b); write(() => value === undefined ? current.delete(key) : current.set(key, value), root, id, key);
      }
    }
  };
  if (doc.getMap('metadata').get('schemaVersion') === 1) {
    // Legacy topology is immutable: only position atoms are supported.
    if (!same([...doc.getMap('members').keys()].sort(), Object.keys(roots.members).sort()) ||
      !same([...doc.getMap('scenes').keys()].sort(), Object.keys(roots.scenes).sort())) throw new Error('RESTORE_TOPOLOGY_MISMATCH');
    for (const [id, value] of Object.entries(roots.scenes)) synchronize(doc.getMap<Y.Map<unknown>>('scenes').get(id)!, value as Data, 'scenes', id);
    return writes;
  }
  const model = getModel(doc);
  const wantedOrder = (key: string) => {
    const value = roots.orders[key] as { active: Record<string, string>; slots: { elementId: string; slotId: string }[] } | undefined;
    const seen = new Set<string>();
    return value ? value.slots.filter(slot => {
      if (value.active[slot.elementId] !== slot.slotId || seen.has(slot.elementId)) return false;
      seen.add(slot.elementId); return true;
    }).map(slot => slot.elementId) : [];
  };
  const dead = new Set<string>();
  for (const [key, enabled] of Object.entries(roots.tombstones)) if (enabled) {
    const [root, id] = JSON.parse(key) as string[]; dead.add(orderKey(root, id));
  }
  synchronize(model.settings, { ...roots.settings, ...(target.content.hasSong ? { song: target.song } : {}) }, 'settings', 'project');
  for (const root of ENTITY_ROOTS) {
    const live = new Set(wantedOrder(orderKey(root)).filter(id => Object.prototype.hasOwnProperty.call(roots[root], id) && !dead.has(orderKey(root, id))));
    for (const id of model[root].keys()) if (!live.has(id) && !deleted(doc, root, id)) {
      const event = orderKey(root, id, crypto.randomUUID()); write(() => model.tombstones.set(event, true), root, id, 'existence');
    }
    for (const id of live) {
      let current = model[root].get(id) as Y.Map<unknown> | undefined;
      if (current) planRestore(doc, root as EntityRoot, id).forEach(emit);
      else { current = new Y.Map(); const record = current; write(() => (model[root] as Y.Map<Y.Map<unknown>>).set(id, record), root, id, 'existence'); }
      synchronize(current, roots[root][id] as Data, root, id);
    }
  }
  // Logical order is restored using NEW active slots; old IDs stay valid for peers.
  for (const key of new Set([...model.orders.keys(), ...Object.keys(roots.orders)])) {
    const desired = wantedOrder(key), actual = orderedIds(doc, key);
    if (same(desired, actual)) continue;
    write(() => {
      const active = model.orders.get(key)?.get('active') as Y.Map<unknown> | undefined;
      for (const id of actual) if (!desired.includes(id)) active?.delete(id);
      for (let i = desired.length - 1; i >= 0; i--) moveSlot(doc, key, desired[i], desired[i + 1]);
    }, 'orders', key, 'order');
  }
  return writes;
}

export function sharedDifferences(doc: Y.Doc, target: Y.Doc): string[] {
  return contentDifferences(effectiveSharedContent(doc), effectiveSharedContent(target));
}
export function contentDifferences(actual: Data, target: Data): string[] {
  const changes: string[] = [];
  const visit = (a: unknown, b: unknown, path: string) => {
    if (same(a, b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit((a as Data)[key], (b as Data)[key], path ? `${path}.${key}` : key);
    } else changes.push(path);
  };
  visit(actual, target, ''); return changes;
}
