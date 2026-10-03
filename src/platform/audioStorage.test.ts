// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  runtime: vi.fn(() => "capacitor-ios"), isNative: vi.fn(() => true),
  resolveAudioURL: vi.fn(), beginAudioUpload: vi.fn(), appendAudioUpload: vi.fn(), finishAudioUpload: vi.fn(), abortAudioUpload: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mock.isNative, convertFileSrc: (uri: string) => `converted:${uri}` }, registerPlugin: () => mock }));
vi.mock("./runtime", () => ({ getAppRuntime: mock.runtime }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Data: "DATA" }, Encoding: { UTF8: "UTF8" }, Filesystem: { readFile: mock.readFile } }));
import { canUseNativeAudioStorage, deleteNativeAudioBlob, loadNativeAudioBlob, resolveNativeAudioURL, saveNativeAudioBlob } from "./audioStorage";
const meta = { id: "old-id", name: "song.mp3", type: "audio/mpeg", size: 5 };
beforeEach(() => {
  vi.clearAllMocks(); mock.runtime.mockReturnValue("capacitor-ios"); mock.isNative.mockReturnValue(true);
  mock.resolveAudioURL.mockResolvedValue({ uri: "file:///v2/key.mp3", size: 5, type: "audio/mpeg" });
  mock.beginAudioUpload.mockResolvedValue({ token: "token" }); mock.appendAudioUpload.mockResolvedValue(undefined);
  mock.finishAudioUpload.mockResolvedValue({ audio: meta }); mock.abortAudioUpload.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
describe("native audio store bridge", () => {
  it("resolves each playback by ID with migration metadata; never fetches", async () => {
    expect(await resolveNativeAudioURL(meta.id, meta)).toBe("converted:file:///v2/key.mp3");
    expect(mock.resolveAudioURL).toHaveBeenCalledWith({ id: meta.id, meta }); expect(fetch).not.toHaveBeenCalled();
  });
  it("returns null for absent IDs", async () => {
    mock.resolveAudioURL.mockResolvedValue({}); await expect(resolveNativeAudioURL("absent")).resolves.toBeNull();
  });
  it("propagates native resolution failures", async () => {
    mock.resolveAudioURL.mockRejectedValue(new Error("DEVICE_LOCKED")); await expect(resolveNativeAudioURL("a")).rejects.toThrow("DEVICE_LOCKED");
  });
  it("exports a verified full-range Blob only on ZIP path", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 206, blob: async () => new Blob(["audio"]) } as Response);
    const blob = await loadNativeAudioBlob(meta.id, meta);
    expect(blob?.size).toBe(5); expect(blob?.type).toBe(meta.type);
    expect(fetch).toHaveBeenCalledWith("converted:file:///v2/key.mp3", { headers: { Range: "bytes=0-" } });
  });
  it("rejects truncated export bytes", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob(["a"]) } as Response);
    await expect(loadNativeAudioBlob(meta.id)).rejects.toThrow("最後まで");
  });
  it("uploads ZIP bytes in bounded ordered chunks then commits", async () => {
    const blob = new Blob([new Uint8Array(192 * 1024 + 5)]);
    mock.finishAudioUpload.mockResolvedValue({ audio: { ...meta, size: blob.size } });
    await saveNativeAudioBlob(meta.id, blob, meta.type, meta.name, 10);
    expect(mock.appendAudioUpload).toHaveBeenCalledTimes(2);
    const calls = mock.appendAudioUpload.mock.calls.map(call => call[0]);
    expect(calls.map(call => call.offset)).toEqual([0, 192 * 1024]);
    expect(calls[0].data.length).toBe(256 * 1024); expect(calls[1].data.length).toBe(8);
    expect(mock.finishAudioUpload).toHaveBeenCalledWith({ token: "token" });
    expect(mock.abortAudioUpload).toHaveBeenCalledWith({ token: "token" });
  });
  it("aborts a failed ZIP transfer without finishing", async () => {
    mock.appendAudioUpload.mockRejectedValue(new Error("NO_SPACE"));
    await expect(saveNativeAudioBlob(meta.id, new Blob(["audio"]), meta.type, meta.name)).rejects.toThrow("NO_SPACE");
    expect(mock.finishAudioUpload).not.toHaveBeenCalled(); expect(mock.abortAudioUpload).toHaveBeenCalledOnce();
  });
  it.each([false, true])("falls back to retained legacy %s-text/binary on migration failure", async text => {
    mock.resolveAudioURL.mockResolvedValue({ legacy: true });
    const raw = text ? btoa("audio") : "audio";
    mock.readFile.mockImplementation(({ path }) => Promise.resolve({ data: path.endsWith(".json") ? JSON.stringify({ type: meta.type }) : btoa(raw) }));
    const restored = await loadNativeAudioBlob(meta.id, meta);
    expect(await restored?.text()).toBe("audio"); expect(fetch).not.toHaveBeenCalled();
    const create = vi.fn(() => "blob:legacy"); vi.stubGlobal("URL", { createObjectURL: create });
    expect(await resolveNativeAudioURL(meta.id, meta)).toBe("blob:legacy");
  });
  it("does not form legacy paths from unsafe IDs", async () => {
    mock.resolveAudioURL.mockResolvedValue({ legacy: true });
    await expect(loadNativeAudioBlob("../escape")).resolves.toBeNull(); expect(mock.readFile).not.toHaveBeenCalled();
  });
  it("keeps native audio on delete", async () => { await deleteNativeAudioBlob(meta.id); expect(mock.readFile).not.toHaveBeenCalled(); });
  it("does not call native plugin in web or non-native iPad reproduction", async () => {
    mock.isNative.mockReturnValue(false); expect(canUseNativeAudioStorage()).toBe(false);
    expect(await loadNativeAudioBlob(meta.id)).toBeNull(); expect(await resolveNativeAudioURL(meta.id)).toBeNull();
    mock.isNative.mockReturnValue(true); mock.runtime.mockReturnValue("web"); expect(canUseNativeAudioStorage()).toBe(false);
    expect(mock.resolveAudioURL).not.toHaveBeenCalled();
  });
});
