// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileMocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  nativeFileShare: true,
  share: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("./runtime", () => ({
  getAppFeatureFlags: () => ({
    collaboration: false,
    nativeFileShare: fileMocks.nativeFileShare,
    personalCloud: true,
  }),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: {
    deleteFile: fileMocks.deleteFile,
    writeFile: fileMocks.writeFile,
  },
}));

vi.mock("@capacitor/share", () => ({
  Share: { share: fileMocks.share },
}));

import { shareBlobWithNativeSheet, shareBlobsWithNativeSheet } from "./files";

describe("native file sharing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    fileMocks.nativeFileShare = true;
    fileMocks.deleteFile.mockReset().mockResolvedValue(undefined);
    fileMocks.share.mockReset().mockResolvedValue(undefined);
    fileMocks.writeFile.mockReset().mockResolvedValue({
      uri: "file://cache/export.pdf",
    });
    vi.spyOn(Date, "now").mockReturnValue(1234);
  });

  it("sanitizes the file name, shares it, and removes the cache file", async () => {
    const result = await shareBlobWithNativeSheet({
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      fileName: " 犬山 2026/隊列?.pdf ",
    });

    expect(result).toBe("shared");
    expect(fileMocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "exports/1234-犬山_2026_隊列_.pdf",
      }),
    );
    expect(fileMocks.share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: ["file://cache/export.pdf"],
      }),
    );
    expect(fileMocks.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "exports/1234-犬山_2026_隊列_.pdf",
      }),
    );
  });

  it("treats user cancellation as a normal result and still cleans up", async () => {
    fileMocks.share.mockRejectedValue(new DOMException("cancelled", "AbortError"));

    await expect(
      shareBlobWithNativeSheet({
        blob: new Blob(["image"], { type: "image/png" }),
        fileName: "scene.png",
      }),
    ).resolves.toBe("cancelled");

    expect(fileMocks.deleteFile).toHaveBeenCalled();
  });

  it("rejects use outside the iPad runtime", async () => {
    fileMocks.nativeFileShare = false;

    await expect(
      shareBlobWithNativeSheet({
        blob: new Blob(["data"]),
        fileName: "data.bin",
      }),
    ).rejects.toThrow("iPadアプリでのみ");
  });

  it.each(["success", "cancel", "failure"])("cleans up every file after multi-file %s", async (scenario) => {
    fileMocks.writeFile.mockResolvedValueOnce({ uri: "file://one" }).mockResolvedValueOnce({ uri: "file://two" });
    if (scenario === "cancel") fileMocks.share.mockRejectedValue(new DOMException("cancel", "AbortError"));
    if (scenario === "failure") fileMocks.share.mockRejectedValue(new Error("failed"));
    const result = shareBlobsWithNativeSheet({ files: [{ blob: new Blob(["one"]), fileName: "one.png" }, { blob: new Blob(["two"]), fileName: "two.png" }] });
    if (scenario === "failure") await expect(result).rejects.toThrow("failed");
    else await expect(result).resolves.toBe(scenario === "cancel" ? "cancelled" : "shared");
    expect(fileMocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: ["file://one", "file://two"] }));
    expect(fileMocks.deleteFile).toHaveBeenCalledTimes(2);
  });
  it("cleans up earlier and partially written files when writing fails midway", async () => {
    fileMocks.writeFile.mockResolvedValueOnce({ uri: "file://one" }).mockRejectedValueOnce(new Error("write failed"));
    await expect(shareBlobsWithNativeSheet({ files: [{ blob: new Blob(["one"]), fileName: "one.png" }, { blob: new Blob(["two"]), fileName: "two.png" }] })).rejects.toThrow("write failed");
    expect(fileMocks.share).not.toHaveBeenCalled(); expect(fileMocks.deleteFile).toHaveBeenCalledTimes(2);
  });
});
