import bundledJson from "./announcements.v1.json";
import { MAX_BYTES, parseFeed, selectFeed, validateFeed, type AnnouncementFeed } from "./contract";
import { publicSiteUrl } from "../config/publicLinks";
import { getAppRuntime } from "../platform/runtime";

export const allowedOrigins = [new URL(publicSiteUrl).origin, "https://apps.apple.com"] as const;
export const announcementUrl = () => getAppRuntime() === "capacitor-ios" ? `${publicSiteUrl}/announcements.v1.json` : "/announcements.v1.json";
export const keys = { cache: "stageflow.announcements.cache.v1", read: "stageflow.announcements.read.v1", meta: "stageflow.announcements.meta.v1" };
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
const browserStorage = (): StorageAccess | undefined => { try { return localStorage; } catch { return undefined; } };
export function readIds(storage = browserStorage()): string[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(keys.read) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))].slice(-500) : [];
  } catch { return []; }
}
export function markRead(ids: string[], previous: string[], storage = browserStorage()): string[] {
  const result = [...new Set([...previous, ...ids])].slice(-500);
  try { storage?.setItem(keys.read, JSON.stringify(result)); } catch { /* Memory state remains usable. */ }
  return result;
}
export function createAnnouncementService(options: { storage?: StorageAccess; fetcher?: typeof fetch; now?: () => number; url?: () => string } = {}) {
  const storage = options.storage ?? browserStorage();
  const now = options.now ?? Date.now;
  const bundled = validateFeed(bundledJson, allowedOrigins)!;
  let cached: AnnouncementFeed | null = null;
  let success: number | null = null, attempt: number | null = null;
  try { cached = parseFeed(storage?.getItem(keys.cache) ?? "", allowedOrigins); } catch { /* Unavailable storage. */ }
  try {
    const meta = JSON.parse(storage?.getItem(keys.meta) ?? "null");
    const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= now();
    if (cached && time(meta?.success)) success = meta.success;
    if (time(meta?.attempt)) attempt = meta.attempt;
  } catch { /* Invalid metadata does not discard a valid feed. */ }
  let feed = selectFeed(bundled, cached);
  let pending: Promise<AnnouncementFeed> | null = null;
  const saveMeta = () => { try { storage?.setItem(keys.meta, JSON.stringify({ success, attempt })); } catch { /* Optional persistence. */ } };
  return {
    getFeed: () => feed,
    refresh(reason: "home" | "open"): Promise<AnnouncementFeed> {
      if (pending) return pending;
      const time = now();
      if ((attempt !== null && time - attempt < 60000) || (reason === "home" && success !== null && time - success < 6 * 3600000)) return Promise.resolve(feed);
      attempt = time; saveMeta();
      pending = (async () => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, 5000); });
          const receive = async () => {
            const response = await (options.fetcher ?? fetch)((options.url ?? announcementUrl)(), { credentials: "omit", cache: "no-cache", signal: controller.signal });
            if (!response.ok || !response.body) throw new Error("response");
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > MAX_BYTES) { controller.abort(); throw new Error("size"); }
                chunks.push(value);
              }
            } finally { void reader.cancel().catch(() => {}); }
            const bytes = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            const result = parseFeed(new TextDecoder("utf-8", { fatal: true }).decode(bytes), allowedOrigins);
            if (!result) throw new Error("feed");
            return result;
          };
          const fetched = await Promise.race([receive(), timeout]);
          feed = selectFeed(feed, fetched);
          success = now();
          try { storage?.setItem(keys.cache, JSON.stringify(feed)); } catch { /* Keep memory cache. */ }
          saveMeta();
        } catch { /* Silently retain the best validated feed. */ }
        finally { clearTimeout(timer); }
        return feed;
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
let service: ReturnType<typeof createAnnouncementService> | undefined;
export const getAnnouncementService = () => service ??= createAnnouncementService();
