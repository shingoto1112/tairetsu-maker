import { beforeEach, describe, expect, it, vi } from "vitest";

const secureMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  isIPadNativeApp: vi.fn(() => true),
  removeItem: vi.fn(),
  setDefaultKeychainAccess: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("./runtime", () => ({
  isIPadNativeApp: secureMocks.isIPadNativeApp,
}));

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  KeychainAccess: { whenUnlockedThisDeviceOnly: "device-only" },
  SecureStorage: {
    getItem: secureMocks.getItem,
    removeItem: secureMocks.removeItem,
    setDefaultKeychainAccess: secureMocks.setDefaultKeychainAccess,
    setItem: secureMocks.setItem,
  },
}));

const loadStorage = async () => {
  vi.resetModules();
  return import("./secureSession");
};

describe("native secure session storage", () => {
  beforeEach(() => {
    secureMocks.isIPadNativeApp.mockReturnValue(true);
    secureMocks.getItem.mockReset().mockResolvedValue("stored-session");
    secureMocks.removeItem.mockReset().mockResolvedValue(undefined);
    secureMocks.setItem.mockReset().mockResolvedValue(undefined);
    secureMocks.setDefaultKeychainAccess.mockReset().mockResolvedValue(undefined);
  });

  it("uses the device-only Keychain and initializes it once", async () => {
    const storage = await loadStorage();

    await expect(storage.readNativeSecureSession()).resolves.toBe(
      "stored-session",
    );
    await storage.writeNativeSecureSession("next-session");
    await storage.clearNativeSecureSession();

    expect(secureMocks.setDefaultKeychainAccess).toHaveBeenCalledTimes(1);
    expect(secureMocks.setDefaultKeychainAccess).toHaveBeenCalledWith(
      "device-only",
    );
    expect(secureMocks.setItem).toHaveBeenCalledWith(
      "tairetsu.cloud.authSession",
      "next-session",
    );
    expect(secureMocks.removeItem).toHaveBeenCalledWith(
      "tairetsu.cloud.authSession",
    );
  });

  it("allows a retry after a temporary Keychain initialization failure", async () => {
    secureMocks.setDefaultKeychainAccess
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce(undefined);
    const storage = await loadStorage();

    await expect(storage.readNativeSecureSession()).rejects.toThrow(
      "temporarily unavailable",
    );
    await expect(storage.readNativeSecureSession()).resolves.toBe(
      "stored-session",
    );

    expect(secureMocks.setDefaultKeychainAccess).toHaveBeenCalledTimes(2);
  });

  it("does not access Keychain in Web or Tauri runtimes", async () => {
    secureMocks.isIPadNativeApp.mockReturnValue(false);
    const storage = await loadStorage();

    await expect(storage.readNativeSecureSession()).resolves.toBeNull();
    await storage.writeNativeSecureSession("web-session");
    await storage.clearNativeSecureSession();

    expect(secureMocks.setDefaultKeychainAccess).not.toHaveBeenCalled();
    expect(secureMocks.setItem).not.toHaveBeenCalled();
    expect(secureMocks.removeItem).not.toHaveBeenCalled();
  });
});
