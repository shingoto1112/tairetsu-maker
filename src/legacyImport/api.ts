import type { CloudConfig } from "../cloud/config";
import { cloudAuthIdentity, getValidCloudAuthSession } from "../cloud/session";
import { LegacyImportError, object, uuid } from "./validation";
export type LegacyCursor = { createdAt: string; projectId: string };
export type LegacyListItem = { projectId: string; title: string; mode: "stage" | "parade"; schemaVersion: number; createdAt: string; hidden: boolean };
export type LegacyPage = { contractVersion: 1; items: LegacyListItem[]; nextCursor: LegacyCursor | null; exportUntil: string };
export interface LegacyExportApi { list(cursor?: LegacyCursor, signal?: AbortSignal): Promise<LegacyPage>; export(projectId: string, signal?: AbortSignal): Promise<unknown>; }
export const legacyFailureMessage = (e: unknown): string => {
  if (e instanceof LegacyImportError) return e.message;
  if (object(e) && e.name === "AbortError") return "中断しました。再開できます。";
  const code = object(e) ? e.code : null;
  return code === "QUOTA_EXCEEDED" ? "端末の空き容量が不足しています。" : code === "ACCESS_DENIED" ? "保存領域へのアクセスが拒否されました。"
    : code === "CONFLICT" ? "別の画面で処理中です。再試行してください。" : code === "CORRUPT" ? "保存結果または台帳が不正です。この文書の処理を停止しました。"
    : "取得または端末保存に失敗しました。通信と保存領域を確認して再試行してください。";
};
const errors: Record<string, string> = {
  LEGACY_EXPORT_EXPIRED: "旧クラウドの取り込み期限が終了しました。端末の下書きやZIPは引き続き救出できます。",
  PERMANENT_ACCOUNT_REQUIRED: "旧クラウドで使ったアカウントにログインしてください。ゲストでは取り込めません。",
  LEGACY_PROJECT_UNAVAILABLE: "所有者として取得できない文書です（削除済みの文書を含みます）。",
  LEGACY_EXPORT_INCOMPLETE: "旧クラウドのresourceが欠けています。管理者に救出を依頼してください。",
  LEGACY_EXPORT_TOO_LARGE: "旧文書が取り込み上限を超えています。管理者による救出が必要です。",
};
/** Bound bytes before JSON allocation; never fetch attachments/URLs from content. */
async function boundedJson(response: Response, max: number) {
  if (!response.body) throw new LegacyImportError("INVALID_RESPONSE", "応答本文がありません。");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
      if (size > max) throw new LegacyImportError("TOO_LARGE", errors.LEGACY_EXPORT_TOO_LARGE); chunks.push(part.value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new LegacyImportError("INVALID_RESPONSE", "応答JSONが不正です。"); }
}
export function validateLegacyPage(v: unknown): LegacyPage {
  const validDate = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
  if (!object(v) || v.contractVersion !== 1 || !Array.isArray(v.items) || v.items.length > 20 || !validDate(v.exportUntil))
    throw new LegacyImportError("EXPORT_UPGRADE_REQUIRED", "取り込み一覧の契約が未対応です。11bの一覧migrationを適用してください。");
  const ids = new Set<string>();
  for (const row of v.items) {
    if (!object(row)) throw new LegacyImportError("INVALID_RESPONSE", "一覧項目が不正です。"); uuid(row.projectId, "一覧ID");
    if (ids.has(row.projectId as string) || typeof row.title !== "string" || !["stage", "parade"].includes(row.mode as string) ||
      !Number.isSafeInteger(row.schemaVersion) || typeof row.hidden !== "boolean" || !validDate(row.createdAt)) throw new LegacyImportError("INVALID_RESPONSE", "一覧項目が不正です。");
    ids.add(row.projectId as string);
  }
  if (v.nextCursor !== null) {
    if (!object(v.nextCursor) || !validDate(v.nextCursor.createdAt)) throw new LegacyImportError("INVALID_RESPONSE", "一覧cursorが不正です。");
    uuid(v.nextCursor.projectId, "cursor ID");
    const last = v.items[v.items.length - 1];
    if (!last || last.projectId !== v.nextCursor.projectId || last.createdAt !== v.nextCursor.createdAt) throw new LegacyImportError("INVALID_RESPONSE", "一覧cursorが末尾と一致しません。");
  }
  return v as unknown as LegacyPage;
}
/** Uses the existing Auth owner/epoch. Captured account cannot silently switch. */
export function createLegacyExportApi(config: CloudConfig, accountId: string): LegacyExportApi {
  const epoch = cloudAuthIdentity().epoch;
  const valid = () => cloudAuthIdentity().epoch === epoch && cloudAuthIdentity().accountId === accountId;
  const rpc = async (name: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
    if (!valid()) throw new LegacyImportError("ACCOUNT_CHANGED", "ログイン状態が変わりました。一覧を取得し直してください。");
    const session = await getValidCloudAuthSession(config);
    if (!valid() || !session || session.user.id !== accountId || (session as typeof session & { collaborationGuest?: boolean }).collaborationGuest) throw new LegacyImportError("ACCOUNT_CHANGED", errors.PERMANENT_ACCOUNT_REQUIRED);
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, { method: "POST", signal, headers: {
      apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await boundedJson(response, response.ok ? 8 * 1024 * 1024 : 64 * 1024);
    if (!valid()) throw new LegacyImportError("ACCOUNT_CHANGED", "ログイン状態が変わりました。一覧を取得し直してください。");
    if (!response.ok) { const code = object(data) && typeof data.message === "string" ? data.message : "HTTP_ERROR";
      throw new LegacyImportError(code, errors[code] ?? "旧クラウドから取得できませんでした。再試行してください。"); }
    return data;
  };
  return { list: async (cursor, signal) => validateLegacyPage(await rpc("legacy_list_owned_projects", {
    p_limit: 20, p_before_created_at: cursor?.createdAt ?? null, p_before_project_id: cursor?.projectId ?? null }, signal)),
  export: (projectId, signal) => { uuid(projectId, "文書ID"); return rpc("legacy_export_project", { p_project_id: projectId }, signal); } };
}
