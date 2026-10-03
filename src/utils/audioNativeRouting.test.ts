/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ save: vi.fn(), blob: vi.fn(), url: vi.fn() }));
vi.mock("../platform", () => ({
  canUseNativeAudioStorage: () => true,
  validateNativeAudioMeta: (meta: unknown) => meta,
  saveNativeAudioBlob: native.save, loadNativeAudioBlob: native.blob, resolveNativeAudioURL: native.url,
}));
import { loadAudioBlobFromIndexedDb, resolveAudioPlaybackURL, saveAudioBlobToIndexedDb, saveAudioFileToIndexedDb } from "./audioStorage";
const meta = { id: "audio-existing", name: "song.mp3", type: "audio/mpeg", size: 5, duration: 2 };
beforeEach(() => { vi.clearAllMocks(); native.save.mockResolvedValue(meta); native.url.mockResolvedValue("capacitor://localhost/_capacitor_file_/key.mp3"); });
describe("iPad audio routing", () => {
  it("adopts picker metadata without saving bytes a second time", async () => {
    expect(await saveAudioFileToIndexedDb(meta)).toEqual(meta);
    expect(native.save).not.toHaveBeenCalled(); expect(native.blob).not.toHaveBeenCalled();
  });
  it("restores directly by ID and sends metadata for lazy migration", async () => {
    expect(await resolveAudioPlaybackURL(meta)).toContain("key.mp3");
    expect(native.url).toHaveBeenCalledWith(meta.id, meta); expect(native.blob).not.toHaveBeenCalled();
  });
  it("routes ZIP import to native upload and ZIP export to native Blob API", async () => {
    const blob = new Blob(["audio"], { type: meta.type }); native.blob.mockResolvedValue(blob);
    expect(await saveAudioBlobToIndexedDb(blob, meta)).toEqual(meta);
    expect(native.save).toHaveBeenCalledWith(expect.any(String), expect.any(File), meta.type, meta.name, meta.duration);
    expect(await loadAudioBlobFromIndexedDb(meta.id, meta)).toBe(blob);
    expect(native.blob).toHaveBeenCalledWith(meta.id, meta);
  });
});
