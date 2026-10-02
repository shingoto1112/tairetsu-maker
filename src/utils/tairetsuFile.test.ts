import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import type { Project } from "../types";
import {
  createTairetsuArchive,
  readTairetsuArchive,
} from "./tairetsuFile";

const toFile = async (
  blob: Blob,
  name: string,
  type = "application/zip",
): Promise<File> => new File([await blob.arrayBuffer()], name, { type });

describe("tairetsu file compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips the shared project shape through ZIP/.tairetsu", async () => {
    const source = createSampleProject();
    const archive = await createTairetsuArchive(source);

    const imported = await readTairetsuArchive(
      await toFile(archive, "sample.tairetsu", "application/octet-stream"),
    );

    expect(imported.audioBlob).toBeNull();
    expect(imported.project).toEqual({ ...source, audio: null });
    expect(source.focusMemberId).toBeTruthy();
    expect(imported.project.focusMemberId).toBe(source.focusMemberId);
  });

  it("preserves an included audio file and its project metadata", async () => {
    const source: Project = {
      ...createSampleProject(),
      audio: {
        id: "audio-compat",
        name: "parade.m4a",
        size: 4,
        type: "audio/mp4",
      },
    };
    const audio = new Blob([new Uint8Array([9, 8, 7, 6])], {
      type: "audio/mp4",
    });

    const archive = await createTairetsuArchive(source, { audioBlob: audio });
    const imported = await readTairetsuArchive(
      await toFile(archive, "audio-project.zip"),
    );

    expect(imported.project).toEqual(source);
    expect(imported.audioFileName).toBe("audio.m4a");
    expect([
      ...new Uint8Array(await imported.audioBlob!.arrayBuffer()),
    ]).toEqual([9, 8, 7, 6]);
  });

  it("imports both raw and wrapped legacy JSON project files", async () => {
    const source = createSampleProject();
    const raw = new File([JSON.stringify(source)], "project.json", {
      type: "application/json",
    });
    const wrapped = new File(
      [JSON.stringify({ project: source })],
      "project-wrapper.json",
      { type: "application/json" },
    );

    await expect(readTairetsuArchive(raw)).resolves.toMatchObject({
      audioBlob: null,
      project: source,
    });
    await expect(readTairetsuArchive(wrapped)).resolves.toMatchObject({
      audioBlob: null,
      project: source,
    });
  });

  it("recovers a valid project when a sharing service wraps it in another ZIP", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const source = createSampleProject();
    const innerArchive = await createTairetsuArchive(source);
    const outerZip = new JSZip();
    outerZip.file("shared-file.tairetsu", await innerArchive.arrayBuffer());
    const outerArchive = await outerZip.generateAsync({ type: "blob" });

    const imported = await readTairetsuArchive(
      await toFile(outerArchive, "line-download.zip"),
    );

    expect(imported.project).toEqual({ ...source, audio: null });
  });

  it("rejects a ZIP that does not contain a project", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const zip = new JSZip();
    zip.file("readme.txt", "not a project");
    const invalidArchive = await zip.generateAsync({ type: "blob" });

    await expect(
      readTairetsuArchive(await toFile(invalidArchive, "invalid.zip")),
    ).rejects.toThrow("manifest.json または project.json");
  });

  it("rejects empty, oversized, and excessive-entry imports before extraction", async () => {
    await expect(
      readTairetsuArchive(new File([], "empty.tairetsu")),
    ).rejects.toThrow("空です");

    const oversized = new File(["PK"], "oversized.tairetsu");
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: 256 * 1024 * 1024 + 1,
    });
    await expect(readTairetsuArchive(oversized)).rejects.toThrow("256MB以下");

    const crowdedZip = new JSZip();
    for (let index = 0; index < 65; index += 1) {
      crowdedZip.file(`entry-${index}.txt`, "x");
    }
    const crowdedArchive = await crowdedZip.generateAsync({ type: "blob" });
    await expect(
      readTairetsuArchive(await toFile(crowdedArchive, "crowded.zip")),
    ).rejects.toThrow("64件以下");
  });
});
