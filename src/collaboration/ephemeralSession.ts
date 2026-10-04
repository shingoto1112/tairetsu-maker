import type { Position, Project } from '../types';
import type { EphemeralBudget, EphemeralEnvelope, EphemeralMember, EphemeralTransport } from './ephemeralTransport';
import { constrainMemberPosition, constrainObjectPosition } from '../utils/coordinates';
import { getSafeParadeCanvasDistance } from '../utils/parade';

export const EPHEMERAL_LIMITS = { startBytes: 16384, moveBytes: 512, previewMs: 3000, heartbeatMs: 15000, participantMs: 45000 } as const;
// Compact tuples keep 146 UUID targets below 16KiB. Coordinates remain internal metres.
export type EphemeralTarget = [kind: 'member' | 'object', id: string, x: number, y: number, width?: number, height?: number, rotation?: number];
type Base = { v: 1; sessionId: string; seq: number };
export type EphemeralMessage = Base & (
  | { type: 'presence'; sceneId: string; selected: [kind: 'member' | 'object', id: string][] }
  | { type: 'start'; dragId: string; sceneId: string; mode: 'stage' | 'parade'; bounds: [number, number]; targets: EphemeralTarget[]; dx: number; dy: number }
  | { type: 'move'; dragId: string; dx: number; dy: number }
  | { type: 'stop' | 'cancel'; dragId: string; updateId?: string });
export const payloadBytes = (payload: string) => new TextEncoder().encode(payload).length;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 96 && !/[\u0000-\u001f]/.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000;
const targetKind = (value: unknown) => value === 'member' || value === 'object';
export function decodeEphemeral(payload: string): EphemeralMessage | null {
  if (payloadBytes(payload) > EPHEMERAL_LIMITS.startBytes) return null;
  try {
    const m = JSON.parse(payload);
    if (!m || m.v !== 1 || !id(m.sessionId) || !Number.isSafeInteger(m.seq) || m.seq < 1) return null;
    const baseKeys = ['v', 'sessionId', 'seq', 'type'];
    let keys: string[];
    switch (m.type) {
      case 'presence':
        keys = ['sceneId', 'selected'];
        if (!id(m.sceneId) || !Array.isArray(m.selected) || m.selected.length > 256 || !m.selected.every((t: unknown[]) => Array.isArray(t) && t.length === 2 && targetKind(t[0]) && id(t[1]))) return null;
        break;
      case 'start':
        keys = ['dragId', 'sceneId', 'mode', 'bounds', 'targets', 'dx', 'dy'];
        if (!id(m.dragId) || !id(m.sceneId) || !['stage', 'parade'].includes(m.mode) ||
          !Array.isArray(m.bounds) || m.bounds.length !== 2 || !m.bounds.every((n: unknown) => finite(n) && n > 0) ||
          !finite(m.dx) || !finite(m.dy) || !Array.isArray(m.targets) || !m.targets.length || m.targets.length > 256 ||
          !m.targets.every((t: unknown[]) => Array.isArray(t) && targetKind(t[0]) && id(t[1]) &&
            (t[0] === 'member' ? t.length === 4 : t.length === 7 && finite(t[4]) && t[4] > 0 && finite(t[5]) && t[5] > 0 && finite(t[6])) && finite(t[2]) && finite(t[3])) ||
          new Set(m.targets.map((t: unknown[]) => `${t[0]}:${t[1]}`)).size !== m.targets.length) return null;
        break;
      case 'move':
        keys = ['dragId', 'dx', 'dy'];
        if (!id(m.dragId) || !finite(m.dx) || !finite(m.dy) || payloadBytes(payload) > EPHEMERAL_LIMITS.moveBytes) return null;
        break;
      case 'stop': case 'cancel':
        keys = ['dragId', 'updateId'];
        if (!id(m.dragId) || (m.updateId !== undefined && !id(m.updateId))) return null;
        break;
      default: return null;
    }
    // Reject actor/name injection and unexpected content, rather than trusting payload fields.
    if (Object.keys(m).some(key => !baseKeys.includes(key) && !keys.includes(key))) return null;
    return m;
  } catch { return null; }
}
export function encodeEphemeral(message: EphemeralMessage): string {
  const payload = JSON.stringify(message);
  if (!decodeEphemeral(payload)) throw Error('Invalid ephemeral payload');
  return payload;
}
export type RemotePresence = EphemeralMember & { sessionId: string; sceneId: string; selected: [kind: 'member' | 'object', id: string][]; expiresAt: number };
export type RemoteDrag = { actorId: string; sessionId: string; start: Extract<EphemeralMessage, { type: 'start' }>; expiresAt: number; updateId?: string };
export type EphemeralSnapshot = { participants: readonly RemotePresence[]; mode: 'A' | 'B'; reason: string; hz: number };
type Options = { project: () => Project; updateId?: () => string | undefined; now?: () => number; autoTick?: boolean };
const percentile = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : 0;

