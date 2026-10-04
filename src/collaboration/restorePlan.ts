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
  if (!same(doc.getMap('metadata').toJSON(), target.getMap('metadata').toJSON())) throw new Error('RESTORE_TOPOLOGY_MISMATCH');
  const writes: PlannedWrite[] = [];
  const write = (run: () => void, root: string, id: string, field: string) => writes.push({ target: { entityType: root, entityId: id, field }, read: () => undefined, write: run });
  const synchronize = (current: Y.Map<unknown>, desired: Y.Map<unknown>, root: string, id: string) => {
    for (const key of new Set([...(current.doc ? current.keys() : []), ...desired.keys()])) {
      const a = current.doc ? current.get(key) : undefined, b = desired.get(key);
      if (b instanceof Y.Map) {
        if (a instanceof Y.Map) synchronize(a, b, root, id);
        else {
          // Only newly generated entities need containers; existing ones keep theirs.
          const map = new Y.Map<unknown>();
          write(() => current.set(key, map), root, id, key); synchronize(map, b, root, id);
        }
      } else if (b instanceof Y.Text) {
        const text = a instanceof Y.Text ? a : new Y.Text();
        if (!(a instanceof Y.Text)) write(() => current.set(key, text), root, id, key);
        const splice = textSplice(a instanceof Y.Text ? a.toString() : '', b.toString());
        if (splice.remove || splice.insert) write(() => { if (splice.remove) text.delete(splice.index, splice.remove); if (splice.insert) text.insert(splice.index, splice.insert); }, root, id, key);
      } else if (!same(a, b)) {
        const value = clone(b); write(() => value === undefined ? current.delete(key) : current.set(key, value), root, id, key);
      }
    }
  };
  if (doc.getMap('metadata').get('schemaVersion') === 1) {
    // Legacy topology is immutable: only position atoms are supported.
    if (!same([...doc.getMap('members').keys()].sort(), [...target.getMap('members').keys()].sort()) ||
      !same([...doc.getMap('scenes').keys()].sort(), [...target.getMap('scenes').keys()].sort())) throw new Error('RESTORE_TOPOLOGY_MISMATCH');
    for (const [id, value] of target.getMap<Y.Map<unknown>>('scenes')) synchronize(doc.getMap<Y.Map<unknown>>('scenes').get(id)!, value, 'scenes', id);
    return writes;
  }
  const model = getModel(doc), wanted = getModel(target);
  synchronize(model.settings, wanted.settings, 'settings', 'project');
  for (const root of ENTITY_ROOTS) {
    const live = new Set(orderedIds(target, orderKey(root)).filter(id => wanted[root].has(id) && !deleted(target, root, id)));
    for (const id of model[root].keys()) if (!live.has(id) && !deleted(doc, root, id)) {
      const event = orderKey(root, id, crypto.randomUUID()); write(() => model.tombstones.set(event, true), root, id, 'existence');
    }
    for (const id of live) {
      let current = model[root].get(id) as Y.Map<unknown> | undefined;
      if (current) writes.push(...planRestore(doc, root as EntityRoot, id));
      else { current = new Y.Map(); const record = current; write(() => (model[root] as Y.Map<Y.Map<unknown>>).set(id, record), root, id, 'existence'); }
      synchronize(current, wanted[root].get(id) as Y.Map<unknown>, root, id);
    }
  }
  // Logical order is restored using NEW active slots; old IDs stay valid for peers.
  for (const key of new Set([...model.orders.keys(), ...wanted.orders.keys()])) {
    const desired = orderedIds(target, key), actual = orderedIds(doc, key);
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
  const changes: string[] = [];
  const visit = (a: unknown, b: unknown, path: string) => {
    if (same(a, b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit((a as Data)[key], (b as Data)[key], path ? `${path}.${key}` : key);
    } else changes.push(path);
  };
  visit(effectiveSharedContent(doc), effectiveSharedContent(target), ''); return changes;
}
