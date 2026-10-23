import { describe, expect, it } from "vitest";
import fixtures from "../repositories/contract/fixtures/projects.json";
import commitFixtures from "../repositories/contract/fixtures/commitProjects.json";
import { createSampleProject } from "../sampleProject";
import type { Project } from "../types";
import { normalizeProjectWithContext, type NormalizationContext } from "./normalizeProject";
import { createProjectSummary, decodeProjectJson, serializeProject, validateProjectStructure } from "./codec";

const context: NormalizationContext = {
  defaultStage: createSampleProject().stage, now: () => "2026-01-10T00:00:00.000Z",
  createId: prefix => `${prefix}_generated`, createProjectId: () => "project_generated",
};
const normalize = (p: unknown) => normalizeProjectWithContext(p as Project, context);

describe("Project codec and legacy normalization", () => {
  it("keeps platform contract geometry identical while preserving its saved audience view", () => {
    const legacyStage = normalize(fixtures.stage);
    const savedStage = normalize(commitFixtures.stage);
    expect(legacyStage.viewerPerspective).toBe("performer");
    expect(savedStage.viewerPerspective).toBe("audience");
    // The platform fixture contains an explicitly saved view; never rewrite it to the new default.
    expect({ ...legacyStage, viewerPerspective: "audience" }).toEqual(savedStage);
    expect(normalize(fixtures.parade)).toEqual(normalize(commitFixtures.parade));
  });
  it.each(Object.entries(fixtures))("round trips anonymous %s without mutating input", (_, raw) => {
    const before = JSON.stringify(raw);
    const p = normalize(raw);
    expect(JSON.stringify(raw)).toBe(before);
    const encoded = serializeProject(p);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) throw encoded.error;
    expect(encoded.value).toBe(JSON.stringify(p));
    const decoded = decodeProjectJson(encoded.value, context);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw decoded.error;
    expect(decoded.value).toEqual(p);
  });
  it("retains unknown fields and legacy aliases exactly as the old normalizer did", () => {
    const p = normalize(fixtures.legacy);
    expect(p.mode).toBe("stage");
    expect(p.stage).toMatchObject({ widthMeters: 18, depthMeters: 9, gridSizeMeters: 0.25,
      horizontalGuideMode: "centerSplit", memberDiameterMeters: 0.7, customStage: "preserve", widthM: 18 });
    expect(p.useGlobalStageSize).toBe(false);
    expect(p).toMatchObject({ customUnknown: { keep: ["unknown", 123] } });
    expect(p.memberGroups?.map(g => g.memberIds)).toEqual([["m_001"], ["m_002"]]);
    expect(p.frames[0].objectAssignments).toEqual({ o_001: ["m_001"] });
    expect(p.movementPaths?.[0]).toMatchObject({ targetId: "m_001", targetType: "member", pathType: "curve", type: "quadratic" });
    expect(p.movementPlans).toHaveLength(1);
  });
  it("produces summary fields for both modes and audio presence", () => {
    const stage = createProjectSummary(normalize(fixtures.stage), "9007199254740993");
    expect(stage).toEqual({ id: "project_a", title: "匿名ステージ", mode: "stage", createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z", memberCount: 2, sceneCount: 1,
      repositoryRevision: "9007199254740993", syncStatus: "local" });
    expect(createProjectSummary(normalize(fixtures.parade), "1")).toMatchObject({ mode: "parade", audioId: "audio-legacy-001" });
    expect(createProjectSummary(normalize(fixtures.large), "1")).toMatchObject({ memberCount: 146, sceneCount: 18 });
  });
  it.each([
    "broken", "null", "[]", "{}", '{"frames":[null]}', '{"members":[{}]}',
    '{"title":4}', '{"stage":"bad"}', '{"frames":[{"id":"f","label":"x","timeSec":0,"positions":{"m":{"x":"bad","y":1}}}]}',
    '{"memberGroups":[{"id":"g","memberIds":null}]}',
    '{"frames":[{"id":"f","label":"x","timeSec":0,"objectAssignments":{"o":5}}]}',
    '{"movementPlans":[null]}', '{"audio":{"id":"audio_a","size":"bad"}}',
  ])("classifies malformed data without throwing", json => {
    expect(decodeProjectJson(json, context)).toMatchObject({ ok: false, error: { code: "CORRUPT" } });
  });
  it("classifies invalid logical IDs without exposing input", () => {
    expect(decodeProjectJson('{"id":"../escape","title":"x"}', context)).toMatchObject({ ok: false, error: { code: "INVALID_ID" } });
    expect(decodeProjectJson(JSON.stringify({ ...fixtures.parade, audio: { ...fixtures.parade.audio, id: "a/b" } }), context)).toMatchObject({ ok: false, error: { code: "INVALID_ID" } });
  });
  it("A10: keeps accepting missing or null optional containers but rejects malformed ones", () => {
    // Stored projects are read through this validator too; normalization already
    // treats null settings/maps as missing, so null must stay readable.
    expect(validateProjectStructure({ title: "旧データ" }).ok).toBe(true);
    for (const key of ["stage", "paradeSettings", "animationSettings", "guideSettings"]) {
      expect(validateProjectStructure({ title: "旧データ", [key]: null }).ok).toBe(true);
      expect(validateProjectStructure({ title: "旧データ", [key]: [] })).toMatchObject({ ok: false, error: { code: "CORRUPT" } });
    }
    for (const key of ["members", "stageObjects", "frames"]) {
      expect(validateProjectStructure({ title: "旧データ", [key]: null })).toMatchObject({ ok: false, error: { code: "CORRUPT" } });
    }
    for (const key of ["positions", "objectStates", "objectAssignments", "memberVisibility", "groupVisibility", "memberAppearanceOverrides", "sceneViewState"]) {
      expect(validateProjectStructure({ ...fixtures.stage, frames: [{ ...fixtures.stage.frames[0], [key]: null }] }).ok).toBe(true);
      expect(validateProjectStructure({ ...fixtures.stage, frames: [{ ...fixtures.stage.frames[0], [key]: "x" }] }))
        .toMatchObject({ ok: false, error: { code: "CORRUPT" } });
    }
  });
  it("rejects nonfinite known coordinates and cyclic JSON during serialization", () => {
    expect(validateProjectStructure({ ...fixtures.stage, frames: [{ ...fixtures.stage.frames[0], positions: { m: { x: Infinity, y: 0 } } }] })).toMatchObject({ ok: false, error: { code: "CORRUPT" } });
    const p = normalize(fixtures.stage) as Project & { unknown?: unknown };
    p.unknown = p;
    expect(serializeProject(p)).toMatchObject({ ok: false, error: { code: "CORRUPT" } });
  });
  it("does not confuse Project.version with the repository schema", () => {
    expect(decodeProjectJson(JSON.stringify({ ...fixtures.stage, version: 999 }), context).ok).toBe(true);
  });
});
