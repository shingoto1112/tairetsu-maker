import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Project, FormationFrame } from "../types";
import fixtures from "../repositories/contract/fixtures/projects.json";
import legacy from "../repositories/contract/fixtures/collaborationSchema1.json";
import { createSampleProject } from "../sampleProject";
import { normalizeProjectWithContext } from "../project/normalizeProject";
import { createSharedDocument, joinSharedDocument, getModel, REMOTE_ORIGIN } from "./model";
import { CollaborationCommands } from "./commands";
import { projectSharedDocument } from "./projection";
import { SharedNotesAdapter } from "./notesAdapter";
import { createCollaborationData, hydrateCollaboration, encodeUpdate, validateCollaborationProject } from "./persistence";
import { SharedProjectEditor } from "./editorSession";
import { SaveCoordinator } from "../storage/saveCoordinator";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { MemoryTransport } from "./testing/memoryTransport";
import { validateState } from "./serverValidation";
import { orderedIds, orderKey, deleted } from "./projectModel";
import { sortFrames, createDefaultObjectState } from "../utils/interpolation";
import { applyObjectAppearance } from "../project/objectAppearance";
import { assertRecipeUpdateSize, recipeUpdateBytes } from "./recipeUpdateSize";
import { SHARED_DOCUMENT_LIMITS } from "../config/collaborationLimits";

const resources: { destroy(): void }[] = [];
const keep = <T extends { destroy(): void }>(resource: T): T => { resources.push(resource); return resource; };
afterEach(() => { resources.reverse().forEach(r => r.destroy()); resources.length = 0; });
const normalize = (value: unknown): Project => normalizeProjectWithContext(structuredClone(value) as Project, {
  defaultStage: createSampleProject().stage, now: () => "2026-01-10T00:00:00.000Z",
  createId: prefix => `${prefix}_generated`, createProjectId: () => "project_generated",
});
function fixture(): Project {
  const p = normalize(fixtures.stage);
  return { ...p, members: [...p.members, { id: "m_003", name: "三", color: "#000", visible: true, zIndex: 25 }],
    audio: { id: "device-song-secret", name: "匿名曲", type: "audio/mpeg", size: 100, duration: 60 },
    frames: [p.frames[0], { ...p.frames[0], id: "f_002", label: "二", timeSec: 10 }, { ...p.frames[0], id: "f_003", label: "三", timeSec: 20 }]
      .map(f => ({ ...f, notes: "abc", section: "A", stageWidthMeters: 12, stageDepthMeters: 6,
        memberVisibility: { m_001: true, m_002: false }, groupVisibility: { g_001: true }, objectAssignments: { o_001: [] } })),
    objectGroups: [{ ...p.objectGroups![0], defaultType: "chair", defaultShape: "rectangle" }],
    movementPlans: [{ id: "plan", fromFrameId: "f_001", toFrameId: "f_002", targetType: "member", targetId: "m_001", enabled: true,
      startSec: 1, endSec: 9, pathType: "curve", controlPoint: { x: 2, y: 3 }, waypoints: [{ x: 1, y: 1 }], note: "計画" }],
    movementPaths: [{ id: "path", fromFrameId: "f_001", toFrameId: "f_002", targetType: "object", targetId: "o_001", pathType: "curve", type: "quadratic", controlPoint: { x: 2, y: 3 }, visible: false }],
    focusMemberId: "m_001", viewerPerspective: "performer", lastOpenedAt: "2026-01-10T00:00:00.000Z" };
}
function peers(p = fixture()) {
  const a = keep(createSharedDocument(p)), b = keep(joinSharedDocument(Y.encodeStateAsUpdate(a)));
  const commands = [keep(new CollaborationCommands(a)), keep(new CollaborationCommands(b))];
  const transport = keep(new MemoryTransport([a, b]));
  const docs = [a, b];
  const edit = (i: number, recipe: (p: Project) => Project) => { const before = projectSharedDocument(docs[i], p); return commands[i].applyRecipe(before, recipe(before)); };
  const frame = (i: number, recipe: (f: FormationFrame) => FormationFrame) => edit(i, previous => ({ ...previous, frames: previous.frames.map((f, n) => n ? f : recipe(f)) }));
  const project = (i = 0) => projectSharedDocument(docs[i], p);
  return { p, docs, commands, transport, edit, frame, project };
}
const converge = (s: ReturnType<typeof peers>, reverse = true) => {
  s.transport.flush(reverse); expect(s.project(0)).toEqual(s.project(1));
};

