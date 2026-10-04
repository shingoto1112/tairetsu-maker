import { createClient } from "@supabase/supabase-js";
import type { CloudConfig } from "../cloud/config";
import { TransportError, uuid, type CollaborationTransport, type Credential } from "./transport";

export function httpError(status: number, code: string, retryAfterMs = 0): TransportError {
  return new TransportError(code === "VALIDATION_BUDGET" ? "validation" : code === "STALE_GENERATION" ? "generation" :
    status === 401 || code === "NOT_AUTHENTICATED" || code === "PGRST301" || code === "PGRST303" ? "auth" :
    status === 403 || code === "42501" ? "permission" : status === 413 || code === "54000" ? "capacity" :
    status === 429 ? "rate-limit" : status >= 500 || code === "HEAD_CONFLICT" || code === "MISSING_DEPENDENCIES" ? "temporary" : "validation", code, retryAfterMs);
}
/** Auth ownership stays with the existing session service. No second persisted auth store. */
export function createCollaborationRequest(config: CloudConfig, fetcher: typeof fetch = fetch) {
  const url = config.url.replace(/\/+$/, "");
  const request = async (path: string, auth: Credential, signal: AbortSignal, body?: unknown) => {
    // Every request is bounded, including a lost ACK or stalled RPC.
    const timeout = new AbortController();
    const abort = () => timeout.abort(); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) timeout.abort();
    const timer = setTimeout(abort, 15_000);
    try {
      const response = await fetcher(`${url}${path}`, { method: body === undefined ? "GET" : "POST", signal: timeout.signal,
        headers: { apikey: config.anonKey, Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body) });
      let result: unknown;
      try { result = await response.json(); } catch {
        if (response.ok) throw new TransportError("protocol", "NON_JSON_RESPONSE");
        result = {};
      }
      if (!response.ok) {
        const error = result as { error?: string; message?: string; code?: string };
        const retryHeader = response.headers.get("Retry-After"), seconds = Number(retryHeader);
        const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryHeader ?? "") - Date.now();
        throw httpError(response.status, error.message ?? error.error ?? error.code ?? `HTTP_${response.status}`, Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : 0);
      }
      return result;
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError("network", "NETWORK_UNAVAILABLE");
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  };
  return request;
}
export function createHttpTransport(config: CloudConfig, credential: CollaborationTransport["credential"],
  subscribe: CollaborationTransport["subscribe"], fetcher: typeof fetch = fetch): CollaborationTransport {
  const request = createCollaborationRequest(config, fetcher);
  return {
    credential, subscribe,
    membership: async (documentId, auth, signal) => {
      const result = await request("/rest/v1/rpc/collab_v2_access_status", auth, signal, { p_document: documentId }) as { status?: string; membershipGeneration?: string } | null;
      if (result?.status === "ended") throw new TransportError("permission", "DOCUMENT_DELETED");
      if (result?.status === "removed" || result?.status === "unavailable") throw new TransportError("permission", "NOT_MEMBER");
      if (result?.status !== "active") throw new TransportError("protocol", "INVALID_MEMBERSHIP");
      const membership = result.membershipGeneration;
      if (!uuid(membership)) throw new TransportError("protocol", "INVALID_MEMBERSHIP");
      return membership;
    },
    pull: (documentId, generation, cursor, limit, auth, signal) => request("/rest/v1/rpc/collab_v2_get_updates", auth, signal,
      { p_document: documentId, p_generation: generation, p_cursor: cursor, p_limit: limit }),
    append: (body, auth, signal) => request("/functions/v1/collab-ingest", auth, signal, body),
  };
}
export function createSupabaseTransport(config: CloudConfig, credential: CollaborationTransport["credential"]): CollaborationTransport {
  // Construction is explicit and only exported behind loadCollaboration(). No env/session reads.
  const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return createHttpTransport(config, credential, async (topic, auth, notice, status) => {
    await client.realtime.setAuth(auth.accessToken);
    const channel = client.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "update" }, ({ payload }) => notice(payload));
    channel.subscribe(value => { if (value === "SUBSCRIBED") status(true); else if (["TIMED_OUT", "CLOSED", "CHANNEL_ERROR"].includes(value)) status(false); });
    return () => { void client.removeChannel(channel); };
  });
}
