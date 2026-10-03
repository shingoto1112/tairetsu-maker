/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ pickAudioFile: vi.fn(), isNative: vi.fn(() => true), runtime: vi.fn(() => "capacitor-ios") }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: native.isNative }, registerPlugin: () => native }));
vi.mock("./runtime", () => ({ getAppRuntime: native.runtime }));
import { AUDIO_FILE_ACCEPT, MAX_AUDIO_FILE_BYTES, validateAudioFile, pickNativeAudioFile, canUseNativeAudioPicker } from "./audioPicker";
const meta = { id: "audio-1", name: "song.m4a", type: "audio/mp4", size: 5, duration: 12 };
beforeEach(() => {
  native.pickAudioFile.mockReset(); native.isNative.mockReturnValue(true); native.runtime.mockReturnValue("capacitor-ios");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
describe("audio picker", () => {
  it("advertises only document audio extensions", () => {
    expect(AUDIO_FILE_ACCEPT).not.toContain("audio/*"); expect(AUDIO_FILE_ACCEPT).toContain(".m4a");
  });
  it("accepts supported web files", () => expect(validateAudioFile(new File(["a"], "song.M4A"))).toBeNull());
  it("rejects invalid web files", () => {
    expect(validateAudioFile(new File(["a"], "song.mov"))).toContain("音源を選択");
    expect(validateAudioFile(new File([], "empty.mp3"))).toContain("空");
    const file = new File(["a"], "large.mp3"); Object.defineProperty(file, "size", { value: MAX_AUDIO_FILE_BYTES + 1 });
    expect(validateAudioFile(file)).toContain("200MB以下");
  });
  it.each([
    { ...meta, name: "bad.flac" }, { ...meta, size: MAX_AUDIO_FILE_BYTES + 1 },
    { ...meta, size: 0 }, { ...meta, size: NaN }, { ...meta, size: undefined }, { ...meta, name: undefined },
  ])("rejects invalid native metadata without reading bytes: %j", async audio => {
    native.pickAudioFile.mockResolvedValue({ audio });
    await expect(pickNativeAudioFile()).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("propagates native copy/commit errors without byte transfer", async () => {
    native.pickAudioFile.mockRejectedValue(new Error("NO_SPACE"));
    await expect(pickNativeAudioFile()).rejects.toThrow("NO_SPACE"); expect(fetch).not.toHaveBeenCalled();
  });
  it("returns saved metadata and duration without fetch or File allocation", async () => {
    native.pickAudioFile.mockResolvedValue({ audio: meta });
    expect(await pickNativeAudioFile()).toEqual(meta); expect(fetch).not.toHaveBeenCalled();
  });
  it("discards native URI fields", async () => {
    native.pickAudioFile.mockResolvedValue({ audio: { ...meta, uri: "file:///secret" } });
    expect(await pickNativeAudioFile()).toEqual(meta);
  });
  it("rejects missing native result", async () => {
    native.pickAudioFile.mockResolvedValue({}); await expect(pickNativeAudioFile()).rejects.toThrow();
  });
  it("does nothing on cancellation", async () => {
    native.pickAudioFile.mockResolvedValue({ cancelled: true }); await expect(pickNativeAudioFile()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses web picker in non-native iPad reproduction and Web/Windows", async () => {
    native.isNative.mockReturnValue(false); expect(canUseNativeAudioPicker()).toBe(false);
    await expect(pickNativeAudioFile()).rejects.toThrow("ネイティブ");
    native.isNative.mockReturnValue(true); native.runtime.mockReturnValue("web"); expect(canUseNativeAudioPicker()).toBe(false);
    native.runtime.mockReturnValue("tauri"); expect(canUseNativeAudioPicker()).toBe(false);
    expect(native.pickAudioFile).not.toHaveBeenCalled();
  });
});
