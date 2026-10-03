import { decodeProjectJson } from "../project/codec";
import { requestDigest } from "../repositories/indexedDbFormat";
import { canonicalJson, type MigrationBatch, type MigrationItem } from "../repositories/migrationTypes";
import type { LegacySource } from "./legacyReaders";
import type { StageConfig } from "../types";

export const LEGACY_MIGRATION_ID = "legacy-projects-v1";
const defaultStage: StageConfig = { widthMeters: 12, depthMeters: 6, gridSizeMeters: 0.5,
  showGrid: true, showCenterLine: true, audienceSide: "bottom", showStageLabels: true };
const time = (v: unknown): number | null => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
type Candidate = { item: MigrationItem; source: LegacySource; updated: number | null; valid: boolean };
export const createMigrationPlan = async (sources: LegacySource[]): Promise<{ batch: MigrationBatch; items: MigrationItem[] }> => {
  const candidates: Candidate[] = [];
  const issues = sources.filter(s => s.status === "unreadable").map(s => ({ source: s.source, code: s.issue ?? "IO_ERROR" as const }));
  for (const source of sources) {
    if (!source.projects) continue;
    for (const raw of source.projects) {
      const rawJson = canonicalJson(raw);
      const sourceHash = await requestDigest(canonicalJson({ project: raw, draft: source.draft ?? null }));
      const oldId = raw && typeof raw === "object" && "id" in raw ? raw.id : undefined;
      const targetId = source.draft ? `draft-${await requestDigest(source.draft.cloudProjectId)}`
        : typeof oldId === "string" ? oldId : `legacy-${await requestDigest(rawJson)}`;
      let sequence = 0;
      // No random/default clock in migration: ledger IDs and normalized defaults
      // remain stable even if planning is interrupted before the batch is sealed.
      const decoded = decodeProjectJson(rawJson, { defaultStage, now: () => "1970-01-01T00:00:00.000Z",
        createProjectId: () => targetId, createId: prefix => `${prefix}-${sourceHash}-${sequence++}` });
      const valid = decoded.ok;
      const json = valid ? canonicalJson({ ...decoded.value, id: targetId }) : rawJson;
      const safeTarget = valid ? targetId : `invalid-${sourceHash}`;
      const id = `migration-${await requestDigest(canonicalJson({ targetId: safeTarget, json, draft: source.draft ?? null }))}`;
      const item: MigrationItem = { kind: "item", id, state: "discovered", sourceHash,
        targetId: safeTarget, sources: [source.source], json, disposition: "recovery",
        reason: valid ? "未採用の旧版・判定不能な差分" : "旧データの構造が不正",
        ...(source.draft ? { draft: { ...source.draft, status: "pending" as const } } : {}) };
      if (!valid) issues.push({ source: `${source.source}#${sourceHash}`, code: "CORRUPT" });
      const updated = raw && typeof raw === "object" && "updatedAt" in raw ? time(raw.updatedAt) : null;
      candidates.push({ item, source, updated, valid });
    }
  }
  const healthyLists = sources.filter(s => s.status === "ok" && s.role === "list");
  const lists = healthyLists.length ? healthyLists : sources.filter(s => s.role === "list" && s.projects !== undefined);
  // Preserve source order when there is no comparable time. This is a
  // deterministic primary preference, never evidence that all other IDs exist.
  let base = lists[0];
  for (const s of lists.slice(1)) {
    const oldTime = time(base?.savedAt), nextTime = time(s.savedAt);
    if (oldTime !== null && nextTime !== null && nextTime > oldTime) base = s;
  }
  const adopt = (c: Candidate, reason: string) => { c.item.disposition = "import"; c.item.reason = reason; };
  const baseCandidates = candidates.filter(c => c.valid && c.source === base);
  const groups = new Map<string, Candidate[]>();
  for (const c of baseCandidates) groups.set(c.item.targetId, [...(groups.get(c.item.targetId) ?? []), c]);
  for (const [id, group] of groups) {
    if (new Set(group.map(c => c.item.json)).size > 1) continue; // duplicate ID within one snapshot is ambiguous
    let chosen = group[0];
    for (const c of candidates.filter(c => c.valid && !c.source.draft && c.item.targetId === id &&
      ["list", "single"].includes(c.source.role))) {
      if (chosen.updated !== null && c.updated !== null && c.updated > chosen.updated) chosen = c;
    }
    adopt(chosen, chosen.source === base ? "採用した全件スナップショット" : "同一IDの更新時刻で確認できる新しい版");
  }
  for (const c of candidates.filter(c => c.valid && c.source.role === "single")) {
    if (!base) adopt(c, "全件スナップショットが読めないため直近1件から回収");
    else if (!groups.has(c.item.targetId) && c.updated !== null && time(base.savedAt) !== null && c.updated > time(base.savedAt)!) {
      adopt(c, "全件保存時刻より新しい直近1件（部分保存失敗）");
    }
  }
  const drafts = new Map<string, Candidate>();
  for (const c of candidates.filter(c => c.valid && c.source.draft && !c.source.source.endsWith(".backup.json"))) {
    const key = c.source.draft!.cloudProjectId, old = drafts.get(key);
    if (!old || time(c.source.savedAt)! > time(old.source.savedAt)!) drafts.set(key, c);
  }
  for (const c of drafts.values()) adopt(c, "本人クラウド下書き・サーバーrevision未確認のpendingコピー");
  const unique = new Map<string, MigrationItem>();
  for (const { item } of candidates) {
    const previous = unique.get(item.id);
    if (!previous) unique.set(item.id, item);
    else {
      previous.sources = [...new Set([...previous.sources, ...item.sources])].sort();
      if (item.disposition === "import") { previous.disposition = "import"; previous.reason = item.reason; }
    }
  }
  const items = [...unique.values()].sort((a, b) =>
    (a.disposition === "import" ? 0 : 1) - (b.disposition === "import" ? 0 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // A later retry may discover additional sources. Keep each sealed item
  // immutable; different evidence gets another ledger item, never another body.
  for (const item of items) {
    const { id: _id, state: _state, ...identity } = item;
    item.id = `migration-${await requestDigest(canonicalJson(identity))}`;
  }
  const snapshots: MigrationBatch["sources"] = [];
  for (const s of sources) snapshots.push({ source: s.source, status: s.status,
    ...(s.raw === undefined ? {} : { hash: await requestDigest(s.raw) }) });
  return { items, batch: { kind: "batch", id: LEGACY_MIGRATION_ID, state: "discovered",
    itemIds: items.map(i => i.id), sources: snapshots, issues } };
};
