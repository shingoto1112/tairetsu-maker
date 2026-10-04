// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAuthSession } from "./auth";
import { createParticipantAuth } from "../collaboration/guestAuth";
const native = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), clear: vi.fn() }));
vi.mock("../platform/secureSession", () => ({ readNativeSecureSession: native.read, writeNativeSecureSession: native.write, clearNativeSecureSession: native.clear }));
import { clearCloudAuthSession, cloudAuthIdentity, hydrateCloudAuthSessionFromNativeStorage, readCloudAuthSession,
  refreshOwnedCloudAuthSession, saveCloudAuthSession, waitCloudAuthPersistence } from "./session";
const session = (id = "account-a"): CloudAuthSession => ({ accessToken: "access", refreshToken: "refresh", expiresAt: 0, tokenType: "bearer", user: { id } });
describe("single authentication owner", () => {
  beforeEach(async () => {
    native.write.mockResolvedValue(undefined); native.clear.mockResolvedValue(undefined); native.read.mockResolvedValue(null);
    clearCloudAuthSession(); await waitCloudAuthPersistence(); vi.clearAllMocks();
  });
  it("coalesces refresh across consumers and rejects replies after logout", async () => {
    saveCloudAuthSession(session());
    let reply!: (value: CloudAuthSession) => void;
    const refresh = vi.fn(() => new Promise<CloudAuthSession>(resolve => { reply = resolve; }));
    const first = refreshOwnedCloudAuthSession(session(), refresh), second = refreshOwnedCloudAuthSession(session(), refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    clearCloudAuthSession(); reply({ ...session(), accessToken: "late" });
    await expect(first).rejects.toThrow(); await expect(second).rejects.toThrow(); expect(readCloudAuthSession()).toBeNull();
  });
  it("waits for ordered Keychain save then delete", async () => {
    let saved!: () => void;
    native.write.mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve; }));
    saveCloudAuthSession(session()); await Promise.resolve(); await Promise.resolve();
    clearCloudAuthSession(); expect(readCloudAuthSession()).toBeNull(); expect(native.clear).not.toHaveBeenCalled();
    saved(); await waitCloudAuthPersistence(); expect(native.clear).toHaveBeenCalledTimes(1);
  });
  it("reports restoration and blocks native reply after account switch", async () => {
    let reply!: (value: string) => void;
    native.read.mockImplementationOnce(() => new Promise<string>(resolve => { reply = resolve; }));
    const hydration = hydrateCloudAuthSessionFromNativeStorage(); expect(cloudAuthIdentity().status).toBe("restoring");
    await Promise.resolve(); await Promise.resolve(); saveCloudAuthSession(session("account-b"));
    reply(JSON.stringify(session())); await hydration;
    expect(readCloudAuthSession()?.user.id).toBe("account-b"); expect(cloudAuthIdentity().status).toBe("signed-in");
  });
  it("guest logout clears mirror and common credentials before a failed remote logout", async () => {
    saveCloudAuthSession({ ...session("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), collaborationGuest: true } as CloudAuthSession);
    expect(localStorage.getItem("tairetsu.collaboration.guestSession.v1")).toBeTruthy();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    try {
      const auth = createParticipantAuth({ url: "http://127.0.0.1:9999", anonKey: "mock" }, "web");
      const logout = auth.signOut(new AbortController().signal);
      expect(readCloudAuthSession()).toBeNull(); expect(localStorage.getItem("tairetsu.collaboration.guestSession.v1")).toBeNull();
      await expect(logout).rejects.toThrow("offline"); await waitCloudAuthPersistence(); expect(native.clear).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