describe("schema 2 full Project mapping", () => {
  it("display time ordering is stable and emits no Yjs updates or saved order changes", () => {
    const p = fixture();
    p.frames = [p.frames[2], { ...p.frames[0], timeSec: 10 }, p.frames[1]];
    const s = peers(p);
    const update = vi.fn(); s.docs[0].on("update", update);
    const before = Y.encodeStateAsUpdate(s.docs[0]);
    const projected = s.project();
    expect(sortFrames(projected.frames).map(f => f.id)).toEqual(["f_001", "f_002", "f_003"]);
    expect(projected.frames.map(f => f.id)).toEqual(["f_003", "f_001", "f_002"]);
    expect(s.project().frames.map(f => f.id)).toEqual(p.frames.map(f => f.id));
    expect(Y.encodeStateAsUpdate(s.docs[0])).toEqual(before);
    expect(update).not.toHaveBeenCalled();
  });
  it.each(["stage", "parade"])("round trips every declared %s field, geometry, paths, orders, null/empty/local state", mode => {
    const p = mode === "stage" ? fixture() : { ...fixture(), ...normalize(fixtures.parade), audio: fixture().audio };
    const doc = keep(createSharedDocument(p)), joined = keep(joinSharedDocument(Y.encodeStateAsUpdate(doc)));
    expect(projectSharedDocument(joined, p)).toEqual(p);
    expect(() => validateState(Y.encodeStateAsUpdate(doc))).not.toThrow();
    const json = JSON.stringify(doc.toJSON());
    for (const field of ["device-song-secret", "lastOpenedAt", "sceneViewState", "viewerPerspective", "focusMemberId", "updatedAt"]) expect(json).not.toContain(field);
    expect(getModel(doc).settings.get("song")).toEqual({ name: p.audio!.name, type: p.audio!.type, size: p.audio!.size, duration: p.audio!.duration });
    expect(getModel(doc).scenes.get(p.frames[0].id)!.get("notes")).toBeInstanceOf(Y.Text);
  });
  it("fills legacy path IDs only at creation; hydration/projection does not regenerate them", () => {
    const p = fixture(); delete p.movementPaths![0].id;
    const doc = keep(createSharedDocument(p)), state = createCollaborationData(doc);
    const first = projectSharedDocument(doc, p).movementPaths![0].id;
    expect(first).toBeTruthy(); expect(p.movementPaths![0].id).toBeUndefined();
    const restored = keep(hydrateCollaboration(state));
    expect(projectSharedDocument(restored, p).movementPaths![0].id).toBe(first);
  });
  it("keeps schema 1 fixture readable without promoting its attachment or creating identities", () => {
    const doc = keep(hydrateCollaboration(legacy.initial as Parameters<typeof hydrateCollaboration>[0]));
    expect(getModel(doc).metadata.get("schemaVersion")).toBe(1);
  });
  it.each(["members", "stageObjects", "scenes", "memberGroups", "objectGroups", "movementPlans", "movementPaths"] as const)("simultaneous move of one %s element never duplicates it", root => {
    const s = peers(), ids = orderedIds(s.docs[0], orderKey(root)), id = ids[0];
    s.commands[0].moveEntity(root, id); s.commands[1].moveEntity(root, id, ids[1]); converge(s);
    const order = orderedIds(s.docs[0], orderKey(root));
    expect(new Set(order).size).toBe(order.length); expect(order.filter(value => value === id)).toHaveLength(1);
    s.commands[0].undo(); converge(s); expect(new Set(orderedIds(s.docs[0], orderKey(root))).size).toBe(ids.length);
  });
  it("deletion dominates simultaneous move/name changes, retains orphan coordinates/links/paths and only explicit restore clears tombstones", () => {
    const s = peers();
    s.edit(0, p => ({ ...p, members: p.members.filter(m => m.id !== "m_001") }));
    s.commands[1].moveMembers([{ sceneId: "f_001", memberId: "m_001", position: { x: 8, y: 9 } }]);
    s.edit(1, p => ({ ...p, members: p.members.map(m => m.id === "m_001" ? { ...m, name: "変更" } : m) })); converge(s);
    expect(s.project().members.some(m => m.id === "m_001")).toBe(false);
    expect(s.project().frames[0].positions.m_001).toBeUndefined(); expect(s.project().movementPlans).toEqual([]);
    expect(getModel(s.docs[0]).scenes.get("f_001")!.get("positions")!.get("m_001")).toEqual({ x: 8, y: 9 });
    expect(() => s.edit(0, p => ({ ...p, members: [...p.members, s.p.members[0]] }))).toThrow(/restore/);
    s.commands[0].restoreEntity("members", "m_001"); converge(s);
    expect(s.project().members.find(m => m.id === "m_001")!.name).toBe("変更");
    expect(s.project().movementPlans).toHaveLength(1);
  });
  it.each([[100, 200], [200, 100]])("order Undo/Redo retains every element for client IDs %i/%i", (a, b) => {
    const s = peers(); s.docs[0].clientID = a; s.docs[1].clientID = b;
    s.commands[0].moveEntity("members", "m_001");
    s.commands[1].moveEntity("members", "m_001", "m_003"); converge(s);
    for (let cycle = 0; cycle < 3; cycle++) {
      s.commands[0].undo(); converge(s);
      expect(new Set(s.project().members.map(m => m.id))).toEqual(new Set(s.p.members.map(m => m.id)));
      s.commands[0].redo(); converge(s);
      expect(new Set(s.project().members.map(m => m.id))).toEqual(new Set(s.p.members.map(m => m.id)));
    }
  });
  it("two delete operations remain independent when one actor Undoes, including real App cascade cleanup", () => {
    const s = peers();
    const remove = (p: Project): Project => ({ ...p, members: p.members.filter(m => m.id !== "m_001"),
      memberGroups: p.memberGroups?.map(g => ({ ...g, memberIds: g.memberIds.filter(id => id !== "m_001") })),
      frames: p.frames.map(f => ({ ...f, positions: Object.fromEntries(Object.entries(f.positions).filter(([id]) => id !== "m_001")) })) });
    s.edit(0, remove); s.edit(1, remove); converge(s);
    expect(s.commands[0].undo().status).toBe("blocked"); converge(s);
    expect(deleted(s.docs[0], "members", "m_001")).toBe(true);
    expect(getModel(s.docs[0]).scenes.get("f_001")!.get("positions")!.has("m_001")).toBe(true);
  });
  it("concurrent assignments and memberships preserve independent links and membership ordering", () => {
    const s = peers();
    s.frame(0, f => ({ ...f, objectAssignments: { ...f.objectAssignments, o_001: ["m_001"] } }));
    s.frame(1, f => ({ ...f, objectAssignments: { ...f.objectAssignments, o_001: ["m_002"] } }));
    s.edit(0, p => ({ ...p, memberGroups: p.memberGroups!.map((g, i) => i ? g : { ...g, memberIds: [...new Set([...g.memberIds, "m_002"])] }) }));
    s.edit(1, p => ({ ...p, memberGroups: p.memberGroups!.map((g, i) => i ? g : { ...g, memberIds: [...new Set([...g.memberIds, "m_003"])] }) })); converge(s);
    expect(new Set(s.project().frames[0].objectAssignments!.o_001)).toEqual(new Set(["m_001", "m_002"]));
    expect(new Set(s.project().memberGroups![0].memberIds)).toEqual(new Set(["m_001", "m_002", "m_003"]));
  });
  it("reports invisible recipe edits as blocked after another actor deletes their entity", () => {
    const s = peers();
    s.frame(0, f => ({ ...f, positions: { ...f.positions, m_001: { x: 8, y: 9 } } }));
    s.edit(1, p => ({ ...p, members: p.members.filter(m => m.id !== "m_001") })); converge(s);
    expect(s.commands[0].undo().status).toBe("blocked"); converge(s);
    expect(s.project().members.some(m => m.id === "m_001")).toBe(false);
  });
  it("separate settings/appearance/geometry registers keep both edits and protect remote values during Undo", () => {
    const s = peers();
    s.edit(0, p => ({ ...p, stage: { ...p.stage, showGrid: false }, animationSettings: { ...p.animationSettings!, membersEnabled: false } }));
    s.edit(1, p => ({ ...p, stage: { ...p.stage, showCenterLine: false }, animationSettings: { ...p.animationSettings!, objectsEnabled: false } }));
    s.frame(0, f => ({ ...f, objectStates: { ...f.objectStates, o_001: { ...f.objectStates.o_001, x: 7, y: 8 } } }));
    s.frame(1, f => ({ ...f, objectStates: { ...f.objectStates, o_001: { ...f.objectStates.o_001, visible: false } } })); converge(s);
    expect(s.project().stage).toMatchObject({ showGrid: false, showCenterLine: false });
    expect(s.project().animationSettings).toMatchObject({ membersEnabled: false, objectsEnabled: false });
    expect(s.project().frames[0].objectStates.o_001).toMatchObject({ x: 7, y: 8, visible: false });
    s.commands[0].undo(); converge(s); expect(s.project().frames[0].objectStates.o_001.visible).toBe(false);
  });
  it("related alias/dimension settings stay atomic and invalid batches do not mutate the doc", () => {
    const s = peers(), before = Y.encodeStateAsUpdate(s.docs[0]);
    expect(() => s.edit(0, p => ({ ...p, title: "途中", stage: { ...p.stage, widthMeters: Infinity } }))).toThrow();
    expect(Y.encodeStateAsUpdate(s.docs[0])).toEqual(before);
    s.edit(0, p => ({ ...p, stage: { ...p.stage, gridSizeMeters: 1, gridIntervalM: 1 } }));
    expect(getModel(s.docs[0]).settings.get("grid")).toEqual({ "stage.gridSizeMeters": 1, "stage.gridIntervalM": 1 });
  });
  it("one compound addition/scene import is one transaction, selective Undo/Redo and projection consistency", () => {
    const s = peers(), origins: unknown[] = []; s.docs[0].on("update", (_, origin) => origins.push(origin));
    s.edit(0, p => ({ ...p, title: "新題", members: [...p.members, { id: "new", name: "新", color: "#123" }],
      frames: p.frames.map(f => ({ ...f, positions: { ...f.positions, new: { x: 3, y: 4 } } })) }));
    expect(origins).toEqual([s.commands[0].localOrigin]);
    expect(s.commands[0].undo().status).toBe("applied"); expect(s.project().members).toHaveLength(s.p.members.length);
    expect(s.commands[0].redo().status).toBe("applied"); expect(s.project().members).toHaveLength(s.p.members.length + 1);
    expect(() => validateCollaborationProject(createCollaborationData(s.docs[0]), s.project())).not.toThrow();
  });
});

