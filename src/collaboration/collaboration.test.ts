import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import fixtures from "../repositories/contract/fixtures/projects.json";
import type { Project } from "../types";
import { normalizeProjectWithContext } from "../project/normalizeProject";
import { createSampleProject } from "../sampleProject";
import { validateProjectStructure } from "../project/codec";
import { loadCollaboration } from "./index";
import { createSharedDocument, getModel, joinSharedDocument, readPosition, REMOTE_ORIGIN } from "./model";
import { CollaborationCommands } from "./commands";
import { projectSharedDocument } from "./projection";
import { MemoryTransport } from "./testing/memoryTransport";

const normalize = (value: unknown): Project => normalizeProjectWithContext(structuredClone(value) as Project, {
  defaultStage: createSampleProject().stage,
  now: () => "2026-01-10T00:00:00.000Z",
  createId: prefix => `${prefix}_generated`, createProjectId: () => "project_generated",
});
const resources: { destroy(): void }[] = [];
const keep = <T extends { destroy(): void }>(resource: T): T => { resources.push(resource); return resource; };
afterEach(() => { resources.reverse().forEach(resource => resource.destroy()); resources.length = 0; });
const move = (memberId: string, x: number, y = x, sceneId = "f_001") => ({ sceneId, memberId, position: { x, y } });
const position = (doc: Y.Doc, memberId = "m_001", sceneId = "f_001") => readPosition(doc, sceneId, memberId);
function peers(count = 2, project = normalize(fixtures.stage)) {
  const creator = keep(createSharedDocument(project));
  const state = Y.encodeStateAsUpdate(creator);
  const docs = [creator, ...Array.from({ length: count - 1 }, () => keep(joinSharedDocument(state)))];
  const commands = docs.map(doc => keep(new CollaborationCommands(doc)));
  const transport = keep(new MemoryTransport(docs));
  return { docs, commands, transport, project };
}
const expectConverged = (docs: Y.Doc[]) => {
  for (const doc of docs.slice(1)) {
    expect(getModel(doc).scenes.toJSON()).toEqual(getModel(docs[0]).scenes.toJSON());
    expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector(docs[0]));
  }
};

describe("collaboration initialization and partial Project projection", () => {
  it("loads its runtime through the dynamic application entry", async () => {
    const runtime = await loadCollaboration();
    expect(runtime.createSharedDocument).toBe(createSharedDocument);
  });
  it.each(Object.entries(fixtures))("round trips normalized anonymous %s including device-only and unknown fields", (_, raw) => {
    const project = normalize(raw);
    const original = JSON.stringify(project);
    const doc = keep(createSharedDocument(project));
    const joined = keep(joinSharedDocument(Y.encodeStateAsUpdate(doc)));
    expect(projectSharedDocument(joined, project)).toEqual(project);
    const frame = project.frames[0];
    const member = project.members[0];
    if (member) {
      const commands = keep(new CollaborationCommands(joined));
      commands.moveMembers([move(member.id, 7.25, -3.5, frame.id)]);
      const projected = projectSharedDocument(joined, project);
      expect(projected).toEqual({ ...project, frames: project.frames.map((item, index) => index ? item :
        { ...item, positions: { ...item.positions, [member.id]: { x: 7.25, y: -3.5 } } }) });
      expect(validateProjectStructure(projected).ok).toBe(true);
      expect(normalize(projected)).toEqual(projected);
      projected.frames[0].positions[member.id].x = 999;
      expect(readPosition(joined, frame.id, member.id)?.x).toBe(7.25);
    }
    expect(JSON.stringify(project)).toBe(original);
  });
  it("keeps the local base's view, focus, audio ID, clock, and perspective", () => {
    const { docs, project } = peers();
    const base: Project = { ...project, focusMemberId: "m_002", viewerPerspective: "performer",
      lastOpenedAt: "local", updatedAt: "local-update", audio: { id: "local-audio", name: "local", type: "audio/mp3", size: 1 },
      frames: project.frames.map(frame => ({ ...frame, sceneViewState: { scrollTop: 7, scrollLeft: 8, zoom: 2 } })) };
    expect(projectSharedDocument(docs[0], base)).toEqual(base);
    const json = JSON.stringify(docs[0].toJSON());
    for (const field of ["sceneViewState", "audio", "lastOpenedAt", "focusMemberId", "updatedAt", "viewerPerspective"]) {
      expect(json).not.toContain(field);
    }
  });
  it("rejects a participant's empty/unsupported state and mismatched projection base", () => {
    expect(() => joinSharedDocument(Y.encodeStateAsUpdate(keep(new Y.Doc())))).toThrow(/Uninitialized/);
    const { docs, project } = peers();
    expect(() => projectSharedDocument(docs[0], { ...project, id: "other" })).toThrow(/does not match/);
    expect(() => projectSharedDocument(docs[0], { ...project, members: [] })).toThrow(/does not match/);
    expect(() => projectSharedDocument(docs[0], { ...project, frames: [project.frames[0], project.frames[0]] })).toThrow();
    getModel(docs[0]).metadata.set("schemaVersion", 999);
    expect(() => projectSharedDocument(docs[0], project)).toThrow(/unsupported/);
  });
  it("validates creation inputs without modifying Project", () => {
    const project = normalize(fixtures.stage);
    expect(() => createSharedDocument({ ...project, id: undefined })).toThrow(/Normalize/);
    expect(() => createSharedDocument({ ...project, members: [project.members[0], project.members[0]] })).toThrow(/unique/);
    expect(() => createSharedDocument({ ...project, frames: [{ ...project.frames[0], positions: { missing: { x: 0, y: 0 } } }] })).toThrow(/Unknown/);
    expect(() => createSharedDocument({ ...project, frames: [{ ...project.frames[0], positions: { m_001: { x: NaN, y: 0 } } }] })).toThrow(/Invalid/);
  });
});

