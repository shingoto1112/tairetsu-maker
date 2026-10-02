/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ pickAudioFile: vi.fn(), removeTemporaryFile: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, convertFileSrc: (uri: string) => uri },
  registerPlugin: () => native,
}));
vi.mock("./runtime", () => ({ getAppRuntime: () => "capacitor-ios" }));
import {
  AUDIO_FILE_ACCEPT,
  MAX_AUDIO_FILE_BYTES,
  validateAudioFile,
  pickNativeAudioFile,
} from "./audioPicker";

describe("audio picker validation", () => {
  it("only advertises document audio extensions without broad media capture", () => {
    expect(AUDIO_FILE_ACCEPT).not.toContain("audio/*");
    expect(AUDIO_FILE_ACCEPT).not.toContain("video");
    expect(AUDIO_FILE_ACCEPT).toContain(".mp3");
    expect(AUDIO_FILE_ACCEPT).toContain(".m4a");
  });

  it("accepts supported audio files", () => {
    const file = new File(["audio"], "sample.M4A", { type: "audio/mp4" });
    expect(validateAudioFile(file)).toBeNull();
  });

  it("rejects unsupported and oversized files", () => {
    expect(validateAudioFile(new File(["video"], "sample.mov"))).toContain(
      "音源を選択",
    );
    const oversized = new File(["audio"], "large.mp3");
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: MAX_AUDIO_FILE_BYTES + 1,
    });
    expect(validateAudioFile(oversized)).toContain("200MB以下");
  });
});

describe("native audio import lifecycle", () => {
  const uri = "file:///tmp/AudioImports/audio.m4a";
  beforeEach(() => {
    native.pickAudioFile.mockReset();
    native.removeTemporaryFile.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { name: "unsupported.flac", size: 100 },
    { name: "large.m4a", size: MAX_AUDIO_FILE_BYTES + 1 },
    { name: "empty.m4a", size: 0 },
    { name: "invalid.m4a", size: NaN },
    { size: 100 },
  ])("rejects invalid metadata before reading and removes temporary files: %j", async (metadata) => {
    native.pickAudioFile.mockResolvedValue({ uri, ...metadata });
    await expect(pickNativeAudioFile()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(native.removeTemporaryFile).toHaveBeenCalledExactlyOnceWith({ uri });
  });

  it("cleans up when file reading fails", async () => {
    native.pickAudioFile.mockResolvedValue({ uri, name: "audio.m4a", size: 10 });
    vi.mocked(fetch).mockRejectedValue(new Error("read failed"));
    await expect(pickNativeAudioFile()).rejects.toThrow("read failed");
    expect(native.removeTemporaryFile).toHaveBeenCalledExactlyOnceWith({ uri });
  });

  it("returns valid audio even when temporary cleanup fails", async () => {
    native.pickAudioFile.mockResolvedValue({ uri, name: "audio.m4a", size: 5, mimeType: "audio/mp4" });
    vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob(["audio"]) } as Response);
    native.removeTemporaryFile.mockRejectedValue(new Error("cleanup failed"));
    const file = await pickNativeAudioFile();
    expect(file?.name).toBe("audio.m4a");
    expect(file?.size).toBe(5);
    expect(native.removeTemporaryFile).toHaveBeenCalledExactlyOnceWith({ uri });
  });

  it("requests the whole file as a byte range so Capacitor answers media with HTTP 206", async () => {
    native.pickAudioFile.mockResolvedValue({ uri, name: "song.wav", size: 5, mimeType: "audio/wav" });
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 206, blob: async () => new Blob(["audio"]) } as Response);
    const file = await pickNativeAudioFile();
    expect(file?.size).toBe(5);
    expect(fetch).toHaveBeenCalledWith(uri, { headers: { Range: "bytes=0-" } });
  });

  it("accepts a complete status-0 media response from the WebView asset handler", async () => {
    native.pickAudioFile.mockResolvedValue({ uri, name: "おどり.wav", size: 5, mimeType: "audio/wav" });
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 0, blob: async () => new Blob(["audio"]) } as Response);
    const file = await pickNativeAudioFile();
    expect(file?.name).toBe("おどり.wav");
    expect(native.removeTemporaryFile).toHaveBeenCalledExactlyOnceWith({ uri });
  });

  it("rejects HTTP errors and truncated bodies and still removes the temporary file", async () => {
    native.pickAudioFile.mockResolvedValue({ uri, name: "song.mp3", size: 10 });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404, blob: async () => new Blob([]) } as Response);
    await expect(pickNativeAudioFile()).rejects.toThrow("(404)");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 0, blob: async () => new Blob(["short"]) } as Response);
    await expect(pickNativeAudioFile()).rejects.toThrow("最後まで読み込めません");
    expect(native.removeTemporaryFile).toHaveBeenCalledTimes(2);
  });

  it("does not read files when selection is cancelled", async () => {
    native.pickAudioFile.mockResolvedValue({ cancelled: true });
    await expect(pickNativeAudioFile()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(native.removeTemporaryFile).not.toHaveBeenCalled();
  });
});
