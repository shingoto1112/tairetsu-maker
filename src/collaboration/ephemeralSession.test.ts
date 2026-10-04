// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EphemeralSession, decodeEphemeral, encodeEphemeral, payloadBytes, type EphemeralMessage, type EphemeralTarget } from './ephemeralSession';
import { MockEphemeralHub } from './ephemeralTransport';
import projects from '../repositories/contract/fixtures/commitProjects.json';
import type { Project } from '../types';
import { MemoryProjectRepository } from '../repositories/contract/testing/MemoryProjectRepository';
import { createSharedDocument } from './model';
import { createCollaborationData } from './persistence';
import { SharedSessionController } from './sharedSessionController';
import { RepositoryError } from '../repositories/types';
const roster = Array.from({ length: 5 }, (_, i) => ({ actorId: `actor${i}`, displayName: `参加者${i + 1}`, color: '#7c3aed' }));
const sessions: EphemeralSession[] = [];
afterEach(() => { sessions.splice(0).forEach(s => s.stop()); });
function fixture(mode: 'stage' | 'parade' = 'stage'): Project {
  const p = structuredClone(projects[mode]) as Project;
  p.frames[0].memberVisibility = {}; p.frames[0].objectAssignments = {};
  p.frames[0].objectStates.o_001 = { objectId: 'o_001', x: 2, y: 2, widthMeters: 1, heightMeters: 1, rotation: 15, visible: true, zIndex: 10 };
  p.frames.push({ ...structuredClone(p.frames[0]), id: 'f_002' }); return p;
}
async function setup(count = 2) {
  let now = 10000; const p = fixture(), hub = new MockEphemeralHub();
  const peers = Array.from({ length: count }, (_, i) => new EphemeralSession(hub.connect(roster[i].actorId, roster), { project: () => p, now: () => now, autoTick: false }));
  sessions.push(...peers); peers.forEach(s => { s.start(); s.view('f_001', []); }); await Promise.resolve(); await Promise.resolve();
  return { p, hub, peers, advance: (ms: number) => { now += ms; }, now: () => now };
}
const start = (seq = 1, dragId = 'drag'): EphemeralMessage => ({ v: 1, sessionId: 'peer-session', seq, type: 'start', dragId, sceneId: 'f_001', mode: 'stage', bounds: [12, 6], targets: [['member', 'm_001', 1, 2]], dx: 0, dy: 0 });
describe('10-local ephemeral isolation and protocol', () => {
  it('validates bounded UTF8 payloads, actor injection, tuples, version, finite coordinates and compact 146 UUID targets', () => {
    const targets = Array.from({ length: 146 }, (_, i) => ['member', crypto.randomUUID(), i / 15, i / 30] as EphemeralTarget);
    const message = { ...start(), targets } as EphemeralMessage;
    expect(payloadBytes(encodeEphemeral(message))).toBeLessThan(16384);
    for (const patch of [{ actorId: 'forged' }, { v: 2 }, { seq: -1 }, { dx: null }, { targets: [['object', 'x', 0, 0]] }, { targets: targets.concat(targets[0]) }]) expect(decodeEphemeral(JSON.stringify({ ...message, ...patch }))).toBeNull();
    expect(decodeEphemeral(' '.repeat(17000))).toBeNull();
    expect(() => encodeEphemeral({ ...message, targets: Array.from({ length: 256 }, () => ['member', 'あ'.repeat(90), 0, 0]) } as EphemeralMessage)).toThrow();
  });
  it('ignores reversed/duplicated moves and all post-stop moves; restores missing start by self-contained renewal', async () => {
    const { peers, advance } = await setup(); const b = peers[1];
    const receive = (message: EphemeralMessage) => b.receive({ actorId: 'actor0', payload: encodeEphemeral(message) });
    receive({ v: 1, sessionId: 'peer-session', seq: 1, type: 'move', dragId: 'drag', dx: 8, dy: 0 }); expect(b.drags.size).toBe(0);
    receive(start(2)); receive({ v: 1, sessionId: 'peer-session', seq: 4, type: 'move', dragId: 'drag', dx: 3, dy: -1 });
    receive({ v: 1, sessionId: 'peer-session', seq: 3, type: 'move', dragId: 'drag', dx: 9, dy: 0 });
    expect([...b.drags.values()][0].start.dx).toBe(3);
    receive({ v: 1, sessionId: 'peer-session', seq: 5, type: 'stop', dragId: 'drag' }); receive(start(6)); expect(b.drags.size).toBe(0);
    receive({ ...start(7, 'new-drag'), dx: 2 } as EphemeralMessage); expect(b.drags.size).toBe(1);
    advance(3001); await b.tick(); expect(b.drags.size).toBe(0);
  });
  it('uses one <=3Hz gate for start/move/end/presence and supports late join with 146 targets across 5 participants', async () => {
    const { p, hub, peers, advance } = await setup(5);
    const targets = Array.from({ length: 146 }, (_, i) => ['member', crypto.randomUUID(), i / 15, i / 30] as EphemeralTarget);
    p.members = targets.map(t => ({ id: t[1], name: '匿名', color: '#2563eb' })); p.frames[0].positions = Object.fromEntries(targets.map(t => [t[1], { x: t[2], y: t[3] }]));
    peers[0].begin('f_001', targets);
    for (let i = 0; i < 200; i++) { peers[0].latest(i / 10, 0); await peers[0].tick(); advance(10); }
    expect(hub.sent.length).toBeLessThanOrEqual(6); expect(peers[4].drags.size).toBe(1);
    expect(peers[0].metrics.maxMoveBytes).toBeLessThanOrEqual(512);
    peers[4].drags.clear(); advance(1100); await peers[0].tick(); expect(peers[4].drags.size).toBe(1);
    peers[1].begin('f_001', targets); await peers[1].tick(); expect(peers[2].drags.size).toBe(2);
  });
  it('applies Stage/Parade per-target bounds, deletion, scene change and expiry without changing the source project', async () => {
    const { p, peers, advance } = await setup(); const b = peers[1]; const original = JSON.stringify(p);
    b.receive({ actorId: 'actor0', payload: encodeEphemeral(start()) });
    expect(b.position('f_001', ['member', 'm_001', 1, 2], 100, -100)).toEqual({ x: 12, y: 0 });
    expect(b.position('f_001', ['object', 'o_001', 2, 2, 1, 1, 15], 100, 100)).toEqual({ x: 11, y: 5 });
    expect(JSON.stringify(p)).toBe(original);
    b.view('f_002', []); expect(b.drags.size).toBe(0); expect(b.getSnapshot().participants).toHaveLength(0);
    p.mode = 'parade'; p.paradeSettings = { ...fixture('parade').paradeSettings!, width: 20, totalDistance: 100, backwardDistanceMeters: 5 };
    expect(b.position('f_001', ['object', 'o_001', 0, 0, 1, 1, 15], 100, 1000)).toEqual({ x: 19, y: 104 });
    p.members = []; b.receive({ actorId: 'actor0', payload: encodeEphemeral(start(2, 'deleted')) }); await b.tick(); expect(b.drags.size).toBe(0);
    advance(45001); await b.tick(); expect(b.getSnapshot().participants).toHaveLength(0);
  });
  it('retains only the matching preview until matching durable commit (either arrival order), save failure waits for TTL', async () => {
    const { peers, advance } = await setup(); const b = peers[1];
    const receive = (message: EphemeralMessage) => b.receive({ actorId: 'actor0', payload: encodeEphemeral(message) });
    receive(start()); receive({ v: 1, sessionId: 'peer-session', seq: 2, type: 'stop', dragId: 'drag', updateId: 'save1' });
    expect(b.drags.size).toBe(1); b.confirm(['unrelated']); expect(b.drags.size).toBe(1); b.confirm(['save1']); expect(b.drags.size).toBe(0);
    b.confirm(['save2']); receive(start(3, 'other')); receive({ v: 1, sessionId: 'peer-session', seq: 4, type: 'stop', dragId: 'other', updateId: 'save2' }); expect(b.drags.size).toBe(0);
    receive(start(5, 'failed')); receive({ v: 1, sessionId: 'peer-session', seq: 6, type: 'stop', dragId: 'failed', updateId: 'failed-save' }); expect(b.drags.size).toBe(1);
    advance(3001); await b.tick(); expect(b.drags.size).toBe(0);
  });
  it('degrades 3->2->1->B, independently drops render frequency, and recovers at 1Hz after stable 45s; monthly budget stays held', async () => {
    const { peers, advance, now, hub } = await setup(); const b = peers[1];
    for (let i = 1; i <= 20; i++) b.receive({ actorId: 'actor0', payload: encodeEphemeral(start(i, `drag${i}`)), latencyMs: 600 });
    advance(2100); await b.tick(); expect(b.getSnapshot().hz).toBe(2);
    advance(2100); await b.tick(); expect(b.getSnapshot().hz).toBe(1);
    advance(2100); await b.tick(); expect(b.getSnapshot().mode).toBe('B');
    b.renderSample(12); expect(b.renderIntervalMs).toBe(100);
    advance(31000); await b.tick(); advance(15000); await b.tick(); expect(b.getSnapshot().hz).toBe(1); expect(b.getSnapshot().mode).toBe('A');
    hub.permit = { allowed: false, maxHz: 0, reason: 'monthly', expiresAt: now() + 1000000 }; advance(16000); await b.tick(); await Promise.resolve(); await Promise.resolve(); expect(b.getSnapshot().mode).toBe('B');
    hub.permit = { allowed: true, maxHz: 3, expiresAt: now() + 1000000 }; advance(16000); await b.tick(); await Promise.resolve(); await Promise.resolve(); await b.tick(); expect(b.getSnapshot().mode).toBe('B');
  });
  it('budget failure/expiry sends nothing; transport revocation, stop and V2 OFF release all resources', async () => {
    const { peers, hub, advance } = await setup(); const a = peers[0];
    hub.permit = { allowed: true, maxHz: 3, expiresAt: 10001 }; advance(16000); await a.tick(); await Promise.resolve();
    const sent = hub.sent.length; await a.tick(); expect(a.getSnapshot().mode).toBe('B'); expect(hub.sent).toHaveLength(sent);
    a.stop(); a.begin('f_001', [['member', 'm_001', 1, 2]]); await a.tick(); expect(hub.sent).toHaveLength(sent);
    const p = fixture(), repo = new MemoryProjectRepository(), doc = createSharedDocument(p);
    await repo.commit({ project: p, collaboration: { ...createCollaborationData(doc), sharedDocumentId: 'shared' }, localRevision: '1', expectedRepositoryRevision: null, operationId: 'seed' }); doc.destroy();
    const transport = hub.connect('off', roster), spy = vi.spyOn(transport, 'subscribe');
    const owner = await SharedSessionController.create(repo, (await repo.get(p.id!))!, { enabled: false, config: null, platform: 'web', ephemeralTransport: transport, current: () => true, publish: vi.fn(), failed: vi.fn(), saved: vi.fn(), committed: vi.fn() });
    owner.start(); expect(owner.ephemeral).toBeNull(); expect(spy).not.toHaveBeenCalled(); owner.dispose();
  });
  it('stops A on unavailable budget and sustained failures, isolates rendering cost, detects >10% local overhead', async () => {
    const { peers, advance, hub } = await setup(); const a = peers[0];
    for (let i = 0; i < 20; i++) a.localSample(1.2, 1);
    advance(2100); await a.tick(); expect(a.getSnapshot().hz).toBe(2);
    a.renderSample(20); expect(a.getSnapshot().hz).toBe(2); expect(a.renderIntervalMs).toBe(100);
    const send = vi.spyOn(a.transport, 'send').mockRejectedValue(Error('offline'));
    a.begin('f_001', [['member', 'm_001', 1, 2]]);
    for (let i = 0; i < 4; i++) { advance(2100); await a.tick(); }
    expect(a.getSnapshot().mode).toBe('B'); send.mockRestore();
    const budget = vi.spyOn(a.transport, 'budget').mockRejectedValue(Error('budget unavailable'));
    advance(16000); await a.tick(); await Promise.resolve(); await Promise.resolve();
    const count = hub.sent.length; advance(2000); await a.tick(); expect(hub.sent).toHaveLength(count); expect(a.getSnapshot().mode).toBe('B');
    budget.mockRestore();
  });
  it('preview-only receive leaves Project, Undo, Repository revision, outbox and cursor unchanged; failed save preserves editor', async () => {
    const p = fixture(), repo = new MemoryProjectRepository(), doc = createSharedDocument(p), hub = new MockEphemeralHub();
    await repo.commit({ project: p, collaboration: { ...createCollaborationData(doc), sharedDocumentId: 'shared' }, localRevision: '1', expectedRepositoryRevision: null, operationId: 'seed' }); doc.destroy();
    const publish = vi.fn(), owner = await SharedSessionController.create(repo, (await repo.get(p.id!))!, { enabled: true, config: null, platform: 'web', ephemeralTransport: hub.connect('actor1', roster), current: () => true, publish, failed: vi.fn(), saved: vi.fn(), committed: vi.fn() });
    try {
      owner.start(); owner.ephemeral!.view('f_001', []); await Promise.resolve(); await Promise.resolve();
      const before = await repo.get(p.id!), project = owner.editor.project;
      owner.ephemeral!.receive({ actorId: 'actor0', payload: encodeEphemeral(start()) });
      expect(owner.editor.project).toEqual(project); expect(await repo.get(p.id!)).toEqual(before); expect(publish).not.toHaveBeenCalled();
      expect((owner.editor.commands as unknown as { undoManager: { undoStack: unknown[] } }).undoManager.undoStack).toHaveLength(0);
      owner.editor.begin(); owner.editor.edit(previous => ({ ...previous, title: '未保存' })); owner.editor.end();
      const commit = vi.spyOn(repo, 'commit').mockRejectedValue(new RepositoryError('NO_SPACE'));
      expect(await owner.flush()).toBe(false); expect(owner.editor.project.title).toBe('未保存'); expect(owner.ephemeral!.drags.size).toBe(1); commit.mockRestore(); expect(await owner.flush()).toBe(true);
      expect(await owner.close()).toBe(true); expect(owner.ephemeral!.getSnapshot().participants).toHaveLength(0);
    } finally { owner.dispose(); }
  });
});
