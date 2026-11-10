// Production health check for the collaboration v2 backend (run with `npm run cloud:check`; no shebang,
// because the test imports this file through Vitest, which cannot load one). Read-only by construction:
// every probe uses only the public anon key and is expected to be rejected before anything runs
// (RPCs are granted to `authenticated` only; Edge Functions answer GET with 405 before auth).
// The legacy cloud (shut down 2026-10-05) must stay closed to anon.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** expect: "ok" = 2xx, "denied" = exists but anon is refused, "method" = deployed function rejecting GET. */
export const PROBES = [
  { label: "認証（auth）", method: "GET", path: "/auth/v1/health", expect: "ok" },
  { label: "共同編集 v2: 参加状態の確認", method: "POST", path: "/rest/v1/rpc/collab_v2_access_status", body: { p_document: null }, expect: "denied" },
  { label: "共同編集 v2: 招待リンクの作成", method: "POST", path: "/rest/v1/rpc/collab_v2_create_invite", body: { p_document: null }, expect: "denied" },
  { label: "共同編集 v2: 招待で参加", method: "POST", path: "/rest/v1/rpc/collab_v2_join", body: { p_token: null, p_display_name: null }, expect: "denied" },
  { label: "共同編集の処理: collab-ingest", method: "GET", path: "/functions/v1/collab-ingest", expect: "method" },
  { label: "共同編集の処理: collab-maintenance", method: "GET", path: "/functions/v1/collab-maintenance", expect: "method" },
  { label: "共同編集の処理: collab-restore", method: "GET", path: "/functions/v1/collab-restore", expect: "method" },
  { label: "旧クラウドの表が閉じたまま", method: "GET", path: "/rest/v1/projects?select=id&limit=1", expect: "denied" },
];

const code = json => (json && typeof json === "object" ? json.code ?? json.error : undefined);

/** Pure: decide one probe's result from the HTTP status and parsed body. */
export function classify(probe, status, json) {
  if (probe.expect === "ok") return status >= 200 && status < 300
    ? { ok: true, detail: `${status}` } : { ok: false, detail: `${status} 正常応答ではない` };
  if (probe.expect === "denied") {
    if (status >= 200 && status < 300) return { ok: false, detail: `${status} 未ログインで通ってしまった（権限の設定を確認）` };
    if (status === 404 || code(json) === "PGRST202" || code(json) === "PGRST205" || code(json) === "42P01")
      return { ok: false, detail: `${status} ${code(json) ?? ""} 機能・表が見つからない（SQL の適用を確認）`.trim() };
    // Only the database's own "permission denied" proves that the function/table exists. A 401/403 without
    // that code comes from the gateway (e.g. a wrong or rotated key) and says nothing about the backend.
    if ((status === 401 || status === 403) && code(json) === "42501")
      return { ok: true, detail: `${status} 未ログインは拒否（正常）` };
    if ((status === 401 || status === 403) && code(json) === undefined)
      return { ok: false, detail: `${status} 入口で拒否された（キーの設定を確認。機能の有無は確かめられていない）` };
    return { ok: false, detail: `${status} ${code(json) ?? ""} 想定外の応答`.trim() };
  }
  if (probe.expect === "method") {
    if (status === 405 && code(json) === "METHOD_NOT_ALLOWED") return { ok: true, detail: "405 配置済み（GET は拒否）" };
    if (status === 404) return { ok: false, detail: "404 関数が配置されていない" };
    return { ok: false, detail: `${status} ${code(json) ?? ""} 想定外の応答`.trim() };
  }
  throw new Error(`unknown expectation ${probe.expect}`);
}

/** One probe may not hang the scheduled job: the limit covers the response body as well. */
async function withTimeout(ms, run) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(`${ms / 1000}秒以内に応答がない`)); }, ms);
  });
  try { return await Promise.race([run(controller.signal), expired]); } finally { clearTimeout(timer); }
}

export async function runProbes(baseUrl, anonKey, fetchImpl = fetch, timeoutMs = 15000) {
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const results = [];
  for (const probe of PROBES) {
    try {
      const { status, text } = await withTimeout(timeoutMs, async signal => {
        const response = await fetchImpl(`${baseUrl}${probe.path}`, { method: probe.method, headers, signal,
          body: probe.body === undefined ? undefined : JSON.stringify(probe.body) });
        return { status: response.status, text: await response.text() };
      });
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      results.push({ probe, ...classify(probe, status, json) });
    } catch (error) {
      results.push({ probe, ok: false, detail: `通信できない: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return results;
}

const loadDotEnv = file => {
  let text; try { text = readFileSync(file, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadDotEnv(path.resolve(".env")); loadDotEnv(path.resolve(".env.local"));
  const url = process.env.VITE_SUPABASE_URL?.replace(/\/+$/, ""), key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) { console.error("Missing required env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY"); process.exit(1); }
  const results = await runProbes(url, key);
  for (const r of results) console.log(`${r.ok ? "OK" : "NG"} ${r.probe.label}: ${r.detail}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? `${failed}件の確認に失敗しました。` : "すべて正常です。");
  process.exit(failed ? 1 : 0);
}
