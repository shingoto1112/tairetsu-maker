import { describe, expect, it } from "vitest";
import { PROBES, classify, runProbes } from "./cloud-health-v2.mjs";

const probe = expect => PROBES.find(p => p.expect === expect);
const reply = (status, json) => ({ status, text: async () => (json === undefined ? "" : JSON.stringify(json)) });

describe("collaboration v2 health check", () => {
  it("accepts only the expected rejections", () => {
    expect(classify(probe("ok"), 200, { name: "GoTrue" }).ok).toBe(true);
    expect(classify(probe("ok"), 503, null).ok).toBe(false);
    expect(classify(probe("denied"), 401, { code: "42501", message: "permission denied for function" }).ok).toBe(true);
    expect(classify(probe("denied"), 200, []).ok).toBe(false); // anon got through: grants regressed
    expect(classify(probe("denied"), 404, { code: "PGRST202" }).ok).toBe(false); // function missing
    expect(classify(probe("denied"), 400, { code: "22P02" }).ok).toBe(false);
    // A gateway rejection (no database error code) does not prove that the function or table exists.
    expect(classify(probe("denied"), 401, null).ok).toBe(false);
    expect(classify(probe("denied"), 403, { message: "Invalid API key" }).ok).toBe(false);
    expect(classify(probe("denied"), 401, "").ok).toBe(false);
    expect(classify(probe("method"), 405, { error: "METHOD_NOT_ALLOWED" }).ok).toBe(true);
    expect(classify(probe("method"), 404, { error: "NOT_FOUND" }).ok).toBe(false);
  });

  it("sends only anon credentials and never writes (GET, or RPC calls anon may not execute)", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/health")) return reply(200, { name: "GoTrue" });
      if (url.includes("/functions/v1/")) return reply(405, { error: "METHOD_NOT_ALLOWED" });
      return reply(401, { code: "42501" });
    };
    const results = await runProbes("https://example.supabase.co", "anon-key", fetchImpl);
    expect(results.every(r => r.ok)).toBe(true);
    for (const { init } of calls) {
      expect(init.headers.Authorization).toBe("Bearer anon-key");
      expect(["GET", "POST"]).toContain(init.method);
    }
    expect(calls.filter(c => c.init.method === "POST").every(c => c.url.includes("/rest/v1/rpc/collab_v2_"))).toBe(true);
    expect(calls.some(c => c.url.includes("/rest/v1/projects"))).toBe(true);
  });

  it("reports network failures as failures", async () => {
    const results = await runProbes("https://example.supabase.co", "k", async () => { throw new Error("offline"); });
    expect(results.every(r => !r.ok && r.detail.includes("offline"))).toBe(true);
  });

  it("gives up on a probe that never answers, and on a body that never ends", async () => {
    const signals = [];
    const never = (url, init) => { signals.push(init.signal); return new Promise(() => {}); };
    const hung = await runProbes("https://example.supabase.co", "k", never, 20);
    expect(hung).toHaveLength(PROBES.length);
    expect(hung.every(r => !r.ok && r.detail.includes("応答がない"))).toBe(true);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    const stalledBody = async () => ({ status: 200, text: () => new Promise(() => {}) });
    const stalled = await runProbes("https://example.supabase.co", "k", stalledBody, 20);
    expect(stalled.every(r => !r.ok)).toBe(true);
  });
});
