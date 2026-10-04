/** Actor comes from an owner-only publication topic, never from the wire payload.
 * Direct Broadcast budgets are cooperative client estimates, not server permits. */
export type EphemeralMember = { actorId: string; displayName: string; color: string };
export type EphemeralBudget = { allowed: boolean; maxHz: number; expiresAt: number; reason?: 'monthly' | 'capacity' };
export type EphemeralEnvelope = { actorId: string; payload: string; latencyMs?: number };
export interface EphemeralTransport {
  readonly actorId: string;
  members(): readonly EphemeralMember[];
  subscribe(receive: (event: EphemeralEnvelope) => void, status: (online: boolean) => void,
    revoked: () => void): () => void;
  send(payload: string): Promise<void>;
  budget(): Promise<EphemeralBudget>;
  stop(): void;
}

/** Deterministic local bus; fault delivery belongs to tests, not durable storage. */
export class MockEphemeralHub {
  private peers = new Map<string, (event: EphemeralEnvelope) => void>();
  sent: EphemeralEnvelope[] = [];
  permit: EphemeralBudget = { allowed: true, maxHz: 3, expiresAt: Number.MAX_SAFE_INTEGER };
  deliver: (event: EphemeralEnvelope, receive: (event: EphemeralEnvelope) => void) => void = (e, r) => r(e);
  connect(actorId: string, roster: EphemeralMember[]): EphemeralTransport {
    let closed = false;
    return {
      actorId, members: () => roster,
      subscribe: (receive, status) => { this.peers.set(actorId, receive); status(true); return () => { this.peers.delete(actorId); }; },
      send: async payload => {
        if (closed || !this.permit.allowed) throw Error('Mock send denied');
        const event = { actorId, payload, latencyMs: 0 }; this.sent.push(event);
        this.peers.forEach((receive, peer) => { if (peer !== actorId) this.deliver(event, receive); });
      },
      budget: async () => this.permit,
      stop: () => { closed = true; this.peers.delete(actorId); },
    };
  }
}
