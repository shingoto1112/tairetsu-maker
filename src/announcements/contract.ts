export const MAX_BYTES = 256 * 1024;
export type AnnouncementKind = "update" | "feature" | "info" | "maintenance";
export type AnnouncementLink = { label: string; url: string };
export type AnnouncementText = { title: string; body: string; links: AnnouncementLink[] };
export type Announcement = { id: string; publishedAt: string; kind: AnnouncementKind; locales: Record<string, AnnouncementText> };
export type AnnouncementFeed = { schemaVersion: 1; revision: number; items: Announcement[] };
export const kindLabels: Record<AnnouncementKind, string> = { update: "アップデート", feature: "新機能", info: "お知らせ", maintenance: "不具合・メンテナンス" };
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const string = (v: unknown, max: number): v is string => typeof v === "string" && [...v].length <= max;
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(value.slice(11, 13)) < 24;
}
export function safeLink(value: unknown, origins: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && origins.includes(url.origin) ? url.href : null;
  } catch { return null; }
}
/** Shared by build, remote input and cache. Invalid links alone are omitted. */
export function validateFeed(value: unknown, origins: readonly string[]): AnnouncementFeed | null {
  if (!object(value) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.items) || value.items.length > 100) return null;
  const ids = new Set<string>();
  const items: Announcement[] = [];
  for (const item of value.items) {
    if (!object(item) || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id) || typeof item.kind !== "string" || !timestamp(item.publishedAt) || !object(item.locales)) return null;
    ids.add(item.id);
    const locales: Record<string, AnnouncementText> = Object.create(null);
    for (const [locale, text] of Object.entries(item.locales)) {
      if (!object(text) || !string(text.title, 120) || !text.title.trim() || !string(text.body, 10000) || (text.links !== undefined && (!Array.isArray(text.links) || text.links.length > 3))) return null;
      const links: AnnouncementLink[] = [];
      for (const link of (text.links ?? []) as unknown[]) {
        if (!object(link) || !string(link.label, 40) || !link.label.trim()) continue;
        const url = safeLink(link.url, origins);
        if (url) links.push({ label: link.label, url });
      }
      locales[locale] = { title: text.title, body: text.body, links };
    }
    const kind = Object.prototype.hasOwnProperty.call(kindLabels, item.kind) ? item.kind as AnnouncementKind : "info";
    items.push({ id: item.id, publishedAt: item.publishedAt, kind, locales });
  }
  return { schemaVersion: 1, revision: value.revision as number, items };
}
export function parseFeed(text: string, origins: readonly string[]): AnnouncementFeed | null {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return null;
  try { return validateFeed(JSON.parse(text), origins); } catch { return null; }
}
// Replace this one function when application i18n is introduced.
export const currentAnnouncementLocale = () => "ja";
export function visibleItems(feed: AnnouncementFeed, locale = currentAnnouncementLocale()) {
  return feed.items.flatMap(item => {
    const text = item.locales[locale] ?? item.locales.ja;
    return text ? [{ ...item, ...text }] : [];
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
/** Arguments are ordered bundled < cache < fetched; equal revisions prefer later. */
export function selectFeed(...feeds: (AnnouncementFeed | null)[]): AnnouncementFeed {
  return feeds.reduce<AnnouncementFeed | null>((best, feed) => feed && (!best || feed.revision >= best.revision) ? feed : best, null)!;
}
