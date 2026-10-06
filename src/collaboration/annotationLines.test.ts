import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { normalizeProject } from "../project/normalizeProject";
import { createSharedDocument, joinSharedDocument, REMOTE_ORIGIN, getModel } from "./model";
import { CollaborationCommands } from "./commands";
import { projectSharedDocument } from "./projection";
import { validateState } from "./serverValidation";
import type { AnnotationLine } from "../types";
const line: AnnotationLine = { x1: 1, y1: 2, x2: 8, y2: 6, color: "red", dash: "dashed" };
describe("atomic annotation collaboration", () => {
  const setup = () => {
    const p = normalizeProject(createSampleProject()); p.frames[0].annotationLines = { line };
    const a = createSharedDocument(p), b = joinSharedDocument(Y.encodeStateAsUpdate(a)), docs = [a, b];
    const commands = docs.map(doc => new CollaborationCommands(doc));
    const read = (i: number) => projectSharedDocument(docs[i], p);
    const edit = (i: number, lines: Record<string, AnnotationLine>) => { const before = read(i); commands[i].applyRecipe(before, { ...before, frames: before.frames.map((f, n) => n ? f : { ...f, annotationLines: lines }) }); };
    const sync = () => { const updates = docs.map(d => Y.encodeStateAsUpdate(d)); Y.applyUpdate(a, updates[1], REMOTE_ORIGIN); Y.applyUpdate(b, updates[0], REMOTE_ORIGIN); expect(read(0)).toEqual(read(1)); docs.forEach(d => expect(() => validateState(Y.encodeStateAsUpdate(d))).not.toThrow()); };
    const close = () => { commands.forEach(c => c.destroy()); docs.forEach(d => d.destroy()); };
    return { p, docs, commands, read, edit, sync, close };
  };
  it("merges different lines, atomically resolves same-line edits and reconnects", () => {
    const s = setup(); try {
      s.edit(0, { line, a: { ...line, color: "blue" } }); s.edit(1, { line, b: { ...line, color: "green" } }); s.sync();
      expect(Object.keys(s.read(0).frames[0].annotationLines!)).toHaveLength(3);
      s.edit(0, { ...s.read(0).frames[0].annotationLines, line: { ...line, x1: 3, color: "black" } });
      s.edit(1, { ...s.read(1).frames[0].annotationLines, line: { ...line, y2: 10, dash: "solid" } }); s.sync();
      expect([{ ...line, x1: 3, color: "black" }, { ...line, y2: 10, dash: "solid" }]).toContainEqual(s.read(0).frames[0].annotationLines!.line);
      const rejoined = joinSharedDocument(Y.encodeStateAsUpdate(s.docs[0])); expect(projectSharedDocument(rejoined, s.p)).toEqual(s.read(0)); rejoined.destroy();
    } finally { s.close(); }
  });
  it("delete wins over disconnected movement; Undo does not undo the other device", () => {
    const s = setup(); try {
      s.edit(0, {}); s.edit(1, { line: { ...line, x1: 4 } }); s.sync();
      expect(s.read(0).frames[0].annotationLines).toEqual({});
      s.commands[1].undo(); s.sync(); expect(s.read(0).frames[0].annotationLines).toEqual({});
      s.commands[0].undo(); s.sync(); expect(s.read(0).frames[0].annotationLines?.line).toEqual(line);
      s.commands[0].redo(); s.sync(); expect(s.read(0).frames[0].annotationLines).toEqual({});
    } finally { s.close(); }
  });
  it("each add/move/style/delete is one Undo operation and old documents permit missing maps", () => {
    const s = setup(); try {
      s.edit(0, { line: { ...line, color: "blue", x1: 2 } }); s.commands[0].undo(); expect(s.read(0).frames[0].annotationLines?.line).toEqual(line);
      s.commands[0].redo(); expect(s.read(0).frames[0].annotationLines?.line.color).toBe("blue");
      getModel(s.docs[0]).scenes.get(s.p.frames[0].id)!.delete("annotationLines");
      expect(() => validateState(Y.encodeStateAsUpdate(s.docs[0]))).not.toThrow();
      expect(s.read(0).frames[0].annotationLines).toEqual({});
    } finally { s.close(); }
  });
  it("concurrent first use in an old v2 document retains both lines and Undo preserves remote lines", () => {
    const p = normalizeProject(createSampleProject()), old = createSharedDocument(p);
    old.getMap<Y.Map<unknown>>("scenes").get(p.frames[0].id)!.delete("annotationLines");
    const docs = [joinSharedDocument(Y.encodeStateAsUpdate(old)), joinSharedDocument(Y.encodeStateAsUpdate(old))];
    const commands = docs.map(d => new CollaborationCommands(d));
    try {
      docs.forEach((d, i) => {
        const before = projectSharedDocument(d, p);
        commands[i].applyRecipe(before, { ...before, frames: before.frames.map((f, n) => n ? f : { ...f, annotationLines: { ["line" + i]: line } }) });
      });
      const updates = docs.map(d => Y.encodeStateAsUpdate(d));
      docs.forEach((d, i) => Y.applyUpdate(d, updates[1 - i], REMOTE_ORIGIN));
      docs.forEach(d => { expect(Object.keys(projectSharedDocument(d, p).frames[0].annotationLines!)).toHaveLength(2); expect(() => validateState(Y.encodeStateAsUpdate(d))).not.toThrow(); });
      commands[0].undo(); Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0]), REMOTE_ORIGIN);
      docs.forEach(d => expect(projectSharedDocument(d, p).frames[0].annotationLines).toEqual({ line1: line }));
      commands[0].redo(); Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0]), REMOTE_ORIGIN);
      docs.forEach(d => expect(Object.keys(projectSharedDocument(d, p).frames[0].annotationLines!)).toHaveLength(2));
    } finally { commands.forEach(c => c.destroy()); docs.forEach(d => d.destroy()); old.destroy(); }
  });
  it("Edge explicitly rejects arbitrary attributes, CSS colors, invalid IDs and scene over-quota", () => {
    for (const value of [{ ...line, color: "url(bad)" }, { ...line, x2: Infinity }, { ...line, extra: true }]) {
      const s = setup(); try {
        const map = getModel(s.docs[0]).scenes.get(s.p.frames[0].id)!.get("annotationLines")! as Y.Map<unknown>;
        map.set("bad", value); expect(() => validateState(Y.encodeStateAsUpdate(s.docs[0]))).toThrow();
      } finally { s.close(); }
    }
    const s = setup(); try {
      const map = getModel(s.docs[0]).scenes.get(s.p.frames[0].id)!.get("annotationLines")! as Y.Map<unknown>;
      for (let i = 0; i < 99; i++) map.set("line" + i, line);
      expect(() => validateState(Y.encodeStateAsUpdate(s.docs[0]))).not.toThrow();
      map.set("overflow", line); expect(() => validateState(Y.encodeStateAsUpdate(s.docs[0]))).toThrow(/QUOTA_EXCEEDED/);
    } finally { s.close(); }
  });
  it("Edge accepts deletion of every allowed line ID, including long and quoted IDs", () => {
    for (const id of ["x".repeat(255), 'line"quoted']) {
      const s = setup(); try {
        s.edit(0, { [id]: line });
        expect(() => validateState(Y.encodeStateAsUpdate(s.docs[0]))).not.toThrow();
        s.edit(0, {});
        expect(() => validateState(Y.encodeStateAsUpdate(s.docs[0]))).not.toThrow();
        expect(s.read(0).frames[0].annotationLines).toEqual({});
      } finally { s.close(); }
    }
  });
  it("Edge accepts 5,000 project lines and rejects the 5,001st even below each scene limit", () => {
    const p = normalizeProject(createSampleProject()), frame = p.frames[0];
    p.frames = Array.from({ length: 51 }, (_, i) => ({ ...frame, id: `quota-scene-${i}`, positions: {},
      annotationLines: i < 50 ? Object.fromEntries(Array.from({ length: 100 }, (_, j) => [`line-${j}`, line])) : {} }));
    const doc = createSharedDocument(p);
    try {
      expect(() => validateState(Y.encodeStateAsUpdate(doc))).not.toThrow();
      (getModel(doc).scenes.get("quota-scene-50")!.get("annotationLines") as Y.Map<unknown>).set("overflow", line);
      expect(() => validateState(Y.encodeStateAsUpdate(doc))).toThrow(/QUOTA_EXCEEDED/);
    } finally { doc.destroy(); }
  });
});
