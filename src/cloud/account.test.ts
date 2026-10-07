import { afterEach, expect, it, vi } from "vitest";
import { deleteCurrentAccount } from "./account";
import { ACCOUNT_REQUEST_TIMEOUT_MS } from "./requestTimeout";
const config = { url: "https://unused.invalid", anonKey: "fake" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("aborts deletion and explains the uncertain result after 20 seconds", async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
  const result = expect(deleteCurrentAccount(config, "fake")).rejects.toThrow(/時間切れ.*再試行/);
  await vi.advanceTimersByTimeAsync(ACCOUNT_REQUEST_TIMEOUT_MS);
  await result; expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it("times out during body consumption and clears deadlines on success", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }));
  const result = expect(deleteCurrentAccount(config, "fake")).rejects.toThrow("時間切れ");
  await vi.advanceTimersByTimeAsync(20_000); await result;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ success: true, reason: "DELETED" }] }));
  await expect(deleteCurrentAccount(config, "fake")).resolves.toMatchObject({ success: true });
  expect(vi.getTimerCount()).toBe(0);
});
