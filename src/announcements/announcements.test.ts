import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BYTES, parseFeed, safeLink, selectFeed, validateFeed, visibleItems } from "./contract";
import { allowedOrigins, announcementUrl, createAnnouncementService, keys, markRead, readIds } from "./service";
import * as runtime from "../platform/runtime";
import { publicSiteUrl } from "../config/publicLinks";
import draft from "./announcements.v1.json";
const copy = () => structuredClone(draft);
const valid = () => validateFeed(copy(), allowedOrigins)!;
function memory() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; }
const response = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("announcement contract", () => {
  it("ignores unknown fields, maps unknown kinds and falls back to ja", () => {
    const raw = { ...copy(), extra: true }; raw.items[0].kind = "future";
    const feed = validateFeed(raw, allowedOrigins)!;
    expect(feed.items[0].kind).toBe("info"); expect(visibleItems(feed, "en")[0].title).toBe(draft.items[0].locales.ja.title);
    feed.items[0].locales = {}; expect(visibleItems(feed)).toEqual([]);
  });
  it("prefers current locale and rejects impossible or offset-free dates", () => {
    const feed = valid(); feed.items[0].locales.en = { title: "English", body: "text", links: [] };
    expect(visibleItems(feed, "en")[0].title).toBe("English");
    for (const publishedAt of ["2026-02-30T09:00:00+09:00", "2026-11-14T09:00:00", "2026-11-14T24:00:00+09:00"]) {
      const raw = copy(); raw.items[0].publishedAt = publishedAt; expect(validateFeed(raw, allowedOrigins)).toBeNull();
    }
  });
  it("rejects malformed, unsupported, duplicate and oversized feeds", () => {
    expect(parseFeed("{", allowedOrigins)).toBeNull();
    expect(parseFeed(" ".repeat(MAX_BYTES + 1), allowedOrigins)).toBeNull();
    for (const patch of [{ schemaVersion: 2 }, { revision: 1.5 }, { items: Array(101).fill(copy().items[0]) }, { items: [copy().items[0], copy().items[0]] }]) expect(validateFeed({ ...copy(), ...patch }, allowedOrigins)).toBeNull();
    const raw = copy(); raw.items[0].locales.ja.title = "?".repeat(121); expect(validateFeed(raw, allowedOrigins)).toBeNull();
    raw.items[0].locales.ja.title = "ok"; raw.items[0].locales.ja.body = "?".repeat(10001); expect(validateFeed(raw, allowedOrigins)).toBeNull();
    expect(validateFeed({ ...copy(), items: [{ id: "x" }] }, allowedOrigins)).toBeNull();
    expect(validateFeed({ ...copy(), items: [{ ...copy().items[0], locales: { ja: { title: "x", body: "x", links: Array(4).fill({}) } } }] }, allowedOrigins)).toBeNull();
  });
  it.each(["http://apps.apple.com/x", "https://user:pass@apps.apple.com/x", "https://apps.apple.com:444/x", "https://apps.apple.com.evil.test/x", "javascript:alert(1)", "//apps.apple.com/x", "https://evil.test/x"])("omits unsafe link %s", url => { expect(safeLink(url, allowedOrigins)).toBeNull(); });
  it("retains only valid links and accepts default https port", () => {
    expect(safeLink("https://apps.apple.com:443/x", allowedOrigins)).toBe("https://apps.apple.com/x");
    const feed = validateFeed({ ...copy(), items: [{ ...copy().items[0], locales: { ja: { title: "x", body: "x", links: [{ label: "ok", url: "https://apps.apple.com/x" }, { label: "x".repeat(41), url: "https://apps.apple.com/x" }, { label: "bad", url: "http://apps.apple.com" }] } } }] }, allowedOrigins)!;
    expect(visibleItems(feed)[0].links).toHaveLength(1);
  });
  it("selects max revision, ties by source, accepts empty and never fills deleted items", () => {
    const bundled = valid(), cache = { ...valid(), revision: 2 }, fetched = { ...valid(), revision: 2, items: [] };
    expect(selectFeed(bundled, cache, fetched)).toBe(fetched); expect(selectFeed(fetched, bundled)).toBe(fetched);
    expect(selectFeed(bundled, { ...cache, revision: 1 }).items).toBe(cache.items);
  });
});
describe("read IDs", () => {
  it("persists and trims oldest at 500", () => { const s = memory(); const ids = markRead(Array.from({ length: 501 }, (_, i) => String(i)), [], s); expect(ids).toHaveLength(500); expect(ids[0]).toBe("1"); expect(readIds(s)).toEqual(ids); });
  it("survives storage exceptions and corrupt values", () => { const s = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } }; expect(readIds(s)).toEqual([]); expect(markRead(["x"], [], s)).toEqual(["x"]); });
});
describe("fetch and cache", () => {
  it("uses relative Web URL and the public site for Capacitor iOS", () => {
    const spy = vi.spyOn(runtime, "getAppRuntime").mockReturnValue("web");
    expect(announcementUrl()).toBe("/announcements.v1.json");
    spy.mockReturnValue("capacitor-ios"); expect(announcementUrl()).toBe(`${publicSiteUrl}/announcements.v1.json`);
  });
  it("deduplicates and applies one minute and six hour intervals", async () => {
    let time = 1000000; const fetcher = vi.fn<typeof fetch>(async () => response(copy()));
    const service = createAnnouncementService({ storage: memory(), fetcher, now: () => time, url: () => "/local" });
    const first = service.refresh("home"); expect(service.refresh("open")).toBe(first); await first;
    await service.refresh("open"); expect(fetcher).toHaveBeenCalledTimes(1);
    time += 60000; await service.refresh("home"); expect(fetcher).toHaveBeenCalledTimes(1);
    await service.refresh("open"); expect(fetcher).toHaveBeenCalledTimes(2);
    time += 6 * 3600000; await service.refresh("home"); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "omit", cache: "no-cache" });
  });
  it("uses cache on failure, suppresses retries, validates cache and persists metadata", async () => {
    const s = memory(); s.setItem(keys.cache, JSON.stringify({ ...copy(), revision: 9, items: [] })); let time = 100000;
    const fetcher = vi.fn(async () => { throw Error("offline"); });
    const service = createAnnouncementService({ storage: s, fetcher, now: () => time });
    expect((await service.refresh("home")).revision).toBe(9); await service.refresh("home"); expect(fetcher).toHaveBeenCalledTimes(1);
    time += 60000; await service.refresh("home"); expect(fetcher).toHaveBeenCalledTimes(2);
    s.setItem(keys.cache, "bad"); expect(createAnnouncementService({ storage: s }).getFeed().revision).toBe(1);
  });
  it("times out even if fetch ignores abort", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const service = createAnnouncementService({ storage: memory(), fetcher });
    const pending = service.refresh("open"); await vi.advanceTimersByTimeAsync(5000); expect((await pending).revision).toBe(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("limits actual bytes without Content-Length and times out stalled bodies", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(MAX_BYTES + 1)); c.close(); } });
    const service = createAnnouncementService({ storage: memory(), fetcher: vi.fn(async () => new Response(stream)) });
    expect((await service.refresh("open")).revision).toBe(1);
    vi.useFakeTimers(); const stalled = createAnnouncementService({ storage: memory(), fetcher: vi.fn(async () => new Response(new ReadableStream())) });
    const pending = stalled.refresh("open"); await vi.advanceTimersByTimeAsync(5000); expect((await pending).revision).toBe(1);
  });
  it("adopts empty feed and prevents rollback after reload", async () => {
    const s = memory(); const service = createAnnouncementService({ storage: s, fetcher: vi.fn(async () => response({ ...copy(), revision: 3, items: [] })) });
    expect((await service.refresh("open")).items).toEqual([]); expect(createAnnouncementService({ storage: s }).getFeed().items).toEqual([]);
  });
  it("retains best cache for HTTP and invalid JSON failures", async () => {
    for (const result of [new Response("fail", { status: 500 }), new Response("{"), response({ schemaVersion: 2 })]) {
      const s = memory(); s.setItem(keys.cache, JSON.stringify({ ...copy(), revision: 5 }));
      const service = createAnnouncementService({ storage: s, fetcher: vi.fn(async () => result) });
      expect((await service.refresh("open")).revision).toBe(5);
    }
  });
  it("restores six-hour success metadata and survives unavailable persistence", async () => {
    const s = memory(); let time = 100000;
    const fetcher = vi.fn<typeof fetch>(async () => response(copy()));
    await createAnnouncementService({ storage: s, fetcher, now: () => time }).refresh("home");
    time += 60000; await createAnnouncementService({ storage: s, fetcher, now: () => time }).refresh("home");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const broken = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
    const feed = await createAnnouncementService({ storage: broken, fetcher: vi.fn(async () => response({ ...copy(), revision: 7 })) }).refresh("open");
    expect(feed.revision).toBe(7);
  });
});
