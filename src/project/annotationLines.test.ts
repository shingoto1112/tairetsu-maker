import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { validateProjectStructure, serializeProject, decodeProjectJson } from "./codec";
import { normalizeProject } from "./normalizeProject";
import { validAnnotationLine, validAnnotationLines, validProjectLineCount } from "./annotationLines";
import { copyAnnotationLines, snapAnnotationPoint, translateAnnotationLine } from "../utils/annotationLines";
import { createTairetsuArchive, readTairetsuArchive } from "../utils/tairetsuFile";
import type { AnnotationLine } from "../types";
export const testLine: AnnotationLine = { x1: 1, y1: 2, x2: 8, y2: 6, color: "red", dash: "dashed" };
describe("annotation storage and grid contract", () => {
  it.each(["black", "red", "blue", "green"] as const)("accepts %s, missing/empty collections and out-of-stage coordinates", color => {
    expect(validAnnotationLine({ ...testLine, color, x1: -100, y2: 1000 })).toBe(true);
    expect(validAnnotationLines(undefined)).toBe(true); expect(validAnnotationLines({})).toBe(true);
    const p = normalizeProject(createSampleProject()); expect(p.frames.every(f => Object.keys(f.annotationLines!).length === 0)).toBe(true);
  });
  it.each([{ color: "url(https://bad.invalid)" }, { dash: "dotted" }, { x1: NaN }, { y2: Infinity }, { x2: 100001 }, { extra: true }, { x2: 1, y2: 2 }])("rejects malformed attributes %j", patch => {
    expect(validAnnotationLine({ ...testLine, ...patch })).toBe(false);
    const p = createSampleProject(); p.frames[0].annotationLines = { line: { ...testLine, ...patch } as AnnotationLine };
    expect(validateProjectStructure(p).ok).toBe(false);
  });
  it("enforces IDs and both quotas", () => {
    for (const id of ["", "../escape", "a/b", "constructor", "x".repeat(256)]) expect(validAnnotationLines({ [id]: testLine })).toBe(false);
    const lines = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ["line" + i, testLine]));
    expect(validAnnotationLines(lines)).toBe(true); expect(validAnnotationLines({ ...lines, extra: testLine })).toBe(false);
    expect(validProjectLineCount(Array.from({ length: 50 }, () => ({ annotationLines: lines })))).toBe(true);
    expect(validProjectLineCount(Array.from({ length: 51 }, () => ({ annotationLines: lines })))).toBe(false);
  });
  it("copies to fresh IDs and independent values", () => {
    const original = { line: { ...testLine } }, a = copyAnnotationLines(original), b = copyAnnotationLines(original);
    expect(Object.keys(a)).not.toEqual(Object.keys(b)); expect(Object.keys(a)).not.toEqual(Object.keys(original));
    Object.values(a)[0].x1 = 99; expect(original.line.x1).toBe(1); expect(Object.values(b)[0].x1).toBe(1);
  });
  it("uses effective width/counting origins, zero vertical origin, and equal movement", () => {
    expect(snapAnnotationPoint({ x: 2, y: 1.7 }, 9.3, 10, 1, "meters")).toEqual({ x: 1.65, y: 2 });
    expect(snapAnnotationPoint({ x: 2, y: 1.7 }, 9.3, 10, 1, "centerSplit")).toEqual({ x: 2.15, y: 2 });
    expect(snapAnnotationPoint({ x: 2, y: 90.2 }, 9.3, 110, 1, "normalMeter")).toEqual({ x: 1.65, y: 90 });
    expect(translateAnnotationLine(testLine, { x: 3, y: 4 })).toEqual({ ...testLine, x1: 3, y1: 4, x2: 10, y2: 8 });
  });
  it("keeps exact coordinates through normalize, JSON and ZIP with/without audio", async () => {
    for (const withAudio of [false, true]) {
      const p = normalizeProject(createSampleProject()); p.frames[0].annotationLines = { line: testLine };
      p.audio = withAudio ? { id: "audio-lines", name: "test.wav", type: "audio/wav", size: 3 } : null;
      const encoded = serializeProject(p); expect(encoded.ok).toBe(true); if (!encoded.ok) throw encoded.error;
      const decoded = decodeProjectJson(encoded.value); expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.value.frames[0].annotationLines).toEqual({ line: testLine });
      const blob = await createTairetsuArchive(p, { audioBlob: withAudio ? new Blob(["abc"]) : null });
      const imported = await readTairetsuArchive(new File([await blob.arrayBuffer()], "lines.zip"));
      expect(imported.project.frames[0].annotationLines).toEqual({ line: testLine });
      expect(Boolean(imported.audioBlob)).toBe(withAudio);
    }
  });
});
