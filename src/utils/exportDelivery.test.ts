// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../platform/runtime", () => ({ getAppFeatureFlags: () => ({ nativeFileShare: false }) }));
vi.mock("../platform/files", () => ({ shareBlobsWithNativeSheet: vi.fn() }));
vi.mock("./fileSave", () => ({ saveGeneratedBlob: vi.fn() }));
import { canShareExportFiles, shareExportFiles } from "./exportDelivery";
import { saveGeneratedBlob } from "./fileSave";
const files = [new File(["one"], "1.png", { type: "image/png" }), new File(["two"], "2.png", { type: "image/png" })];
describe("Web export delivery", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("uses canShare with the actual file array on any supported device and calls share synchronously", async () => {
    const share = vi.fn().mockResolvedValue(undefined), canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare, userAgent: "Android" });
    expect(canShareExportFiles(files)).toBe(true);
    const result = shareExportFiles(files, "名簿");
    expect(share).toHaveBeenCalledExactlyOnceWith({ files, title: "名簿" });
    await expect(result).resolves.toBe("shared"); expect(canShare).toHaveBeenCalledWith({ files });
  });
  it("does not download on cancellation, unsupported share or failure", async () => {
    const share = vi.fn().mockRejectedValueOnce(new DOMException("cancel", "AbortError")).mockRejectedValueOnce(new Error("failure"));
    const canShare = vi.fn().mockReturnValue(true); vi.stubGlobal("navigator", { share, canShare });
    await expect(shareExportFiles(files, "名簿")).resolves.toBe("cancelled");
    await expect(shareExportFiles(files, "名簿")).rejects.toThrow("failure");
    canShare.mockReturnValue(false);
    await expect(shareExportFiles(files, "名簿")).resolves.toBe("unsupported");
    expect(share).toHaveBeenCalledTimes(2); expect(saveGeneratedBlob).not.toHaveBeenCalled();
  });
});
