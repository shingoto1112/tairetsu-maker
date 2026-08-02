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

import { shareBlobWithNativeSheet } from "./files";

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
});
