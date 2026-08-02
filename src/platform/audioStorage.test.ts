// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const audioMocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  files: new Map<string, string>(),
  getAppRuntime: vi.fn(() => "capacitor-ios"),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("./runtime", () => ({
  getAppRuntime: audioMocks.getAppRuntime,
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "UTF8" },
  Filesystem: {
    deleteFile: audioMocks.deleteFile,
    readFile: audioMocks.readFile,
    writeFile: audioMocks.writeFile,
  },
}));

import {
  deleteNativeAudioBlob,
  loadNativeAudioBlob,
  saveNativeAudioBlob,
} from "./audioStorage";

describe("native audio storage", () => {
  beforeEach(() => {
    audioMocks.files.clear();
    audioMocks.getAppRuntime.mockReturnValue("capacitor-ios");
    audioMocks.writeFile.mockReset().mockImplementation(({ data, path }) => {
      audioMocks.files.set(path, data);
      return Promise.resolve({ uri: `file://${path}` });
    });
    audioMocks.readFile.mockReset().mockImplementation(({ path }) => {
      const value = audioMocks.files.get(path);
      return value === undefined
        ? Promise.reject(new Error("missing"))
        : Promise.resolve({ data: value });
    });
    audioMocks.deleteFile.mockReset().mockImplementation(({ path }) => {
      audioMocks.files.delete(path);
      return Promise.resolve();
    });
  });

  it("round-trips an audio blob with its MIME type", async () => {
    const source = new Blob([new Uint8Array([0, 1, 2, 127, 255])], {
      type: "audio/mpeg",
    });

    await saveNativeAudioBlob("audio-1", source, source.type);
    const restored = await loadNativeAudioBlob("audio-1");

    expect(restored?.type).toBe("audio/mpeg");
    expect([...new Uint8Array(await restored!.arrayBuffer())]).toEqual([
      0, 1, 2, 127, 255,
    ]);
  });

  it("returns null for incomplete native audio data", async () => {
    audioMocks.files.set("audio/audio-missing.data", "AAEC");

    await expect(loadNativeAudioBlob("audio-missing")).resolves.toBeNull();
  });

  it("deletes both audio data and metadata", async () => {
    audioMocks.files.set("audio/audio-delete.data", "AAEC");
    audioMocks.files.set(
      "audio/audio-delete.json",
      JSON.stringify({ type: "audio/mpeg" }),
    );

    await deleteNativeAudioBlob("audio-delete");

    expect(audioMocks.files.size).toBe(0);
  });

  it("does not access native audio storage outside iPad", async () => {
    audioMocks.getAppRuntime.mockReturnValue("web");

    await saveNativeAudioBlob("audio-web", new Blob(["web"]), "audio/mpeg");

    await expect(loadNativeAudioBlob("audio-web")).resolves.toBeNull();
    expect(audioMocks.writeFile).not.toHaveBeenCalled();
  });
});
