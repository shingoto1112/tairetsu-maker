import type { EphemeralTransport, EphemeralMember, EphemeralBudget } from '../ephemeralTransport';

/** DEV loopback relay only. Test actor tokens are not production authentication. */
export function createMockEphemeralTransport(origin: string, documentId: string, actorId: string): EphemeralTransport {
  const url = new URL(origin);
  if (!import.meta.env.DEV || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local ephemeral mock only');
  let events: EventSource | undefined, stopped = false, roster: EphemeralMember[] = [];
  const abort = new AbortController();
  const endpoint = `${url.origin}/ephemeral?document=${encodeURIComponent(documentId)}&actor=${encodeURIComponent(actorId)}`;
  const request = async (method: string, body?: string) => {
    if (stopped) throw Error('Stopped');
    const result = await fetch(endpoint, { method, body, signal: abort.signal, headers: { 'Content-Type': 'application/json' } });
    if (!result.ok) throw Error('Mock ephemeral unavailable');
    return result;
  };
  return {
    actorId, members: () => roster,
    subscribe(receive, status, revoked) {
      events = new EventSource(`${endpoint}&stream=1`);
      events.onopen = () => status(true); events.onerror = () => status(false);
      events.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.revoked) { revoked(); return; }
        if (data.members) { roster = data.members; status(true); return; }
        receive(data);
      };
      return () => events?.close();
    },
    send: async payload => { await request('POST', payload); },
    budget: async () => (await (await request('GET')).json()) as EphemeralBudget,
    stop: () => { stopped = true; abort.abort(); events?.close(); },
  };
}
