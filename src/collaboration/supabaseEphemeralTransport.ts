import { createClient } from '@supabase/supabase-js';
import type { CloudConfig } from '../cloud/config';
import { EPHEMERAL_BUDGET, type EphemeralBudgetSettings } from '../config/collaborationLimits';
import { decodeEphemeral, payloadBytes, EPHEMERAL_LIMITS } from './ephemeralSession';
import type { EphemeralBudget, EphemeralEnvelope, EphemeralMember, EphemeralTransport } from './ephemeralTransport';
import { createCollaborationRequest } from './supabaseTransport';
import { TransportError, uuid, type Credential } from './transport';

type Member = EphemeralMember & { membershipGeneration: string };
export type EphemeralState = { documentId: string; generation: string; aclGeneration: string;
  topic: string; membershipGeneration: string; members: Member[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const generation = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
export function parseEphemeralState(v: unknown): EphemeralState {
  if (!object(v) || !uuid(v.documentId) || !generation(v.generation) || !generation(v.aclGeneration) ||
    !uuid(v.membershipGeneration) || typeof v.topic !== 'string' || !/^collab-v2:[0-9a-f-]{36}$/.test(v.topic) ||
    !uuid(v.topic.slice(10)) || !Array.isArray(v.members) || !v.members.length || v.members.length > 8) throw Error('Invalid ephemeral state');
  const members = v.members.map(m => {
    if (!object(m) || !uuid(m.userId) || !uuid(m.membershipGeneration) || typeof m.displayName !== 'string' ||
      !m.displayName.trim() || [...m.displayName].length > 80 || typeof m.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(m.color)) throw Error('Invalid roster');
    return { actorId: m.userId, membershipGeneration: m.membershipGeneration, displayName: m.displayName, color: m.color };
  });
  if (new Set(members.map(m => m.actorId)).size !== members.length) throw Error('Duplicate roster');
  return { documentId: v.documentId, generation: v.generation, aclGeneration: v.aclGeneration,
    topic: v.topic, membershipGeneration: v.membershipGeneration, members };
}
export const ephemeralTopic = (topic: string, actorId: string) => `${topic}:ephemeral:${actorId}`;

/** Small SDK seam for offline contract tests. ready() must include socket AND
 * joined-channel state: SDK send() otherwise silently falls back to REST. */
export interface EphemeralRealtimePort {
  setAuth(token: string): Promise<void>;
  channel(topic: string, event: string, receive: (payload: unknown) => void,
    status: (connected: boolean) => void): { ready(): boolean; send(payload: unknown): Promise<string>; close(): void | Promise<void> };
  disconnect(): void;
}
type Channel = ReturnType<EphemeralRealtimePort['channel']>;
type Options = { enabled: boolean; documentId: string; generation: string; membershipGeneration: string;
  actorId: string; credential(signal: AbortSignal): Promise<Credential | null>; valid(): boolean;
  state(auth: Credential, signal: AbortSignal): Promise<EphemeralState>; now?: () => number; lifecycle?: boolean;
  budget?: Readonly<EphemeralBudgetSettings> };

/** No durable state and no offline queue. Control topic is server-only; actor
 * identity is bound to its owner-only topic by RLS, never a packet field. */
export class SupabaseEphemeralTransport implements EphemeralTransport {
  readonly actorId: string;
  private roster: Member[] = [];
  private stateValue?: EphemeralState;
  private token = ''; private key = ''; private epoch = 0; private confirmedAt = 0;
  private started = false; private stopped = false; private online = false; private busy = false; private pending = false;
  private abort = new AbortController(); private channels: Channel[] = []; private sender?: Channel;
  private receive?: (event: EphemeralEnvelope) => void; private status?: (online: boolean) => void; private revoked?: () => void;
  private poll?: ReturnType<typeof setInterval>; private retry?: ReturnType<typeof setTimeout>;
  private connections = new Map<string, number>(); private overflowUntil = 0; private nextSend = 0;
  private sending = false;
  private closing: Promise<void> = Promise.resolve();
  constructor(private realtime: EphemeralRealtimePort, private options: Options) { this.actorId = options.actorId; }
  private now() { return this.options.now?.() ?? Date.now(); }
  private get settings() { return this.options.budget ?? EPHEMERAL_BUDGET; }
  members = () => this.roster;
  private valid() { return this.options.enabled && !this.stopped && this.options.valid(); }
  private network() { return this.options.lifecycle === false || typeof navigator === 'undefined' || navigator.onLine; }
  subscribe(receive: (event: EphemeralEnvelope) => void, status: (online: boolean) => void, revoked: () => void) {
    if (this.started || !this.valid()) return () => {};
    this.started = true; this.receive = receive; this.status = status; this.revoked = revoked; status(false);
    if (this.options.lifecycle !== false && typeof window !== 'undefined') {
      window.addEventListener('offline', this.offline); window.addEventListener('online', this.refresh);
      document.addEventListener('visibilitychange', this.visible);
    }
    this.poll = setInterval(this.refresh, this.settings.pollMs); this.refresh();
    return () => this.stop();
  }
  private visible = () => { if (document.visibilityState === 'visible') this.refresh(); };
  private offline = () => this.suspend();
  /** Synchronous fence before awaiting metadata, including token changes. */
  invalidate = () => { if (!this.started || this.stopped) return; this.suspend(); this.refresh(); };
  private suspend() {
    this.epoch++; this.abort.abort(); this.abort = new AbortController();
    this.online = false; this.key = ''; this.sender = undefined; this.stateValue = undefined; this.roster = [];
    this.connections.clear(); this.overflowUntil = 0;
    // SDK channel(topic) reuses an existing object until unsubscribe completes.
    // Fence immediately, then serialize teardown before recreating equal topics.
    const closing = this.channels.splice(0).map(c => Promise.resolve(c.close()).catch(() => {}));
    this.closing = Promise.all([this.closing, ...closing]).then(() => {});
    this.status?.(false);
  }
  refresh = () => {
    if (!this.started || !this.valid()) { if (this.started && !this.stopped) this.revoke(); return; }
    if (!this.network()) { this.suspend(); return; }
    this.pending = true; if (!this.busy) void this.refreshState();
  };
  private revoke() { const callback = this.revoked; this.stop(); callback?.(); }
  private async refreshState() {
    this.busy = true; this.pending = false;
    let epoch = this.epoch;
    try {
      const auth = await this.options.credential(this.abort.signal);
      if (!this.valid() || epoch !== this.epoch) return;
      if (!auth || auth.accountId !== this.actorId) { this.revoke(); return; }
      // setAuth is owned by this transport; no second persisted auth store.
      if (this.token && this.token !== auth.accessToken) { this.suspend(); epoch = this.epoch; }
      const state = await this.options.state(auth, this.abort.signal);
      if (!this.valid() || epoch !== this.epoch) return;
      const mine = state.members.find(m => m.actorId === this.actorId);
      if (state.documentId !== this.options.documentId || state.generation !== this.options.generation ||
        state.membershipGeneration !== this.options.membershipGeneration || mine?.membershipGeneration !== state.membershipGeneration) { this.revoke(); return; }
      const key = JSON.stringify([state, auth.accessToken]);
      this.confirmedAt = this.now();
      if (key === this.key) return;
      this.suspend(); epoch = this.epoch;
      await this.closing;
      if (!this.valid() || epoch !== this.epoch) return;
      await this.realtime.setAuth(auth.accessToken);
      if (!this.valid() || epoch !== this.epoch || !this.network()) return;
      this.token = auth.accessToken; this.key = key; this.stateValue = state; this.roster = state.members;
      const connected = new Set<string>(); const total = state.members.length + 1;
      const status = (topic: string) => (ready: boolean) => {
        if (!this.valid() || epoch !== this.epoch) return;
        if (!ready) { this.suspend(); this.schedule(); return; }
        connected.add(topic);
        if (connected.size === total) { this.online = true; this.status?.(true); }
      };
      // This topic forbids client INSERT, including all legacy policies.
      this.channels.push(this.realtime.channel(state.topic, 'acl_changed', payload => {
        if (epoch === this.epoch && object(payload) && Object.keys(payload).length === 0) this.invalidate();
      }, status(state.topic)));
      for (const member of state.members) {
        const topic = ephemeralTopic(state.topic, member.actorId);
        const channel = this.realtime.channel(topic, 'ephemeral', payload => {
          if (!this.online || !this.valid() || epoch !== this.epoch || !this.network() || !object(payload) ||
            Object.keys(payload).sort().join() !== 'aclGeneration,generation,membershipGeneration,payload' ||
            payload.generation !== state.generation || payload.aclGeneration !== state.aclGeneration ||
            payload.membershipGeneration !== member.membershipGeneration || typeof payload.payload !== 'string') return;
          const message = decodeEphemeral(payload.payload);
          if (!message || payloadBytes(JSON.stringify(payload)) > (message.type === 'move' ? EPHEMERAL_LIMITS.moveBytes : EPHEMERAL_LIMITS.startBytes)) return;
          const now = this.now(); this.expireConnections(now);
          const session = JSON.stringify([member.actorId, message.sessionId]);
          if (this.connections.size >= this.settings.maxConnections && !this.connections.has(session)) { this.overflowUntil = now + this.settings.connectionTtlMs; return; }
          this.connections.set(session, now + this.settings.connectionTtlMs);
          this.receive?.({ actorId: member.actorId, payload: payload.payload });
        }, status(topic));
        this.channels.push(channel); if (member.actorId === this.actorId) this.sender = channel;
      }
    } catch (error) {
      if (!this.valid() || epoch !== this.epoch) return;
      if (error instanceof TransportError && ['permission', 'auth', 'generation'].includes(error.kind)) this.revoke();
      else { this.suspend(); this.schedule(); }
    } finally {
      this.busy = false; if (this.pending && this.valid()) void this.refreshState();
    }
  }
  private schedule() { clearTimeout(this.retry); this.retry = setTimeout(this.refresh, 1000); }
  private expireConnections(now: number) { this.connections.forEach((until, key) => { if (until <= now) this.connections.delete(key); }); }
  async budget(): Promise<EphemeralBudget> {
    const now = this.now(); this.expireConnections(now);
    const count = Math.max(this.settings.minimumConnections, this.roster.length, this.connections.size + 1);
    const maxHz = Math.min(this.settings.maxHz, 3, Math.max(0, this.settings.messagesPerSecond - this.settings.reservePerSecond) / (count * count));
    return { allowed: this.valid() && this.network() && this.online && this.settings.enabled && now >= this.overflowUntil &&
      count <= this.settings.maxConnections && now < this.confirmedAt + this.settings.pollMs + this.settings.permitMs,
      maxHz, expiresAt: Math.min(now + this.settings.permitMs, this.confirmedAt + this.settings.pollMs + this.settings.permitMs), reason: 'capacity' };
  }
  async send(payload: string): Promise<void> {
    const budget = await this.budget(), state = this.stateValue, sender = this.sender;
    const message = decodeEphemeral(payload);
    const wire = state && { generation: state.generation, aclGeneration: state.aclGeneration,
      membershipGeneration: this.options.membershipGeneration, payload };
    if (!this.valid() || !budget.allowed || budget.maxHz <= 0 || !state || !sender?.ready() || this.sending || this.now() < this.nextSend ||
      !message || !wire || payloadBytes(JSON.stringify(wire)) > (message.type === 'move' ? EPHEMERAL_LIMITS.moveBytes : EPHEMERAL_LIMITS.startBytes)) throw Error('Ephemeral send denied');
    // No await between ready() and send(): prevent SDK's REST fallback.
    this.nextSend = this.now() + 1000 / budget.maxHz; this.sending = true;
    try {
      const result = await sender.send(wire);
      if (result !== 'ok') throw Error('Ephemeral send failed');
    } finally { this.nextSend = Math.max(this.nextSend, this.now() + 1000 / budget.maxHz); this.sending = false; }
  }
  stop() {
    if (this.stopped) return; this.stopped = true; clearInterval(this.poll); clearTimeout(this.retry); this.suspend();
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', this.offline); window.removeEventListener('online', this.refresh);
      document.removeEventListener('visibilitychange', this.visible);
    }
    this.realtime.disconnect(); this.receive = undefined; this.status = undefined; this.revoked = undefined;
  }
}

export function createSupabaseEphemeralTransport(config: CloudConfig, options: Omit<Options, 'state'>): SupabaseEphemeralTransport {
  const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const request = createCollaborationRequest(config);
  const realtime: EphemeralRealtimePort = {
    setAuth: token => client.realtime.setAuth(token), disconnect: () => client.realtime.disconnect(),
    channel: (topic, event, receive, status) => {
      const channel = client.channel(topic, { config: { private: true, broadcast: { ack: true, self: false } } });
      channel.on('broadcast', { event }, ({ payload }) => receive(payload));
      channel.subscribe(value => status(value === 'SUBSCRIBED'));
      return { ready: () => channel.state === 'joined' && client.realtime.isConnected(),
        send: payload => channel.send({ type: 'broadcast', event: 'ephemeral', payload }, { timeout: 3000 }),
        close: async () => { try { await client.removeChannel(channel); } finally { channel.teardown(); } } };
    },
  };
  return new SupabaseEphemeralTransport(realtime, { ...options, state: async (auth, signal) =>
    parseEphemeralState(await request('/rest/v1/rpc/collab_v2_ephemeral_state', auth, signal, { p_document: options.documentId })) });
}
