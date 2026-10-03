import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSampleProject } from '../sampleProject';
import { createSharedDocument, getModel } from './model';
import { CollaborationCommands } from './commands';
import { decodeBase64, encodeBase64, inspectWire, SERVER_LIMITS, validateState } from './serverValidation';

function fixture(members = 1, scenes = 1) {
  const project = createSampleProject(); project.id = 'server-test';
  project.members = Array.from({ length: members }, (_, i) => ({ id: `m${i}`, name: `メンバー${i}`, color: '#123456' }));
  project.frames = Array.from({ length: scenes }, (_, i) => ({ ...project.frames[0], id: `s${i}`,
    positions: Object.fromEntries(project.members.map((m, j) => [m.id, { x: j / 4, y: i / 4 }])) }));
  return createSharedDocument(project);
}
function update(doc: Y.Doc, action: () => void) {
  const updates: Uint8Array[] = []; const listener = (b: Uint8Array) => updates.push(b);
  doc.on('update', listener); action(); doc.off('update', listener);
  return Y.mergeUpdates(updates);
}
describe('schema 1 server validation', () => {
  it('accepts empty roots, which Yjs does not encode until their first item', () => {
    const doc = fixture(0, 0); expect(() => validateState(Y.encodeStateAsUpdate(doc))).not.toThrow(); doc.destroy();
  });
  it('validates creator identity, finite coordinates, delta, Undo/Redo and repeated history', () => {
    const doc = fixture(), base = Y.encodeStateAsUpdate(doc), commands = new CollaborationCommands(doc);
    const updates: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) {
      const delta = update(doc, () => commands.moveMembers([{ memberId: 'm0', sceneId: 's0', position: { x: i + .25, y: -i } }]));
      expect(validateState(base, updates, delta).stateBytes).toBeGreaterThan(0); updates.push(delta);
    }
    const undo = update(doc, () => commands.undo()); expect(() => validateState(base, updates, undo)).not.toThrow(); updates.push(undo);
    const redo = update(doc, () => commands.redo()); expect(() => validateState(base, updates, redo)).not.toThrow();
    expect(() => validateState(Y.encodeStateAsUpdate(doc))).not.toThrow(); commands.destroy(); doc.destroy();
  });
  it.each([NaN, Infinity, -Infinity, '3', null])('rejects invalid coordinate %s', value => {
    const doc = fixture(), base = Y.encodeStateAsUpdate(doc);
    const delta = update(doc, () => getModel(doc).scenes.get('s0')!.get('positions')!.set('m0', { x: value, y: 1 } as never));
    expect(() => validateState(base, [], delta)).toThrow(); doc.destroy();
  });
  it.each(['root', 'member', 'position', 'array', 'text', 'subdoc', 'metadata', 'topology', 'hidden'])('rejects unknown %s structure and immutable topology', kind => {
    const doc = fixture(), base = Y.encodeStateAsUpdate(doc), model = getModel(doc);
    const delta = update(doc, () => {
      if (kind === 'root') doc.getMap('permissions').set('creator', 'fake');
      if (kind === 'member') model.members.get('m0')!.set('admin', 1);
      if (kind === 'position') model.scenes.get('s0')!.get('positions')!.set('m0', { x: 1, y: 2, admin: 3 } as never);
      if (kind === 'array') model.members.get('m0')!.set('a', new Y.Array());
      if (kind === 'text') model.members.get('m0')!.set('a', new Y.Text('secret'));
      if (kind === 'subdoc') model.members.get('m0')!.set('a', new Y.Doc());
      if (kind === 'metadata') model.metadata.set('projectId', 'replacement');
      if (kind === 'topology') model.members.delete('m0');
      if (kind === 'hidden') { model.members.get('m0')!.set('admin', 1); model.members.get('m0')!.delete('admin'); }
    });
    expect(() => validateState(base, [], delta)).toThrow(); doc.destroy();
  });
  it('rejects missing dependencies, malformed/trailing bytes, declared allocation bomb and excessive counts', () => {
    const doc = fixture(), base = Y.encodeStateAsUpdate(doc);
    const first = update(doc, () => getModel(doc).scenes.get('s0')!.get('positions')!.set('m0', { x: 3, y: 4 }));
    const second = update(doc, () => getModel(doc).scenes.get('s0')!.get('positions')!.set('m0', { x: 5, y: 6 }));
    expect(() => validateState(base, [], second)).toThrow('MISSING_DEPENDENCIES');
    expect(() => validateState(base, [first], second)).not.toThrow();
    expect(() => inspectWire(Uint8Array.of(1, 255, 255, 255, 127))).toThrow('QUOTA_EXCEEDED');
    expect(() => inspectWire(Uint8Array.of(0, 0, 99))).toThrow();
    expect(() => validateState(Uint8Array.of(1))).toThrow();
    expect(() => validateState(base, [], new Uint8Array(SERVER_LIMITS.updateBytes + 1))).toThrow('QUOTA_EXCEEDED');
    const large = fixture(SERVER_LIMITS.members + 1);
    expect(() => validateState(Y.encodeStateAsUpdate(large))).toThrow('QUOTA_EXCEEDED'); large.destroy(); doc.destroy();
  });
  it('requires canonical bounded base64', () => {
    expect(decodeBase64(encodeBase64(Uint8Array.of(1, 2, 3)), 3)).toEqual(Uint8Array.of(1, 2, 3));
    for (const value of ['AB==', 'AQ==\n', '', null, '!', 'AAAA']) expect(() => decodeBase64(value, 2)).toThrow();
  });
  it('measures 146 members × 18 scenes without a hosted-performance assertion', () => {
    const doc = fixture(146, 18), base = Y.encodeStateAsUpdate(doc);
    const delta = update(doc, () => {
      for (let i = 0; i < 146; i++) getModel(doc).scenes.get('s0')!.get('positions')!.set(`m${i}`, { x: i / 4 + 1, y: 3 });
    });
    const timings = Array.from({ length: 12 }, () => validateState(base, [], delta).elapsedMs).sort((a, b) => a - b);
    console.log(JSON.stringify({ workload: '146x18', snapshotBytes: base.length, updateBytes: delta.length,
      validationMedianMs: timings[6], validationP95Ms: timings[11] }));
    expect(timings.every(Number.isFinite)).toBe(true); doc.destroy();
  });
});