/** No Repository, Y.Doc, Undo, outbox or cursor dependencies. Drag listeners are
 * separate from the React presence store, so moves cannot redraw App/thumbnails. */
export class EphemeralSession {
  readonly sessionId = crypto.randomUUID();
  readonly drags = new Map<string, RemoteDrag>();
  readonly metrics = { sent: 0, bytes: 0, maxStartBytes: 0, maxMoveBytes: 0, rejected: 0, localMs: [] as number[], latencyMs: [] as number[], rafMs: [] as number[], frames: 0 };
  private snapshot: EphemeralSnapshot = { participants: [], mode: 'B', reason: '予算を確認中', hz: 0 };
  private listeners = new Set<() => void>();
  private dragListeners = new Set<() => void>();
  private peers = new Map<string, RemotePresence>();
  private sequences = new Map<string, number>();
  private ended = new Map<string, number>();
  private durable = new Map<string, number>();
  private local?: Extract<EphemeralMessage, { type: 'start' }>;
  private pendingEnds: EphemeralMessage[] = [];
  private sceneId = ''; private selected: [kind: 'member' | 'object', id: string][] = [];
  private presenceDirty = true; private seq = 0; private nextSend = 0; private heartbeatAt = 0; private startAt = 0;
  private budgetValue?: EphemeralBudget; private budgetAt = 0; private requesting = false;
  private online = false; private closed = false; private started = false; private sending = false;
  private failures = 0; private degradedAt = 0; private healthyAt = 0; private lastBadAt = 0; private baseline = 0;
  private baseSamples: number[] = []; private latencyAt = 0; private localAt = 0; private monthlyUntil = 0;
  private beginUpdateId?: string;
  private sequenceExpiry = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>; private release?: () => void;
  renderIntervalMs = 0;
  constructor(readonly transport: EphemeralTransport, private options: Options) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeDrags = (listener: () => void) => { this.dragListeners.add(listener); return () => { this.dragListeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private changed() { this.dragListeners.forEach(f => f()); }
  private publish() {
    const participants = [...this.peers.values()];
    const content = (items: readonly RemotePresence[]) => JSON.stringify(items.map(p => ({ ...p, expiresAt: 0 })));
    if (content(participants) === content(this.snapshot.participants)) return;
    this.snapshot = { ...this.snapshot, participants }; this.listeners.forEach(f => f());
  }
  private mode(mode: 'A' | 'B', reason: string, hz: number) {
    if (this.snapshot.mode === mode && this.snapshot.reason === reason && this.snapshot.hz === hz) return;
    this.snapshot = { ...this.snapshot, mode, reason, hz }; this.listeners.forEach(f => f());
    if (mode === 'B') { this.local = undefined; this.drags.clear(); this.changed(); }
  }
  start() {
    if (this.started || this.closed) return; this.started = true;
    this.release = this.transport.subscribe(this.receive, online => {
      this.online = online;
      if (!online) { this.local = undefined; this.pendingEnds = []; this.budgetValue = undefined; this.budgetAt = 0;
        this.clearRemote(); this.mode('B', '再接続を待っています', 0); this.healthyAt = this.now(); this.degradedAt = this.now() || 1; }
      else { this.presenceDirty = true; void this.refreshBudget(); }
    }, () => this.stop());
    if (this.options.autoTick !== false) this.timer = setInterval(() => { void this.tick(); }, 50);
    void this.refreshBudget();
  }
  private async refreshBudget() {
    if (this.requesting || this.closed) return;
    this.requesting = true;
    try {
      const budget = await this.transport.budget(); if (this.closed) return;
      if (typeof budget.allowed !== 'boolean' || !Number.isFinite(budget.expiresAt) || !Number.isFinite(budget.maxHz) || budget.maxHz < 0) throw Error('Invalid budget');
      this.budgetValue = budget; this.budgetAt = this.now() + 15000;
      if (!budget.allowed && budget.reason === 'monthly') this.monthlyUntil = Math.max(this.monthlyUntil, this.now() + 300000);
      if (!budget.allowed || budget.maxHz <= 0 || budget.expiresAt <= this.now()) {
        this.mode('B', budget.reason === 'monthly' ? '月間予算による停止' : '送信予算なし', 0); this.degradedAt = this.now() || 1; this.healthyAt = this.now();
      }
      else if (!this.degradedAt && this.online && this.now() >= this.monthlyUntil) this.mode('A', '', Math.min(3, budget.maxHz));
    } catch { if (this.closed) return; this.budgetValue = undefined; this.budgetAt = this.now() + 15000; this.mode('B', '予算を取得できません', 0); this.degradedAt = this.now() || 1; this.healthyAt = this.now(); }
    finally { this.requesting = false; }
  }
  view(sceneId: string | null, selected: [kind: 'member' | 'object', id: string][]) {
    if (this.closed) return;
    if (this.sceneId !== sceneId) { this.cancel(); this.clearRemote(); }
    if (this.sceneId === sceneId && JSON.stringify(this.selected) === JSON.stringify(selected)) return;
    this.sceneId = sceneId ?? ''; this.selected = selected.slice(0, 256); this.presenceDirty = true;
  }
  begin(sceneId: string | null, targets: EphemeralTarget[]) {
    if (this.closed || !sceneId || this.snapshot.mode !== 'A') return;
    this.cancel();
    const project = this.options.project(), frame = project.frames.find(f => f.id === sceneId); if (!frame) return;
    const global = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true;
    const bounds: [number, number] = project.mode === 'parade' ? [project.paradeSettings?.width ?? 10, getSafeParadeCanvasDistance(project.paradeSettings?.totalDistance, project.paradeSettings?.backwardDistanceMeters)] :
      [global ? project.stage.widthMeters : frame.stageWidthMeters ?? project.stage.widthMeters, global ? project.stage.depthMeters : frame.stageDepthMeters ?? project.stage.depthMeters];
    const start: Extract<EphemeralMessage, { type: 'start' }> = { v: 1, sessionId: this.sessionId, seq: this.seq + 1, type: 'start', dragId: crypto.randomUUID(), sceneId, mode: project.mode ?? 'stage', bounds, targets, dx: 0, dy: 0 };
    try { encodeEphemeral(start); } catch { this.mode('B', '開始情報が上限を超えています', 0); this.degradedAt = this.now() || 1; this.healthyAt = this.now(); return; }
    this.local = start; this.startAt = 0;
    this.beginUpdateId = this.options.updateId?.();
  }
  latest(dx: number, dy: number) { if (this.local && finite(dx) && finite(dy)) { this.local.dx = dx; this.local.dy = dy; } }
  latestMeasured(dx: number, dy: number, startedAt: number) {
    const baseline = performance.now() - startedAt;
    this.latest(dx, dy); this.localSample(performance.now() - startedAt, baseline);
  }
  finish() { const updateId = this.options.updateId?.(); this.end('stop', updateId !== this.beginUpdateId ? updateId : undefined); }
  cancel() { this.end('cancel'); }
  private end(type: 'stop' | 'cancel', updateId?: string) {
    if (!this.local) return;
    this.pendingEnds.push({ v: 1, sessionId: this.sessionId, seq: 0, type, dragId: this.local.dragId, ...(updateId ? { updateId } : {}) });
    this.pendingEnds = this.pendingEnds.slice(-8); this.local = undefined;
  }
  confirm(updateIds: readonly string[]) {
    const now = this.now(); updateIds.forEach(id => this.durable.set(id, now + 45000));
    while (this.durable.size > 2048) this.durable.delete(this.durable.keys().next().value!);
    let changed = false;
    this.drags.forEach((drag, key) => { if (drag.updateId && this.durable.has(drag.updateId)) { this.drags.delete(key); changed = true; } });
    if (changed) this.changed();
  }
  private key(actorId: string, sessionId: string, dragId?: string) { return JSON.stringify([actorId, sessionId, dragId ?? '']); }
  receive = (event: EphemeralEnvelope) => {
    if (this.closed || !this.online || event.actorId === this.transport.actorId) return;
    const member = this.transport.members().find(m => m.actorId === event.actorId); if (!member) return;
    const m = decodeEphemeral(event.payload); if (!m) { this.metrics.rejected++; return; }
    const now = this.now(), peerKey = this.key(event.actorId, m.sessionId), key = this.key(event.actorId, m.sessionId, 'dragId' in m ? m.dragId : undefined);
    if (m.seq <= (this.sequences.get(peerKey) ?? 0)) return;
    // Bound untrusted session IDs; a legitimate session count is far below this.
    if (!this.sequences.has(peerKey) && this.sequences.size >= 128) return;
    this.sequences.set(peerKey, m.seq);
    this.sequenceExpiry.set(peerKey, now + 45000);
    if ((m.type === 'start' || m.type === 'move') && event.latencyMs !== undefined && event.latencyMs >= 0 && Number.isFinite(event.latencyMs)) { this.latencyAt = now; this.metrics.latencyMs.push(event.latencyMs); this.metrics.latencyMs = this.metrics.latencyMs.slice(-120); }
    if (m.type === 'presence' || m.type === 'start') {
      if (!this.options.project().frames.some(f => f.id === m.sceneId)) return;
      const previous = this.peers.get(peerKey);
      this.peers.set(peerKey, { ...member, sessionId: m.sessionId, sceneId: m.sceneId, selected: m.type === 'presence' ? m.selected : previous?.selected ?? [], expiresAt: now + 45000 });
      this.publish();
    }
    if (m.type === 'presence') return;
    if (m.type === 'stop' || m.type === 'cancel') {
      this.ended.set(key, now + 45000);
      while (this.ended.size > 2048) this.ended.delete(this.ended.keys().next().value!);
      const drag = this.drags.get(key);
      if (m.type === 'stop' && m.updateId && drag && !this.durable.has(m.updateId)) { drag.updateId = m.updateId; drag.expiresAt = now + 3000; }
      else this.drags.delete(key);
      this.changed(); return;
    }
    if (this.snapshot.mode !== 'A' || this.ended.has(key)) return;
    if (m.type === 'start') {
      if (this.drags.size >= 128 && !this.drags.has(key)) return;
      this.drags.set(key, { actorId: event.actorId, sessionId: m.sessionId, start: m, expiresAt: now + 3000 });
    } else if (m.type === 'move') {
      const drag = this.drags.get(key); if (!drag || drag.updateId) return;
      drag.start = { ...drag.start, dx: m.dx, dy: m.dy }; drag.expiresAt = now + 3000;
    }
    this.changed();
  };
  /** Receiver clamps each target using CURRENT local mode/dimensions, never wire bounds. */
  position(sceneId: string, target: EphemeralTarget, dx = 0, dy = 0, p = this.options.project()): Position | null {
    const frame = p.frames.find(f => f.id === sceneId); if (!frame) return null;
    const [kind, id, x, y] = target;
    if (kind === 'member' ? !p.members.some(m => m.id === id) || !frame.positions[id] || frame.memberVisibility?.[id] === false : !p.stageObjects.some(o => o.id === id) || !frame.objectStates[id]?.visible) return null;
    const global = p.useGlobalStageSize ?? p.useGlobalStageWidth ?? true;
    const stage = p.mode === 'parade' ? { ...p.stage, widthMeters: p.paradeSettings?.width ?? 10, depthMeters: getSafeParadeCanvasDistance(p.paradeSettings?.totalDistance, p.paradeSettings?.backwardDistanceMeters) } :
      { ...p.stage, widthMeters: global ? p.stage.widthMeters : frame.stageWidthMeters ?? p.stage.widthMeters, depthMeters: global ? p.stage.depthMeters : frame.stageDepthMeters ?? p.stage.depthMeters };
    const position = { x: x + dx, y: y + dy };
    return kind === 'member' ? constrainMemberPosition(position, stage) : constrainObjectPosition(position, frame.objectStates[id].widthMeters, frame.objectStates[id].heightMeters, stage);
  }
  localSample(ms: number, baselineMs?: number) {
    if (!finite(ms) || ms < 0) return;
    this.localAt = this.now();
    if (baselineMs !== undefined && Number.isFinite(baselineMs) && baselineMs >= 0) { this.baseSamples.push(baselineMs); this.baseSamples = this.baseSamples.slice(-120); this.baseline = percentile(this.baseSamples); }
    this.metrics.localMs.push(ms); this.metrics.localMs = this.metrics.localMs.slice(-120);
  }
  renderSample(ms: number) { this.metrics.rafMs.push(ms); this.metrics.rafMs = this.metrics.rafMs.slice(-120); this.metrics.frames++; this.renderIntervalMs = percentile(this.metrics.rafMs) > 8 ? 100 : 0; }
  get measurements() { return { localP95: percentile(this.metrics.localMs), latencyP95: percentile(this.metrics.latencyMs), rafP95: percentile(this.metrics.rafMs), baseline: this.baseline }; }
  private degrade() {
    const now = this.now(); if (now - this.lastBadAt < 2000) return;
    this.lastBadAt = now; this.degradedAt = now || 1; this.healthyAt = now;
    const hz = this.snapshot.hz;
    if (hz > 1) this.mode('A', '一時表示の送信を減速中', hz > 2 ? 2 : 1);
    else this.mode('B', '一時表示を休止中', 0);
  }
  async tick() {
    if (this.closed || !this.started) return;
    const now = this.now(); let changed = false;
    if (now - this.latencyAt > 30000) this.metrics.latencyMs = [];
    if (now - this.localAt > 30000) { this.metrics.localMs = []; this.baseSamples = []; this.baseline = 0; }
    this.sequenceExpiry.forEach((expiry, key) => { if (expiry <= now) { this.sequenceExpiry.delete(key); this.sequences.delete(key); } });
    this.peers.forEach((peer, key) => { if (peer.expiresAt <= now) { this.peers.delete(key); this.sequences.delete(key); } }); this.publish();
    this.drags.forEach((drag, key) => { if (drag.expiresAt <= now || !drag.start.targets.some(t => this.position(drag.start.sceneId, t))) { this.drags.delete(key); changed = true; } });
    [this.ended, this.durable].forEach(map => map.forEach((expires, key) => { if (expires <= now) map.delete(key); }));
    if (changed) this.changed();
    if (now >= this.budgetAt) void this.refreshBudget();
    const budget = this.budgetValue;
    if (!budget || !budget.allowed || budget.expiresAt <= now || budget.maxHz <= 0 || !this.online || now < this.monthlyUntil) { this.mode('B', now < this.monthlyUntil ? '月間予算による停止' : '送信許可を確認中', 0); return; }
    const { localP95, latencyP95 } = this.measurements;
    const bad = this.failures >= 2 || this.metrics.latencyMs.length >= 20 && latencyP95 > 500 || this.baseline > 0 && this.metrics.localMs.length >= 20 && localP95 > this.baseline * 1.1;
    if (budget.maxHz < .5) this.mode('B', '接続数に応じて確定時だけ反映', 0);
    else if (bad) this.degrade();
    else if (this.degradedAt && now - this.healthyAt >= 45000) {
      const hz = this.snapshot.mode === 'B' ? 1 : Math.min(3, this.snapshot.hz + 1);
      this.mode('A', hz < 3 ? '一時表示を段階的に再開中' : '', Math.min(hz, budget.maxHz)); this.healthyAt = now;
      if (hz === 3) this.degradedAt = 0;
    }
    if (bad) this.healthyAt = now;
    if (this.sending || now < this.nextSend || !this.sceneId) return;
    // B still sends small presence/heartbeat; no drag. All traffic shares one gate.
    const hz = this.snapshot.mode === 'A' ? Math.min(this.snapshot.hz, budget.maxHz) : Math.min(1, budget.maxHz);
    let message: EphemeralMessage | undefined = this.pendingEnds.shift();
    if (!message && this.local && this.snapshot.mode === 'A') {
      message = now >= this.startAt ? { ...this.local } : { v: 1, sessionId: this.sessionId, seq: 0, type: 'move', dragId: this.local.dragId, dx: this.local.dx, dy: this.local.dy };
      if (message.type === 'start') this.startAt = now + 1000;
    }
    if (!message && (this.presenceDirty || now >= this.heartbeatAt)) message = { v: 1, sessionId: this.sessionId, seq: 0, type: 'presence', sceneId: this.sceneId, selected: this.selected };
    if (!message) return;
    message.seq = ++this.seq;
    let payload: string;
    try { payload = encodeEphemeral(message); } catch { this.mode('B', '送信情報が上限を超えています', 0); return; }
    this.nextSend = now + 1000 / hz; this.sending = true;
    const bytes = payloadBytes(payload); this.metrics.sent++; this.metrics.bytes += bytes;
    if (message.type === 'start') this.metrics.maxStartBytes = Math.max(this.metrics.maxStartBytes, bytes);
    if (message.type === 'move') this.metrics.maxMoveBytes = Math.max(this.metrics.maxMoveBytes, bytes);
    try { await this.transport.send(payload); if (this.closed) return; this.failures = 0;
      if (message.type === 'presence') { this.presenceDirty = false; this.heartbeatAt = now + 15000; }
    } catch { if (!this.closed) { this.failures++; if (this.failures >= 2) this.degrade(); } }
    finally {
      // Space sends from completion too: a delayed request must not bunch with
      // the next packet on the receiver when the main thread/network resumes.
      const currentHz = this.snapshot.mode === 'A' ? this.snapshot.hz : 1;
      this.nextSend = Math.max(this.nextSend, this.now() + 1000 / Math.max(.01, Math.min(hz, currentHz || hz)));
      this.sending = false;
    }
  }
  private clearRemote() { this.peers.clear(); this.drags.clear(); this.publish(); this.changed(); }
  stop() {
    if (this.closed) return; this.closed = true; clearInterval(this.timer); this.release?.(); this.transport.stop();
    this.local = undefined; this.pendingEnds = []; this.sequences.clear(); this.ended.clear(); this.durable.clear(); this.clearRemote(); this.mode('B', '停止', 0);
  }
}
