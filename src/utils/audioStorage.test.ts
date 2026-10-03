import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAudioBlobFromIndexedDb, saveAudioBlobToIndexedDb } from "./audioStorage";

vi.mock("../platform", () => ({ canUseNativeAudioStorage: () => false }));
afterEach(() => vi.unstubAllGlobals());

const mockDb = () => {
  const request = { result: undefined as unknown, error: null as Error | null, onsuccess: null as (() => void) | null };
  const store = { put: vi.fn(() => request), get: vi.fn(() => request) };
  const tx = { objectStore: () => store, error: null as Error | null,
    oncomplete: null as (() => void) | null, onabort: null as (() => void) | null,
    onerror: null as ((event: unknown) => void) | null, abort: vi.fn(() => queueMicrotask(() => tx.onabort?.())) };
  const db = { transaction: vi.fn(() => tx), close: vi.fn(), onversionchange: null };
  const openRequest = { result: db, onsuccess: null as (() => void) | null };
  const open = vi.fn(() => { queueMicrotask(() => openRequest.onsuccess?.()); return openRequest; });
  vi.stubGlobal("window", { indexedDB: { open } });
  return { request, store, tx, db, open };
};
const save = () => saveAudioBlobToIndexedDb(new Blob(["audio"], { type: "audio/wav" }), { name: "anonymous.wav", duration: 1 });

describe("audio IndexedDB completion boundary", () => {
  it("does not resolve on put success; closes and resolves on transaction completion", async () => {
    const mock = mockDb();
    let resolved = false;
    const saving = save().then(meta => { resolved = true; return meta; });
    await vi.waitFor(() => expect(mock.store.put).toHaveBeenCalledOnce());
    expect(mock.open).toHaveBeenCalledWith("tairetsu-maker-audio", 1);
    expect(mock.db.transaction).toHaveBeenCalledWith("audio-files", "readwrite", { durability: "strict" });
    mock.request.onsuccess!();
    await Promise.resolve(); await Promise.resolve();
    expect(resolved).toBe(false);
    expect(mock.db.close).not.toHaveBeenCalled();
    mock.tx.oncomplete!();
    expect(await saving).toMatchObject({ name: "anonymous.wav", size: 5 });
    expect(mock.db.close).toHaveBeenCalledOnce();
  });
  it("rejects an abort AFTER the put succeeded", async () => {
    const mock = mockDb();
    const saving = save();
    const rejected = expect(saving).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(mock.store.put).toHaveBeenCalledOnce());
    mock.request.onsuccess!();
    mock.tx.onabort!();
    await rejected;
    expect(mock.db.close).toHaveBeenCalledOnce();
  });
  it("returns null only for absent audio", async () => {
    const mock = mockDb();
    const reading = loadAudioBlobFromIndexedDb("audio-missing");
    await vi.waitFor(() => expect(mock.store.get).toHaveBeenCalledOnce());
    mock.request.onsuccess!(); mock.tx.oncomplete!();
    expect(await reading).toBeNull();
  });
  it("rejects request/access failure and preserves its cause", async () => {
    const mock = mockDb();
    const reading = loadAudioBlobFromIndexedDb("audio-existing");
    const error = new DOMException("denied", "SecurityError");
    const rejected = expect(reading).rejects.toBe(error);
    await vi.waitFor(() => expect(mock.store.get).toHaveBeenCalledOnce());
    mock.request.error = error;
    mock.tx.onerror!({ target: mock.request });
    await rejected;
    expect(mock.tx.abort).toHaveBeenCalledOnce();
    expect(mock.db.close).toHaveBeenCalledOnce();
  });
  it("rejects malformed records instead of treating them as absent", async () => {
    const mock = mockDb();
    const reading = loadAudioBlobFromIndexedDb("audio-existing");
    const rejected = expect(reading).rejects.toThrow("保存済み音源データを読み込めません。");
    await vi.waitFor(() => expect(mock.store.get).toHaveBeenCalledOnce());
    mock.request.result = { id: "audio-existing", blob: "not-a-blob" };
    mock.request.onsuccess!(); mock.tx.oncomplete!();
    await rejected;
  });
  it("closes the connection when put throws synchronously", async () => {
    const mock = mockDb();
    const error = new DOMException("quota", "QuotaExceededError");
    mock.store.put.mockImplementation(() => { throw error; });
    await expect(save()).rejects.toBe(error);
    expect(mock.db.close).toHaveBeenCalledOnce();
  });
});