describe("Y.Text and anchored IME input", () => {
  it("large anchored deletion preserves remote inserted text without per-character scans", () => {
    const p = fixture(); p.frames[0].notes = "a".repeat(60000);
    const s = peers(p), adapter = new SharedNotesAdapter(s.docs[0], s.commands[0], "f_001"), capture = adapter.capture();
    s.frame(1, f => ({ ...f, notes: f.notes!.slice(0, 30000) + "REMOTE" + f.notes!.slice(30000) })); converge(s);
    adapter.input(capture, "end"); converge(s);
    expect(s.project().frames[0].notes).toContain("REMOTE"); expect(s.project().frames[0].notes).toContain("end");
    s.commands[0].undo(); converge(s); expect(s.project().frames[0].notes).toHaveLength(60006);
  });
  it("concurrent notes merge and Undo removes only the actor's own characters", () => {
    const s = peers(); s.frame(0, f => ({ ...f, notes: "Aabc" })); s.frame(1, f => ({ ...f, notes: "abcB" })); converge(s);
    expect(s.project().frames[0].notes).toBe("AabcB");
    s.commands[0].undo(); converge(s); expect(s.project().frames[0].notes).toBe("abcB");
    s.commands[0].redo(); converge(s); expect(s.project().frames[0].notes).toBe("AabcB");
  });
  it("composition buffers a draft while remote edits continue; final anchored deletion preserves inserted remote characters", () => {
    const s = peers(), adapter = new SharedNotesAdapter(s.docs[0], s.commands[0], "f_001"), capture = adapter.capture();
    s.frame(1, f => ({ ...f, notes: "aREMOTEbc" }));
    s.frame(1, f => ({ ...f, notes: "aREMOTEbc!" })); converge(s);
    adapter.input(capture, "a日本語c"); converge(s);
    expect(s.project().frames[0].notes).toBe("aREMOTE日本語c!");
    s.commands[0].undo(); converge(s); expect(s.project().frames[0].notes).toBe("aREMOTEbc!");
  });
  it("does not delete replacements when the original character was remotely removed; emoji boundaries remain intact", () => {
    const s = peers(), adapter = new SharedNotesAdapter(s.docs[0], s.commands[0], "f_001"), capture = adapter.capture();
    s.frame(1, f => ({ ...f, notes: "aZc" })); converge(s);
    adapter.input(capture, "a😀c"); converge(s);
    expect(s.project().frames[0].notes).toContain("Z"); expect(s.project().frames[0].notes).toContain("😀");
    expect(() => validateState(Y.encodeStateAsUpdate(s.docs[0]))).not.toThrow();
  });
});

