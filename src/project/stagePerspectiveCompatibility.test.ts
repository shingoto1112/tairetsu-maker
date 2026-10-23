import { expect, it } from "vitest";
import { formationExportFixture } from "../utils/formationExportFixture";
import { normalizeProject } from "./normalizeProject";
import { createTairetsuArchive, readTairetsuArchive } from "../utils/tairetsuFile";

for (const mode of [undefined, "stage", "parade"] as const)
for (const saved of [undefined, "audience", "performer"] as const)
for (const frontDirection of ["top", "bottom", "left", "right"] as const) {
  it(`${mode}/${saved}/${frontDirection}: restores the view without resnapping or migrating scene data`, () => {
    const p = formationExportFixture(); p.mode = mode; p.stage.frontDirection = frontDirection;
    p.viewerPerspective = saved;
    p.frames[0].positions.m0 = { x: 2.137, y: 1.943 };
    p.frames[0].objectStates.flag = { objectId: "flag", x: -.13, y: 1.237, widthMeters: 2.43, heightMeters: .73, rotation: 137, visible: false, zIndex: 9 };
    p.frames[0].annotationLines = { a: { x1: -.713, y1: 2.341, x2: 8.923, y2: 5.117, color: "red", dash: "dashed" } };
    const before = structuredClone(p);
    const loaded = normalizeProject(p);
    expect(loaded.viewerPerspective).toBe(saved ?? (mode === "parade" ? "audience" : "performer"));
    for (const [i, frame] of before.frames.entries()) {
      expect(loaded.frames[i].positions).toEqual(frame.positions);
      expect(loaded.frames[i].objectStates).toEqual(frame.objectStates);
      expect(loaded.frames[i].annotationLines).toEqual(frame.annotationLines ?? {});
    }
    expect(loaded.stage.frontDirection).toBe(frontDirection);
    expect(p).toEqual(before);
  });
}

it.each(["top", "bottom", "left", "right", undefined] as const)("ZIP round trip preserves front, coordinates, object states, annotations and saved view (%s)", async frontDirection => {
  const p = formationExportFixture();
  p.stage.frontDirection = frontDirection; p.stage.audienceSide = "top"; p.viewerPerspective = "audience";
  p.frames[0].positions.m0 = { x: 2.137, y: 1.943 };
  p.frames[0].objectStates.flag = { objectId: "flag", x: -.13, y: 1.237, widthMeters: 2.43, heightMeters: .73, rotation: 137, visible: false, zIndex: 9 };
  p.frames[0].annotationLines = { a: { x1: -.713, y1: 2.341, x2: 8.923, y2: 5.117, color: "red", dash: "dashed" } };
  const before = structuredClone(p);
  const archive = await createTairetsuArchive(p);
  const { project } = await readTairetsuArchive(new File([await archive.arrayBuffer()], "orientation.zip"));
  // JSON does not retain undefined keys; compare the serialized payload independently.
  expect(project).toEqual({ ...JSON.parse(JSON.stringify(before)), audio: null });
  expect(project.stage.frontDirection).toBe(frontDirection);
  expect(project.stage.audienceSide).toBe("top");
  expect(normalizeProject(project).frames.map(f => f.positions)).toEqual(before.frames.map(f => f.positions));
  expect(p).toEqual(before);
});
