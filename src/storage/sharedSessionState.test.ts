import { describe, expect, it } from "vitest";
import { sessionSnapshot, sessionTone } from "./sharedSessionState";
import type { ProviderState } from "../collaboration/provider";
import { RepositoryError } from "../repositories/types";
const provider: ProviderState = { online: true, realtimeConnected: true, syncing: false, pending: 0, held: false, cursor: "0", error: null,
  sharing: "active", credentialConfirmed: true, pullConfirmed: true };
const saved = { id: "a", localRevision: "1", persistedRevision: "1", dirty: false, saving: false, error: null };
describe("session sync status", () => {
  it("requires durable local edits, verified credential and successful pull", () => {
    expect(sessionSnapshot("a", provider, saved, null).sync).toBe("同期済み");
    for (const patch of [{ credentialConfirmed: false }, { pullConfirmed: false }, { error: { kind: "network" as const, code: "PULL_FAILED" } }])
      expect(sessionSnapshot("a", { ...provider, ...patch }, saved, null).sync).toBe("接続を確認中");
    expect(sessionSnapshot("a", { ...provider, held: true }, saved, null).sync).toBe("資格保留");
    expect(sessionSnapshot("a", { ...provider, syncing: true }, saved, null).sync).toBe("接続を確認中");
    expect(sessionSnapshot("a", provider, { ...saved, dirty: true }, null).sync).toBe("送信待ち");
    expect(sessionSnapshot("a", provider, { ...saved, dirty: true }, null).label).toBe("端末に保存中");
    expect(sessionSnapshot("a", provider, { ...saved, saving: true }, null).label).toBe("端末に保存中");
    expect(sessionSnapshot("a", { ...provider, pending: 2 }, saved, null).label).toBe("送信待ち 2 件");
    expect(sessionSnapshot("a", { ...provider, pending: 2 }, { ...saved, dirty: true }, null).label).toBe("送信待ち 2 件（端末保存中）");
  });
  it("uses plain sharing labels and reserves green for fully synced active documents", () => {
    for (const [sharing, label] of [["removed", "共有から外れました"], ["ended", "共有は終了しました"], ["auth-required", "ログインが必要です"], ["membership-changed", "参加し直しが必要です"]] as const) {
      const state = sessionSnapshot("a", { ...provider, sharing }, saved, null);
      expect(state.label).toBe(label); expect(sessionTone(state)).toBe("warning");
    }
    expect(sessionTone(sessionSnapshot("a", provider, saved, null))).toBe("success");
    for (const patch of [{ online: false }, { pending: 2 }, { held: true }, { pullConfirmed: false }])
      expect(sessionTone(sessionSnapshot("a", { ...provider, ...patch }, saved, null))).toBe("neutral");
    const failed = sessionSnapshot("a", provider, { ...saved, error: new RepositoryError("IO_ERROR") }, null);
    expect(failed.label).toBe("保存失敗"); expect(sessionTone(failed)).toBe("warning");
  });
});