describe("App entry/save-session boundary", () => {
  async function setup(p = fixture()) {
    const doc = keep(createSharedDocument(p)), repository = new MemoryProjectRepository(); await repository.initialize();
    await repository.commit({ project: p, collaboration: createCollaborationData(doc), localRevision: "1", expectedRepositoryRevision: null, operationId: "create" });
    let editor: SharedProjectEditor | undefined, latest = p;
    const coordinator = new SaveCoordinator(repository, () => editor?.receiveDurable());
    coordinator.activate((await repository.get(p.id!))!);
    const failed = vi.fn(); editor = keep(await SharedProjectEditor.create(coordinator, p, projection => { latest = projection; }, failed));
    const remote = keep(joinSharedDocument(Y.encodeStateAsUpdate(editor.doc))), commands = keep(new CollaborationCommands(remote));
    const receive = async (action: () => void) => {
      const updates: Uint8Array[] = []; const listener = (b: Uint8Array) => updates.push(b); remote.on("update", listener);
      action(); remote.off("update", listener);
      await coordinator.editCollaboration([{ updateId: crypto.randomUUID(), bytes: encodeUpdate(Y.mergeUpdates(updates)), source: "remote" }]);
    };
    return { p, repository, coordinator, editor, commands, remote, receive, failed, latest: () => latest };
  }
  it("fresh recipes preserve remote edits; rejects captured whole Project/frame replacement; coordinator refuses Project-only writes", async () => {
    const s = await setup(), stale = s.editor.project;
    // Remember the exact projection a React handler captured.
    s.editor.setLocal(stale);
    const captured = s.latest();
    await s.receive(() => s.commands.moveMembers([{ sceneId: "f_001", memberId: "m_001", position: { x: 6, y: 7 } }]));
    expect(() => s.editor.edit(() => ({ ...captured, title: "stale" }))).toThrow(/古い/);
    expect(() => s.editor.replace()).toThrow(/古い/);
    expect(() => s.coordinator.edit(captured)).toThrow();
    s.editor.edit(p => ({ ...p, title: "live", members: p.members.map(m => m.id === "m_002" ? { ...m, name: "changed" } : m) }));
    expect(s.latest().frames[0].positions.m_001).toEqual({ x: 6, y: 7 });
    expect(await s.coordinator.flush()).toBe(true);
    expect(s.failed).not.toHaveBeenCalled();
    expect((await s.repository.get(s.p.id!))!.project.title).toBe("live");
  });
  it("object appearance commits once, keeps received movement/untouched size, supports Undo/Redo and remote deletion", async () => {
    const p = fixture();
    p.frames.forEach(frame => { frame.objectStates.o_001 = createDefaultObjectState(p.stageObjects[0]); });
    const s = await setup(p), id = "o_001";
    await s.receive(() => {
      const before = projectSharedDocument(s.remote, s.p);
      s.commands.applyRecipe(before, { ...before, frames: before.frames.map(frame => ({ ...frame, objectStates: {
        ...frame.objectStates, [id]: { ...frame.objectStates[id], x: 6, y: 3, heightMeters: 2 },
      } })) });
    });
    const before = s.editor.project, baseWidth = before.stageObjects.find(o => o.id === id)!.widthMeters;
    const updates = vi.fn(); s.editor.doc.on("update", updates);
    s.editor.edit(p => applyObjectAppearance(p, id, { widthMeters: baseWidth + .1 }), false, true);
    expect(updates).toHaveBeenCalledTimes(1); expect(s.coordinator.collaborationProjection!.outbox).toHaveLength(1);
    expect(s.latest().frames[0].objectStates[id]).toMatchObject({ x: 5.95, y: 3, heightMeters: 2 });
    expect(s.editor.undo().status).toBe("applied"); expect(s.latest().frames).toEqual(before.frames);
    expect(s.editor.redo().status).toBe("applied"); expect(s.latest().frames[0].objectStates[id].widthMeters).toBe(baseWidth + .1);
    const next = s.editor.project;
    const count = updates.mock.calls.length;
    s.editor.edit(p => applyObjectAppearance(p, id, { widthMeters: baseWidth + .1 }), false, true);
    expect(updates).toHaveBeenCalledTimes(count);
    await s.receive(() => {
      const previous = projectSharedDocument(s.remote, s.p);
      s.commands.applyRecipe(previous, { ...previous, stageObjects: previous.stageObjects.filter(o => o.id !== id) });
    });
    expect(s.editor.project.stageObjects.some(o => o.id === id)).toBe(false);
    const bytes = Y.encodeStateAsUpdate(s.editor.doc);
    s.editor.edit(p => applyObjectAppearance(p, id, { shape: "circle" }), false, true);
    expect(Y.encodeStateAsUpdate(s.editor.doc)).toEqual(bytes);
    expect(next.stageObjects.some(o => o.id === id)).toBe(true);
  });
  it("preflight measures exact Yjs bytes, accepts boundary, rejects above boundary without history/outbox/live changes", async () => {
    const s = await setup(), before = s.editor.project;
    const after = applyObjectAppearance(before, "o_001", { widthMeters: 1.33 });
    const original = Y.encodeStateAsUpdate(s.editor.doc);
    const measured = recipeUpdateBytes(s.editor.doc, before, after);
    expect(measured).toBeGreaterThan(0); expect(Y.encodeStateAsUpdate(s.editor.doc)).toEqual(original);
    expect(() => assertRecipeUpdateSize(s.editor.doc, before, after, null, measured)).not.toThrow();
    expect(() => assertRecipeUpdateSize(s.editor.doc, before, after, null, measured - 1)).toThrow(/256KiB/);
    const boundaryRecipe = (padding: number) => ({ ...before, frames: before.frames.map((f, i) => ({ ...f,
      notes: i < 2 ? "a".repeat(60000) : "あ".repeat(47000) + "a".repeat(padding),
    })) });
    let padding = SHARED_DOCUMENT_LIMITS.updateBytes - recipeUpdateBytes(s.editor.doc, before, boundaryRecipe(0));
    for (let attempt = 0; attempt < 3; attempt++) padding += SHARED_DOCUMENT_LIMITS.updateBytes - recipeUpdateBytes(s.editor.doc, before, boundaryRecipe(padding));
    expect(recipeUpdateBytes(s.editor.doc, before, boundaryRecipe(padding))).toBe(262144);
    expect(() => assertRecipeUpdateSize(s.editor.doc, before, boundaryRecipe(padding))).not.toThrow();
    expect(recipeUpdateBytes(s.editor.doc, before, boundaryRecipe(padding + 1))).toBe(262145);
    expect(() => assertRecipeUpdateSize(s.editor.doc, before, boundaryRecipe(padding + 1))).toThrow(/256KiB/);
    const update = vi.fn(); s.editor.doc.on("update", update);
    s.editor.edit(p => applyObjectAppearance(p, "o_001", { widthMeters: 1.33 }), false, true);
    expect(update).toHaveBeenCalledTimes(1); expect(update.mock.calls[0][0].byteLength).toBe(measured);
    const beforeOversized = s.editor.project, bytes = Y.encodeStateAsUpdate(s.editor.doc);
    const oversized = (p: Project) => ({ ...p, frames: p.frames.map(f => ({ ...f, notes: "あ".repeat(40000) })) });
    expect(recipeUpdateBytes(s.editor.doc, beforeOversized, oversized(beforeOversized))).toBeGreaterThan(SHARED_DOCUMENT_LIMITS.updateBytes);
    expect(() => s.editor.edit(oversized, false, true)).toThrow(/256KiB/);
    expect(Y.encodeStateAsUpdate(s.editor.doc)).toEqual(bytes); expect(s.editor.project).toEqual(beforeOversized);
    expect(s.coordinator.collaborationProjection!.outbox).toHaveLength(1); expect(update).toHaveBeenCalledTimes(1);
    expect(s.editor.undo().status).toBe("applied"); expect(s.editor.project.frames).toEqual(before.frames);
  });
  it("pointer-up emits one operation, own dragged geometry survives remote reflection, and remote hide is preserved", async () => {
    const s = await setup(); s.editor.begin("f_001", [{ id: "m_001", type: "member-position" }]);
    s.editor.edit(p => ({ ...p, frames: p.frames.map(f => f.id === "f_001" ? { ...f, positions: { ...f.positions, m_001: { x: 4, y: 5 } } } : f) }));
    expect(s.coordinator.collaborationProjection!.outbox).toHaveLength(0);
    await s.receive(() => {
      const before = projectSharedDocument(s.remote, s.p);
      s.commands.applyRecipe(before, { ...before, frames: before.frames.map(f => f.id === "f_001" ? { ...f, positions: { ...f.positions, m_001: { x: 9, y: 9 }, m_002: { x: 7, y: 7 } }, memberVisibility: { ...f.memberVisibility, m_001: false } } : f) });
    });
    expect(s.latest().frames[0].positions).toMatchObject({ m_001: { x: 4, y: 5 }, m_002: { x: 7, y: 7 } });
    s.editor.end(); expect(s.coordinator.collaborationProjection!.outbox).toHaveLength(1);
    expect(s.latest().frames[0].memberVisibility!.m_001).toBe(false);
    expect(s.editor.undo().status).toBe("applied"); expect(s.latest().frames[0].positions.m_001).toEqual({ x: 9, y: 9 });
  });
  it("a synchronous compound entry accumulates drafts into one transaction", async () => {
    const s = await setup(); s.editor.begin();
    for (const id of ["m_002", "m_003"]) s.editor.edit(p => ({ ...p, movementPlans: [...p.movementPlans!,
      { ...p.movementPlans![0], id: `plan-${id}`, targetId: id }] }));
    expect(s.latest().movementPlans).toHaveLength(3);
    s.editor.end(); expect(s.latest().movementPlans).toHaveLength(3);
    expect(s.coordinator.collaborationProjection!.outbox).toHaveLength(1);
    s.editor.undo(); expect(s.latest().movementPlans).toHaveLength(1);
    s.editor.redo(); expect(s.latest().movementPlans).toHaveLength(3);
  });
  it("observes remote Y.Doc updates without creating a local outbox entry", async () => {
    const s = await setup(); const vector = Y.encodeStateVector(s.editor.doc);
    s.commands.moveMembers([{ sceneId: "f_001", memberId: "m_002", position: { x: 11, y: 12 } }]);
    Y.applyUpdate(s.editor.doc, Y.encodeStateAsUpdate(s.remote, vector), REMOTE_ORIGIN);
    expect(s.latest().frames[0].positions.m_002).toEqual({ x: 11, y: 12 });
    expect(s.coordinator.collaborationProjection!.outbox).toHaveLength(0);
  });
  it("device-only edits emit no Yjs update, save atomically and survive received content without changing another device", async () => {
    const s = await setup();
    s.editor.edit(p => ({ ...p, viewerPerspective: "audience", focusMemberId: "m_002", frames: p.frames.map(f => ({ ...f, sceneViewState: { scrollTop: 100, scrollLeft: 20, zoom: 2 } })) }));
    expect(s.coordinator.collaborationProjection!.outbox).toHaveLength(0);
    await s.receive(() => s.commands.moveMembers([{ sceneId: "f_001", memberId: "m_002", position: { x: 3, y: 4 } }]));
    expect(s.latest().frames[0].sceneViewState!.zoom).toBe(2); expect(s.latest().focusMemberId).toBe("m_002");
    expect(projectSharedDocument(s.remote, s.p).focusMemberId).toBe("m_001");
    expect(await s.coordinator.flush()).toBe(true);
  });
});
