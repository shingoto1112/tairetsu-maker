import { describe, expect, it } from "vitest";
import { sessionSnapshot } from "./sharedSessionState";
import type { ProviderState } from "../collaboration/provider";
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
    expect(sessionSnapshot("a", { ...provider, pending: 2 }, saved, null).label).toBe("送信待ち 2 件");
  });
});