describe("deterministic in-memory delivery", () => {
  it.each([2, 3, 4, 5])("converges %i documents with reversed, duplicate, delayed and missing/resend delivery", count => {
    const { docs, commands, transport } = peers(count);
    commands[0].moveMembers([move("m_001", 10, 11)]);
    commands[0].moveMembers([move("m_001", 12, 13)]);
    commands[count - 1].moveMembers([move("m_002", -5, -6)]);
    const delayed = transport.pending[0];
    const lost = transport.pending.find(packet => packet.from === 0 && packet.to === 1 && packet.id !== delayed.id)!;
    transport.duplicate(delayed.id);
    transport.drop(lost.id);
    // Newer update reaches peer 1 before a dependency; keep the earlier packet delayed.
    for (const packet of transport.pending.reverse()) if (packet.id !== delayed.id) transport.deliver(packet.id);
    transport.deliver(delayed.id);
    expect(position(docs[1])).not.toEqual({ x: 12, y: 13 });
    transport.resend(0, 1);
    transport.flush(true);
    // Resend to every peer also carries deletion sets, not just missing inserted structs.
    for (let from = 0; from < count; from++) for (let to = 0; to < count; to++) {
      if (from !== to) transport.resend(from, to);
    }
    transport.flush(true);
    expectConverged(docs);
    for (const doc of docs) {
      expect(position(doc)).toEqual({ x: 12, y: 13 });
      expect(position(doc, "m_002")).toEqual({ x: -5, y: -6 });
    }
  });
  it.each([false, true])("same-member concurrent moves converge by CRDT rules, NOT wall-clock or delivery order (reverse=%s)", reverse => {
    const { docs, commands, transport } = peers(5);
    // Deliberately fixed test client IDs. The higher concurrent Y.Map client wins,
    // even though the lower client's move executes later. No timestamp is consulted.
    docs.forEach((doc, index) => { doc.clientID = 100 + index; });
    commands[4].moveMembers([move("m_001", 41, -41)]);
    commands[0].moveMembers([move("m_001", 1, -1)]);
    const first = transport.pending[0];
    transport.duplicate(first.id);
    transport.flush(reverse);
    expectConverged(docs);
    docs.forEach(doc => expect(position(doc)).toEqual({ x: 41, y: -41 }));
  });
  it("retains independent concurrent moves of different members", () => {
    const { docs, commands, transport } = peers();
    commands[0].moveMembers([move("m_001", 10)]);
    commands[1].moveMembers([move("m_002", 20)]);
    transport.flush(true);
    expectConverged(docs);
    docs.forEach(doc => {
      expect(position(doc)).toEqual({ x: 10, y: 10 });
      expect(position(doc, "m_002")).toEqual({ x: 20, y: 20 });
    });
  });
  it("does not rebroadcast remote updates or count its own echo twice", () => {
    const { docs, commands, transport } = peers();
    commands[0].moveMembers([move("m_001", 10)]);
    const packet = transport.pending[0];
    transport.echo(packet.id);
    transport.duplicate(packet.id);
    transport.flush();
    expect(transport.pending).toHaveLength(0);
    expect(commands[1].canUndo).toBe(false);
    expect(commands[1].undo().status).toBe("empty");
    expect(commands[0].undo()).toMatchObject({ status: "applied", consumedOperations: 1 });
    expect(commands[0].canUndo).toBe(false);
    transport.flush();
    expectConverged(docs);
  });
  it("rejects invalid transport peer counts", () => {
    const doc = keep(new Y.Doc());
    expect(() => new MemoryTransport([doc])).toThrow();
    expect(() => new MemoryTransport([doc, doc])).toThrow();
  });
});

