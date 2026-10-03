// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileMocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  nativeFileShare: true,
  pluginAvailable: true,
  share: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  getUri: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => fileMocks.nativeFileShare, getPlatform: () => "ios", isPluginAvailable: () => fileMocks.pluginAvailable },
  registerPlugin: () => ({ shareFiles: fileMocks.share }),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: {
    deleteFile: fileMocks.deleteFile,
    writeFile: fileMocks.writeFile,
    appendFile: fileMocks.appendFile,
    getUri: fileMocks.getUri,
    stat: fileMocks.stat,
  },
}));

import { shareBlobWithNativeSheet, shareBlobsWithNativeSheet, shareGeneratedFilesWithNativeSheet } from "./files";

describe("native file sharing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    fileMocks.nativeFileShare = true;
    fileMocks.pluginAvailable = true;
    fileMocks.deleteFile.mockReset().mockResolvedValue(undefined);
    fileMocks.share.mockReset().mockResolvedValue({ status: "shared" });
    fileMocks.writeFile.mockReset().mockResolvedValue({
      uri: "file://cache/export.pdf",
    });
    fileMocks.appendFile.mockReset().mockResolvedValue(undefined);
    fileMocks.getUri.mockReset().mockImplementation(async ({ path }: { path: string }) => ({ uri: `file://cache/${path}` }));
    fileMocks.stat.mockReset();
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
        files: [{ path: "file://cache/export.pdf", mimeType: "application/pdf", fileName: "犬山_2026_隊列_.pdf" }],
      }),
    );
    expect(fileMocks.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "exports/1234-犬山_2026_隊列_.pdf",
      }),
    );
  });

  it("treats user cancellation as a normal result and still cleans up", async () => {
    fileMocks.share.mockResolvedValue({ status: "cancelled" });

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
    if (scenario === "cancel") fileMocks.share.mockResolvedValue({ status: "cancelled" });
    if (scenario === "failure") fileMocks.share.mockRejectedValue(new Error("failed"));
    const result = shareBlobsWithNativeSheet({ files: [{ blob: new Blob(["one"], { type: "image/png" }), fileName: "one.png" }, { blob: new Blob(["two"], { type: "image/png" }), fileName: "two.png" }] });
    if (scenario === "failure") await expect(result).rejects.toThrow("failed");
    else await expect(result).resolves.toBe(scenario === "cancel" ? "cancelled" : "shared");
    expect(fileMocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: [
      { path: "file://one", mimeType: "image/png", fileName: "one.png" },
      { path: "file://two", mimeType: "image/png", fileName: "two.png" },
    ] }));
    expect(fileMocks.deleteFile).toHaveBeenCalledTimes(2);
  });
  it("cleans up earlier and partially written files when writing fails midway", async () => {
    fileMocks.writeFile.mockResolvedValueOnce({ uri: "file://one" }).mockRejectedValueOnce(new Error("write failed"));
    await expect(shareBlobsWithNativeSheet({ files: [{ blob: new Blob(["one"]), fileName: "one.png" }, { blob: new Blob(["two"]), fileName: "two.png" }] })).rejects.toThrow("write failed");
    expect(fileMocks.share).not.toHaveBeenCalled(); expect(fileMocks.deleteFile).toHaveBeenCalledTimes(2);
  });

  it("stages generated files sequentially with bounded base64 and cleans all paths after sharing", async () => {
    const order: string[] = [];
    fileMocks.appendFile.mockImplementation(async () => { order.push("append"); });
    fileMocks.stat.mockResolvedValueOnce({ size: 400 * 1024 }).mockResolvedValueOnce({ size: 8 });
    async function* files() {
      yield { blob: new Blob([new Uint8Array(400 * 1024)], { type: "application/zip" }), fileName: "part-1.zip" };
      order.push("next");
      yield { blob: new Blob(["manifest"], { type: "application/json" }), fileName: "set.manifest.json" };
    }
    expect(await shareGeneratedFilesWithNativeSheet(files())).toBe("shared");
    expect(order).toEqual(["append", "append", "next"]);
    expect(fileMocks.writeFile).toHaveBeenCalledTimes(2);
    for (const [request] of [...fileMocks.writeFile.mock.calls, ...fileMocks.appendFile.mock.calls]) expect(request.data.length).toBeLessThanOrEqual(192 * 1024 / 3 * 4);
    expect(fileMocks.share.mock.calls[0][0].files).toHaveLength(2); expect(fileMocks.deleteFile).toHaveBeenCalledTimes(2);
  });
  it("cleans partial staging when a chunk fails and releases the share guard", async () => {
    fileMocks.appendFile.mockRejectedValueOnce(new Error("no space"));
    fileMocks.stat.mockResolvedValue({ size: 200 * 1024 });
    async function* files() { yield { blob: new Blob([new Uint8Array(200 * 1024)]), fileName: "large.zip" }; }
    await expect(shareGeneratedFilesWithNativeSheet(files())).rejects.toThrow("no space");
    expect(fileMocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(fileMocks.share).not.toHaveBeenCalled();
    expect(await shareGeneratedFilesWithNativeSheet(files())).toBe("shared");
  });
  it("rejects a missing plugin without writing or falling back to file-URL sharing", async () => {
    fileMocks.pluginAvailable = false;
    await expect(shareBlobWithNativeSheet({ blob: new Blob(["image"]), fileName: "one.png" })).rejects.toThrow("共有機能が見つかりません");
    expect(fileMocks.writeFile).not.toHaveBeenCalled(); expect(fileMocks.share).not.toHaveBeenCalled();
  });
  it("blocks concurrent calls until completion and cleanup, then permits retry", async () => {
    let finish!: (value: { status: "shared" }) => void;
    fileMocks.share.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const request = { blob: new Blob(["image"], { type: "image/png" }), fileName: "one.png" };
    const first = shareBlobWithNativeSheet(request);
    await expect(shareBlobWithNativeSheet(request)).rejects.toThrow("進行中");
    await vi.waitFor(() => expect(fileMocks.share).toHaveBeenCalledTimes(1));
    finish({ status: "shared" }); await first;
    await expect(shareBlobWithNativeSheet(request)).resolves.toBe("shared");
    expect(fileMocks.deleteFile).toHaveBeenCalledTimes(2);
  });
  it("rejects an invalid native result and still removes its files", async () => {
    fileMocks.share.mockResolvedValue({ status: "unknown" });
    await expect(shareBlobWithNativeSheet({ blob: new Blob(["pdf"]), fileName: "one.pdf" })).rejects.toThrow("共有結果");
    expect(fileMocks.deleteFile).toHaveBeenCalledTimes(1);
  });
});
