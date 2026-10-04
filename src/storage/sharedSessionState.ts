import type { ProviderState } from "../collaboration/provider";
import type { HistoryResult } from "../collaboration/commands";
import type { SaveState } from "./saveCoordinator";

export type SharedSessionSnapshot = {
  localId: string | null;
  sharing: ProviderState["sharing"];
  sync: "接続を確認中" | "同期済み" | "送信待ち" | "オフライン" | "保存失敗" | "資格保留";
  pending: number;
  label: string;
  history: HistoryResult | null;
  historyEvent?: number;
  error?: { kind: string; code: string } | null;
};
export function sessionSnapshot(localId: string, provider: ProviderState | null, save: SaveState | null, history: HistoryResult | null): SharedSessionSnapshot {
  const pending = provider?.pending ?? 0;
  const sync = save?.error || provider?.error?.kind === "storage" ? "保存失敗" :
    !provider || provider.held || ["auth-required", "membership-changed", "removed", "ended"].includes(provider.sharing) ? "資格保留" :
    !provider.online ? "オフライン" : provider.error || !provider.credentialConfirmed || !provider.pullConfirmed ? "接続を確認中" :
    pending || save?.dirty || save?.saving ? "送信待ち" : provider.syncing ? "接続を確認中" : "同期済み";
  const sharing = provider?.sharing ?? "auth-required";
  const sharingLabels = { removed: "共有から外れました", ended: "共有は終了しました", "auth-required": "ログインが必要です", "membership-changed": "参加し直しが必要です" };
  const label = sync === "保存失敗" ? sync : sharing !== "active" ? sharingLabels[sharing] :
    sync === "資格保留" ? "接続を確認中" : sync === "送信待ち" ? `送信待ち ${pending} 件${save?.dirty ? "（端末保存中）" : ""}` : sync;
  return { localId, sharing, sync, pending, label, history,
    error: save?.error ? { kind: "storage", code: save.error.code } : provider?.error ?? null };
}
export const sessionTone = (snapshot: SharedSessionSnapshot): "success" | "neutral" | "warning" =>
  snapshot.sync === "保存失敗" || snapshot.sharing !== "active" ? "warning" : snapshot.sync === "同期済み" ? "success" : "neutral";
/** Status-only subscriptions never require a Project/Canvas render. */
export class SharedSessionStore {
  private value: SharedSessionSnapshot = { localId: null, sharing: "active", sync: "接続を確認中", pending: 0, label: "接続を確認中", history: null };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(value: SharedSessionSnapshot) {
    if (JSON.stringify(value) === JSON.stringify(this.value)) return;
    this.value = value; for (const listener of this.listeners) listener();
  }
}