describe("local commands and selective Undo/Redo", () => {
  it("protects B's 2 when A undoes 0→1 after receiving B's 1→2", () => {
    const project = normalize(fixtures.stage);
    project.frames[0].positions.m_001 = { x: 0, y: 0 };
    const { docs, commands, transport } = peers(2, project);
    commands[0].moveMembers([move("m_001", 1)]);
    transport.flush();
    commands[1].moveMembers([move("m_001", 2)]);
    transport.flush();
    expect(commands[0].undo()).toEqual({ status: "blocked", consumedOperations: 1,
      attempted: [{ sceneId: "f_001", memberId: "m_001" }], changed: [],
      skipped: [{ sceneId: "f_001", memberId: "m_001" }] });
    expect(commands[0].canRedo).toBe(false);
    transport.flush();
    docs.forEach(doc => expect(position(doc)).toEqual({ x: 2, y: 2 }));
    expectConverged(docs);
  });
  it("undoes 145 of A's 146 moves while protecting B's one change; partial Redo touches only the 145", () => {
    const { docs, commands, transport, project } = peers(2, normalize(fixtures.large));
    const sceneId = project.frames[0].id;
    const moves = project.members.map(member => move(member.id, 500, 600, sceneId));
    commands[0].moveMembers(moves);
    transport.flush();
    const protectedId = project.members[0].id;
    commands[1].moveMembers([move(protectedId, 700, 800, sceneId)]);
    transport.flush();
    const result = commands[0].undo();
    expect(result).toMatchObject({ status: "partial", consumedOperations: 1 });
    expect(result.attempted).toHaveLength(146);
    expect(result.changed).toHaveLength(145);
    expect(result.skipped).toEqual([{ sceneId, memberId: protectedId }]);
    transport.flush(true);
    expectConverged(docs);
    docs.forEach(doc => {
      expect(position(doc, protectedId, sceneId)).toEqual({ x: 700, y: 800 });
      project.members.slice(1).forEach(member => {
        expect(position(doc, member.id, sceneId)).toEqual(project.frames[0].positions[member.id]);
      });
    });
    expect(commands[0].redo()).toMatchObject({ status: "applied", changed: result.changed, skipped: [] });
    transport.flush();
    expectConverged(docs);
    expect(position(docs[1], protectedId, sceneId)).toEqual({ x: 700, y: 800 });
    expect(position(docs[1], project.members[1].id, sceneId)).toEqual({ x: 500, y: 600 });
  });
  it("reports Yjs's skipped newer operation and successful older operation together", () => {
    const { docs, commands, transport } = peers();
    commands[0].moveMembers([move("m_002", 10)]);
    commands[0].moveMembers([move("m_001", 20)]);
    transport.flush();
    commands[1].moveMembers([move("m_001", 30)]);
    transport.flush();
    expect(commands[0].undo()).toMatchObject({ status: "partial", consumedOperations: 2,
      changed: [{ sceneId: "f_001", memberId: "m_002" }],
      skipped: [{ sceneId: "f_001", memberId: "m_001" }] });
    expect(position(docs[0])).toEqual({ x: 30, y: 30 });
    expect(position(docs[0], "m_002")).toBeUndefined();
    transport.flush();
    expectConverged(docs);
  });
  it("keeps fast sequential commits separate and supports repeated Undo/Redo of newly added coordinates", () => {
    const { docs, commands, transport } = peers();
    commands[0].moveMembers([move("m_002", 10)]);
    commands[0].moveMembers([move("m_002", 20)]);
    expect(commands[0].undo().status).toBe("applied");
    expect(position(docs[0], "m_002")).toEqual({ x: 10, y: 10 });
    expect(commands[0].undo().status).toBe("applied");
    expect(position(docs[0], "m_002")).toBeUndefined();
    expect(commands[0].redo().status).toBe("applied");
    expect(commands[0].redo().status).toBe("applied");
    expect(position(docs[0], "m_002")).toEqual({ x: 20, y: 20 });
    transport.flush(true);
    expectConverged(docs);
  });
  it("protects B's later move between A's Undo and Redo", () => {
    const { docs, commands, transport } = peers();
    commands[0].moveMembers([move("m_001", 10)]);
    transport.flush();
    commands[0].undo();
    transport.flush();
    commands[1].moveMembers([move("m_001", 30)]);
    transport.flush();
    expect(commands[0].redo().status).toBe("blocked");
    expect(position(docs[0])).toEqual({ x: 30, y: 30 });
  });
  it("one multi-member command emits one update and one local-origin transaction; inputs are detached", () => {
    const { docs, commands } = peers();
    const origins: unknown[] = [];
    docs[0].on("update", (_, origin) => origins.push(origin));
    const input = [move("m_001", 10), move("m_002", 20)];
    expect(commands[0].moveMembers(input)).toBe(2);
    input[0].position.x = 999;
    expect(origins).toEqual([commands[0].localOrigin]);
    expect(position(docs[0])).toEqual({ x: 10, y: 10 });
    const undone = commands[0].undo();
    expect(undone.changed).toHaveLength(2);
    undone.changed[0].memberId = "caller-owned-result";
    expect(commands[0].redo()).toMatchObject({ status: "applied", attempted: [
      { sceneId: "f_001", memberId: "m_001" }, { sceneId: "f_001", memberId: "m_002" },
    ] });
  });
  it("rejects the entire invalid batch before mutation; no-ops preserve Redo", () => {
    const { docs, commands } = peers();
    const initial = Y.encodeStateAsUpdate(docs[0]);
    for (const invalid of [move("missing", 3), move("m_002", Infinity), move("m_002", 2, 2, "missing")]) {
      expect(() => commands[0].moveMembers([move("m_001", 10), invalid])).toThrow();
      expect(Y.encodeStateAsUpdate(docs[0])).toEqual(initial);
    }
    expect(() => commands[0].moveMembers([move("m_001", 10), move("m_001", 20)])).toThrow(/Duplicate/);
    commands[0].moveMembers([move("m_001", 10)]);
    commands[0].undo();
    expect(commands[0].moveMembers([])).toBe(0);
    expect(commands[0].moveMembers([move("m_001", 1, 2)])).toBe(0);
    expect(commands[0].canRedo).toBe(true);
  });
  it("does not capture remote or unmarked local writes", () => {
    const { docs, commands } = peers();
    const source = keep(joinSharedDocument(Y.encodeStateAsUpdate(docs[0])));
    keep(new CollaborationCommands(source)).moveMembers([move("m_001", 9)]);
    Y.applyUpdate(docs[0], Y.encodeStateAsUpdate(source), REMOTE_ORIGIN);
    getModel(docs[0]).scenes.get("f_001")!.get("positions")!.set("m_002", { x: 4, y: 5 });
    expect(commands[0].canUndo).toBe(false);
  });
});

