/** In-process loopback fault relay. No SQL, realtime service or external network. */
export function mockEphemeralRelay(backend, documentId) {
  const sinks = new Set(), records = [], colors = ['#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#16a34a'];
  const state = { allowed: true, maxHz: 3, reason: undefined, fail: false, drop: new Set(), duplicate: false, reverse: false, held: [], latencyMs: 0 };
  const roster = () => [...backend.members.keys()].map((actorId, i) => ({ actorId, displayName: `参加者${i + 1}`, color: colors[i % colors.length] }));
  const send = (event, destination) => {
    for (const sink of sinks) if (sink.actor !== event.actorId && (!destination || destination === sink.actor)) sink.res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const handler = async (req, res, url) => {
    const actor = url.searchParams.get('actor');
    if (url.searchParams.get('document') !== documentId || !backend.members.has(actor)) { res.writeHead(403).end(); return; }
    if (url.searchParams.has('stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); res.write('retry: 100\n\n');
      res.write(`data: ${JSON.stringify({ members: roster() })}\n\n`);
      const sink = { actor, res }; sinks.add(sink);
      for (const peer of sinks) if (peer !== sink) peer.res.write(`data: ${JSON.stringify({ members: roster() })}\n\n`);
      req.on('close', () => sinks.delete(sink)); return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify({ allowed: state.allowed, maxHz: state.maxHz, reason: state.reason, expiresAt: Number.MAX_SAFE_INTEGER })); return; }
    if (state.fail || !state.allowed) { res.writeHead(429).end('{}'); return; }
    let payload = ''; for await (const chunk of req) payload += chunk;
    const message = JSON.parse(payload), event = { actorId: actor, payload, latencyMs: state.latencyMs };
    records.push({ actor, type: message.type, time: Date.now(), bytes: Buffer.byteLength(payload), message });
    if (!state.drop.has(message.type)) {
      if (state.reverse) state.held.push(event);
      else { send(event); if (state.duplicate) send(event); }
    }
    res.end('{}');
  };
  return { handler, state, records, sinks,
    flushReverse: () => { state.held.reverse().forEach(event => send(event)); state.held = []; },
    inject: (actorId, message, destination, latencyMs = 0) => send({ actorId, payload: JSON.stringify(message), latencyMs }, destination),
    revoke: actor => { for (const sink of sinks) if (sink.actor === actor) { sink.res.write('data: {"revoked":true}\n\n'); sink.res.end(); } },
    reconnect: actor => { for (const sink of sinks) if (sink.actor === actor) sink.res.end(); },
  };
}
