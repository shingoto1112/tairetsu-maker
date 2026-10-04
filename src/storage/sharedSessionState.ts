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
  error?: { kind: string; code: string } | null;
};
export function sessionSnapshot(localId: string, provider: ProviderState | null, save: SaveState | null, history: HistoryResult | null): SharedSessionSnapshot {
  const pending = provider?.pending ?? 0;
  const sync = save?.error || provider?.error?.kind === "storage" ? "保存失敗" :
    !provider || provider.held || ["auth-required", "membership-changed", "removed", "ended"].includes(provider.sharing) ? "資格保留" :
    !provider.online ? "オフライン" : provider.error || !provider.credentialConfirmed || !provider.pullConfirmed ? "接続を確認中" :
    pending || save?.dirty || save?.saving ? "送信待ち" : provider.syncing ? "接続を確認中" : "同期済み";
  return { localId, sharing: provider?.sharing ?? "auth-required", sync, pending,
    label: sync === "送信待ち" ? `送信待ち ${pending} 件${save?.dirty ? "（端末保存中）" : ""}` : sync, history,
    error: save?.error ? { kind: "storage", code: save.error.code } : provider?.error ?? null };
}
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