it("measures anonymous 146-member × 18-scene initialization, one move, projection and encoded Y.Doc size (not heap memory)", () => {
  const project = normalize(fixtures.large);
  expect(project.members).toHaveLength(146);
  expect(project.frames).toHaveLength(18);
  const start = performance.now();
  const doc = keep(createSharedDocument(project));
  const initialized = performance.now();
  const initialBytes = Y.encodeStateAsUpdate(doc).byteLength;
  const commands = keep(new CollaborationCommands(doc));
  let updateBytes = 0;
  doc.on("update", update => { updateBytes += update.byteLength; });
  const moveStart = performance.now();
  commands.moveMembers([move(project.members[0].id, 25, 30, project.frames[0].id)]);
  const moved = performance.now();
  const projected = projectSharedDocument(doc, project);
  const finished = performance.now();
  expect(projected.frames[0].positions[project.members[0].id]).toEqual({ x: 25, y: 30 });
  console.info("COLLAB_BENCHMARK", JSON.stringify({
    fixture: "projects.json/large", members: 146, scenes: 18,
    initializeMs: +(initialized - start).toFixed(3), moveMs: +(moved - moveStart).toFixed(3),
    projectionMs: +(finished - moved).toFixed(3), initialBytes,
    afterMoveBytes: Y.encodeStateAsUpdate(doc).byteLength, moveUpdateBytes: updateBytes,
  }));
});
