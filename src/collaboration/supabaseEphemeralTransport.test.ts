// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseEphemeralTransport, parseEphemeralState, ephemeralTopic, type EphemeralRealtimePort } from './supabaseEphemeralTransport';
import { EPHEMERAL_BUDGET } from '../config/collaborationLimits';
import { EphemeralSession, encodeEphemeral, payloadBytes, type EphemeralMessage } from './ephemeralSession';
import { TransportError } from './transport';
import fixtures from '../repositories/contract/fixtures/commitProjects.json';
import type { Project } from '../types';
const uid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const state = (epoch = 1) => ({ documentId: uid(10), generation: '1', aclGeneration: String(epoch), topic: `collab-v2:${uid(100 + epoch)}`,
  membershipGeneration: uid(11), members: [1, 2].map(n => ({ userId: uid(n), membershipGeneration: uid(10 + n), displayName: `参加者${n}`, color: '#2563eb' })) });
const message = (seq = 1): EphemeralMessage => ({ v: 1, sessionId: 'device', seq, type: 'start', dragId: 'drag', sceneId: 'f_001',
  mode: 'stage', bounds: [12, 6], targets: [['member', 'm_001', 1, 2]], dx: 0, dy: 0 });
class Port implements EphemeralRealtimePort {
  auth = vi.fn(async (_token: string) => {}); disconnect = vi.fn();
  channels: { topic: string; event: string; receive(payload: unknown): void; status(value: boolean): void; closed: boolean; ready: boolean }[] = [];
  sent: { topic: string; payload: unknown }[] = [];
  closeGate?: Promise<void>;
  setAuth = this.auth;
  channel: EphemeralRealtimePort['channel'] = (topic, event, receive, status) => {
    const c = { topic, event, receive, status, closed: false, ready: true }; this.channels.push(c);
    queueMicrotask(() => { if (!c.closed) status(true); });
    return { ready: () => c.ready && !c.closed, close: () => { c.closed = true; return this.closeGate; },
      send: async payload => { this.sent.push({ topic, payload }); return 'ok'; } };
  };
  control() { return this.channels.filter(c => !c.closed && c.event === 'acl_changed').slice(-1)[0]!; }
  peer() { return this.channels.filter(c => !c.closed && c.topic.endsWith(uid(2))).slice(-1)[0]!; }
}
const transports: SupabaseEphemeralTransport[] = [];
afterEach(() => { transports.splice(0).forEach(t => t.stop()); vi.useRealTimers(); });
const settle = async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); };
async function setup(enabled = true, lifecycle = false, observe = true, budget = EPHEMERAL_BUDGET) {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  const port = new Port(); let current = state(), token = 'token1', valid = true;
  const load = vi.fn(async () => parseEphemeralState(current));
  const t = new SupabaseEphemeralTransport(port, { enabled, lifecycle, budget, documentId: uid(10), generation: '1', membershipGeneration: uid(11), actorId: uid(1),
    credential: async () => ({ accountId: uid(1), accessToken: token }), valid: () => valid, state: load });
  transports.push(t); const receive = vi.fn(), status = vi.fn(), revoked = vi.fn(); if (observe) t.subscribe(receive, status, revoked); await settle();
  const wire = (m: EphemeralMessage = message()) => ({ generation: current.generation, aclGeneration: current.aclGeneration,
    membershipGeneration: uid(12), payload: encodeEphemeral(m) });
  return { t, port, load, receive, status, revoked, wire, rotate: () => { current = state(2); },
    update: (value: ReturnType<typeof state>) => { current = value; }, token: () => { token = 'token2'; }, invalid: () => { valid = false; } };
}
describe('10-transport direct private Broadcast contract', () => {
  it('joins private owner channels via SDK seam and fences all packet types with <=3Hz and estimated fanout budget', async () => {
    const s = await setup(); expect(s.port.channels).toHaveLength(3); expect(s.status).toHaveBeenLastCalledWith(true);
    expect(await s.t.budget()).toMatchObject({ allowed: true, maxHz: .75 });
    await s.t.send(encodeEphemeral(message())); expect(s.port.sent[0].topic).toBe(ephemeralTopic(state().topic, uid(1)));
    await expect(s.t.send(encodeEphemeral(message(2)))).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1400); await s.t.send(encodeEphemeral(message(2))); expect(s.port.sent).toHaveLength(2);
  });
  it('synchronously fences and clears previews on ACL notice, rebinds remaining members, drops old callbacks and unsent drag', async () => {
    const own = await setup(true, false, false), fresh = own.t;
    const display = new EphemeralSession(fresh, { project: () => fixtures.stage as Project, autoTick: false }); display.start(); await settle();
    await vi.advanceTimersByTimeAsync(45000); await display.tick(); await settle(); await display.tick();
    own.port.peer().receive(own.wire()); expect(display.drags.size).toBe(1); expect(display.getSnapshot().participants).toHaveLength(1);
    display.view('f_001', []); display.begin('f_001', [['member', 'm_001', 1, 2]]);
    const old = own.port.peer(); own.rotate(); own.port.control().receive({});
    expect(display.drags.size).toBe(0); expect(display.getSnapshot().participants).toHaveLength(0);
    await expect(fresh.send(encodeEphemeral(message()))).rejects.toThrow(); await settle();
    expect(own.port.peer().topic).toBe(ephemeralTopic(state(2).topic, uid(2)));
    old.receive(own.wire(message(2))); expect(display.drags.size).toBe(0);
    await vi.advanceTimersByTimeAsync(45000); await display.tick(); await settle(); await display.tick();
    expect(own.port.sent.every(p => JSON.parse((p.payload as { payload: string }).payload).type === 'presence')).toBe(true); display.stop();
  });
  it.each(['removed', 'ended', 'membership', 'document'])('stops removed/ended/changed participant (%s) and releases all channels', async kind => {
    const s = await setup();
    if (kind === 'removed' || kind === 'ended') s.load.mockRejectedValue(new TransportError('permission', kind === 'ended' ? 'DOCUMENT_DELETED' : 'NOT_MEMBER'));
    else { const value = state(2); if (kind === 'membership') value.membershipGeneration = uid(90); else value.generation = '2'; s.update(value); }
    s.port.control().receive({}); await settle();
    expect(s.revoked).toHaveBeenCalledOnce(); expect(s.port.channels.every(c => c.closed)).toBe(true);
    await expect(s.t.send(encodeEphemeral(message()))).rejects.toThrow(); expect(s.t.members()).toHaveLength(0);
  });
  it('derives actor/name/color from topic and roster; rejects actor injections, extra envelope fields, malformed and stale generation packets', async () => {
    const s = await setup(); const peer = s.port.peer(); peer.receive(s.wire());
    expect(s.receive).toHaveBeenCalledWith({ actorId: uid(2), payload: encodeEphemeral(message()) });
    for (const patch of [{ actorId: uid(1) }, { generation: '2' }, { aclGeneration: '0' }, { membershipGeneration: uid(99) },
      { payload: JSON.stringify({ ...message(), actorId: uid(1), displayName: '偽装' }) }, { payload: JSON.stringify({ ...message(), dx: null }) },
      { payload: ' '.repeat(17000) }, { payload: null }]) peer.receive({ ...s.wire(), ...patch });
    expect(s.receive).toHaveBeenCalledTimes(1); expect(s.t.members()[1].displayName).toBe('参加者2');
    const largeMove: EphemeralMessage = { v: 1, type: 'move', sessionId: 's'.repeat(96), dragId: 'あ'.repeat(96), seq: 1, dx: 100000, dy: 100000 };
    const largeWire = { ...s.wire(largeMove), generation: '1' };
    // Inner move fits 512B; the full envelope has the stricter same wire cap.
    expect(payloadBytes(JSON.stringify(largeWire))).toBeGreaterThan(512); peer.receive(largeWire); expect(s.receive).toHaveBeenCalledTimes(1);
    await expect(s.t.send(encodeEphemeral(largeMove))).rejects.toThrow();
    s.rotate(); s.port.control().receive({}); await settle(); peer.receive(s.wire()); expect(s.receive).toHaveBeenCalledTimes(1);
  });
  it('sends nothing offline or on an unjoined socket; refreshes token and reconnects without replay', async () => {
    const s = await setup(true, true); const before = s.port.channels;
    window.dispatchEvent(new Event('offline')); expect(s.status).toHaveBeenLastCalledWith(false);
    await expect(s.t.send(encodeEphemeral(message()))).rejects.toThrow(); expect(s.port.sent).toHaveLength(0);
    window.dispatchEvent(new Event('online')); await settle();
    const mine = s.port.channels.filter(c => !c.closed && c.topic.endsWith(uid(1))).slice(-1)[0]!; mine.ready = false;
    await expect(s.t.send(encodeEphemeral(message()))).rejects.toThrow(); mine.ready = true;
    s.token(); s.t.invalidate(); await settle(); expect(s.port.auth).toHaveBeenLastCalledWith('token2');
    expect(before.some(c => c.closed)).toBe(true); s.port.peer().status(false); await vi.advanceTimersByTimeAsync(1000);
    expect(s.status).toHaveBeenLastCalledWith(true); expect(s.port.sent).toHaveLength(0);
  });
  it('recovers missed ACL by 30s poll and foreground; ignores late metadata after auth invalidation', async () => {
    const s = await setup(true, true); s.rotate(); await vi.advanceTimersByTimeAsync(30000);
    expect(s.port.peer().topic).toBe(ephemeralTopic(state(2).topic, uid(2)));
    const loads = s.load.mock.calls.length; document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(s.load.mock.calls.length).toBeGreaterThan(loads);
    s.invalid(); s.t.invalidate(); await settle(); expect(s.revoked).toHaveBeenCalledOnce(); expect(await s.t.budget()).toMatchObject({ allowed: false });
  });
  it('waits for delayed SDK teardown before recreating a same-topic channel on token refresh', async () => {
    const s = await setup(); let release!: () => void;
    s.port.closeGate = new Promise<void>(resolve => { release = resolve; });
    s.token(); s.t.invalidate(); await settle();
    expect(s.port.channels).toHaveLength(3); expect(s.status).toHaveBeenLastCalledWith(false);
    await expect(s.t.send(encodeEphemeral(message()))).rejects.toThrow();
    release(); await settle(); expect(s.port.channels).toHaveLength(6); expect(s.port.auth).toHaveBeenLastCalledWith('token2');
    expect(s.status).toHaveBeenLastCalledWith(true);
  });
  it('rejects late metadata from an old epoch and processes the queued ACL refresh', async () => {
    const s = await setup(); let release!: (value: ReturnType<typeof parseEphemeralState>) => void;
    s.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    s.t.refresh(); await settle(); s.rotate(); s.port.control().receive({});
    release(parseEphemeralState(state())); await settle();
    expect(s.port.peer().topic).toBe(ephemeralTopic(state(2).topic, uid(2)));
    expect(s.port.channels.filter(c => !c.closed)).toHaveLength(3);
  });
  it('accounts for multiple sessions, bounds unknown session growth, and supports operator B/off switch', async () => {
    const s = await setup();
    for (let n = 0; n < 16; n++) s.port.peer().receive(s.wire({ ...message(n + 1), sessionId: `tab${n}` }));
    expect((await s.t.budget()).maxHz).toBeCloseTo(48 / (17 * 17));
    for (let n = 16; n < 40; n++) s.port.peer().receive(s.wire({ ...message(n + 1), sessionId: `tab${n}` }));
    expect((await s.t.budget()).allowed).toBe(false); expect(s.receive.mock.calls.length).toBe(EPHEMERAL_BUDGET.maxConnections);
    const b = await setup(true, false, false, { ...EPHEMERAL_BUDGET, maxHz: .25 });
    const session = new EphemeralSession(b.t, { project: () => fixtures.stage as Project, autoTick: false }); session.start(); await settle();
    await vi.advanceTimersByTimeAsync(45000); await session.tick(); await settle(); await session.tick();
    expect(session.getSnapshot().mode).toBe('B'); session.stop();
    const off = await setup(true, false, true, { ...EPHEMERAL_BUDGET, enabled: false });
    expect((await off.t.budget()).allowed).toBe(false); await expect(off.t.send(encodeEphemeral(message()))).rejects.toThrow();
  });
  it('V2 OFF does not load credentials/state, authenticate, connect or send', async () => {
    const s = await setup(false); expect(s.load).not.toHaveBeenCalled(); expect(s.port.auth).not.toHaveBeenCalled(); expect(s.port.channels).toHaveLength(0);
    await expect(s.t.send(encodeEphemeral(message()))).rejects.toThrow();
  });
  it('clears removed participant displays and never resurrects them after a late callback', async () => {
    const s = await setup(true, false, false), session = new EphemeralSession(s.t, { project: () => fixtures.stage as Project, autoTick: false });
    session.start(); await settle(); await vi.advanceTimersByTimeAsync(45000); await session.tick(); await settle(); await session.tick();
    const peer = s.port.peer(); peer.receive(s.wire()); expect(session.drags.size).toBe(1);
    s.load.mockRejectedValue(new TransportError('permission', 'NOT_MEMBER')); s.port.control().receive({});
    expect(session.drags.size).toBe(0); await settle(); expect(session.getSnapshot()).toMatchObject({ participants: [], mode: 'B', reason: '停止' });
    peer.receive(s.wire(message(2))); expect(session.drags.size).toBe(0); session.stop();
  });
  it('validates RPC roster size, unique users, names, topic and positive bounded generations', () => {
    for (const patch of [{ aclGeneration: '0' }, { generation: '9223372036854775808' }, { topic: 'collab-v2:garbage' }, { members: [] },
      { members: [...state().members, state().members[0]] }, { members: [{ ...state().members[0], color: 'url(x)' }] }]) expect(() => parseEphemeralState({ ...state(), ...patch })).toThrow();
  });
});
