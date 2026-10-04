// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseEphemeralTransport } from './supabaseEphemeralTransport';
import { encodeEphemeral } from './ephemeralSession';
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('binds SDK private channels, token auth and WebSocket-only sends; never falls back to REST on lost join/socket', async () => {
  const actor = '00000000-0000-0000-0000-000000000001', documentId = '00000000-0000-0000-0000-000000000010';
  const membershipGeneration = '00000000-0000-0000-0000-000000000011';
  const topic = 'collab-v2:00000000-0000-0000-0000-000000000101';
  const wire = { documentId, generation: '1', aclGeneration: '1', topic, membershipGeneration,
    members: [{ userId: actor, membershipGeneration, displayName: '本人', color: '#2563eb' }] };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(wire), { status: 200 })); vi.stubGlobal('fetch', fetcher);
  let socket = true;
  const channels: { topic: string; state: string; send: ReturnType<typeof vi.fn>; teardown: ReturnType<typeof vi.fn> }[] = [];
  const sdk = { realtime: { setAuth: vi.fn(async () => {}), isConnected: () => socket, disconnect: vi.fn() },
    removeChannel: vi.fn(async () => {}), channel: vi.fn((name: string, _config: unknown) => {
      const channel = { topic: name, state: 'joined', send: vi.fn(async () => 'ok'), teardown: vi.fn(),
        on: vi.fn(), subscribe: vi.fn((status: (value: string) => void) => queueMicrotask(() => status('SUBSCRIBED'))) };
      channels.push(channel); return channel;
    }) };
  vi.mocked(createClient).mockReturnValue(sdk as unknown as ReturnType<typeof createClient>);
  const t = createSupabaseEphemeralTransport({ url: 'http://127.0.0.1:1', anonKey: 'fixture-only' }, { enabled: true,
    lifecycle: false, documentId, generation: '1', membershipGeneration, actorId: actor,
    credential: async () => ({ accountId: actor, accessToken: 'fake-token' }), valid: () => true });
  const connected = vi.fn();
  try {
    t.subscribe(() => {}, connected, () => {}); for (let n = 0; n < 30; n++) await Promise.resolve();
    expect(connected).toHaveBeenLastCalledWith(true); expect(sdk.realtime.setAuth).toHaveBeenCalledWith('fake-token');
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:1', 'fixture-only', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    expect(sdk.channel.mock.calls.every(([, config]) => JSON.stringify(config) === JSON.stringify({ config: { private: true, broadcast: { ack: true, self: false } } }))).toBe(true);
    const sender = channels.find(c => c.topic.endsWith(`:ephemeral:${actor}`))!;
    const payload = encodeEphemeral({ v: 1, type: 'presence', sessionId: 'device', seq: 1, sceneId: 'scene', selected: [] });
    sender.state = 'joining'; await expect(t.send(payload)).rejects.toThrow(); sender.state = 'joined';
    socket = false; await expect(t.send(payload)).rejects.toThrow(); expect(sender.send).not.toHaveBeenCalled();
    socket = true; await t.send(payload);
    expect(sender.send).toHaveBeenCalledWith({ type: 'broadcast', event: 'ephemeral', payload: { generation: '1', aclGeneration: '1', membershipGeneration, payload } }, { timeout: 3000 });
    expect(fetcher).toHaveBeenCalledOnce(); // metadata RPC only; never REST broadcast
  } finally { t.stop(); }
  expect(sdk.removeChannel).toHaveBeenCalledTimes(2); expect(sdk.realtime.disconnect).toHaveBeenCalledOnce();
});
